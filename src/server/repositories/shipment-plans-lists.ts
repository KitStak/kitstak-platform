/**
 * Shipment Plan read models (M02): the plan grid, Plan Orders, Plan LPs, the plan detail
 * page and the eligible-order picker. Every read is scoped (warehouse + client).
 */
import { sql, type SQL } from "drizzle-orm";
import { SHIPMENT_PLAN_STATUSES, type ShipmentPlanStatus } from "@/lib/enums";
import {
  LOADED_ORDER_STATUSES, PLAN_ELIGIBLE_ORDER_FIELDS, PLAN_ELIGIBLE_ORDER_STATUSES, PLAN_LP_FIELDS, PLAN_LP_SEARCH_FIELDS, PLAN_LP_SORT_FIELDS,
  PLAN_ORDER_FIELDS, PLAN_ORDER_SEARCH_FIELDS, PLAN_ORDER_SORT_FIELDS, SHIPMENT_PLAN_FIELDS, SHIPMENT_PLAN_SEARCH_FIELDS,
  SHIPMENT_PLAN_SORT_FIELDS, ACTIVE_PLAN_STATUSES, planDeleteBlockReason, planEditBlockReason, planShipBlockReason,
} from "@/lib/grid-defs/shipping/shipment-plans";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, type Scope } from "@/server/auth/scope";
import { stateMachines } from "@/server/domain/state-machines";
import type { GridQuery } from "@/server/query/grid-query";
import { compileGrid, scopeSql, whereClause, type GridSpec } from "./shipping-grid";
import { formatAddress, type ListResult } from "./shipping";

const raw = (expr: string): SQL => sql.raw(expr);
const statusList = (values: readonly string[]): string => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");

const LOADED_SQL = statusList(LOADED_ORDER_STATUSES);
const SHIPPED_SQL = statusList(["Shipped", "Partially Shipped", "Delivered"]);

const PLAN_FROM = raw(`
  shipment_plans p
  JOIN warehouses w ON w.id = p.warehouse_id
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN carrier_connections cc ON cc.id = p.carrier_connection_id
  LEFT JOIN locations g ON g.id = p.loading_gate_location_id
  LEFT JOIN customers cu ON cu.id = p.customer_id
  LEFT JOIN addresses ad ON ad.id = p.customer_address_id
  LEFT JOIN retailers r ON r.id = p.retailer_id
`);

const PLAN_SQL: Readonly<Record<string, SQL>> = {
  code: raw("p.code"),
  status: raw("p.status"),
  warehouseCode: raw("w.code"),
  clientName: raw("c.name"),
  customerName: raw("(cu.first_name || ' ' || cu.last_name)"),
  customerAddress: raw("ad.line1"),
  createdAt: raw("p.created_at"),
  plannedShipmentAt: raw("p.planned_shipment_at"),
  actualShipmentAt: raw("p.actual_shipment_at"),
  carrierName: raw("cc.account_prefix"),
  truckPlateNumber: raw("p.truck_plate_number"),
  loadingGate: raw("g.code"),
  retailerName: raw("r.name"),
  loadingStartedAt: raw("p.loading_started_at"),
  loadingCompletedAt: raw("p.loading_completed_at"),
  truckDepartedAt: raw("p.truck_departed_at"),
  orderCount: raw("(SELECT COUNT(*) FROM shipment_plan_orders x WHERE x.plan_id = p.id)"),
  loadedPercent: raw(`(SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE 100.0 * SUM(o.status IN (${LOADED_SQL})) / COUNT(*) END FROM shipment_plan_orders x JOIN shipment_orders o ON o.id = x.order_id WHERE x.plan_id = p.id)`),
  expectedTotalWeight: raw("p.expected_total_weight"),
};

