/**
 * Operational Analytics (KitStaks-designed, BUILD_PLAN Part D): Inbound & Inventory,
 * Fulfillment, Management and Productivity dashboards from the live tables.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AnalyticsChart, AnalyticsKpi, AnalyticsRow, OperationalPage, TimingShare } from "./analytics-types";
import { clIn, dayFilter, daySql, fmtInt, fmtMoney, hourFilter, localDayOf, PALETTE, rangeFilter, round, whIn, type Range } from "./analytics-common";
import { clientQs, loadTaskFacts, MIN_TASK_MINUTES, RECEIVING_GRID, TASKS_GRID as TASKS, taskGridOf, tasksHref, timingShare, type TaskFact } from "./analytics-labor";

type Built = { kpis: AnalyticsKpi[]; charts: AnalyticsChart[]; timing?: TimingShare };
const enc = encodeURIComponent;

/* ---------------------------------------------------------- inbound/inventory */

export const AGING_BUCKETS = ["0–30 days", "31–60 days", "61–90 days", "90+ days"] as const;

const DAY_MS = 86_400_000;
const shiftDay = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);

/** Inventory-by-location drilldown for one aging bucket (Receiving Date window). */
export function agingHref(bucket: (typeof AGING_BUCKETS)[number], now: Date = new Date()): string {
  const base = "/inventory/by-location?f.receivedAt=date:custom:";
  if (bucket === AGING_BUCKETS[0]) return `${base}${shiftDay(now, 30)}..`;
  if (bucket === AGING_BUCKETS[1]) return `${base}${shiftDay(now, 60)}..${shiftDay(now, 31)}`;
  if (bucket === AGING_BUCKETS[2]) return `${base}${shiftDay(now, 90)}..${shiftDay(now, 61)}`;
  return `${base}..${shiftDay(now, 91)}`;
}

/** Shipped-orders grid without cancelled orders (they carry a cancel date in shippedAt). */
export const SHIPPED_STATUSES_QS = `f.status=in:${["Shipped", "Partially Shipped", "Delivered"].map(encodeURIComponent).join(",")}`;

export function agingBucket(receivedAt: string, now: Date = new Date()): (typeof AGING_BUCKETS)[number] {
  const days = (now.getTime() - Date.parse(receivedAt)) / 86_400_000;
  if (days <= 30) return AGING_BUCKETS[0];
  if (days <= 60) return AGING_BUCKETS[1];
  if (days <= 90) return AGING_BUCKETS[2];
  return AGING_BUCKETS[3];
}

