/**
 * Operational Analytics (KitStaks-designed, BUILD_PLAN Part D): Inbound & Inventory,
 * Fulfillment, Management and Productivity dashboards from the live tables.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AnalyticsChart, AnalyticsKpi, AnalyticsRow, OperationalPage } from "./analytics-types";
import { dayFilter, fmtInt, fmtMoney, hourFilter, PALETTE, rangeFilter, round, whIn, type Range } from "./analytics-common";
import { loadTaskFacts, RECEIVING_GRID, TASKS_GRID as TASKS, taskGridOf, tasksHref } from "./analytics-labor";

type Built = { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] };
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
    SELECT substr(received_at, 1, 10) AS d, CASE WHEN type = 'Return' THEN 'returns' ELSE 'po' END AS kind, SUM(uom_quantity) AS units
    FROM receipts WHERE cancelled_at IS NULL AND type IN ('Purchase Order', 'Return', 'Product Receive', 'Add Inventory')
      AND received_at >= ${r.fromIso} AND received_at < ${r.toIso} AND ${whIn("warehouse_id", wh)} GROUP BY 1, 2`);
  const trend: AnalyticsRow[] = r.days.map((day) => ({
    day,
    po: receipts.filter((x) => x.d === day && x.kind === "po").reduce((a, x) => a + Number(x.units), 0),
    returns: receipts.filter((x) => x.d === day && x.kind === "returns").reduce((a, x) => a + Number(x.units), 0),
    href: `${RECEIVING_GRID}?${dayFilter("receivedAt", day)}`,
  }));
  // Dock-to-stock: receipt into a Receiving location → first move out of it for that product.
  const d2s = db.get<{ hrs: number | null; n: number; pending: number }>(sql`
    WITH rc AS (
      SELECT r.id, r.received_at, (SELECT MIN(t.at) FROM inventory_transactions t
        WHERE t.from_location_id = r.location_id AND t.product_id = r.product_id AND t.at >= r.received_at
          AND t.type IN ('Inventory Movement', 'Replenishment')) AS moved_at
      FROM receipts r JOIN locations l ON l.id = r.location_id
      WHERE r.cancelled_at IS NULL AND l.type = 'Receiving' AND r.received_at >= ${r.fromIso} AND r.received_at < ${r.toIso} AND ${whIn("r.warehouse_id", wh)}
    )
    SELECT AVG(CASE WHEN moved_at IS NOT NULL THEN (julianday(moved_at) - julianday(received_at)) * 24 END) AS hrs,
           SUM(moved_at IS NOT NULL) AS n, SUM(moved_at IS NULL) AS pending FROM rc`);
  const inv = db.all<{ sku: string; pid: string; units: number; value: number; received: string }>(sql`
    SELECT p.sku AS sku, p.id AS pid, i.on_hand AS units, i.on_hand * COALESCE(p.purchase_price, p.price, 0) AS value, i.received_at AS received
    FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.on_hand > 0 AND ${whIn("i.warehouse_id", wh)}`);
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
  const recHref = `${RECEIVING_GRID}?${rangeFilter("receivedAt", r)}`;
  return {
    kpis: [
      { label: "Units received", value: fmtInt(trend.reduce((a, x) => a + Number(x.po) + Number(x.returns), 0)), href: recHref },
      { label: "Avg dock-to-stock", value: d2s?.hrs != null ? `${round(Number(d2s.hrs), 1)} h` : "—", hint: d2s?.pending ? `${fmtInt(Number(d2s.pending))} receipts still on the dock` : "Every receipt is put away", href: "/inventory/by-location?f.locationType=in:Receiving" },
      { label: "Inventory value", value: fmtMoney(totalValue), hint: "On hand × purchase price", href: "/inventory" },
      { label: "Units on hand", value: fmtInt(inv.reduce((a, x) => a + Number(x.units), 0)), href: "/inventory" },
    ],
    charts: [
      { id: "receipts", title: "Receipts trend", description: "Units received per day: purchase orders and returns. Click a day to open its receipts.", kind: "stackedBar", xKey: "day", wide: true,
        series: [{ key: "po", label: "Purchase orders", color: PALETTE[0] }, { key: "returns", label: "Returns", color: PALETTE[2] }], rows: trend, hrefKey: "href",
        columns: [{ key: "day", label: "Day" }, { key: "po", label: "PO units", kind: "number" }, { key: "returns", label: "Return units", kind: "number" }], gridHref: recHref, gridLabel: "Open receiving history" },
      { id: "aging", title: "Inventory aging", description: "On-hand units by days since they were received. Click a bucket to open that stock.", kind: "bar", xKey: "bucket",
        series: [{ key: "units", label: "Units", color: PALETTE[1] }], rows: aging, hrefKey: "href",
        columns: [{ key: "bucket", label: "Age" }, { key: "units", label: "Units", kind: "number" }, { key: "value", label: "Value", kind: "money" }], gridHref: "/inventory/by-location", gridLabel: "Open inventory by location" },
      { id: "top-skus", title: "Top SKUs by inventory value", description: "The ten SKUs holding the most value. Click to open the SKU's inventory.", kind: "bar", xKey: "sku",
        series: [{ key: "value", label: "Value", color: PALETTE[3] }], rows: top, hrefKey: "href",
        columns: [{ key: "sku", label: "SKU" }, { key: "units", label: "Units", kind: "number" }, { key: "value", label: "Value", kind: "money" }], gridHref: "/inventory", gridLabel: "Open total inventory" },
    ],
  };
}

/* ---------------------------------------------------------------- fulfillment */