export const PLAN_GRID: GridSpec = {
  fields: SHIPMENT_PLAN_FIELDS, sqlFor: PLAN_SQL, searchFields: SHIPMENT_PLAN_SEARCH_FIELDS, sortFields: SHIPMENT_PLAN_SORT_FIELDS,
  defaultSort: [{ field: "createdAt", dir: "desc" }], tiebreaker: raw("p.id"),
};

const PLAN_SELECT = raw(`
  p.id AS id, p.code AS code, p.status AS status, p.version AS version, p.warehouse_id AS warehouseId, w.code AS warehouseCode,
  w.name AS warehouseName, p.client_id AS clientId, c.name AS clientName, p.carrier_connection_id AS carrierConnectionId,
  cc.account_prefix AS carrierPrefix, cc.setup_name AS carrierSetupName, p.truck_plate_number AS truckPlateNumber,
  p.loading_gate_location_id AS loadingGateLocationId, g.code AS loadingGate,
  p.planned_shipment_at AS plannedShipmentAt, p.actual_shipment_at AS actualShipmentAt, p.loading_started_at AS loadingStartedAt,
  p.loading_completed_at AS loadingCompletedAt, p.truck_departed_at AS truckDepartedAt,
  p.expected_total_volume AS expectedTotalVolume, p.expected_total_weight AS expectedTotalWeight,
  p.prevent_lpn_edit_during_loading AS preventLpnEditDuringLoading, p.note AS note,
  p.customer_id AS customerId, CASE WHEN cu.id IS NULL THEN NULL ELSE cu.first_name || ' ' || cu.last_name END AS customerName,
  p.customer_address_id AS customerAddressId, ad.line1 AS adLine1, ad.line2 AS adLine2, ad.city AS adCity, ad.state AS adState,
  ad.postal_code AS adZip, ad.country AS adCountry, p.retailer_id AS retailerId, r.name AS retailerName,
  p.custom_fields AS customFields, p.created_at AS createdAt, p.updated_at AS updatedAt,
  (SELECT COUNT(*) FROM shipment_plan_orders x WHERE x.plan_id = p.id) AS orderCount,
  (SELECT COUNT(*) FROM shipment_plan_orders x JOIN shipment_orders o ON o.id = x.order_id WHERE x.plan_id = p.id AND o.status IN (${LOADED_SQL})) AS loadedCount,
  (SELECT COUNT(*) FROM shipment_plan_orders x JOIN shipment_orders o ON o.id = x.order_id WHERE x.plan_id = p.id AND o.status IN (${SHIPPED_SQL})) AS shippedCount,
  (SELECT COALESCE(SUM(o.total_quantity), 0) FROM shipment_plan_orders x JOIN shipment_orders o ON o.id = x.order_id WHERE x.plan_id = p.id) AS unitCount
`);

type PlanRaw = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly warehouseCode: string;
  readonly plannedShipmentAt: string | null;
  readonly truckPlateNumber: string | null;
  readonly note: string | null;
  readonly status: ShipmentPlanStatus;
  readonly warehouseId: string;
  readonly clientId: string | null;
  readonly carrierPrefix: string | null;
  readonly carrierSetupName: string | null;
  readonly preventLpnEditDuringLoading: number;
  readonly adLine1: string | null;
  readonly adLine2: string | null;
  readonly adCity: string | null;
  readonly adState: string | null;
  readonly adZip: string | null;
  readonly adCountry: string | null;
  readonly customFields: string | null;
  readonly orderCount: number;
  readonly loadedCount: number;
  readonly shippedCount: number;
};

export type PlanRow = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly code: string;
  readonly status: ShipmentPlanStatus;
  readonly version: number;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly clientId: string | null;
  readonly plannedShipmentAt: string | null;
  readonly truckPlateNumber: string | null;
  readonly note: string | null;
  readonly orderCount: number;
  readonly loadedCount: number;
  readonly shippedCount: number;
  readonly carrierName: string | null;
  readonly customerAddress: string | null;
  readonly preventLpnEditDuringLoading: boolean;
  readonly customFields: Readonly<Record<string, string | boolean | null>>;
  readonly loadedPercent: number;
  /** Statuses the popover may offer (state machine). "Shipped" routes to Ship. */
  readonly nextStatuses: readonly ShipmentPlanStatus[];
  readonly deleteBlockedReason: string | null;
  readonly editBlockedReason: string | null;
  readonly shipBlockedReason: string | null;
};

