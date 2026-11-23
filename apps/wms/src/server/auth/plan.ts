/**
 * The WMS's view of the organization's plan (docs/billing/CONTRACTS.md section 18): one call for
 * the app shell (`getPlanView`: access level, the banner, the lock screen, the app switcher badges),
 * one for the settings "Plan" card (`getPlanSummary`), and the warehouse limit check. Reads only.
 * Every word and every link comes from `@kitstak/billing`, so the WMS says the same thing as the
 * Portal and the other apps.
 *
 * In the WMS the word "billing" already means 3PL client billing, so this area is called "Plan"
 * on screen and there is no WMS route named `/billing` for it.
 *
 * The plan lives in `core` tables, so every read here uses the PLATFORM handle, never a tenant one.
 */
import { and, eq, sql } from 'drizzle-orm';
import { member } from '@kitstak/db/schema';
import { CATALOG, formatDay, formatMoney } from '@kitstak/billing/catalog';
import { billingLink } from '@kitstak/billing/links';
import {
  billingMode,
  checkSeatAvailable,
  checkWarehouseAvailable,
  getAppPlanView,
  getBillingAccess,
  getPlanState,
  rows,
  type AppPlanView,
  type BillingDb,
  type BillingReadDb,
} from '@kitstak/billing/server';
import { planSummaryFor, type PlanSummaryView } from '@kitstak/ui/plan-summary-model';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import { entitlementsAllowAll } from '@/server/auth/entitlements';

/** Portal origin, no trailing slash. The dev default matches the dev port. */
export function portalUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_PORTAL_URL?.trim() || 'http://localhost:3300').replace(/\/+$/, '');
}

/** Marketing site origin, for "Talk to us". */
function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://kitstak.com').replace(/\/+$/, '');
}

/** The WMS platform handle (postgres-js) satisfies the billing read seam structurally. */
const billingDb = (db: AppDb): BillingReadDb => db as unknown as BillingReadDb;

/** Link into the Portal's billing area with the WMS as the way back. */
export function wmsPlanLink(intent: Parameters<typeof billingLink>[1]): string {
  return billingLink(portalUrl(), intent, 'wms');
}

export interface PlanViewInput {
  readonly orgId: string;
  /** The core user id (the Better Auth user), which is also the WMS user id. */
  readonly userId: string;
  /** The raw `core.member.role` string. Looked up when left out. */
  readonly role?: string;
  readonly timeZone?: string;
}

/** The person's role string in the org (`core.member.role`), or '' when they are not a member. */
export async function memberRole(platformDb: AppDb, orgId: string, userId: string): Promise<string> {
  const row = (
    await platformDb
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1)
  )[0];
  return row?.role ?? '';
}

/** A view with nothing to say: full access, no banner. Used when the gate is off and nothing is readable. */
const QUIET_VIEW: AppPlanView = {
  access: 'full',
  notice: null,
  lock: null,
  badges: { crm: 'included', wms: 'included', projects: 'included', pulse: 'included' },
  usage: { seatsUsed: 0, seatsPaid: null, seatLimit: null, pendingInvites: 0, warehousesUsed: null, warehousesPaid: null },
};

/** Access level, banner, lock screen and badges for this person in the WMS. */
export async function getPlanView(platformDb: AppDb, input: PlanViewInput): Promise<AppPlanView> {
  const allowAll = entitlementsAllowAll();
  try {
    const role = input.role ?? (await memberRole(platformDb, input.orgId, input.userId));
    return await getAppPlanView(billingDb(platformDb), {
      orgId: input.orgId,
      userId: input.userId,
      role,
      module: 'wms',
      portalUrl: portalUrl(),
      allowAll,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    });
  } catch (error) {
    // A local database without the core billing tables (PGlite dev, unit tests) has no plan to
    // read. With the gate off that is fine: stay quiet. With the gate on, fail closed.
    if (allowAll) return QUIET_VIEW;
    throw error;
  }
}

/** The "Plan" card in WMS settings (SPEC 9.5), with warehouses in use. */
export async function getPlanSummary(platformDb: AppDb, input: PlanViewInput): Promise<PlanSummaryView> {
  const now = new Date();
  const role = input.role ?? (await memberRole(platformDb, input.orgId, input.userId));
  const [view, state, access] = await Promise.all([
    getPlanView(platformDb, { ...input, role }),
    // `getPlanState` only reads; its parameter type is the wider write seam.
    getPlanState({ db: platformDb as unknown as BillingDb, mode: billingMode(), now: () => now }, input.orgId),
    getBillingAccess(billingDb(platformDb), { orgId: input.orgId, userId: input.userId, role }),
  ]);
  return planSummaryFor({
    app: 'wms',
    state,
    badge: view.badges.wms,
    openAccess: entitlementsAllowAll() && state.phase === 'none',
    canView: access.canView,
    ownerName: access.ownerName,
    billingHref: wmsPlanLink({ to: 'home' }),
    pulseIncludedSeats: CATALOG.products.pulse.includedSeats ?? 0,
    contactHref: `${siteUrl()}/contact`,
    format: { money: (cents) => formatMoney(cents), day: (date) => formatDay(date, input.timeZone) },
  });
}

