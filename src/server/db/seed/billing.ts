/**
 * 3PL billing: five contracts with four fees (one tiered). Each has a September bill (Approved,
 * exported) and an October bill (Draft; Approved for HRB) whose consolidated and detailed lines are
 * computed from the replayed activity, and twelve VAS operations.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { nextValue } from "@/server/domain/sequences";
import type { Tx } from "@/server/domain/types";
import { lookupId } from "./lookups";
import { isoOf, utcAt } from "./runtime";
import { actor, round2, type Id } from "./types";
import type { World } from "./world";

/** `start`/`end` bound the activity (warehouse midnight in UTC); `billStart`/`billEnd` are the stored day period, as the engine writes it. */
interface Period { readonly start: string; readonly end: string; readonly billStart: string; readonly billEnd: string; readonly calcDaysAgo: number }
/** September and October (warehouse time, America/New_York): every contract gets one bill per period. */
const PERIODS: readonly Period[] = [
  { start: "2026-09-01T04:00:00.000Z", end: "2026-10-01T03:59:59.999Z", billStart: "2026-09-01T00:00:00.000Z", billEnd: "2026-09-30T23:59:59.999Z", calcDaysAgo: 35 },
  { start: "2026-10-01T04:00:00.000Z", end: "2026-11-01T03:59:59.999Z", billStart: "2026-10-01T00:00:00.000Z", billEnd: "2026-10-31T23:59:59.999Z", calcDaysAgo: 4 },
];

interface FeeDef {
  readonly name: string;
  readonly operationType: (typeof schema.billingFees.$inferInsert)["operationType"];
  readonly feeBy: string;
  readonly chargeBy: string;
  readonly rate: number;
  readonly tiers?: readonly (readonly [number, number | null, number])[];
  readonly calculationType?: (typeof schema.billingFees.$inferInsert)["calculationType"];
  readonly minPrice?: number;
}

const FEES: readonly FeeDef[] = [
  // Fee By / Charge By use the Logiwa matrix values (grid-defs/organization/billing CHARGE_BY).
  { name: "Order Fulfillment Fee", operationType: "Shipment", feeBy: "Per SO", chargeBy: "SO", rate: 2.85, minPrice: 250 },
  { name: "Pick & Pack (per unit)", operationType: "Pick & Pack", feeBy: "Per Picking", chargeBy: "Product (UOM Quantity)", rate: 0.35, tiers: [[1, 1000, 0.35], [1001, 5000, 0.3], [5001, null, 0.25]] },
  { name: "Storage - Bin Location", operationType: "Storage", feeBy: "Location", chargeBy: "Location", rate: 0.65, calculationType: "Daily Accumulation" },
  { name: "Receiving (per unit)", operationType: "Receiving", feeBy: "Per Product", chargeBy: "Product (UOM Quantity)", rate: 0.18 },
];

function activity(tx: Tx, clientId: Id, warehouseId: Id, { start: PERIOD_START, end: PERIOD_END }: Period): Record<FeeDef["operationType"], number> {
  const shipped = tx.select({ id: schema.shipmentOrders.id }).from(schema.shipmentOrders).where(and(eq(schema.shipmentOrders.clientId, clientId),
    eq(schema.shipmentOrders.warehouseId, warehouseId), gte(schema.shipmentOrders.shippedAt, PERIOD_START), lte(schema.shipmentOrders.shippedAt, PERIOD_END))).all().map((o) => o.id);
  const units = shipped.length === 0 ? 0 : tx.select({ n: sql<number>`COALESCE(SUM(${schema.orderLines.shippedQuantity}), 0)` }).from(schema.orderLines)
    .where(inArray(schema.orderLines.orderId, shipped)).get()?.n ?? 0;
  const received = tx.select({ n: sql<number>`COALESCE(SUM(${schema.receipts.uomQuantity}), 0)` }).from(schema.receipts).where(and(eq(schema.receipts.clientId, clientId),
    eq(schema.receipts.warehouseId, warehouseId), gte(schema.receipts.receivedAt, PERIOD_START), lte(schema.receipts.receivedAt, PERIOD_END), sql`${schema.receipts.cancelledAt} IS NULL`,
    sql`${schema.receipts.type} <> 'Add Inventory'`)).get()?.n ?? 0;
  const locations = tx.get<{ n: number }>(sql`SELECT COUNT(DISTINCT location_id) AS n FROM inventory WHERE client_id = ${clientId} AND warehouse_id = ${warehouseId} AND on_hand > 0`)?.n ?? 0;
  return { "Shipment": shipped.length, "Pick & Pack": Number(units), "Storage": Number(locations) * 26, "Receiving": Number(received), "Recurring": 0, "VAS": 0, "Return": 0, "Work Order": 0 };
}

