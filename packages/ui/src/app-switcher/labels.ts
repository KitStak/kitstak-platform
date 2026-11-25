/**
 * Plan badge ids and their words on screen (docs/billing/CONTRACTS.md section 17). Kept out of the
 * client component file so server components can read the words too.
 */

/** The same strings as `PlanBadge` in `@kitstak/billing` (this package does not import it). */
export type AppSwitcherPlanBadge = 'trial' | 'active' | 'past_due' | 'view_only' | 'not_in_plan' | 'included';

/** Badge words on screen. Text, never color alone. */
export const APP_SWITCHER_BADGE_LABELS: Readonly<Record<AppSwitcherPlanBadge, string>> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Payment due',
  view_only: 'View only',
  not_in_plan: 'Not in your plan',
  included: 'Included',
};
