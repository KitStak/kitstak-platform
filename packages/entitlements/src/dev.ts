/**
 * Dev allow-all switch (BLUEPRINT.md §3.2 `src/dev.ts`).
 *
 * `ENTITLEMENTS_DEV_ALLOW_ALL=1` (or `true`) short-circuits `hasModule` to entitled,
 * so every app builds and runs without any billing configured — the buildability
 * guarantee while Stripe integration is deferred.
 *
 * Posture per environment:
 *  - dev/test: each app's env defaults (`.env.example` → `.env.local`, seeds, CI env)
 *    set `ENTITLEMENTS_DEV_ALLOW_ALL=1`, so entitlements never block local work.
 *  - production: the variable must stay UNSET. Orgs are then gated by explicit rows in
 *    `core.entitlements` (today: manual grants via `pnpm --filter @kitstak/entitlements grant`).
 *
 * The switch is read per call (not cached at import) so tests and scripts can toggle it.
 */

const TRUTHY = new Set(['1', 'true']);

/** True when the environment opts into allow-all entitlements. */
export function isDevAllowAll(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.ENTITLEMENTS_DEV_ALLOW_ALL?.trim().toLowerCase() ?? '';
  return TRUTHY.has(value);
}