function parseJson(text: string | null): Record<string, string | boolean | null> {
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, string | boolean | null>) : {};
  } catch {
    return {};
  }
}

export function toPlanRow(r: PlanRaw): PlanRow {
  const { adLine1, adLine2, adCity, adState, adZip, adCountry } = r;
  return {
    ...r,
    carrierName: r.carrierPrefix ? `${r.carrierSetupName ?? ""} - ${r.carrierPrefix}`.replace(/^ - /, "") : null,
    customerAddress: adLine1 ? formatAddress([adLine1, adLine2, adCity, adState, adZip, adCountry]) : null,
    preventLpnEditDuringLoading: Boolean(r.preventLpnEditDuringLoading),
    customFields: parseJson(r.customFields),
    loadedPercent: r.orderCount === 0 ? 0 : Math.round((100 * r.loadedCount) / r.orderCount),
    nextStatuses: stateMachines.shipmentPlan.nextStatuses(r.status),
    deleteBlockedReason: planDeleteBlockReason(r.status),
    editBlockedReason: planEditBlockReason(r.status),
    shipBlockedReason: planShipBlockReason(r.status, r.orderCount),
  } as PlanRow;
}

const planScope = (scope: Scope): SQL => scopeSql(raw("p.warehouse_id"), raw("p.client_id"), scope);

