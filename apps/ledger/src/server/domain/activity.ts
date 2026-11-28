/**
 * The audit trail (docs/ledger/SPEC.md 4.12): one append only `ledger.activity` row per change,
 * written in the same transaction as the change.
 */
import 'server-only';
import { activity } from '@/server/db/schema';
import type { Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { actorUserId, type DomainContext } from './_shared';

export interface ActivityInput {
  /** `entity.verb`, for example `role.changed` or `journal.posted`. */
  readonly verb: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly meta?: Record<string, unknown>;
}

/** Writes one activity row and returns its id. `executor` is the write transaction. */
export const logActivity = scoped(async function logActivity(executor: Executor, ctx: DomainContext, input: ActivityInput): Promise<string> {
  const [row] = await executor
    .insert(activity)
    .values({
      orgId: ctx.orgId,
      actorId: actorUserId(ctx),
      actorKind: ctx.actorKind,
      verb: input.verb,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      meta: input.meta ?? {},
    })
    .returning({ id: activity.id });
  return row!.id;
}, 1);
