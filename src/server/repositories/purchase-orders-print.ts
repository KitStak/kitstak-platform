/**
 * PO printouts (M05): the Purchase Order document (PDF), product-label records for the
 * shared print pipeline and the PO billing-charges workbook. The foundation catalog has
 * no renderer for "purchase-order-list" / "po-billing-charges" yet (REQ-4), so M05
 * renders them here with the shared PdfWriter / xlsx builder.
 */
import { and, eq, inArray } from "drizzle-orm";
import { displayPoStatus } from "@/lib/grid-defs/receiving/purchase-orders";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { buildXlsx } from "@/server/exports/xlsx";
import { PdfWriter, PAGE_LETTER } from "@/server/print/pdf";
import { getPurchaseOrder, purchaseOrdersByIds, type PurchaseOrderDetail } from "./purchase-orders";
import { receiptsForPurchaseOrder } from "./receipts";
import type { VendorAddress } from "./vendors";

const money = (n: number): string => `$${n.toFixed(2)}`;
const day = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC" }) : "-");
const addressLine = (a: VendorAddress | null): string =>
  a ? [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ") || "-" : "-";

export async function renderPurchaseOrderDocuments(db: AppDb, scope: Scope, ids: readonly string[]): Promise<Uint8Array> {
  const rows = purchaseOrdersByIds(db, scope, ids);
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Purchase order not found");
  const writer = await PdfWriter.create(PAGE_LETTER, 40, rows.length === 1 ? `Purchase Order ${rows[0]?.code}` : "Purchase Orders");
  rows.forEach((row, index) => {
    const detail = getPurchaseOrder(db, scope, row.id);
    if (index > 0) writer.newPage();
    writer.text("Purchase Order", { size: 9, muted: true });
    writer.text(detail.code, { size: 20, bold: true });
    writer.moveDown(4);
    writer.keyValues([
      ["Status", detail.status], ["PO type", detail.poType], ["PO date", day(detail.poDate)], ["Reference", detail.referenceNumber ?? "-"],
      ["Client", detail.clientName], ["Warehouse", detail.warehouseName], ["Planned receiving", day(detail.plannedReceivingDate)], ["Planned arrival", day(detail.plannedArrivalDate)],
    ]);
    writer.rule();
    writer.text("Vendor", { bold: true, size: 11 });
    writer.keyValues([
      ["Name", detail.vendor?.displayName ?? detail.vendorName], ["Company", detail.vendor?.vendorName ?? "-"],
      ["Shipping address", addressLine(detail.vendor?.shipping ?? null)], ["Billing address", addressLine(detail.vendor?.billing ?? null)],
    ], 1);
    writer.rule();
    writer.table([
      { label: "SKU", width: 0.2, value: (l) => l.sku },
      { label: "Description", width: 0.32, value: (l) => l.productName },
      { label: "Pack type", width: 0.12, value: (l) => l.packType },
      { label: "Qty", width: 0.1, align: "right", value: (l) => String(l.orderedQuantity) },
      { label: "Received", width: 0.1, align: "right", value: (l) => String(l.receivedQuantity) },
      { label: "Total", width: 0.16, align: "right", value: (l) => money(l.totalPrice) },
    ], detail.lines);
    writer.moveDown(6);
    writer.text(`Total quantity: ${detail.totalQuantity}`, { align: "right", bold: true });
    writer.text(`Total: ${money(detail.purchasePrice)}`, { align: "right", bold: true, size: 12 });
    if (detail.note) {
      writer.moveDown(6);
      writer.text("Note", { bold: true });
      writer.text(detail.note, { muted: true });
    }
  });
  return writer.finish("KitStaks WMS · Purchase order");
}

export interface ProductLabelRecord {
  readonly sku: string;
  readonly barcode: string;
  readonly name: string;
  readonly clientCode?: string;
  readonly packType?: string;
  readonly lotNumber?: string;
}

/**
 * Product labels for the PO lines. "Use as line quantity" (default, Logiwa parity): one label
 * per ordered unit (capped per line); `perLine`: one label per line.
 */
export function productLabelRecords(db: AppDb, scope: Scope, ids: readonly string[], options: { lineIds?: readonly string[]; maxPerLine?: number; perLine?: boolean } = {}): ProductLabelRecord[] {
  const rows = purchaseOrdersByIds(db, scope, ids);
  const cap = options.maxPerLine ?? 500;
  const out: ProductLabelRecord[] = [];
  for (const row of rows) {
    const detail = getPurchaseOrder(db, scope, row.id);
    for (const l of detail.lines) {
      if (options.lineIds && !options.lineIds.includes(l.id)) continue;
      const record: ProductLabelRecord = {
        sku: l.sku, barcode: l.barcode || l.sku, name: l.productName, clientCode: detail.clientCode || undefined,
        packType: l.packType, ...(l.lotNumber ? { lotNumber: l.lotNumber } : {}),
      };
      const copies = options.perLine ? 1 : Math.min(l.orderedQuantity, cap);
      for (let i = 0; i < copies; i++) out.push(record);
    }
  }
  return out;
}

export interface ProductLabelLine {
  readonly poCode: string;
  readonly record: ProductLabelRecord;
  readonly ordered: number;
  readonly received: number;
}

/** One entry per PO line with its ordered / received quantity (the Print Options modal expands them). */
export function productLabelLines(db: AppDb, scope: Scope, ids: readonly string[]): ProductLabelLine[] {
  const out: ProductLabelLine[] = [];
  for (const row of purchaseOrdersByIds(db, scope, ids)) {
    const detail = getPurchaseOrder(db, scope, row.id);
    for (const l of detail.lines) {
      out.push({
        poCode: detail.code, ordered: l.orderedQuantity, received: l.receivedQuantity,
        record: { sku: l.sku, barcode: l.barcode || l.sku, name: l.productName, clientCode: detail.clientCode || undefined, packType: l.packType, ...(l.lotNumber ? { lotNumber: l.lotNumber } : {}) },
      });
    }
  }
  return out;
}

export interface BillingChargeRow {
  readonly fee: string;
  readonly operation: string;
  readonly chargeBy: string;
  readonly quantity: number;
  readonly rate: number;
  readonly amount: number;
}

/** Receiving + PO-referenced VAS charges from the client's approved contract for the warehouse. */
export function billingCharges(db: AppDb, scope: Scope, id: string): { po: PurchaseOrderDetail; charges: BillingChargeRow[]; contract: string | null } {
  const po = getPurchaseOrder(db, scope, id);
  const contract = db.select().from(schema.billingContracts)
    .where(and(eq(schema.billingContracts.clientId, po.clientId), eq(schema.billingContracts.warehouseId, po.warehouseId), eq(schema.billingContracts.approvalStatus, "Approved"))).get();
  if (!contract) return { po, charges: [], contract: null };
  const fees = db.select().from(schema.billingFees).where(and(eq(schema.billingFees.contractId, contract.id), inArray(schema.billingFees.operationType, ["Receiving", "VAS"]))).all();
  const receipts = receiptsForPurchaseOrder(db, scope, id).filter((r) => !r.cancelledAt);
  const units = receipts.reduce((s, r) => s + r.uomQuantity, 0);
  const skus = new Set(receipts.map((r) => r.productId)).size;
  const vas = db.select().from(schema.vasOperations)
    .where(and(eq(schema.vasOperations.referenceOrderType, "Purchase Order"), eq(schema.vasOperations.referenceNumber, po.code), eq(schema.vasOperations.clientId, po.clientId))).all();
  const charges = fees.flatMap((f): BillingChargeRow[] => {
    const rate = f.standardRate ?? 0;
    if (f.operationType === "VAS") {
      return vas.filter((x) => !f.vasTypeId || x.vasTypeId === f.vasTypeId)
        .map((x) => ({ fee: f.name, operation: "VAS", chargeBy: f.chargeBy, quantity: x.value, rate, amount: Math.round((x.calculationType === "Total Price" ? x.value : x.value * rate) * 100) / 100 }));
    }
    const by = f.chargeBy.toLowerCase();
    const qty = by.includes("sku") ? skus : by.includes("order") || by.includes("po") ? (receipts.length > 0 ? 1 : 0) : by.includes("line") ? receipts.length : units;
    let amount = Math.round(qty * rate * 100) / 100;
    if (f.useMinPrice && f.minPrice !== null && qty > 0) amount = Math.max(amount, f.minPrice);
    if (f.useMaxPrice && f.maxPrice !== null) amount = Math.min(amount, f.maxPrice);
    return [{ fee: f.name, operation: f.operationType, chargeBy: f.chargeBy, quantity: qty, rate, amount }];
  });
  return { po, charges, contract: contract.name };
}

export async function billingChargesWorkbook(db: AppDb, scope: Scope, id: string): Promise<{ bytes: Buffer; fileName: string }> {
  const { po, charges, contract } = billingCharges(db, scope, id);
  const rows = charges.length > 0
    ? charges.map((c) => ({ po: po.code, status: displayPoStatus(po.status), contract: contract ?? "", ...c }))
    : [{ po: po.code, status: po.status, contract: contract ?? "No approved contract", fee: "No billable receiving charges", operation: "", chargeBy: "", quantity: 0, rate: 0, amount: 0 }];
  const bytes = await buildXlsx({
    name: `PO ${po.code} billing`,
    columns: [
      { key: "po", label: "PO number" }, { key: "status", label: "Status" }, { key: "contract", label: "Contract" }, { key: "fee", label: "Fee" },
      { key: "operation", label: "Operation" }, { key: "chargeBy", label: "Charge by" }, { key: "quantity", label: "Quantity", type: "integer" },
      { key: "rate", label: "Rate", type: "money" }, { key: "amount", label: "Amount", type: "money" },
    ],
    rows,
  });
  return { bytes, fileName: `${po.code}-billing-charges.xlsx` };
}