function inbound(db: AppDb, r: Range, wh: readonly string[]): Built {
  const receipts = db.all<{ d: string; kind: string; units: number }>(sql`
    SELECT ${daySql("received_at", r)} AS d, CASE WHEN type = 'Return' THEN 'returns' ELSE 'po' END AS kind, SUM(uom_quantity) AS units
    FROM receipts WHERE cancelled_at IS NULL AND type IN ('Purchase Order', 'Return', 'Product Receive', 'Add Inventory')
      AND received_at >= ${r.fromIso} AND received_at < ${r.toIso} AND ${whIn("warehouse_id", wh)} AND ${clIn("client_id", r)} GROUP BY 1, 2`);
  const trend: AnalyticsRow[] = r.days.map((day) => ({
    day,
    po: receipts.filter((x) => x.d === day && x.kind === "po").reduce((a, x) => a + Number(x.units), 0),
    returns: receipts.filter((x) => x.d === day && x.kind === "returns").reduce((a, x) => a + Number(x.units), 0),
    href: `${RECEIVING_GRID}?${dayFilter("receivedAt", day, r)}${clientQs(r)}`,
  }));
  // Dock-to-stock: receipt into a Receiving location → first move out of it for that product.
  const d2s = db.get<{ hrs: number | null; n: number; pending: number }>(sql`
    WITH rc AS (
      SELECT r.id, r.received_at, (SELECT MIN(t.at) FROM inventory_transactions t
        WHERE t.from_location_id = r.location_id AND t.product_id = r.product_id AND t.at >= r.received_at
          AND t.type IN ('Inventory Movement', 'Replenishment')) AS moved_at
      FROM receipts r JOIN locations l ON l.id = r.location_id
      WHERE r.cancelled_at IS NULL AND l.type = 'Receiving' AND r.received_at >= ${r.fromIso} AND r.received_at < ${r.toIso} AND ${whIn("r.warehouse_id", wh)} AND ${clIn("r.client_id", r)}
    )
    SELECT AVG(CASE WHEN moved_at IS NOT NULL THEN (julianday(moved_at) - julianday(received_at)) * 24 END) AS hrs,
           SUM(moved_at IS NOT NULL) AS n, SUM(moved_at IS NULL) AS pending FROM rc`);
  const inv = db.all<{ sku: string; pid: string; units: number; value: number; received: string }>(sql`
    SELECT p.sku AS sku, p.id AS pid, i.on_hand AS units, i.on_hand * COALESCE(p.purchase_price, p.price, 0) AS value, i.received_at AS received
    FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.on_hand > 0 AND ${whIn("i.warehouse_id", wh)} AND ${clIn("i.client_id", r)}`);
  const now = new Date();
  const aging: AnalyticsRow[] = AGING_BUCKETS.map((b) => {
    const xs = inv.filter((x) => agingBucket(x.received, now) === b);
    return { bucket: b, units: xs.reduce((a, x) => a + Number(x.units), 0), value: round(xs.reduce((a, x) => a + Number(x.value), 0), 2), href: agingHref(b, now) };
  });
  const bySku = new Map<string, { pid: string; units: number; value: number }>();
  for (const x of inv) {
    const a = bySku.get(x.sku) ?? { pid: x.pid, units: 0, value: 0 };
    bySku.set(x.sku, { pid: x.pid, units: a.units + Number(x.units), value: a.value + Number(x.value) });
  }
  const top: AnalyticsRow[] = [...bySku.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 10)
    .map(([sku, a]) => ({ sku, units: a.units, value: round(a.value, 2), href: `/inventory?q=${enc(sku)}&qm=eq` }));
  const totalValue = inv.reduce((a, x) => a + Number(x.value), 0);
  const recHref = `${RECEIVING_GRID}?${rangeFilter("receivedAt", r)}${clientQs(r)}`;
  return {
    kpis: [
      { label: "Units received", value: fmtInt(trend.reduce((a, x) => a + Number(x.po) + Number(x.returns), 0)), hint: "Purchase orders plus returns, in the period", href: recHref },
      { label: "Avg dock-to-stock", value: d2s?.hrs != null ? `${round(Number(d2s.hrs), 1)} h` : "—", hint: d2s?.pending ? `${fmtInt(Number(d2s.pending))} receipts still on the dock` : "Every receipt is put away", href: "/inventory/by-location?f.locationType=in:Receiving" },
      { label: "Inventory value", value: fmtMoney(totalValue), hint: "On hand × purchase price", href: "/inventory" },
      { label: "Units on hand", value: fmtInt(inv.reduce((a, x) => a + Number(x.units), 0)), hint: "All inventory statuses, right now", href: "/inventory" },
    ],
    charts: [
      { id: "receipts", title: "Receipts trend", description: "Units received per day: purchase orders and returns. Click a day to open its receipts.", kind: "stackedBar", xKey: "day", wide: true,
        series: [{ key: "po", label: "Purchase orders", color: PALETTE[0] }, { key: "returns", label: "Returns", color: PALETTE[2] }], rows: trend, hrefKey: "href",
        columns: [{ key: "day", label: "Day" }, { key: "po", label: "PO units", kind: "number" }, { key: "returns", label: "Return units", kind: "number" }], gridHref: recHref, gridLabel: "Open receiving history" },
      { id: "aging", title: "Inventory aging", description: "On-hand units by days since they were received. Click a bucket to open that stock.", kind: "bar", xKey: "bucket",
        series: [{ key: "units", label: "Units", color: PALETTE[1] }], rows: aging, hrefKey: "href",
        columns: [{ key: "bucket", label: "Age" }, { key: "units", label: "Units", kind: "number" }, { key: "value", label: "Value", kind: "money" }], gridHref: "/inventory/by-location", gridLabel: "Open inventory by location" },
      { id: "top-skus", title: "Top SKUs by inventory value", description: "The ten SKUs holding the most value. Click a bar to open the SKU's inventory.", kind: "bar", xKey: "sku", horizontal: true,
        series: [{ key: "value", label: "Value", color: PALETTE[3] }], rows: top, hrefKey: "href",
        columns: [{ key: "sku", label: "SKU" }, { key: "units", label: "Units", kind: "number" }, { key: "value", label: "Value", kind: "money" }], gridHref: "/inventory", gridLabel: "Open total inventory" },
    ],
  };
}

/* ---------------------------------------------------------------- fulfillment */

/** On-time % for one trend day: null for today (still in progress) and for days with no dated shipments. */
export function partialDayOnTime(day: string, today: string, dated: number, onTime: number): number | null {
  if (day >= today) return null;
  return dated > 0 ? onTimePct(dated, onTime) : null;
}

export function onTimePct(shipped: number, onTime: number): number {
  return shipped > 0 ? round((onTime / shipped) * 100, 1) : 0;
}