function tieredPrice(qty: number, fee: FeeDef): number {
  if (!fee.tiers) return qty * fee.rate;
  return fee.tiers.reduce((sum, [from, to, rate]) => sum + Math.max(0, Math.min(qty, to ?? Infinity) - from + 1) * rate, 0);
}

interface DetailRow { readonly ref: string | null; readonly sku: string | null; readonly lp: string | null; readonly at: string | null; readonly qty: number; readonly note: string | null }

/** Activity-level lines for the Detailed tab: one per shipped order and one per receipt line, capped per fee. */
function details(tx: Tx, clientId: Id, warehouseId: Id, p: Period, op: FeeDef["operationType"]): readonly DetailRow[] {
  if (op === "Shipment" || op === "Pick & Pack") {
    const qty = op === "Shipment" ? sql`1` : sql`(SELECT COALESCE(SUM(l.shipped_quantity), 0) FROM order_lines l WHERE l.order_id = o.id)`;
    return tx.all<DetailRow>(sql`SELECT o.code AS ref, (SELECT pr.sku FROM order_lines l JOIN products pr ON pr.id = l.product_id WHERE l.order_id = o.id LIMIT 1) AS sku,
      NULL AS lp, substr(o.shipped_at, 1, 10) AS at, ${qty} AS qty, o.carrier AS note FROM shipment_orders o
      WHERE o.client_id = ${clientId} AND o.warehouse_id = ${warehouseId} AND o.shipped_at BETWEEN ${p.start} AND ${p.end} ORDER BY o.shipped_at LIMIT 400`);
  }
  if (op === "Receiving") {
    return tx.all<DetailRow>(sql`SELECT COALESCE(po.code, r.type) AS ref, pr.sku AS sku, lp.number AS lp, substr(r.received_at, 1, 10) AS at, r.uom_quantity AS qty, r.line_note AS note
      FROM receipts r LEFT JOIN purchase_orders po ON po.id = r.purchase_order_id LEFT JOIN products pr ON pr.id = r.product_id LEFT JOIN license_plates lp ON lp.id = r.lp_id
      WHERE r.client_id = ${clientId} AND r.warehouse_id = ${warehouseId} AND r.received_at BETWEEN ${p.start} AND ${p.end} AND r.cancelled_at IS NULL AND r.type <> 'Add Inventory'
      ORDER BY r.received_at LIMIT 400`);
  }
  return [];
}

/** 16-digit bill number (`YYMMDD` + 10-digit daily sequence): the scheme and sequence key of billing-engine `wideBillNumber`. */
function billNumber16(tx: Tx, at: Date): string {
  const p = (v: number) => String(v).padStart(2, "0");
  const ymd = `${p(at.getUTCFullYear() % 100)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}`;
  return `${ymd}${String(nextValue(tx, `bill16:${ymd}`)).padStart(10, "0")}`;
}