export function listPlans(db: AppDb, auth: AuthContext, query: GridQuery): ListResult<PlanRow> {
  const grid = compileGrid(PLAN_GRID, query, planScope(auth.viewScope));
  const rows = db.all<PlanRaw>(sql`SELECT ${PLAN_SELECT} FROM ${PLAN_FROM} ${whereClause(grid.where)} ORDER BY ${sql.join(grid.orderBy, sql`, `)} LIMIT ${grid.pageSize} OFFSET ${grid.offset}`);
  const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${PLAN_FROM} ${whereClause(grid.where)}`)?.n ?? 0;
  return { rows: rows.map(toPlanRow), total };
}

/** One plan in the caller's full scope (cross-scope → 404). */
export function loadPlanRow(db: AppDb, scope: Scope, id: string): PlanRow {
  const r = db.get<PlanRaw>(sql`SELECT ${PLAN_SELECT} FROM ${PLAN_FROM} WHERE p.id = ${id}`);
  if (!r) throw notFoundError("Shipment plan");
  assertInScope(scope, r, "Shipment plan");
  return toPlanRow(r);
}

/* ------------------------------------------------------------ plan orders */

const ORDER_FROM = raw(`
  shipment_plan_orders spo
  JOIN shipment_plans p ON p.id = spo.plan_id
  JOIN shipment_orders o ON o.id = spo.order_id
  JOIN warehouses w ON w.id = p.warehouse_id
  LEFT JOIN clients c ON c.id = o.client_id
  LEFT JOIN carrier_connections cc ON cc.id = p.carrier_connection_id
  LEFT JOIN locations g ON g.id = p.loading_gate_location_id
`);

const ORDER_SQL: Readonly<Record<string, SQL>> = {
  planCode: raw("p.code"),
  orderCode: raw("o.code"),
  orderStatus: raw("o.status"),
  planStatus: raw("spo.status"),
  warehouseCode: raw("w.code"),
  customerName: raw("o.customer_name"),
  customerAddress: raw("o.ship_address"),
  carrierName: raw("cc.account_prefix"),
  lpShippingOption: raw("o.requested_shipping_option"),
  clientName: raw("c.name"),
  truckPlateNumber: raw("p.truck_plate_number"),
  orderCarrier: raw("o.carrier"),
  shippingService: raw("o.shipping_service"),
  loadingGate: raw("g.code"),
  plannedShipmentAt: raw("p.planned_shipment_at"),
  truckDepartedAt: raw("p.truck_departed_at"),
};

export const PLAN_ORDER_GRID: GridSpec = {
  fields: PLAN_ORDER_FIELDS, sqlFor: ORDER_SQL, searchFields: PLAN_ORDER_SEARCH_FIELDS, sortFields: PLAN_ORDER_SORT_FIELDS,
  defaultSort: [{ field: "planCode", dir: "desc" }, { field: "orderCode", dir: "asc" }], tiebreaker: raw("spo.order_id"),
};

export type PlanOrderRow = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly planId: string;
  readonly orderId: string;
};

const ORDER_SELECT = sql.join(
  [raw("(spo.plan_id || ':' || spo.order_id) AS id"), raw("spo.plan_id AS planId"), raw("spo.order_id AS orderId"),
    raw("o.ship_address2 AS shipAddress2"), raw("o.ship_city AS shipCity"), raw("o.ship_state AS shipState"), raw("o.ship_zip AS shipZip"),
    raw("o.ship_country AS shipCountry"), raw("o.total_quantity AS totalQuantity"), raw("cc.setup_name AS carrierSetupName"),
    ...Object.entries(ORDER_SQL).map(([alias, expr]) => sql`${expr} AS ${sql.identifier(alias)}`)],
  sql`, `,
);

function withOrderAddress<T extends Record<string, unknown>>(r: T): T {
  return { ...r, customerAddress: formatAddress([r.customerAddress as string, r.shipAddress2 as string, r.shipCity as string, r.shipState as string, r.shipZip as string, r.shipCountry as string]) };
}

export function listPlanOrders(db: AppDb, auth: AuthContext, query: GridQuery, planId?: string): ListResult<PlanOrderRow> {
  const base = planId ? sql`${planScope(auth.viewScope)} AND spo.plan_id = ${planId}` : planScope(auth.viewScope);
  const grid = compileGrid(PLAN_ORDER_GRID, query, base);
  const rows = db.all<PlanOrderRow>(sql`SELECT ${ORDER_SELECT} FROM ${ORDER_FROM} ${whereClause(grid.where)} ORDER BY ${sql.join(grid.orderBy, sql`, `)} LIMIT ${grid.pageSize} OFFSET ${grid.offset}`);
  const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${ORDER_FROM} ${whereClause(grid.where)}`)?.n ?? 0;
  return { rows: rows.map(withOrderAddress), total };
}

/* --------------------------------------------------------------- plan LPs */

const LP_FROM = raw(`
  (SELECT DISTINCT x.order_id AS order_id, x.lp_id AS lp_id FROM (
     SELECT a.order_id AS order_id, i.lp_id AS lp_id FROM inventory_allocations a JOIN inventory i ON i.id = a.inventory_id
       WHERE i.lp_id IS NOT NULL AND a.status <> 'Cancelled' AND a.order_id IS NOT NULL
     UNION
     SELECT t.order_id, t.from_lp_id FROM inventory_transactions t WHERE t.type = 'Shipment' AND t.from_lp_id IS NOT NULL AND t.order_id IS NOT NULL
   ) x) olp
  JOIN shipment_plan_orders spo ON spo.order_id = olp.order_id
  JOIN shipment_plans p ON p.id = spo.plan_id
  JOIN shipment_orders o ON o.id = spo.order_id
  JOIN license_plates lp ON lp.id = olp.lp_id
  LEFT JOIN license_plates plp ON plp.id = lp.parent_lp_id
  JOIN warehouses w ON w.id = p.warehouse_id
  LEFT JOIN clients c ON c.id = o.client_id
  LEFT JOIN carrier_connections cc ON cc.id = p.carrier_connection_id
  LEFT JOIN locations g ON g.id = p.loading_gate_location_id
`);