function fulfillment(db: AppDb, r: Range, wh: readonly string[]): Built {
  const created = db.all<{ d: string; n: number }>(sql`SELECT ${daySql("order_date", r)} AS d, COUNT(*) AS n FROM shipment_orders
    WHERE deleted_at IS NULL AND order_date >= ${r.fromIso} AND order_date < ${r.toIso} AND ${whIn("warehouse_id", wh)} AND ${clIn("client_id", r)} GROUP BY 1`);
  const shipped = db.all<{ d: string; n: number; ontime: number; dated: number }>(sql`SELECT ${daySql("shipped_at", r)} AS d, COUNT(*) AS n,
      SUM(expected_ship_date IS NOT NULL AND substr(shipped_at, 1, 10) <= substr(expected_ship_date, 1, 10)) AS ontime, SUM(expected_ship_date IS NOT NULL) AS dated
    FROM shipment_orders WHERE deleted_at IS NULL AND status IN ('Shipped', 'Partially Shipped', 'Delivered') AND shipped_at >= ${r.fromIso} AND shipped_at < ${r.toIso}
      AND ${whIn("warehouse_id", wh)} AND ${clIn("client_id", r)} GROUP BY 1`);
  const whQs = `${wh.length ? `&f.warehouseId=in:${wh.join(",")}` : ""}${clientQs(r)}`;
  const today = localDayOf(new Date().toISOString(), r);
  const trend: AnalyticsRow[] = r.days.map((day) => ({
    day, created: Number(created.find((x) => x.d === day)?.n ?? 0), shipped: Number(shipped.find((x) => x.d === day)?.n ?? 0),
    href: `/orders/shipped?${SHIPPED_STATUSES_QS}&${dayFilter("shippedAt", day, r)}${whQs}`,
    // The current day is still in progress: its on-time % is not final, so it is left off the line.
    onTimePct: (() => { const s = shipped.find((x) => x.d === day); return partialDayOnTime(day, today, s ? Number(s.dated) : 0, s ? Number(s.ontime) : 0); })(),
  }));
  const backlog = db.all<{ status: string; n: number }>(sql`SELECT status, COUNT(*) AS n FROM shipment_orders WHERE deleted_at IS NULL
    AND status NOT IN ('Shipped', 'Partially Shipped', 'Delivered', 'Cancelled') AND ${whIn("warehouse_id", wh)} AND ${clIn("client_id", r)} GROUP BY 1 ORDER BY n DESC`);
  const backlogRows: AnalyticsRow[] = backlog.map((b) => ({ status: b.status, orders: Number(b.n), href: `/orders?f.status=in:${enc(b.status)}${whQs}` }));
  const shortages = db.all<{ sku: string; qty: number; lines: number }>(sql`SELECT p.sku AS sku, SUM(s.shortage_qty) AS qty, COUNT(*) AS lines
    FROM order_line_shortages s JOIN order_lines l ON l.id = s.order_line_id JOIN shipment_orders o ON o.id = s.order_id JOIN products p ON p.id = l.product_id
    WHERE s.resolved_at IS NULL AND ${whIn("o.warehouse_id", wh)} AND ${clIn("o.client_id", r)} GROUP BY p.sku ORDER BY qty DESC LIMIT 10`);
  const shortRows: AnalyticsRow[] = shortages.map((s) => ({ sku: s.sku, qty: Number(s.qty), lines: Number(s.lines), href: `/jobs/shortage?q=${enc(s.sku)}&qm=eq` }));
  const totShipped = shipped.reduce((a, x) => a + Number(x.n), 0);
  const totDated = shipped.reduce((a, x) => a + Number(x.dated), 0);
  const totOnTime = shipped.reduce((a, x) => a + Number(x.ontime), 0);
  return {
    kpis: [
      { label: "Orders created", value: fmtInt(created.reduce((a, x) => a + Number(x.n), 0)), hint: "Open and shipped orders dated in the period" },
      { label: "Orders shipped", value: fmtInt(totShipped), hint: "Shipped, partially shipped or delivered in the period", href: `/orders/shipped?${SHIPPED_STATUSES_QS}&${rangeFilter("shippedAt", r)}${whQs}` },
      { label: "On-time shipping", value: `${onTimePct(totDated, totOnTime)}%`, hint: "Shipped on or before the expected ship date", href: `/orders/shipped?${SHIPPED_STATUSES_QS}&${rangeFilter("shippedAt", r)}${whQs}` },
      { label: "Open backlog", value: fmtInt(backlogRows.reduce((a, x) => a + Number(x.orders), 0)), hint: "Open orders right now, any order date", href: `/orders${whQs ? `?${whQs.slice(1)}` : ""}` },
    ],
    charts: [
      { id: "created-shipped", title: "Orders created vs shipped", description: "Per day. The dashed line is the on-time shipping %; it breaks on days with no dated shipments and leaves out today until the day closes. Click a day to open the orders shipped that day.", kind: "line", xKey: "day", wide: true,
        series: [{ key: "created", label: "Created", color: PALETTE[0] }, { key: "shipped", label: "Shipped", color: PALETTE[1] }, { key: "onTimePct", label: "On-time %", color: PALETTE[2], axis: "percent" }], rows: trend, hrefKey: "href",
        columns: [{ key: "day", label: "Day" }, { key: "created", label: "Created", kind: "number" }, { key: "shipped", label: "Shipped", kind: "number" }, { key: "onTimePct", label: "On-time %", kind: "percent" }],
        gridHref: `/orders/shipped?${SHIPPED_STATUSES_QS}&${rangeFilter("shippedAt", r)}${whQs}`, gridLabel: "Open shipped orders" },
      { id: "backlog", title: "Backlog by status", description: "Every open order by its current status. Click a bar to open those orders.", kind: "bar", xKey: "status", horizontal: true,
        series: [{ key: "orders", label: "Orders", color: PALETTE[0] }], rows: backlogRows, hrefKey: "href",
        columns: [{ key: "status", label: "Status" }, { key: "orders", label: "Orders", kind: "number" }], gridHref: `/orders${whQs ? `?${whQs.slice(1)}` : ""}`, gridLabel: "Open the backlog" },
      { id: "shortages", title: "Open shortages by SKU", description: "Units short on unresolved shortage lines. Click a bar to open the shortage report for that SKU.", kind: "bar", xKey: "sku", horizontal: true,
        series: [{ key: "qty", label: "Units short", color: PALETTE[4] }], rows: shortRows, hrefKey: "href",
        columns: [{ key: "sku", label: "SKU" }, { key: "qty", label: "Units short", kind: "number" }, { key: "lines", label: "Lines", kind: "number" }], gridHref: "/jobs/shortage", gridLabel: "Open the shortage report" },
    ],
  };
}