export function onTimePct(shipped: number, onTime: number): number {
  return shipped > 0 ? round((onTime / shipped) * 100, 1) : 0;
}

function fulfillment(db: AppDb, r: Range, wh: readonly string[]): Built {
  const created = db.all<{ d: string; n: number }>(sql`SELECT substr(order_date, 1, 10) AS d, COUNT(*) AS n FROM shipment_orders
    WHERE deleted_at IS NULL AND order_date >= ${r.fromIso} AND order_date < ${r.toIso} AND ${whIn("warehouse_id", wh)} GROUP BY 1`);
  const shipped = db.all<{ d: string; n: number; ontime: number; dated: number }>(sql`SELECT substr(shipped_at, 1, 10) AS d, COUNT(*) AS n,
      SUM(expected_ship_date IS NOT NULL AND substr(shipped_at, 1, 10) <= substr(expected_ship_date, 1, 10)) AS ontime, SUM(expected_ship_date IS NOT NULL) AS dated
    FROM shipment_orders WHERE deleted_at IS NULL AND status IN ('Shipped', 'Partially Shipped', 'Delivered') AND shipped_at >= ${r.fromIso} AND shipped_at < ${r.toIso}
      AND ${whIn("warehouse_id", wh)} GROUP BY 1`);
  const whQs = wh.length ? `&f.warehouseId=in:${wh.join(",")}` : "";
  const trend: AnalyticsRow[] = r.days.map((day) => ({
    day, created: Number(created.find((x) => x.d === day)?.n ?? 0), shipped: Number(shipped.find((x) => x.d === day)?.n ?? 0),
    href: `/orders/shipped?${SHIPPED_STATUSES_QS}&${dayFilter("shippedAt", day)}${whQs}`,
    onTimePct: (() => { const s = shipped.find((x) => x.d === day); return s && Number(s.dated) > 0 ? onTimePct(Number(s.dated), Number(s.ontime)) : null; })(),
  }));
  const backlog = db.all<{ status: string; n: number }>(sql`SELECT status, COUNT(*) AS n FROM shipment_orders WHERE deleted_at IS NULL
    AND status NOT IN ('Shipped', 'Partially Shipped', 'Delivered', 'Cancelled') AND ${whIn("warehouse_id", wh)} GROUP BY 1 ORDER BY n DESC`);
  const backlogRows: AnalyticsRow[] = backlog.map((b) => ({ status: b.status, orders: Number(b.n), href: `/orders?f.status=in:${enc(b.status)}${whQs}` }));
  const shortages = db.all<{ sku: string; qty: number; lines: number }>(sql`SELECT p.sku AS sku, SUM(s.shortage_qty) AS qty, COUNT(*) AS lines
    FROM order_line_shortages s JOIN order_lines l ON l.id = s.order_line_id JOIN shipment_orders o ON o.id = s.order_id JOIN products p ON p.id = l.product_id
    WHERE s.resolved_at IS NULL AND ${whIn("o.warehouse_id", wh)} GROUP BY p.sku ORDER BY qty DESC LIMIT 10`);
  const shortRows: AnalyticsRow[] = shortages.map((s) => ({ sku: s.sku, qty: Number(s.qty), lines: Number(s.lines), href: `/jobs/shortage?q=${enc(s.sku)}&qm=eq` }));
  const totShipped = shipped.reduce((a, x) => a + Number(x.n), 0);
  const totDated = shipped.reduce((a, x) => a + Number(x.dated), 0);
  const totOnTime = shipped.reduce((a, x) => a + Number(x.ontime), 0);
  return {
    kpis: [
      { label: "Orders created", value: fmtInt(created.reduce((a, x) => a + Number(x.n), 0)), hint: "Open and shipped orders dated in the period" },
      { label: "Orders shipped", value: fmtInt(totShipped), href: `/orders/shipped?${SHIPPED_STATUSES_QS}&${rangeFilter("shippedAt", r)}${whQs}` },
      { label: "On-time shipping", value: `${onTimePct(totDated, totOnTime)}%`, hint: "Shipped on or before the expected ship date", href: `/orders/shipped?${SHIPPED_STATUSES_QS}&${rangeFilter("shippedAt", r)}${whQs}` },
      { label: "Open backlog", value: fmtInt(backlogRows.reduce((a, x) => a + Number(x.orders), 0)), href: `/orders${whQs ? `?${whQs.slice(1)}` : ""}` },
    ],
    charts: [
      { id: "created-shipped", title: "Orders created vs shipped", description: "Per day. The dashed line is the on-time shipping %. Click a day to open the orders shipped that day.", kind: "line", xKey: "day", wide: true,
        series: [{ key: "created", label: "Created", color: PALETTE[0] }, { key: "shipped", label: "Shipped", color: PALETTE[1] }, { key: "onTimePct", label: "On-time %", color: PALETTE[2] }], rows: trend, hrefKey: "href",
        columns: [{ key: "day", label: "Day" }, { key: "created", label: "Created", kind: "number" }, { key: "shipped", label: "Shipped", kind: "number" }, { key: "onTimePct", label: "On-time %", kind: "percent" }],
        gridHref: `/orders/shipped?${SHIPPED_STATUSES_QS}&${rangeFilter("shippedAt", r)}${whQs}`, gridLabel: "Open shipped orders" },
      { id: "backlog", title: "Backlog by status", description: "Every open order by its current status. Click a bar to open those orders.", kind: "bar", xKey: "status",
        series: [{ key: "orders", label: "Orders", color: PALETTE[0] }], rows: backlogRows, hrefKey: "href",
        columns: [{ key: "status", label: "Status" }, { key: "orders", label: "Orders", kind: "number" }], gridHref: `/orders${whQs ? `?${whQs.slice(1)}` : ""}`, gridLabel: "Open the backlog" },
      { id: "shortages", title: "Open shortages by SKU", description: "Units short on unresolved shortage lines.", kind: "bar", xKey: "sku",
        series: [{ key: "qty", label: "Units short", color: PALETTE[4] }], rows: shortRows, hrefKey: "href",
        columns: [{ key: "sku", label: "SKU" }, { key: "qty", label: "Units short", kind: "number" }, { key: "lines", label: "Lines", kind: "number" }], gridHref: "/jobs/shortage", gridLabel: "Open the shortage report" },
    ],
  };
}