function seedContract(w: World, tx: Tx, code: string, frequency: "Monthly" | "SemiMonthly", label: string, latestApproved: boolean): void {
  const client = w.org.clientByCode.get(code);
  if (!client) return;
  const ctx = actor(w.access.admin);
  const warehouseId = w.facility.MLT1.id;
  const contract = tx.insert(schema.billingContracts).values({
    name: `${client.name} · ${label}`, clientId: client.id, warehouseId, calcStartDate: "2026-01-01", frequency, approvalStatus: "Approved",
    lastCalculatedAt: isoOf(utcAt(4, 14)), nextPeriodStart: "2026-11-01", createdBy: ctx.userId, createdAt: isoOf(utcAt(320, 15)),
  }).returning({ id: schema.billingContracts.id }).get();
  const fees = FEES.map((f) => {
    const id = tx.insert(schema.billingFees).values({
      contractId: contract.id, name: f.name, operationType: f.operationType, calculationType: f.calculationType ?? null, feeBy: f.feeBy, chargeBy: f.chargeBy,
      standardRate: f.rate, useMinPrice: f.minPrice !== undefined, minPrice: f.minPrice ?? null,
    }).returning({ id: schema.billingFees.id }).get().id;
    for (const [fromQty, toQty, rate] of f.tiers ?? []) tx.insert(schema.billingFeeTiers).values({ feeId: id, fromQty, toQty, rate }).run();
    return { id, def: f };
  });
  PERIODS.forEach((p, i) => {
    // Earlier periods are approved and exported; the latest is approved or left as a draft.
    const approved = i < PERIODS.length - 1 || latestApproved;
    const integrationStatus = approved ? "Sent" as const : "Not Sent" as const;
    const totals = activity(tx, client.id, warehouseId, p);
    const lines = fees.map(({ id, def }) => {
      const qty = totals[def.operationType];
      const raw = round2(tieredPrice(qty, def));
      const adjusted = def.minPrice !== undefined ? Math.max(raw, def.minPrice) : raw;
      return { feeId: id, feeName: def.name, operationType: def.operationType, feeBy: def.feeBy, chargeBy: def.chargeBy, unitPrice: def.rate, quantity: qty,
        totalPrice: raw, minMaxAdjustment: round2(adjusted - raw), adjustedPrice: round2(adjusted), isDetail: false, integrationStatus };
    });
    const calculatedAt = utcAt(p.calcDaysAgo, 14, 20);
    const report = tx.insert(schema.billingReports).values({
      contractId: contract.id, billNumber: billNumber16(tx, new Date(calculatedAt)), calcStatus: "Successful", clientId: client.id, warehouseId,
      calculatedAt: isoOf(calculatedAt), periodStart: p.billStart, periodEnd: p.billEnd, billStatus: approved ? "Approved" : "Draft",
      totalPrice: round2(lines.reduce((s, l) => s + l.adjustedPrice, 0)), exportedToIntegration: approved, createdBy: null, // the period-end scheduler
    }).returning({ id: schema.billingReports.id }).get();
    tx.insert(schema.billingReportLines).values(lines.map((l) => ({ ...l, reportId: report.id, activityDate: p.billEnd.slice(0, 10) }))).run();
    const detail = fees.flatMap(({ id, def }) => details(tx, client.id, warehouseId, p, def.operationType).map((d) => {
      const rate = def.tiers?.[0]?.[2] ?? def.rate;
      const qty = Number(d.qty);
      return { reportId: report.id, feeId: id, feeName: def.name, operationType: def.operationType, feeBy: def.feeBy, chargeBy: def.chargeBy, sku: d.sku,
        unitPrice: rate, quantity: qty, totalPrice: round2(qty * rate), adjustedPrice: round2(qty * rate), activityDate: d.at, referenceNumber: d.ref,
        lpNumber: d.lp, note: d.note, isDetail: true, integrationStatus };
    }));
    for (let k = 0; k < detail.length; k += 200) tx.insert(schema.billingReportLines).values(detail.slice(k, k + 200)).run();
  });
}

const VAS_PLAN: readonly (readonly [string, string, number, string])[] = [
  ["APX", "Special Project", 180, "Re-bagged 300 tees after supplier label recall"], ["APX", "Customer Pickup", 25, "Will-call pickup for pop-up event"],
  ["NVF", "Programming (hours)", 3, "Firmware flash on 60 hubs"], ["NVF", "Return Additional Item", 4, "Extra items found in return boxes"],
  ["CPL", "Grade B Pallet", 2, "Pallet swap for inbound from roaster"], ["CPL", "Cycle Count (hours)", 1.5, "Client-requested full count of espresso SKUs"],
  ["VLT", "Special Project", 240, "Kit assembly line set-up for desk bundle"], ["VLT", "Programming (hours)", 2, "Keyboard firmware update"],
  ["BLB", "Return Additional Item", 6, "Unlisted items in returns"], ["SMT", "Customer Pickup", 25, "Sponsored athlete pickup"],
  ["HRB", "Grade B Pallet", 1, "Damaged pallet replaced"], ["SMT", "Cycle Count (hours)", 2, "Jacket size-run audit"],
];

function seedVas(w: World, tx: Tx): number {
  VAS_PLAN.forEach(([code, type, value, note], i) => {
    const client = w.org.clientByCode.get(code);
    if (!client) return;
    const isTotal = type === "Special Project" || type === "Customer Pickup";
    tx.insert(schema.vasOperations).values({
      clientId: client.id, warehouseId: w.facility.MLT1.id, vasTypeId: lookupId(w.lookups, "vas_type", type), operationAt: isoOf(utcAt(28 - i * 2, 18)),
      calculationType: isTotal ? "Total Price" : "Vas Quantity", value, note, referenceOrderType: i % 3 === 0 ? "Purchase Order" : null,
      createdBy: w.access.manager.id,
    }).run();
  });
  return VAS_PLAN.length;
}

export function seedBilling(w: World, tx: Tx): void {
  seedContract(w, tx, "APX", "Monthly", "Apparel 3PL 2026", false);
  seedContract(w, tx, "NVF", "SemiMonthly", "Electronics 3PL 2026", false);
  seedContract(w, tx, "CPL", "Monthly", "Ambient DTC 2026", false);
  seedContract(w, tx, "BLB", "Monthly", "Retail + DTC 2026", false);
  seedContract(w, tx, "HRB", "Monthly", "Wholesale 2026", true);
  seedVas(w, tx);
}
