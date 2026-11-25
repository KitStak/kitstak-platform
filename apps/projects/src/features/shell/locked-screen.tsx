import { PlanLockScreen, type PlanLockView } from '@kitstak/ui/plan-lock';

/**
 * Shown inside the app frame when Projects is not in the org's plan. A thin wrapper over the
 * shared `PlanLockScreen`: the title, the price and both links come from `planLockFor` in
 * `@kitstak/billing`, so every KitStak app shows the same screen (docs/billing/SPEC.md 9.3).
 */
export function LockedScreen({ lock }: { readonly lock: PlanLockView }) {
  return <PlanLockScreen app="projects" lock={lock} />;
}
