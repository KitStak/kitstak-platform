/**
 * Server action plumbing (NOT a 'use server' file). Every action in src/server/actions/*.ts:
 *
 *   export async function claimLedgerAction() {
 *     return runAction(z.object({}), {}, (_data, ctx) => claimLedger(ctx));
 *   }
 *
 * runAction: zod validates the input, resolves the signed in context and the preview gate,
 * calls the domain function (which checks rights), turns DomainErrors into a typed failure and
 * revalidates the app layout so server components refresh. Actions never throw to the client.
 */
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg } from '@/server/db/scope';
import { asDomainError } from '@/server/domain/posting';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { assertLedgerOpen } from '@/server/entitlements';
import { isDomainError, type ErrorCode } from '@/server/errors';
import { requireActionContext } from '@/server/session';

export interface ActionError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fields?: Readonly<Record<string, string>>;
}

export type ActionResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ActionError };

export interface RunActionOptions {
  /** Revalidate the whole app layout after success (default true). */
  readonly revalidate?: boolean;
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
  const mapped = asDomainError(error);
  if (isDomainError(mapped)) return { code: mapped.code, message: mapped.message, fields: mapped.fields };
  if (mapped instanceof z.ZodError) return { code: 'VALIDATION', message: 'Some fields need another look.', fields: zodFields(mapped) };
  console.error('[ledger] action failed', error);
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
    assertLedgerOpen(context.org);
    const data = await withOrg(context.org.id, () => handler(parsed.data, toDomainContext(context)));
    if (options.revalidate !== false) revalidatePath('/', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
