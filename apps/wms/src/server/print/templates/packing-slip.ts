/** Packing List / Packing Slip (letter, one order per page group, order barcode). */
import { z } from "zod";
import { renderBarcodePng } from "../barcode";
import { pdfSafe, PdfWriter, type TableColumn } from "../pdf";
import { addressLines, addressSchema, formatPrintDay, pdfOutput, type PrintTemplate } from "../types";

const lineSchema = z.object({
  sku: z.string().trim().min(1).max(120),
  name: z.string().trim().max(300).default(""),
  quantity: z.number().int().nonnegative(),
  uom: z.string().trim().max(40).optional(),
  lotNumber: z.string().trim().max(120).optional(),
  serialNumbers: z.array(z.string().max(120)).max(1000).optional(),
});

export const packingSlipRecordSchema = z.object({
  orderCode: z.string().trim().min(1).max(60),
  storeOrderNumber: z.string().trim().max(120).optional(),
  orderDate: z.string().max(40).optional(),
  clientName: z.string().trim().max(200).optional(),
  shipFrom: addressSchema.optional(),
  shipTo: addressSchema,
  carrier: z.string().max(120).optional(),
  shippingService: z.string().max(120).optional(),
  trackingNumber: z.string().max(120).optional(),
  giftMessage: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(lineSchema).min(1).max(2000),
});

export type PackingSlipRecord = z.output<typeof packingSlipRecordSchema>;
type Line = PackingSlipRecord["lines"][number];

const COLUMNS: readonly TableColumn<Line>[] = [
  { label: "SKU", width: 0.22, value: (l) => l.sku },
  { label: "Description", width: 0.43, value: (l) => [l.name, l.serialNumbers?.length ? `S/N: ${l.serialNumbers.join(", ")}` : ""].filter(Boolean).join(" - ") },
  { label: "Lot", width: 0.15, value: (l) => l.lotNumber ?? "" },
  { label: "UOM", width: 0.08, value: (l) => l.uom ?? "Each" },
  { label: "Qty", width: 0.12, align: "right", value: (l) => String(l.quantity) },
];

async function renderOrder(writer: PdfWriter, record: PackingSlipRecord, title: string): Promise<void> {
  const top = writer.y;
  writer.text(title, { size: 18, bold: true });
  writer.text(record.clientName ?? "", { size: 10, muted: true });
  const png = await renderBarcodePng({ text: record.orderCode, heightMm: 10, scale: 2 });
  const img = await writer.doc.embedPng(png);
  const width = 170;
  const height = (img.height / img.width) * width;
  writer.currentPage.drawImage(img, { x: writer.size[0] - writer.margin - width, y: top - height, width, height });
  writer.moveDown(Math.max(0, height - (top - writer.y)) + 6);
  writer.keyValues([
    ["Order", record.orderCode],
    ["Store Order #", record.storeOrderNumber ?? "-"],
    ["Order Date", formatPrintDay(record.orderDate) || "-"],
    ["Carrier", [record.carrier, record.shippingService].filter(Boolean).join(" / ") || "-"],
    ["Tracking #", record.trackingNumber ?? "-"],
    ["Total Units", String(record.lines.reduce((sum, l) => sum + l.quantity, 0))],
  ]);
  writer.rule();
  const startY = writer.y;
  writer.text("SHIP TO", { size: 8, bold: true, muted: true });
  for (const line of addressLines(record.shipTo)) writer.text(line, { size: 10 });
  const leftEnd = writer.y;
  if (record.shipFrom) {
    const half = writer.margin + writer.contentWidth / 2;
    let y = startY;
    const draw = (text: string, bold: boolean, size: number): void => {
      writer.currentPage.drawText(text, { x: half, y: y - size, size, font: bold ? writer.bold : writer.regular });
      y -= size + 3;
    };
    draw("SHIP FROM", true, 8);
    for (const line of addressLines(record.shipFrom)) draw(pdfSafe(line), false, 10);
    writer.moveDown(Math.max(0, writer.y - Math.min(leftEnd, y)));
  }
  writer.moveDown(8);
  writer.table(COLUMNS, record.lines);
  if (record.giftMessage) {
    writer.moveDown(10);
    writer.text("Gift message", { size: 8, bold: true, muted: true });
    writer.text(record.giftMessage, { size: 10 });
  }
  if (record.notes) {
    writer.moveDown(10);
    writer.text("Notes", { size: 8, bold: true, muted: true });
    writer.text(record.notes, { size: 10 });
  }
  writer.moveDown(14);
  writer.text("Thank you for your order.", { size: 9, muted: true, align: "center" });
}

export const packingSlipTemplate: PrintTemplate<PackingSlipRecord> = {
  recordSchema: packingSlipRecordSchema,
  async render(records, ctx) {
    const writer = await PdfWriter.create(undefined, 40, `${ctx.typeName} ${records[0]?.orderCode ?? ""}`);
    for (const [index, record] of records.entries()) {
      for (let copy = 0; copy < ctx.options.copies; copy += 1) {
        if (index > 0 || copy > 0) writer.newPage();
        await renderOrder(writer, record, ctx.typeName);
      }
    }
    return pdfOutput(await writer.finish(ctx.options.companyName ?? "KitStaks WMS"));
  },
};
