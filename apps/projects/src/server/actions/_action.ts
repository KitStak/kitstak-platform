/**
 * Server action plumbing (NOT a 'use server' file). Every action in src/server/actions/*.ts:
 *
 *   export async function updateTaskAction(input: UpdateTaskActionInput) {
 *     return runAction(updateTaskSchema, input, (data, ctx) => updateTask(ctx, data.taskId, data.patch));
 *   }
 *
 * runAction: zod-validates the input, resolves the signed-in context + plan gate, calls the
 * domain function (which checks permissions), converts DomainErrors into a typed failure and
 * revalidates the app layout so server components refresh. Actions never throw to the client.
 */
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { isDomainError, type ErrorCode } from '@/server/errors';
import { assertPlanAllows } from '@/server/plan-gate';
import { requireActionContext } from '@/server/session';

export interface ActionError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fields?: Readonly<Record<string, string>>;
}

export type ActionResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ActionError };

export interface RunActionOptions {
  /** Revalidate the whole app layout after success (default true). Pass false for chatty actions (timers, visits). */
  readonly revalidate?: boolean;
  /**
   * Marks an action that changes no business data: a preview, a lookup, a "seen" marker or a
   * personal preference. It keeps working while the plan is view only (docs/billing/SPEC.md
   * section 9.4). Every other action is refused in view only with code `plan.read_only`.
   */
  readonly read?: boolean;
}

function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function toActionError(error: unknown): ActionError {
  if (isDomainError(error)) return { code: error.code, message: error.message, fields: error.fields };
  if (error instanceof z.ZodError) {
    return { code: 'VALIDATION', message: 'Some fields need another look.', fields: zodFields(error) };
  }
  console.error('[projects] action failed', error);
  return { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' };
}

export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  handler: (data: z.output<S>, ctx: DomainContext) => Promise<T>,
  options: RunActionOptions = {},
): Promise<ActionResult<T>> {
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Some fields need another look.', fields: zodFields(parsed.error) } };
    }
    const context = await requireActionContext();
    await assertPlanAllows(context.org.id, { write: options.read !== true });
    const data = await handler(parsed.data, toDomainContext(context));
    if (options.revalidate !== false) revalidatePath('/', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Public (no sign-in) variant for intake forms. */
export async function runPublicAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  handler: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Some answers need another look.', fields: zodFields(parsed.error) } };
    }
    return { ok: true, data: await handler(parsed.data) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
