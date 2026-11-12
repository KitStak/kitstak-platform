/**
 * The login page advertises the seeded demo credentials only when BOTH hold:
 * the build is not production, AND the operator opted in with DEMO_MODE=1 (or "true").
 * A production build never prints them, whatever DEMO_MODE says.
 */
const ENABLED_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'yes', 'on']);

export interface DemoEnv {
  readonly NODE_ENV?: string;
  readonly DEMO_MODE?: string;
}

export function demoCredentialsEnabled(env: DemoEnv): boolean {
  if (env.NODE_ENV === 'production') return false;
  return ENABLED_VALUES.has((env.DEMO_MODE ?? '').trim().toLowerCase());
}