/* ----------------------------------------------------------------- management */

export interface OperationalOptions {
  /** Viewer may see revenue and 3PL billing money (BILLING_VIEW_PERMISSIONS). */
  readonly money: boolean;
}

function management(db: AppDb, r: Range, wh: readonly string[], opts: OperationalOptions): Built {
  const rows = db.all<{ cid: string; client: string; orders: number; units: number; revenue: number }>(sql`
    SELECT c.id AS cid, c.name AS client, COUNT(o.id) AS orders, COALESCE(SUM(o.total_quantity), 0) AS units, COALESCE(SUM(o.sales_price), 0) AS revenue
    FROM shipment_orders o JOIN clients c ON c.id = o.client_id
    WHERE o.deleted_at IS NULL AND o.status IN ('Shipped', 'Partially Shipped', 'Delivered') AND o.shipped_at >= ${r.fromIso} AND o.shipped_at < ${r.toIso} AND ${whIn("o.warehouse_id", wh)} AND ${clIn("o.client_id", r)}
    GROUP BY c.id`);
  const rec = db.all<{ cid: string; units: number }>(sql`SELECT client_id AS cid, SUM(uom_quantity) AS units FROM receipts WHERE cancelled_at IS NULL
    AND received_at >= ${r.fromIso} AND received_at < ${r.toIso} AND ${whIn("warehouse_id", wh)} AND ${clIn("client_id", r)} GROUP BY 1`);
  // Billing money is never queried for a viewer without the billing view permission.
  const bills = opts.money ? db.all<{ cid: string; total: number }>(sql`SELECT client_id AS cid, SUM(total_price) AS total FROM billing_reports
    WHERE period_end >= ${r.from} AND period_start <= ${r.to} AND ${whIn("warehouse_id", wh)} AND ${clIn("client_id", r)} GROUP BY 1`) : [];
  const names = new Map(db.all<{ id: string; name: string }>(sql`SELECT id, name FROM clients`).map((c) => [c.id, c.name]));
  const mgmtWhQs = wh.length ? `&f.warehouseId=in:${wh.join(",")}` : "";
  const shippedHref = `/orders/shipped?${SHIPPED_STATUSES_QS}&${rangeFilter("shippedAt", r)}${mgmtWhQs}`;
  const ids = new Set([...rows.map((x) => x.cid), ...rec.map((x) => x.cid), ...bills.map((x) => x.cid)]);
  const out: AnalyticsRow[] = [...ids].map((id): AnalyticsRow => {
    const o = rows.find((x) => x.cid === id);
    const base = {
      client: names.get(id) ?? "Unknown client", orders: Number(o?.orders ?? 0), units: Number(o?.units ?? 0),
      received: Number(rec.find((x) => x.cid === id)?.units ?? 0),
      href: `/orders/shipped?${SHIPPED_STATUSES_QS}&f.clientId=in:${id}&${rangeFilter("shippedAt", r)}${mgmtWhQs}`,
    };
    return opts.money ? { ...base, revenue: round(Number(o?.revenue ?? 0), 2), billed: round(Number(bills.find((x) => x.cid === id)?.total ?? 0), 2) } : base;
  }).sort((a, b) => (opts.money ? Number(b.revenue) - Number(a.revenue) : Number(b.units) - Number(a.units)));
  const sum = (k: string) => out.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  const activeClients: AnalyticsKpi = { label: "Active clients", value: String(out.filter((x) => Number(x.orders) > 0 || Number(x.received) > 0).length), hint: "Shipped or received in the period", href: "/clients" };
  const share: AnalyticsChart = { id: "share", title: "Order share by client", description: "Share of orders shipped in the period.", kind: "donut", xKey: "client",
    series: [{ key: "orders", label: "Orders", color: PALETTE[0] }], rows: out.filter((x) => Number(x.orders) > 0), hrefKey: "href",
    columns: [{ key: "client", label: "Client" }, { key: "orders", label: "Orders shipped", kind: "number" }] };
  const volumeColumns: AnalyticsChart["columns"] = [{ key: "client", label: "Client" }, { key: "orders", label: "Orders shipped", kind: "number" }, { key: "units", label: "Units shipped", kind: "number" },
    { key: "received", label: "Units received", kind: "number" }];
  if (!opts.money) {
    return {
      kpis: [
        { label: "Orders shipped", value: fmtInt(sum("orders")), hint: "Shipped, partially shipped or delivered in the period", href: shippedHref },
        { label: "Units shipped", value: fmtInt(sum("units")), hint: "Units on those orders, in each (base UOM)", href: shippedHref },
        { label: "Units received", value: fmtInt(sum("received")), hint: "Units received in the period", href: `${RECEIVING_GRID}?${rangeFilter("receivedAt", r)}${clientQs(r)}` },
        activeClients,
      ],
      charts: [
        { id: "by-client", title: "Units by client", description: "Units shipped and received per client. Click a client to open their shipped orders.", kind: "bar", xKey: "client", wide: true,
          series: [{ key: "units", label: "Units shipped", color: PALETTE[0] }, { key: "received", label: "Units received", color: PALETTE[1] }], rows: out, hrefKey: "href",
          columns: volumeColumns, gridHref: shippedHref, gridLabel: "Open shipped orders" },
        share,
      ],
    };
  }
  return {
    kpis: [
      { label: "Orders shipped", value: fmtInt(sum("orders")), hint: "Shipped, partially shipped or delivered in the period", href: shippedHref },
      { label: "Merchandise shipped", value: fmtMoney(sum("revenue")), hint: "Sum of order sales prices (revenue proxy)", href: shippedHref },
      { label: "Billed", value: fmtMoney(sum("billed")), hint: "3PL billing reports overlapping the period", href: "/billing/reports" },
      activeClients,
    ],
    charts: [
      { id: "by-client", title: "Shipped value by client", description: "Revenue proxy (order sales price) against 3PL billing. Click a client to open their shipped orders.", kind: "bar", xKey: "client", wide: true,
        series: [{ key: "revenue", label: "Merchandise shipped", color: PALETTE[0] }, { key: "billed", label: "Billed", color: PALETTE[1] }], rows: out, hrefKey: "href",
        columns: [...volumeColumns, { key: "revenue", label: "Merchandise shipped", kind: "money" }, { key: "billed", label: "Billed", kind: "money" }],
        gridHref: shippedHref, gridLabel: "Open shipped orders" },
      share,
    ],
  };
}

