/**
 * The plan gate (docs/billing/CONTRACTS.md section 18), the Pulse file with the word Pulse swapped:
 * one check for route handlers, server actions, cron and device links. Before launch it only ever
 * sees `full` or `locked` (docs/crew/SPEC.md 3.4); the launch shaped `read_only` branch is kept so
 * nothing here changes when Crew becomes a billed module.
 */
import 'server-only';
import { orgCrewAccess, type AccessOrg } from '@/server/entitlements';
import { DomainError } from '@/server/errors';

/** The one sentence every refused write shows in view only (billing SPEC 9.4). */
export const PLAN_READ_ONLY_MESSAGE = 'Your plan is view only right now. Pick a plan in the Portal to make changes.';
/** The sentence for a call from a workspace that is not in the preview (SPEC 3.4). */
export const PLAN_LOCKED_MESSAGE = 'Crew is in preview. Ask KitStak to add your workspace.';

/** Methods that never change data. Everything else is a write. */
export function isPlanSafeMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
}

/** Throws NOT_ENTITLED (402) when the org may not use Crew. `write: true` would also need full access. */
export async function assertPlanAllows(org: AccessOrg, kind: { readonly write: boolean }): Promise<void> {
  const access = await orgCrewAccess(org);
  if (access === 'locked') throw new DomainError('NOT_ENTITLED', PLAN_LOCKED_MESSAGE);
  if (access === 'read_only' && kind.write) throw new DomainError('plan.read_only', PLAN_READ_ONLY_MESSAGE);
}