const LP_SQL: Readonly<Record<string, SQL>> = {
  planCode: raw("p.code"),
  orderCode: raw("o.code"),
  orderStatus: raw("o.status"),
  lpNumber: raw("lp.number"),
  parentLpNumber: raw("plp.number"),
  planStatus: raw("p.status"),
  warehouseCode: raw("w.code"),
  customerName: raw("o.customer_name"),
  customerAddress: raw("o.ship_address"),
  carrierName: raw("cc.account_prefix"),
  shippingService: raw("o.shipping_service"),
  clientName: raw("c.name"),
  truckPlateNumber: raw("p.truck_plate_number"),
  lpCarrier: raw("o.carrier"),
  originalLpNumber: raw("lp.original_number"),
  loadingGate: raw("g.code"),
  plannedShipmentAt: raw("p.planned_shipment_at"),
  truckDepartedAt: raw("p.truck_departed_at"),
  weight: raw("lp.weight"),
  volume: raw("lp.actual_volume"),
};

export const PLAN_LP_GRID: GridSpec = {
  fields: PLAN_LP_FIELDS, sqlFor: LP_SQL, searchFields: PLAN_LP_SEARCH_FIELDS, sortFields: PLAN_LP_SORT_FIELDS,
  defaultSort: [{ field: "planCode", dir: "desc" }, { field: "lpNumber", dir: "asc" }], tiebreaker: raw("lp.id"),
};

const LP_SELECT = sql.join(
  [raw("(spo.plan_id || ':' || lp.id || ':' || o.id) AS id"), raw("spo.plan_id AS planId"), raw("o.id AS orderId"), raw("lp.id AS lpId"),
    raw("o.ship_address2 AS shipAddress2"), raw("o.ship_city AS shipCity"), raw("o.ship_state AS shipState"), raw("o.ship_zip AS shipZip"), raw("o.ship_country AS shipCountry"),
    ...Object.entries(LP_SQL).map(([alias, expr]) => sql`${expr} AS ${sql.identifier(alias)}`)],
  sql`, `,
);