let billingTablesSeen = false;

/**
 * True when this database has the core billing tables. A local PGlite database (dev without
 * DATABASE_URL, unit tests) has none: there is no plan there, so there is no limit to check. Asked
 * with `to_regclass`, which never fails, because a failed statement would abort a caller's open
 * transaction. A yes is remembered for the life of the process.
 */
async function hasBillingTables(db: AppDb): Promise<boolean> {
  if (billingTablesSeen) return true;
  const result = await billingDb(db).execute(
    sql`SELECT to_regclass('core.billing_subscriptions') IS NOT NULL AND to_regclass('core.invitation') IS NOT NULL AS "ok"`,
  );
  const ok = rows<{ ok: boolean | string }>(result)[0]?.ok;
  billingTablesSeen = ok === true || ok === 't' || ok === 'true';
  return billingTablesSeen;
}

/** Where the person comes back to in the WMS after they changed the plan in the Portal. */
const WAREHOUSES_PAGE = '/settings/warehouses';

/** Adds the WMS page to return to. The Portal only accepts a plain path on the calling app. */
function withReturn(link: string, path: string): string {
  return `${link}${link.includes('?') ? '&' : '?'}return=${encodeURIComponent(path)}`;
}

export interface WarehouseLimitNotice {
  /** "Your plan covers 1 warehouse. Add one more for $279.20 more per month." */
  readonly message: string;
  /** The Portal plan picker with one more warehouse, and the way back to the warehouses page. */
  readonly planUrl: string;
}

/**
 * The warehouse limit, known BEFORE the form opens (SPEC 6.9): null while one more warehouse fits
 * the plan (or there is no limit), else the sentence with the price and the link. The shell hands it
 * to the warehouses page, so "Create warehouse" at the limit shows the price first, not after a
 * person filled in the whole form.
 */
export async function warehouseLimitNotice(platformDb: AppDb, orgId: string): Promise<WarehouseLimitNotice | null> {
  try {
    if (!(await hasBillingTables(platformDb))) return null;
    const check = await checkWarehouseAvailable(billingDb(platformDb), { orgId, adding: 1 });
    if (check.ok) return null;
    return { message: check.message, planUrl: withReturn(wmsPlanLink({ to: 'warehouses', warehouses: check.used + 1 }), WAREHOUSES_PAGE) };
  } catch {
    // The limit is checked again on save. A failed read here never blocks the page.
    return null;
  }
}

/**
 * The warehouse limit of the paid plan (SPEC P7, section 6.9): throws PLAN_WAREHOUSE_LIMIT with
 * the plain sentence and the price when `adding` more active warehouses would pass what the plan
 * covers. During a free trial, with no paid plan, and when WMS is not paid for there is no limit.
 * Nothing here changes a charge: the person sees the price and says yes in the Portal first (P10).
 */
export async function assertWarehouseAvailable(platformDb: AppDb, orgId: string, adding: number): Promise<void> {
  if (adding <= 0 || !(await hasBillingTables(platformDb))) return;
  const check = await checkWarehouseAvailable(billingDb(platformDb), { orgId, adding });
  if (check.ok) return;
  throw new AppError('PLAN_WAREHOUSE_LIMIT', check.message, {
    details: {
      module: 'wms',
      paid: check.paid,
      used: check.used,
      // The picker opens with the new count; the person confirms the price there, then comes back.
      planUrl: withReturn(wmsPlanLink({ to: 'warehouses', warehouses: check.used + adding }), WAREHOUSES_PAGE),
    },
  });
}

/**
 * The seat limit of the paid plan (SPEC P6, section 6.9): throws PLAN_SEAT_LIMIT with the plain
 * sentence when one more person with `role` would pass the plan's seats. During a free trial,
 * with no paid plan, for guests and for a plan with WMS alone there is no limit. `platformDb` may
 * be any handle that reaches the `core` tables. Nothing here changes a charge (P10).
 */
export async function assertSeatAvailable(platformDb: AppDb, orgId: string, role: string): Promise<void> {
  if (!(await hasBillingTables(platformDb))) return;
  const check = await checkSeatAvailable(billingDb(platformDb), { orgId, adding: 1, role });
  if (check.ok) return;
  // In the WMS "Billing" is 3PL client billing, and people are added here, not invited. So the
  // shared sentence ("Add a seat in Billing, then invite again.") gets WMS words (CONTRACTS 1.10).
  const message = check.pulseOnly
    ? check.message
    : `All ${check.limit} ${check.limit === 1 ? 'seat is' : 'seats are'} in use. Add a seat to your plan, then add this person.`;
  throw new AppError('PLAN_SEAT_LIMIT', message, {
    details: {
      module: 'wms',
      limit: check.limit,
      used: check.used,
      ...(check.pulseOnly ? {} : { planUrl: wmsPlanLink({ to: 'seats' }) }),
    },
  });
}
