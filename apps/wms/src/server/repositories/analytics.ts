/** Entry point for the native analytics dashboards: app gate → range/scope → permission shaping → builder. */
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { canAny } from "@/server/auth/permissions";
import {
  ANALYTICS_TITLES, BILLING_VIEW_PERMISSIONS, LABOR_APP, LABOR_TEAM_PERMISSION, NO_BILLING_NOTICE, OPERATIONAL_APP, SELF_ONLY_NOTICE,
  type AnalyticsPayload, type LaborPage, type OperationalPage,
} from "./analytics-types";
import { clientsFor, isAppActive, parseRange, warehousesFor, zoneOf, type AnalyticsQuery, type Range } from "./analytics-common";
import { buildLabor } from "./analytics-labor";
import { buildOperational } from "./analytics-operational";

/** Warehouses + clients in scope, and the range in the (first) warehouse's time zone. */
async function resolve(db: AppDb, auth: AuthContext, q: AnalyticsQuery): Promise<{ range: Range; wh: readonly string[] }> {
  const wh = warehousesFor(auth, q.wh);
  return { wh, range: parseRange(q, new Date(), await zoneOf(db, wh), clientsFor(auth, q.cl ?? [])) };
}

const baseOf = (page: LaborPage | OperationalPage, range: Range) => ({
  key: page, title: ANALYTICS_TITLES[page].title, range: { from: range.from, to: range.to, timeZone: range.tz },
});

/** Supervisors and up see every associate; anyone else sees only their own work. */
export const seesTeamLabor = (auth: Pick<AuthContext, "permissions">): boolean => canAny(auth, [LABOR_TEAM_PERMISSION]);
/** Revenue / billing money on the Management Dashboard follows the billing screens' view gate. */
export const seesBillingMoney = (auth: Pick<AuthContext, "permissions">): boolean => canAny(auth, BILLING_VIEW_PERMISSIONS);

export async function getLaborAnalytics(db: AppDb, auth: AuthContext, page: LaborPage, q: AnalyticsQuery): Promise<AnalyticsPayload> {
  const { range, wh } = await resolve(db, auth, q);
  const base = baseOf(page, range);
  if (!(await isAppActive(db, LABOR_APP.key))) return { ...base, gate: { appKey: LABOR_APP.key, appName: LABOR_APP.name, reason: "inactive" }, kpis: [], charts: [] };
  const team = seesTeamLabor(auth);
  const self = team ? null : { id: auth.user.id, name: auth.user.name, email: auth.user.email };
  return { ...base, gate: null, ...(await buildLabor(db, page, range, wh, self)), notice: team ? null : SELF_ONLY_NOTICE };
}

export async function getOperationalAnalytics(db: AppDb, auth: AuthContext, page: OperationalPage, q: AnalyticsQuery): Promise<AnalyticsPayload> {
  const { range, wh } = await resolve(db, auth, q);
  const base = baseOf(page, range);
  if (!(await isAppActive(db, OPERATIONAL_APP.key))) return { ...base, gate: { appKey: OPERATIONAL_APP.key, appName: OPERATIONAL_APP.name, reason: "inactive" }, kpis: [], charts: [] };
  const money = seesBillingMoney(auth);
  return { ...base, gate: null, ...(await buildOperational(db, page, range, wh, { money })), notice: page === "management" && !money ? NO_BILLING_NOTICE : null };
}
