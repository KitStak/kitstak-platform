/**
 * Purchase Order document and PO Billing Charges printouts (docs/requests/inbound-receiving.md REQ-4),
 * lifted from M05's `purchase-orders-print.ts` onto the shared record-based print pipeline.
 * The caller (M05) builds the records from its repository; the templates only lay them out.
 */
import { z } from "zod";
import { PdfWriter, PAGE_LETTER } from "../pdf";
import type { PrintOutput, PrintTemplate, RenderContext } from "../types";

const str = (max = 300) => z.string().trim().max(max);
const optStr = (max = 300) => str(max).nullish();
const money = (n: number): string => `$${n.toFixed(2)}`;
const day = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC" }) : "-");

export const purchaseOrderRecordSchema = z.object({
  code: str(50),
  status: str(50),
  poType: optStr(50),
  poDate: optStr(40),
  referenceNumber: optStr(100),
  clientName: str(200),
  warehouseName: str(200),
  plannedReceivingDate: optStr(40),
  plannedArrivalDate: optStr(40),
  vendorName: optStr(200),
  vendorCompany: optStr(200),
  shippingAddress: optStr(500),
  billingAddress: optStr(500),
  note: optStr(2000),
  totalQuantity: z.number(),
  purchasePrice: z.number(),
  lines: z.array(z.object({
    sku: str(100), productName: str(300), packType: str(50), orderedQuantity: z.number(), receivedQuantity: z.number(), totalPrice: z.number(),
  })).max(1000),
});
export type PurchaseOrderRecord = z.output<typeof purchaseOrderRecordSchema>;

async function pdf(writer: PdfWriter, footer: string, ctx: RenderContext): Promise<PrintOutput> {
  const bytes = await writer.finish(ctx.options.companyName ? `${ctx.options.companyName} · ${footer}` : footer);
  return { bytes, mime: "application/pdf", format: "pdf", extension: "pdf" };
}

export const purchaseOrderTemplate: PrintTemplate<PurchaseOrderRecord> = {
  recordSchema: purchaseOrderRecordSchema,
  async render(records, ctx) {
    const writer = await PdfWriter.create(PAGE_LETTER, 40, records.length === 1 ? `Purchase Order ${records[0]?.code}` : "Purchase Orders");
    records.forEach((po, index) => {
      if (index > 0) writer.newPage();
      writer.text("Purchase Order", { size: 9, muted: true });
      writer.text(po.code, { size: 20, bold: true });
      writer.moveDown(4);
      writer.keyValues([
        ["Status", po.status], ["PO type", po.poType ?? "-"], ["PO date", day(po.poDate)], ["Reference", po.referenceNumber ?? "-"],
        ["Client", po.clientName], ["Warehouse", po.warehouseName], ["Planned receiving", day(po.plannedReceivingDate)], ["Planned arrival", day(po.plannedArrivalDate)],
      ]);
      writer.rule();
      writer.text("Vendor", { bold: true, size: 11 });
      writer.keyValues([
        ["Name", po.vendorName ?? "-"], ["Company", po.vendorCompany ?? "-"],
        ["Shipping address", po.shippingAddress ?? "-"], ["Billing address", po.billingAddress ?? "-"],
      ], 1);
      writer.rule();
      writer.table([
        { label: "SKU", width: 0.2, value: (l) => l.sku },
        { label: "Description", width: 0.32, value: (l) => l.productName },
        { label: "Pack type", width: 0.12, value: (l) => l.packType },
        { label: "Qty", width: 0.1, align: "right", value: (l) => String(l.orderedQuantity) },
        { label: "Received", width: 0.1, align: "right", value: (l) => String(l.receivedQuantity) },
        { label: "Total", width: 0.16, align: "right", value: (l) => money(l.totalPrice) },
      ], po.lines);
      writer.moveDown(6);
      writer.text(`Total quantity: ${po.totalQuantity}`, { align: "right", bold: true });
      writer.text(`Total: ${money(po.purchasePrice)}`, { align: "right", bold: true, size: 12 });
      if (po.note) {
        writer.moveDown(6);
        writer.text("Note", { bold: true });
        writer.text(po.note, { muted: true });
      }
    });
    return pdf(writer, "Purchase order", ctx);
  },
};

export const poBillingChargesRecordSchema = z.object({
  code: str(50),
  status: str(50),
  contract: optStr(200),
  charges: z.array(z.object({
    fee: str(200), operation: str(50), chargeBy: str(100), quantity: z.number(), rate: z.number(), amount: z.number(),
  })).max(1000),
});
export type PoBillingChargesRecord = z.output<typeof poBillingChargesRecordSchema>;

export const poBillingChargesTemplate: PrintTemplate<PoBillingChargesRecord> = {
  recordSchema: poBillingChargesRecordSchema,
  async render(records, ctx) {
    const writer = await PdfWriter.create(PAGE_LETTER, 40, "PO Billing Charges");
    records.forEach((po, index) => {
      if (index > 0) writer.newPage();
      writer.text("PO billing charges", { size: 9, muted: true });
      writer.text(po.code, { size: 20, bold: true });
      writer.moveDown(4);
      writer.keyValues([["Status", po.status], ["Contract", po.contract ?? "No approved contract"]]);
      writer.rule();
      if (po.charges.length === 0) {
        writer.text("No billable receiving charges.", { muted: true });
        return;
      }
      writer.table([
        { label: "Fee", width: 0.3, value: (c) => c.fee },
        { label: "Operation", width: 0.14, value: (c) => c.operation },
        { label: "Charge by", width: 0.18, value: (c) => c.chargeBy },
        { label: "Qty", width: 0.1, align: "right", value: (c) => String(c.quantity) },
        { label: "Rate", width: 0.12, align: "right", value: (c) => money(c.rate) },
        { label: "Amount", width: 0.16, align: "right", value: (c) => money(c.amount) },
      ], po.charges);
      writer.moveDown(6);
      writer.text(`Total: ${money(po.charges.reduce((s, c) => s + c.amount, 0))}`, { align: "right", bold: true, size: 12 });
    });
    return pdf(writer, "PO billing charges", ctx);
  },
};
