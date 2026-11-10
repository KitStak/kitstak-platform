/** Entry point for the native analytics dashboards: app gate → range/scope → builder. */
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { ANALYTICS_TITLES, LABOR_APP, OPERATIONAL_APP, type AnalyticsPayload, type LaborPage, type OperationalPage } from "./analytics-types";
import { isAppActive, parseRange, warehousesFor, type AnalyticsQuery } from "./analytics-common";
import { buildLabor } from "./analytics-labor";
import { buildOperational } from "./analytics-operational";

export function getLaborAnalytics(db: AppDb, auth: AuthContext, page: LaborPage, q: AnalyticsQuery): AnalyticsPayload {
  const range = parseRange(q);
  const base = { key: page, title: ANALYTICS_TITLES[page].title, range: { from: range.from, to: range.to } };
  if (!isAppActive(db, LABOR_APP.key)) return { ...base, gate: { appKey: LABOR_APP.key, appName: LABOR_APP.name, reason: "inactive" }, kpis: [], charts: [] };
  return { ...base, gate: null, ...buildLabor(db, page, range, warehousesFor(auth, q.wh)) };
}

export function getOperationalAnalytics(db: AppDb, auth: AuthContext, page: OperationalPage, q: AnalyticsQuery): AnalyticsPayload {
  const range = parseRange(q);
  const base = { key: page, title: ANALYTICS_TITLES[page].title, range: { from: range.from, to: range.to } };
  if (!isAppActive(db, OPERATIONAL_APP.key)) return { ...base, gate: { appKey: OPERATIONAL_APP.key, appName: OPERATIONAL_APP.name, reason: "inactive" }, kpis: [], charts: [] };
  return { ...base, gate: null, ...buildOperational(db, page, range, warehousesFor(auth, q.wh)) };
}
