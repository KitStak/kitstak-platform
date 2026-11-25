/**
 * The plan gate's fixed words and its method rule (docs/billing/CONTRACTS.md section 18). No
 * imports, so `withApi`, the page guard, client code and tests can all share them.
 */

/** The one sentence every refused write shows in view only (SPEC 9.4). */
export const PLAN_READ_ONLY_MESSAGE = 'Your plan is view only right now. Pick a plan in the Portal to make changes.';
/** The sentence for an API call to an app that is not in the plan. */
export const PLAN_LOCKED_MESSAGE = 'CRM is not in your plan yet. Add it in the Portal to use it.';

/** Error codes of the two fixed 402 envelopes. */
export const PLAN_READ_ONLY_CODE = 'plan.read_only';
export const PLAN_LOCKED_CODE = 'entitlement.missing';

/** Methods that never change data. Everything else is a write. */
export function isPlanSafeMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
}
