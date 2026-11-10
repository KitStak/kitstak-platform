/**
 * Grid backend for the shared "Add order(s)" drawer (`OrderPickerDrawer`):
 * `GET /api/pickers/orders/grid` (docs/requests/shipping.md REQ-3, stations-returns.md REQ-2).
 * Accepts the grid grammar (q/qm, f.*, sort, page, ps) plus `clientId`, `warehouseId` and
 * `status=a,b`, and returns `OrderPick` rows. Scoped to the caller's view scope.
 */
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { SO_STATUSES } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import { scopedWhere, type Scope } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import { parseGridQuery } from "@/server/query/grid-query";

const so = s.shipmentOrders;
/** Table-qualified refs (drizzle renders bare names in single-table selects). */
const col = (name: string): SQL => sql.raw(`"shipment_orders"."${name}"`);

const EXPR: Readonly<Record<string, SQL>> = {
  code: col("code"),
  storeOrderCode: col("store_order_number"),
  clientName: sql`(SELECT c.name FROM clients c WHERE c.id = ${col("client_id")})`,
  customerName: col("customer_name"),
  status: col("status"),
  lineCount: sql`(SELECT COUNT(*) FROM order_lines l WHERE l.order_id = ${col("id")})`,
  quantity: col("total_quantity"),
  orderDate: col("order_date"),
  shipBy: col("expected_ship_date"),
};

const FILTERS: readonly FilterFieldDef[] = [
  { key: "status", label: "Status", type: "enum", sql: EXPR.status, nullable: false },
  { key: "storeOrderCode", label: "Store order #", type: "text", sql: EXPR.storeOrderCode, nullable: true },
  { key: "customerName", label: "Customer", type: "text", sql: EXPR.customerName, nullable: true },
  { key: "orderDate", label: "Order date", type: "date", sql: EXPR.orderDate, nullable: true },
  { key: "shipBy", label: "Ship by", type: "date", sql: EXPR.shipBy, nullable: true },
  { key: "quantity", label: "Quantity", type: "number", sql: EXPR.quantity, nullable: true },
];

export interface OrderPickRow {
  readonly id: string;
  readonly code: string;
  readonly storeOrderCode: string | null;
  readonly clientName: string | null;
  readonly status: string;
  readonly customerName: string | null;
  readonly lineCount: number;
  readonly quantity: number;
  readonly orderDate: string | null;
  readonly shipBy: string | null;
}

export function listOrderPickerGrid(db: AppDb, scope: Scope, params: URLSearchParams): { rows: OrderPickRow[]; total: number; page: number; pageSize: number } {
  const known = new URLSearchParams([...params.entries()].filter(([k]) => k !== "clientId" && k !== "warehouseId" && k !== "status"));
  const { query, issues } = parseGridQuery(known);
  if (issues.length > 0) {
    throw new AppError("VALIDATION", issues[0]?.message ?? "Invalid grid query", { fieldErrors: Object.fromEntries(issues.map((i) => [i.param, [i.message]])) });
  }
  const unknownSort = query.sort.find((x) => !EXPR[x.field]);
  if (unknownSort) throw new AppError("VALIDATION", `Cannot sort by "${unknownSort.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
  const statuses = (params.get("status") ?? "").split(",").map((x) => x.trim()).filter((x): x is (typeof SO_STATUSES)[number] => (SO_STATUSES as readonly string[]).includes(x));
  const clientId = params.get("clientId");
  const warehouseId = params.get("warehouseId");
  const where = and(
    isNull(so.deletedAt),
    scopedWhere(so, scope),
    clientId ? eq(so.clientId, clientId) : undefined,
    warehouseId ? eq(so.warehouseId, warehouseId) : undefined,
    statuses.length ? inArray(so.status, statuses) : undefined,
    compileQuickSearch(query.q, query.qm, [EXPR.code, EXPR.storeOrderCode, EXPR.customerName]),
    compileFilters(FILTERS, query.filters),
  );
  const orderBy = query.sort.length > 0
    ? query.sort.map((x) => (x.dir === "asc" ? asc(EXPR[x.field]) : desc(EXPR[x.field])))
    : [desc(EXPR.orderDate)];
  const total = Number(db.select({ n: sql<number>`COUNT(*)` }).from(so).where(where).get()?.n ?? 0);
  const rows = db.select({
    id: so.id, code: so.code, storeOrderCode: sql<string | null>`${EXPR.storeOrderCode}`, clientName: sql<string | null>`${EXPR.clientName}`,
    status: so.status, customerName: so.customerName, lineCount: sql<number>`${EXPR.lineCount}`, quantity: so.totalQuantity,
    orderDate: so.orderDate, shipBy: so.expectedShipDate,
  }).from(so).where(where).orderBy(...orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize).all();
  return { rows, total, page: query.page, pageSize: query.pageSize };
}