/* ----------------------------------------------------------------- management */

function management(db: AppDb, r: Range, wh: readonly string[]): Built {
  const rows = db.all<{ cid: string; client: string; orders: number; units: number; revenue: number }>(sql`
    SELECT c.id AS cid, c.name AS client, COUNT(o.id) AS orders, COALESCE(SUM(o.total_quantity), 0) AS units, COALESCE(SUM(o.sales_price), 0) AS revenue
    FROM shipment_orders o JOIN clients c ON c.id = o.client_id
    WHERE o.deleted_at IS NULL AND o.status IN ('Shipped', 'Partially Shipped', 'Delivered') AND o.shipped_at >= ${r.fromIso} AND o.shipped_at < ${r.toIso} AND ${whIn("o.warehouse_id", wh)}
    GROUP BY c.id`);
  const rec = db.all<{ cid: string; units: number }>(sql`SELECT client_id AS cid, SUM(uom_quantity) AS units FROM receipts WHERE cancelled_at IS NULL
    AND received_at >= ${r.fromIso} AND received_at < ${r.toIso} AND ${whIn("warehouse_id", wh)} GROUP BY 1`);
  const bills = db.all<{ cid: string; total: number }>(sql`SELECT client_id AS cid, SUM(total_price) AS total FROM billing_reports
    WHERE period_end >= ${r.from} AND period_start <= ${r.to} AND ${whIn("warehouse_id", wh)} GROUP BY 1`);
  const names = new Map(db.all<{ id: string; name: string }>(sql`SELECT id, name FROM clients`).map((c) => [c.id, c.name]));
  const mgmtWhQs = wh.length ? `&f.warehouseId=in:${wh.join(",")}` : "";
  const shippedHref = `/orders/shipped?${SHIPPED_STATUSES_QS}&${rangeFilter("shippedAt", r)}${mgmtWhQs}`;
  const ids = new Set([...rows.map((x) => x.cid), ...rec.map((x) => x.cid), ...bills.map((x) => x.cid)]);
  const out: AnalyticsRow[] = [...ids].map((id) => {
    const o = rows.find((x) => x.cid === id);
    return {
      client: names.get(id) ?? "Unknown client", orders: Number(o?.orders ?? 0), units: Number(o?.units ?? 0), revenue: round(Number(o?.revenue ?? 0), 2),
      received: Number(rec.find((x) => x.cid === id)?.units ?? 0), billed: round(Number(bills.find((x) => x.cid === id)?.total ?? 0), 2),
      href: `/orders/shipped?${SHIPPED_STATUSES_QS}&f.clientId=in:${id}&${rangeFilter("shippedAt", r)}${mgmtWhQs}`,
    };
  }).sort((a, b) => Number(b.revenue) - Number(a.revenue));
  const sum = (k: string) => out.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  return {
    kpis: [
      { label: "Orders shipped", value: fmtInt(sum("orders")), href: shippedHref },
      { label: "Merchandise shipped", value: fmtMoney(sum("revenue")), hint: "Sum of order sales prices (revenue proxy)", href: shippedHref },
      { label: "Billed", value: fmtMoney(sum("billed")), hint: "3PL billing reports overlapping the period", href: "/billing/reports" },
      { label: "Active clients", value: String(out.filter((x) => Number(x.orders) > 0 || Number(x.received) > 0).length), hint: "Shipped or received in the period", href: "/clients" },
    ],
    charts: [
      { id: "by-client", title: "Shipped value by client", description: "Revenue proxy (order sales price) against 3PL billing. Click a client to open their shipped orders.", kind: "bar", xKey: "client", wide: true,
        series: [{ key: "revenue", label: "Merchandise shipped", color: PALETTE[0] }, { key: "billed", label: "Billed", color: PALETTE[1] }], rows: out, hrefKey: "href",
        columns: [{ key: "client", label: "Client" }, { key: "orders", label: "Orders shipped", kind: "number" }, { key: "units", label: "Units shipped", kind: "number" },
          { key: "received", label: "Units received", kind: "number" }, { key: "revenue", label: "Merchandise shipped", kind: "money" }, { key: "billed", label: "Billed", kind: "money" }],
        gridHref: shippedHref, gridLabel: "Open shipped orders" },
      { id: "share", title: "Order share by client", description: "Share of orders shipped in the period.", kind: "donut", xKey: "client",
        series: [{ key: "orders", label: "Orders", color: PALETTE[0] }], rows: out.filter((x) => Number(x.orders) > 0), hrefKey: "href",
        columns: [{ key: "client", label: "Client" }, { key: "orders", label: "Orders shipped", kind: "number" }] },
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

function productivity(db: AppDb, r: Range, wh: readonly string[]): Built {
  const facts = loadTaskFacts(db, r, wh);
  const meta = db.all<{ id: string; fin: string; tz: string; s: string; e: string }>(sql`SELECT t.id AS id, t.finished_at AS fin, w.timezone AS tz, w.day_shift_start AS s, w.day_shift_end AS e
    FROM tasks t JOIN warehouses w ON w.id = t.warehouse_id WHERE t.status = 'Completed' AND t.finished_at >= ${r.fromIso} AND t.finished_at < ${r.toIso} AND ${whIn("t.warehouse_id", wh)}`);
  const byId = new Map(meta.map((m) => [m.id, m]));
  const areas = new Map<string, { day: { u: number; m: number }; off: { u: number; m: number } }>();
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
    const a = areas.get(area) ?? { day: { u: 0, m: 0 }, off: { u: 0, m: 0 } };
    a[shift].u += f.qty; a[shift].m += f.mins;
    areas.set(area, a);
  }
  const uph = (u: number, m: number) => (m > 0 ? round(u / (m / 60), 1) : 0);
  const areaRows: AnalyticsRow[] = [...areas.entries()].map(([area, a]) => ({
    area, dayShift: uph(a.day.u, a.day.m), offShift: uph(a.off.u, a.off.m), units: a.day.u + a.off.u, hours: round((a.day.m + a.off.m) / 60, 1),
    href: tasksHref(r, `&f.taskType=in:${typesOfArea(area).map(enc2).join(",")}`, taskGridOf(typesOfArea(area))),
  })).sort((x, y) => Number(y.units) - Number(x.units));
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
  const heatDays = [...dayLabels.keys()].sort().slice(-HEATMAP_DAYS);
  const heatRows: AnalyticsRow[] = heatDays.map((d) => {
    const row: Record<string, string | number> = { day: dayLabels.get(d) ?? d, date: d };
    hours.forEach((h, i) => {
      const cell = heat.get(`${d}|${i}`);
      row[h] = cell?.n ?? 0;
      if (cell) row[`href:${h}`] = `${TASKS}?f.status=in:Completed&${hourFilter("finishedAt", cell.hourIso)}`;
    });
    return row;
  });
  const busiest = [...heat.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const work = facts.filter((f) => f.type !== "Count");
  const units = work.reduce((a, f) => a + f.qty, 0);
  const mins = work.reduce((a, f) => a + f.mins, 0);
  const workHref = tasksHref(r, "&f.taskType=nin:Count");
  const busiestLabel = busiest ? `${dayLabels.get(busiest[0].split("|")[0] ?? "") ?? ""} ${String(busiest[0].split("|")[1]).padStart(2, "0")}:00` : "—";
  return {
    kpis: [
      { label: "Units per hour", value: fmtInt(uph(units, mins)), hint: "Counts excluded", href: workHref },
      { label: "Units handled", value: fmtInt(units), href: workHref },
      { label: "Measured hours", value: `${round(mins / 60, 1)} h`, href: workHref },
      { label: "Busiest hour", value: busiestLabel, hint: busiest ? `${fmtInt(busiest[1].n)} tasks` : undefined,
        href: busiest ? `${TASKS}?f.status=in:Completed&${hourFilter("finishedAt", busiest[1].hourIso)}` : undefined },
    ],
    charts: [
      { id: "by-area", title: "Units per hour by area and shift", description: "Day shift uses each warehouse's shift window; everything else is off shift. Click an area to open its tasks.", kind: "bar", xKey: "area", wide: true,
        series: [{ key: "dayShift", label: "Day shift", color: PALETTE[0] }, { key: "offShift", label: "Off shift", color: PALETTE[3] }], rows: areaRows, hrefKey: "href",
        columns: [{ key: "area", label: "Area" }, { key: "dayShift", label: "Day shift units/h", kind: "decimal" }, { key: "offShift", label: "Off shift units/h", kind: "decimal" }, { key: "units", label: "Units", kind: "number" }, { key: "hours", label: "Hours", kind: "hours" }],
        gridHref: `${TASKS}?f.status=in:Completed&${rangeFilter("finishedAt", r)}`, gridLabel: "Open completed tasks" },
      { id: "heatmap", title: "Tasks completed by hour", description: `Warehouse local time, the last ${HEATMAP_DAYS} active days of the range. Click a cell to open the tasks finished in that hour.`, kind: "heatmap", xKey: "day", wide: true,
        series: [{ key: "tasks", label: "Tasks", color: PALETTE[0] }], rows: heatRows, xCategories: hours, yCategories: heatRows.map((x) => String(x.day)),
        columns: [{ key: "day", label: "Day" }, ...hours.map((h) => ({ key: h, label: `${h}:00`, kind: "number" as const }))] },
    ],
  };
}

export function buildOperational(db: AppDb, page: OperationalPage, r: Range, wh: readonly string[]): Built {
  if (page === "inbound-inventory") return inbound(db, r, wh);
  if (page === "fulfillment") return fulfillment(db, r, wh);
  if (page === "management") return management(db, r, wh);
  return productivity(db, r, wh);
}