/* --------------------------------------------------------------- productivity */

export const AREA_OF: Readonly<Record<string, string>> = {
  Picking: "Picking", Packing: "Packing", Sorting: "Sorting", Loading: "Shipping dock", Replenishment: "Replenishment", Count: "Inventory control", Kitting: "Kitting",
};
/** Heatmap rows: the most recent N local days of the range. */
export const HEATMAP_DAYS = 14;
const enc2 = encodeURIComponent;

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
/** Intl formatters are expensive to build; one per time zone serves every task. */
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
    FORMATTERS.set(tz, f);
  }
  return f;
}

export function localParts(iso: string, tz: string): { hour: number; date: string; label: string } {
  const parts = formatterFor(tz).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { hour: Number(get("hour") || 0), date, label: `${get("weekday")} ${Number(get("month"))}/${Number(get("day"))}` };
}

/** Task types that roll up into one work area (inverse of AREA_OF). */
export function typesOfArea(area: string): string[] {
  const xs = Object.entries(AREA_OF).filter(([, a]) => a === area).map(([t]) => t);
  return xs.length ? xs : [area];
}

/** Start of the UTC hour holding `iso` (warehouse offsets are whole hours). */
export const utcHourStart = (iso: string): string => `${new Date(iso).toISOString().slice(0, 13)}:00:00.000Z`;

