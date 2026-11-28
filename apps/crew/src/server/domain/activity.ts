/** The append only activity log (crew.activity). Every write logs one row in the same transaction. */
import 'server-only';
import { scoped } from '@/server/db/scope';
import { activity } from '@/server/db/schema';
import type { Executor } from '@/server/db';
import type { DomainContext } from './_shared';

export interface ActivityInput {
  readonly verb: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly meta?: Record<string, unknown>;
}

export const logActivity = scoped(async function logActivity(executor: Executor, ctx: DomainContext, input: ActivityInput): Promise<void> {
  await executor.insert(activity).values({
    orgId: ctx.orgId,
    actorId: ctx.actorKind === 'user' ? ctx.userId : null,
    actorKind: ctx.actorKind,
    verb: input.verb,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta ?? {},
  });
}, 1);
