/**
 * Pulse's view of the organization's plan (docs/billing/CONTRACTS.md section 18): one call for the
 * app shell (`getPlanView`: access level, the banner, the lock screen, the app switcher badges) and
 * one for the settings "Plan and payment" row (`getPlanSummary`). Reads only. Every word and every
 * link comes from `@kitstak/billing`, so Pulse says the same thing as the Portal and the other apps.
 *
 * The plan lives in `core` (billing accounts, the subscription, entitlements, members), not in a
 * Pulse workspace table, so these reads run with `asSystem`, like the entitlement check. Each one
 * is keyed by the org id of the signed in person's active workspace.
 */
import 'server-only';
import { CATALOG, formatDay, formatMoney } from '@kitstak/billing/catalog';
import { billingLink } from '@kitstak/billing/links';
import { billingMode, getAppPlanView, getBillingAccess, getPlanState, type AppPlanView } from '@kitstak/billing/server';
import { planSummaryFor, type PlanSummaryView } from '@kitstak/ui/plan-summary-model';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';
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
  usage: { seatsUsed: 0, seatsPaid: null, seatLimit: null, pendingInvites: 0, seatFloor: 0, warehousesUsed: null, warehousesPaid: null },
};

/** Access level, banner, lock screen and badges for this person in Pulse. */
export async function getPlanView(input: PlanViewInput): Promise<AppPlanView> {
  const allowAll = entitlementsAllowAll();
  try {
    return await asSystem('plan state lives in core billing tables, read for the active workspace', () =>
      getAppPlanView(db, { ...input, module: 'pulse', portalUrl: appUrls().portal, allowAll }),
    );
  } catch (error) {
    if (allowAll) return QUIET_VIEW;
    throw error;
  }
}

/** Link into Portal billing with Pulse as the way back. */
export function pulseBillingLink(intent: Parameters<typeof billingLink>[1], orgId?: string): string {
  // With the organization named, the Portal opens the page for it, whichever one was used last there.
  return billingLink(appUrls().portal, intent, 'pulse', orgId);
}

/** Seats the flat Pulse price covers (SPEC P8). */
export const PULSE_INCLUDED_SEATS = CATALOG.products.pulse.includedSeats ?? 0;

/** The "Plan and payment" row in Pulse settings (SPEC 9.5), with the Pulse seat rule. */
export async function getPlanSummary(input: PlanViewInput): Promise<PlanSummaryView> {
  const now = new Date();
  const [view, state, access] = await Promise.all([
    getPlanView(input),
    asSystem('plan state lives in core billing tables, read for the active workspace', () =>
      getPlanState({ db, mode: billingMode(), now: () => now }, input.orgId),
    ),
    asSystem('billing roles live in core, read for the active workspace', () =>
      getBillingAccess(db, { orgId: input.orgId, userId: input.userId, role: input.role }),
    ),
  ]);
  return planSummaryFor({
    app: 'pulse',
    state,
    badge: view.badges.pulse,
    openAccess: entitlementsAllowAll() && state.phase === 'none',
    canView: access.canView,
    ownerName: access.ownerName,
    billingHref: pulseBillingLink({ to: 'home' }, input.orgId),
    pulseIncludedSeats: PULSE_INCLUDED_SEATS,
    contactHref: `${siteUrl()}/contact`,
    format: { money: (cents) => formatMoney(cents), day: (date) => formatDay(date, input.timeZone) },
  });
}