/**
 * Per-area throughput. Only timed tasks feed units/hour (their units over their minutes): an
 * untimed task used to add units with zero minutes and inflate the rate. `floored` counts timed
 * tasks that sit on the 15 s floor (e.g. case moves scanned back to back); when most of an
 * area's tasks are floored its rate says more about the floor than about the work.
 */
export interface AreaAgg {
  day: { u: number; m: number };
  off: { u: number; m: number };
  /** All units, timed or not. */
  units: number;
  measured: number;
  floored: number;
  /** Timed / floored task counts per shift, so each area × shift bar is judged on its own tasks. */
  byShift: { day: { measured: number; floored: number }; off: { measured: number; floored: number } };
}
export const LOW_CONFIDENCE_FLOORED_SHARE = 0.5;
/** Fewer timed tasks than this in one area × shift bucket: its rate is a small-sample guess. */
export const MIN_BUCKET_TASKS = 5;
export const emptyArea = (): AreaAgg => ({ day: { u: 0, m: 0 }, off: { u: 0, m: 0 }, units: 0, measured: 0, floored: 0, byShift: { day: { measured: 0, floored: 0 }, off: { measured: 0, floored: 0 } } });
export function addFact(a: AreaAgg, f: Pick<TaskFact, "qty" | "mins" | "measured">, shift: "day" | "off"): void {
  a.units += f.qty;
  if (!f.measured) return;
  a[shift].u += f.qty; a[shift].m += f.mins;
  a.measured += 1;
  a.byShift[shift].measured += 1;
  if (f.mins <= MIN_TASK_MINUTES) { a.floored += 1; a.byShift[shift].floored += 1; }
}

/**
 * Timing confidence of ONE area × shift bucket (the low-confidence rule applied per bar, not
 * per area): bulk areas, buckets mostly on the 15 s floor, and buckets with fewer than
 * MIN_BUCKET_TASKS timed tasks are flagged. "Normal" otherwise; empty buckets have no bar.
 */
export function bucketConfidence(area: string, s: { measured: number; floored: number }): string {
  if (BULK_AREAS.has(area)) return BULK_NOTE;
  if (s.measured === 0) return "Normal";
  if (s.floored / s.measured > LOW_CONFIDENCE_FLOORED_SHARE) return `Low timing confidence: ${Math.round((s.floored / s.measured) * 100)}% of ${fmtInt(s.measured)} timed tasks at the ${Math.round(MIN_TASK_MINUTES * 60)} s floor`;
  if (s.measured < MIN_BUCKET_TASKS) return `Low sample: only ${fmtInt(s.measured)} timed task${s.measured === 1 ? "" : "s"} in this shift`;
  return "Normal";
}
export const isLowConfidence = (a: Pick<AreaAgg, "measured" | "floored">): boolean => a.measured === 0 || a.floored / a.measured > LOW_CONFIDENCE_FLOORED_SHARE;
/**
 * Areas that move whole cases / LPs per task (a replenishment task moves 24-48 units in a minute
 * or two): their units/hour is real but not comparable with piece picking, so it is flagged,
 * drawn off scale and kept out of the headline units/hour.
 */
export const BULK_AREAS: ReadonlySet<string> = new Set(["Replenishment"]);
export const BULK_NOTE = "Bulk moves (cases and LPs): not comparable with piece picking";
export const unitsPerHour = (u: number, m: number): number => (m > 0 ? round(u / (m / 60), 1) : 0);

const fmtDecimal = (n: number): string => (n >= 10 ? fmtInt(n) : String(round(n, 1)));
const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/**
 * Busiest hour of the day across a range: tasks per local hour-of-day averaged over the days
 * that had any completed task (idle days would only dilute every hour equally). Ties go to the
 * earlier hour. Pure.
 */
export function busiestHourOfDay(cells: readonly { readonly day: string; readonly hour: number; readonly n: number }[]): { readonly hour: number; readonly avg: number; readonly days: number; readonly label: string } | null {
  const days = new Set(cells.filter((c) => c.n > 0).map((c) => c.day)).size;
  if (days === 0) return null;
  const byHour = new Array<number>(24).fill(0);
  for (const c of cells) if (c.hour >= 0 && c.hour < 24) byHour[c.hour] = (byHour[c.hour] ?? 0) + c.n;
  let hour = 0;
  for (let h = 1; h < 24; h += 1) if ((byHour[h] ?? 0) > (byHour[hour] ?? 0)) hour = h;
  const avg = (byHour[hour] ?? 0) / days;
  return { hour, avg, days, label: `${hh(hour)}–${hh((hour + 1) % 24)}` };
}