export function listPlanLps(db: AppDb, auth: AuthContext, query: GridQuery, planId?: string): ListResult<PlanOrderRow> {
  const base = planId ? sql`${planScope(auth.viewScope)} AND spo.plan_id = ${planId}` : planScope(auth.viewScope);
  const grid = compileGrid(PLAN_LP_GRID, query, base);
  const rows = db.all<PlanOrderRow>(sql`SELECT ${LP_SELECT} FROM ${LP_FROM} ${whereClause(grid.where)} ORDER BY ${sql.join(grid.orderBy, sql`, `)} LIMIT ${grid.pageSize} OFFSET ${grid.offset}`);
  const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${LP_FROM} ${whereClause(grid.where)}`)?.n ?? 0;
  return { rows: rows.map(withOrderAddress), total };
}

/* ------------------------------------------------------- eligible orders */

const ELIGIBLE_FIELDS = PLAN_ELIGIBLE_ORDER_FIELDS;

const ELIGIBLE_SQL: Readonly<Record<string, SQL>> = {
  code: raw("o.code"),
  status: raw("o.status"),
  orderType: raw("COALESCE(lv.name, o.order_type)"),
  storeName: raw("COALESCE(o.store_name, o.channel)"),
  warehouseCode: raw("w.code"),
  createdAt: raw("o.created_at"),
  clientName: raw("c.name"),
  customerName: raw("o.customer_name"),
  totalQuantity: raw("o.total_quantity"),
  sku: raw("(SELECT group_concat(pp.sku, ', ') FROM order_lines ol JOIN products pp ON pp.id = ol.product_id WHERE ol.order_id = o.id)"),
  storeOrderNumber: raw("o.store_order_number"),
};

export const ELIGIBLE_GRID: GridSpec = {
  fields: ELIGIBLE_FIELDS, sqlFor: ELIGIBLE_SQL, searchFields: ["code", "storeOrderNumber", "customerName"],
  sortFields: ["code", "status", "orderType", "storeName", "warehouseCode", "createdAt", "clientName", "customerName", "totalQuantity"],
  defaultSort: [{ field: "createdAt", dir: "asc" }], tiebreaker: raw("o.id"),
};

export { ELIGIBLE_FIELDS };

const ELIGIBLE_FROM = raw(`
  shipment_orders o JOIN warehouses w ON w.id = o.warehouse_id LEFT JOIN clients c ON c.id = o.client_id
  LEFT JOIN lookup_values lv ON lv.id = o.order_type_id
`);

export type EligibleOrderRow = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly totalQuantity: number;
  readonly totalWeightOz: number;
};

/** Orders that may join a plan in `warehouseId` (optionally one client), excluding those in another active plan. */
export function listEligibleOrders(db: AppDb, auth: AuthContext, query: GridQuery, input: { warehouseId: string; clientId?: string | null; planId?: string | null }): ListResult<EligibleOrderRow> {
  const active = statusList(ACTIVE_PLAN_STATUSES);
  const base = sql`${scopeSql(raw("o.warehouse_id"), raw("o.client_id"), auth.scope)} AND o.deleted_at IS NULL
    AND o.warehouse_id = ${input.warehouseId} ${input.clientId ? sql`AND o.client_id = ${input.clientId}` : sql``}
    AND o.status IN (${raw(statusList(PLAN_ELIGIBLE_ORDER_STATUSES))})
    AND NOT EXISTS (SELECT 1 FROM shipment_plan_orders x JOIN shipment_plans xp ON xp.id = x.plan_id
      WHERE x.order_id = o.id AND xp.status IN (${raw(active)}) ${input.planId ? sql`AND xp.id <> ${input.planId}` : sql``})`;
  const grid = compileGrid(ELIGIBLE_GRID, query, base);
  const select = sql.join([raw("o.id AS id"), raw("o.total_weight_oz AS totalWeightOz"), ...Object.entries(ELIGIBLE_SQL).map(([alias, expr]) => sql`${expr} AS ${sql.identifier(alias)}`)], sql`, `);
  const rows = db.all<EligibleOrderRow>(sql`SELECT ${select} FROM ${ELIGIBLE_FROM} ${whereClause(grid.where)} ORDER BY ${sql.join(grid.orderBy, sql`, `)} LIMIT ${grid.pageSize} OFFSET ${grid.offset}`);
  const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${ELIGIBLE_FROM} ${whereClause(grid.where)}`)?.n ?? 0;
  return { rows, total };
}

/* ---------------------------------------------------------- plan detail */

export type PlanDetail = PlanRow & {
  readonly orders: readonly PlanOrderRow[];
  readonly lps: readonly PlanOrderRow[];
  readonly timeline: readonly { readonly at: string; readonly message: string; readonly source: string | null; readonly type: string }[];
  readonly statuses: readonly ShipmentPlanStatus[];
};

export function getPlanDetail(db: AppDb, auth: AuthContext, id: string): PlanDetail {
  const plan = loadPlanRow(db, auth.scope, id);
  const fullScope = { ...auth, viewScope: auth.scope };
  const page = { q: undefined, qm: "sw" as const, filters: [], sort: [], page: 1, pageSize: 1000 };
  const orders = listPlanOrders(db, fullScope, page, id).rows;
  const lps = listPlanLps(db, fullScope, page, id).rows;
  const timeline = db.all<{ at: string; message: string; source: string | null; type: string }>(sql`
    SELECT at, message, source, type FROM change_log WHERE entity_type = 'shipment_plan' AND entity_id = ${id} ORDER BY at DESC, rowid DESC LIMIT 100`);
  return { ...plan, orders, lps, timeline, statuses: SHIPMENT_PLAN_STATUSES };
}
