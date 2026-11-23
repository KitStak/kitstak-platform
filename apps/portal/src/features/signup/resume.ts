/**
 * Where a person should be right now (docs/billing/SPEC.md section 5.6). PURE: the server gathers
 * the facts, this decides. Closing the tab at any point loses nothing, because every answer here
 * comes from real rows, not from the browser.
 */

export type SignupStep = '/signup' | '/signup/company' | '/signup/plan' | '/verify-email' | '/welcome' | '/';

export interface SignupFacts {
  readonly signedIn: boolean;
  readonly hasOrg: boolean;
  /** Owner, admin or billing manager of the active organization. */
  readonly canStartTrial: boolean;
  /** Owner or admin: the people who see the welcome wizard. */
  readonly isManager: boolean;
  /** No free trial was ever started and there is no plan. */
  readonly planUntouched: boolean;
  readonly hasOpenIntent: boolean;
  readonly emailVerified: boolean;
  readonly verifySkipped: boolean;
  readonly profileSaved: boolean;
}

export function resolveSignupStep(facts: SignupFacts): SignupStep {
  if (!facts.signedIn) return '/signup';
  if (!facts.hasOrg) return '/signup/company';
  // Everything below is the tail of a signup. A person with no open signup is simply home.
  if (!facts.hasOpenIntent) return '/';
  if (facts.planUntouched) return facts.canStartTrial ? '/signup/plan' : '/';
  if (!facts.emailVerified && !facts.verifySkipped) return '/verify-email';
  if (facts.isManager && !facts.profileSaved) return '/welcome';
  return '/';
}

/** The link for a step. Verification always knows where to send the person next. */
export function stepHref(step: SignupStep): string {
  return step === '/verify-email' ? '/verify-email?next=/welcome' : step;
}