function productivity(db: AppDb, r: Range, wh: readonly string[]): Built {
  const facts = loadTaskFacts(db, r, wh);
  const meta = db.all<{ id: string; fin: string; tz: string; s: string; e: string }>(sql`SELECT t.id AS id, t.finished_at AS fin, w.timezone AS tz, w.day_shift_start AS s, w.day_shift_end AS e
    FROM tasks t JOIN warehouses w ON w.id = t.warehouse_id WHERE t.status = 'Completed' AND t.finished_at >= ${r.fromIso} AND t.finished_at < ${r.toIso} AND ${whIn("t.warehouse_id", wh)} AND ${clIn("t.client_id", r)}`);
  const byId = new Map(meta.map((m) => [m.id, m]));
  const areas = new Map<string, AreaAgg>();
  const heat = new Map<string, { n: number; hourIso: string }>();
  const dayLabels = new Map<string, string>();
  const toMin = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  for (const f of facts) {
    const m = byId.get(f.id);
    if (!m) continue;
    const { hour, date, label } = localParts(m.fin, m.tz);
    dayLabels.set(date, label);
    const shift = hour * 60 >= toMin(m.s) && hour * 60 < toMin(m.e) ? "day" : "off";
    const key = `${date}|${hour}`;
    const cell = heat.get(key);
    heat.set(key, { n: (cell?.n ?? 0) + 1, hourIso: cell?.hourIso ?? utcHourStart(m.fin) });
    // Counted quantity is not throughput, so counts only feed the heatmap.
    if (f.type === "Count") continue;
    const area = AREA_OF[f.type] ?? f.type;
    const a = areas.get(area) ?? emptyArea();
    addFact(a, f, shift);
    areas.set(area, a);
  }
  const areaRows: AnalyticsRow[] = [...areas.entries()].map(([area, a]) => {
    const low = isLowConfidence(a);
    return {
      area, dayShift: unitsPerHour(a.day.u, a.day.m), offShift: unitsPerHour(a.off.u, a.off.m), overall: unitsPerHour(a.day.u + a.off.u, a.day.m + a.off.m),
      units: a.units, timedUnits: a.day.u + a.off.u, hours: round((a.day.m + a.off.m) / 60, 1),
      "confidence:dayShift": bucketConfidence(area, a.byShift.day), "confidence:offShift": bucketConfidence(area, a.byShift.off),
      confidence: BULK_AREAS.has(area) ? BULK_NOTE : low ? `Low timing confidence: ${Math.round((a.floored / Math.max(a.measured, 1)) * 100)}% of ${fmtInt(a.measured)} timed tasks at the ${Math.round(MIN_TASK_MINUTES * 60)} s floor` : "Normal",
      href: tasksHref(r, `&f.taskType=in:${typesOfArea(area).map(enc2).join(",")}`, taskGridOf(typesOfArea(area))),
    };
  }).sort((x, y) => Number(y.units) - Number(x.units));
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
  const heatDays = [...dayLabels.keys()].sort().slice(-HEATMAP_DAYS);
  const heatRows: AnalyticsRow[] = heatDays.map((d) => {
    const row: Record<string, string | number> = { day: dayLabels.get(d) ?? d, date: d };
    hours.forEach((h, i) => {
      const cell = heat.get(`${d}|${i}`);
      row[h] = cell?.n ?? 0;
      if (cell) row[`href:${h}`] = `${TASKS}?f.status=in:Completed&${hourFilter("finishedAt", cell.hourIso)}${clientQs(r)}`;
    });
    return row;
  });
  const busiest = [...heat.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  // Units per hour uses timed tasks only (units and minutes from the same tasks) and leaves out
  // low-confidence and bulk-move areas, so one area cannot inflate the rate.
  const credible = [...areas.entries()].filter(([area, a]) => !isLowConfidence(a) && !BULK_AREAS.has(area));
  const cu = credible.reduce((s, [, a]) => s + a.day.u + a.off.u, 0);
  const cm = credible.reduce((s, [, a]) => s + a.day.m + a.off.m, 0);
  const units = [...areas.values()].reduce((s, a) => s + a.units, 0);
  const mins = [...areas.values()].reduce((s, a) => s + a.day.m + a.off.m, 0);
  const lowAreas = areaRows.filter((x) => x.confidence !== "Normal").map((x) => String(x.area));
  const lowBuckets = areaRows.filter((x) => x.confidence === "Normal").flatMap((x) => ([["dayShift", "day shift"], ["offShift", "off shift"]] as const)
    .filter(([k]) => x[`confidence:${k}`] !== "Normal").map(([, label]) => `${String(x.area)} ${label}`));
  const perArea = areaRows.filter((x) => x.confidence === "Normal").slice(0, 3).map((x) => `${String(x.area)} ${fmtInt(Number(x.overall))}/h`).join(" · ");
  const workHref = tasksHref(r, "&f.taskType=nin:Count");
  const peakLabel = busiest ? `${dayLabels.get(busiest[0].split("|")[0] ?? "") ?? ""} ${String(busiest[0].split("|")[1]).padStart(2, "0")}:00` : "";
  const pattern = busiestHourOfDay([...heat.entries()].map(([k, v]) => ({ day: k.split("|")[0] ?? "", hour: Number(k.split("|")[1]), n: v.n })));
  return {
    timing: timingShare(facts),
    kpis: [
      { label: "Units per hour", value: cm > 0 ? fmtInt(unitsPerHour(cu, cm)) : "—", hint: perArea || "Timed tasks only, counts excluded", href: workHref },
      { label: "Units handled", value: fmtInt(units), hint: "Counts excluded", href: workHref },
      { label: "Measured hours", value: `${round(mins / 60, 1)} h`, hint: "Sum of timed task durations (start to finish)", href: workHref },
      // Staffing view (critic R5): the hour of the DAY that is busiest on average across the
      // active days of the range, with the single peak hour as a secondary hint (and link).
      { label: "Busiest hour", value: pattern ? pattern.label : "—",
        hint: pattern && busiest ? `avg ${fmtDecimal(pattern.avg)} tasks/day over ${fmtInt(pattern.days)} active day${pattern.days === 1 ? "" : "s"} · peak ${peakLabel} (${fmtInt(busiest[1].n)})` : "No completed tasks in the period",
        href: busiest ? `${TASKS}?f.status=in:Completed&${hourFilter("finishedAt", busiest[1].hourIso)}` : undefined },
    ],
    charts: [
      { id: "by-area", title: "Units per hour by area and shift",
        description: `Timed tasks only. Day shift uses each warehouse's shift window; everything else is off shift.${lowAreas.length ? ` Hatched: ${lowAreas.join(", ")} (bulk moves or low timing confidence; see the tooltip), left out of the headline units per hour.` : ""}${lowBuckets.length ? ` Also hatched: ${lowBuckets.join(", ")} (too few or mostly floored timed tasks in that shift).` : ""} Click an area to open its tasks.`,
        kind: "bar", xKey: "area", wide: true, offScale: true, flagKey: "confidence", flagNormal: "Normal",
        series: [{ key: "dayShift", label: "Day shift", color: PALETTE[0] }, { key: "offShift", label: "Off shift", color: PALETTE[3] }], rows: areaRows, hrefKey: "href",
        columns: [{ key: "area", label: "Area" }, { key: "dayShift", label: "Day shift units/h", kind: "decimal" }, { key: "offShift", label: "Off shift units/h", kind: "decimal" }, { key: "overall", label: "All units/h", kind: "decimal" },
          { key: "units", label: "Units", kind: "number" }, { key: "hours", label: "Timed hours", kind: "hours" }, { key: "confidence", label: "Timing confidence" },
          { key: "confidence:dayShift", label: "Day shift confidence" }, { key: "confidence:offShift", label: "Off shift confidence" }],
        gridHref: `${TASKS}?f.status=in:Completed&${rangeFilter("finishedAt", r)}${clientQs(r)}`, gridLabel: "Open completed tasks" },
      { id: "heatmap", title: "Tasks completed by hour", description: `Warehouse local time, the last ${HEATMAP_DAYS} active days of the range. Click a cell to open the tasks finished in that hour.`, kind: "heatmap", xKey: "day", wide: true,
        series: [{ key: "tasks", label: "Tasks", color: PALETTE[0] }], rows: heatRows, xCategories: hours, yCategories: heatRows.map((x) => String(x.day)),
        columns: [{ key: "day", label: "Day" }, ...hours.map((h) => ({ key: h, label: `${h}:00`, kind: "number" as const }))] },
    ],
  };
}

export function buildOperational(db: AppDb, page: OperationalPage, r: Range, wh: readonly string[], opts: OperationalOptions = { money: false }): Built {
  if (page === "inbound-inventory") return inbound(db, r, wh);
  if (page === "fulfillment") return fulfillment(db, r, wh);
  if (page === "management") return management(db, r, wh, opts);
  return productivity(db, r, wh);
}
