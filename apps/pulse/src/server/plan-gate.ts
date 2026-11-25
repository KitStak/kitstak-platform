/**
 * The plan gate (docs/billing/CONTRACTS.md section 18): one check for route handlers, server
 * actions, cron and device links. Not in the plan: everything is refused. View only: reads pass,
 * every change is refused with one plain sentence. Kept apart from `plan.ts` so the hot path loads
 * no billing code.
 */
import 'server-only';
import { orgPulseAccess } from '@/server/entitlements';
import { DomainError } from '@/server/errors';

/** The one sentence every refused write shows in view only (SPEC 9.4). */
export const PLAN_READ_ONLY_MESSAGE = 'Your plan is view only right now. Pick a plan in the Portal to make changes.';
/** The sentence for a call to an app that is not in the plan. */
export const PLAN_LOCKED_MESSAGE = 'Pulse is not in your plan yet. Add it in the Portal to use it.';

/** Methods that never change data. Everything else is a write. */
export function isPlanSafeMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
}

/**
 * Throws when the org may not do this. `write: false` is a read (a GET, or an action marked as a
 * read): it passes in view only. `write: true` needs full access.
 */
export async function assertPlanAllows(orgId: string, kind: { readonly write: boolean }): Promise<void> {
  const access = await orgPulseAccess(orgId);
  if (access === 'locked') throw new DomainError('NOT_ENTITLED', PLAN_LOCKED_MESSAGE);
  if (access === 'read_only' && kind.write) throw new DomainError('plan.read_only', PLAN_READ_ONLY_MESSAGE);
}
