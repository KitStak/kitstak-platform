/**
 * Projects' view of the organization's plan (docs/billing/CONTRACTS.md section 18): one call for
 * the app shell (`getPlanView`: access level, the banner, the lock screen, the app switcher badges)
 * and one for the settings "Plan and payment" row (`getPlanSummary`). Reads only. Every word and
 * every link comes from `@kitstak/billing`, so Projects says the same thing as the Portal and the
 * other apps.
 */
import 'server-only';
import { CATALOG, formatDay, formatMoney } from '@kitstak/billing/catalog';
import { billingLink } from '@kitstak/billing/links';
import { billingMode, getAppPlanView, getBillingAccess, getPlanState, type AppPlanView } from '@kitstak/billing/server';
import { planSummaryFor, type PlanSummaryView } from '@kitstak/ui/plan-summary-model';
import { db } from '@/server/db';
import { entitlementsAllowAll } from '@/server/entitlements';
import { appUrls } from '@/server/env';

/** Marketing site origin, for "Talk to us". */
function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://kitstak.com').replace(/\/+$/, '');
}

export interface PlanViewInput {
  readonly orgId: string;
  readonly userId: string;
  /** The raw `core.member.role` string (a comma list). */
  readonly role: string;
  readonly timeZone?: string;
}

/**
 * A view with nothing to say: full access, no banner. Used only when the plan gate is off
 * (allow-all) and the plan cannot be read, for example a local database without the billing
 * tables. That keeps the app able to run on its own. With the gate on, a failed read is an error.
 */
const QUIET_VIEW: AppPlanView = {
  access: 'full',
  notice: null,
  lock: null,
  badges: { crm: 'included', wms: 'included', projects: 'included', pulse: 'included' },
  usage: { seatsUsed: 0, seatsPaid: null, seatLimit: null, pendingInvites: 0, warehousesUsed: null, warehousesPaid: null },
};

/** Access level, banner, lock screen and badges for this person in Projects. */
export async function getPlanView(input: PlanViewInput): Promise<AppPlanView> {
  const allowAll = entitlementsAllowAll();
  try {
    return await getAppPlanView(db, { ...input, module: 'projects', portalUrl: appUrls().portal, allowAll });
  } catch (error) {
    if (allowAll) return QUIET_VIEW;
    throw error;
  }
}

/** Link into Portal billing with Projects as the way back. */
export function projectsBillingLink(intent: Parameters<typeof billingLink>[1]): string {
  return billingLink(appUrls().portal, intent, 'projects');
}

/** The "Plan and payment" row in Projects settings (SPEC 9.5). */
export async function getPlanSummary(input: PlanViewInput): Promise<PlanSummaryView> {
  const now = new Date();
  const [view, state, access] = await Promise.all([
    getPlanView(input),
    getPlanState({ db, mode: billingMode(), now: () => now }, input.orgId),
    getBillingAccess(db, { orgId: input.orgId, userId: input.userId, role: input.role }),
  ]);
  return planSummaryFor({
    app: 'projects',
    state,
    badge: view.badges.projects,
    openAccess: entitlementsAllowAll() && state.phase === 'none',
    canView: access.canView,
    ownerName: access.ownerName,
    billingHref: projectsBillingLink({ to: 'home' }),
    pulseIncludedSeats: CATALOG.products.pulse.includedSeats ?? 0,
    contactHref: `${siteUrl()}/contact`,
    format: { money: (cents) => formatMoney(cents), day: (date) => formatDay(date, input.timeZone) },
  });
}
