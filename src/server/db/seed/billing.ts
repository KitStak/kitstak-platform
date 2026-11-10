/**
 * 3PL billing: two contracts with four fees (one tiered), two calculated October bills
 * whose lines are computed from the replayed activity, and twelve VAS operations.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { sequences } from "@/server/domain";
import type { Tx } from "@/server/domain/types";
import { lookupId } from "./lookups";
import { isoOf, utcAt } from "./runtime";
import { actor, round2, type Id } from "./types";
import type { World } from "./world";

const PERIOD_START = "2026-10-01T04:00:00.000Z";
const PERIOD_END = "2026-11-01T03:59:59.999Z";

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
  { name: "Order Fulfillment Fee", operationType: "Shipment", feeBy: "Order", chargeBy: "Per Order", rate: 2.85, minPrice: 250 },
  { name: "Pick & Pack (per unit)", operationType: "Pick & Pack", feeBy: "Unit", chargeBy: "Per Unit", rate: 0.35, tiers: [[1, 1000, 0.35], [1001, 5000, 0.3], [5001, null, 0.25]] },
  { name: "Storage - Bin Location", operationType: "Storage", feeBy: "Location", chargeBy: "Per Day", rate: 0.65, calculationType: "Daily Accumulation" },
  { name: "Receiving (per unit)", operationType: "Receiving", feeBy: "Unit", chargeBy: "Per Unit", rate: 0.18 },
];

function activity(tx: Tx, clientId: Id, warehouseId: Id): Record<FeeDef["operationType"], number> {
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

function seedContract(w: World, tx: Tx, code: string, frequency: "Monthly" | "SemiMonthly", approved: boolean): void {
  const client = w.org.clientByCode.get(code);
  if (!client) return;
  const ctx = actor(w.access.admin);
  const warehouseId = w.facility.MLT1.id;
  const contract = tx.insert(schema.billingContracts).values({
    name: `${client.name} - 3PL Services 2026`, clientId: client.id, warehouseId, calcStartDate: "2026-01-01", frequency, approvalStatus: "Approved",
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
  const totals = activity(tx, client.id, warehouseId);
  const lines = fees.map(({ id, def }) => {
    const qty = totals[def.operationType];
    const raw = round2(tieredPrice(qty, def));
    const adjusted = def.minPrice !== undefined ? Math.max(raw, def.minPrice) : raw;
    return { feeId: id, feeName: def.name, operationType: def.operationType, feeBy: def.feeBy, chargeBy: def.chargeBy, unitPrice: def.rate, quantity: qty,
      totalPrice: raw, minMaxAdjustment: round2(adjusted - raw), adjustedPrice: round2(adjusted), isDetail: false, integrationStatus: approved ? "Sent" as const : "Not Sent" as const };
  });
  const calculatedAt = utcAt(4, 14, 20);
  const report = tx.insert(schema.billingReports).values({
    contractId: contract.id, billNumber: sequences.billNumber(tx, new Date(calculatedAt)), calcStatus: "Successful", clientId: client.id, warehouseId,
    calculatedAt: isoOf(calculatedAt), periodStart: PERIOD_START, periodEnd: PERIOD_END, billStatus: approved ? "Approved" : "Draft",
    totalPrice: round2(lines.reduce((s, l) => s + l.adjustedPrice, 0)), exportedToIntegration: approved, createdBy: ctx.userId,
  }).returning({ id: schema.billingReports.id }).get();
  tx.insert(schema.billingReportLines).values(lines.map((l) => ({ ...l, reportId: report.id, activityDate: PERIOD_END.slice(0, 10) }))).run();
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
  seedContract(w, tx, "APX", "Monthly", true);
  seedContract(w, tx, "NVF", "SemiMonthly", false);
  seedVas(w, tx);
}
