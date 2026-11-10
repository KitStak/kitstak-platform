/** Manifest / Bill of Lading (shipment plan or carrier pickup), with totals and signatures. */
import { z } from "zod";
import { renderBarcodePng } from "../barcode";
import { PdfWriter, type TableColumn } from "../pdf";
import { addressLines, addressSchema, formatPrintDay, pdfOutput, type PrintTemplate } from "../types";

const shipmentSchema = z.object({
  orderCode: z.string().trim().min(1).max(60),
  customerName: z.string().trim().max(200).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  lpNumber: z.string().trim().max(120).optional(),
  packages: z.number().int().nonnegative().default(1),
  weightLb: z.number().nonnegative().default(0),
  freightClass: z.string().max(20).optional(),
});

export const manifestRecordSchema = z.object({
  bolNumber: z.string().trim().min(1).max(60),
  shipDate: z.string().max(40).optional(),
  carrier: z.string().trim().min(1).max(120),
  scac: z.string().trim().max(10).optional(),
  proNumber: z.string().trim().max(60).optional(),
  trailerNumber: z.string().trim().max(60).optional(),
  sealNumber: z.string().trim().max(60).optional(),
  shipFrom: addressSchema,
  shipTo: addressSchema.optional(),
  freightTerms: z.enum(["Prepaid", "Collect", "Third Party"]).default("Prepaid"),
  specialInstructions: z.string().max(2000).optional(),
  shipments: z.array(shipmentSchema).min(1).max(5000),
});

export type ManifestRecord = z.output<typeof manifestRecordSchema>;
type Shipment = ManifestRecord["shipments"][number];

const COLUMNS: readonly TableColumn<Shipment>[] = [
  { label: "Order", width: 0.16, value: (s) => s.orderCode },
  { label: "Customer", width: 0.22, value: (s) => s.customerName ?? "" },
  { label: "Tracking # / LP", width: 0.28, value: (s) => [s.trackingNumber, s.lpNumber].filter(Boolean).join(" / ") },
  { label: "Class", width: 0.08, value: (s) => s.freightClass ?? "" },
  { label: "Pkgs", width: 0.12, align: "right", value: (s) => String(s.packages) },
  { label: "Weight (lb)", width: 0.14, align: "right", value: (s) => s.weightLb.toFixed(2) },
];

export function manifestTotals(record: ManifestRecord): { readonly packages: number; readonly weightLb: number; readonly shipments: number } {
  return {
    shipments: record.shipments.length,
    packages: record.shipments.reduce((sum, s) => sum + s.packages, 0),
    weightLb: Math.round(record.shipments.reduce((sum, s) => sum + s.weightLb, 0) * 100) / 100,
  };
}

async function renderManifest(writer: PdfWriter, record: ManifestRecord, title: string): Promise<void> {
  const top = writer.y;
  writer.text(title.toUpperCase(), { size: 18, bold: true });
  writer.text(`BOL # ${record.bolNumber}`, { size: 11, bold: true });
  const img = await writer.doc.embedPng(await renderBarcodePng({ text: record.bolNumber, heightMm: 10, scale: 2 }));
  const width = 170;
  const height = (img.height / img.width) * width;
  writer.currentPage.drawImage(img, { x: writer.size[0] - writer.margin - width, y: top - height, width, height });
  writer.moveDown(Math.max(0, height - (top - writer.y)) + 6);
  writer.keyValues([
    ["Ship Date", formatPrintDay(record.shipDate) || "-"],
    ["Carrier", record.scac ? `${record.carrier} (${record.scac})` : record.carrier],
    ["PRO #", record.proNumber ?? "-"],
    ["Trailer #", record.trailerNumber ?? "-"],
    ["Seal #", record.sealNumber ?? "-"],
    ["Freight Terms", record.freightTerms],
  ]);
  writer.rule();
  writer.text("SHIP FROM", { size: 8, bold: true, muted: true });
  for (const line of addressLines(record.shipFrom)) writer.text(line, { size: 10 });
  if (record.shipTo) {
    writer.moveDown(4);
    writer.text("SHIP TO", { size: 8, bold: true, muted: true });
    for (const line of addressLines(record.shipTo)) writer.text(line, { size: 10 });
  }
  writer.moveDown(8);
  writer.table(COLUMNS, record.shipments);
  const totals = manifestTotals(record);
  writer.moveDown(6);
  writer.text(`Totals: ${totals.shipments} shipments | ${totals.packages} packages | ${totals.weightLb.toFixed(2)} lb`, { size: 10, bold: true, align: "right" });
  if (record.specialInstructions) {
    writer.moveDown(8);
    writer.text("Special instructions", { size: 8, bold: true, muted: true });
    writer.text(record.specialInstructions, { size: 10 });
  }
  writer.ensureSpace(90);
  writer.moveDown(24);
  writer.text("Shipper signature: ____________________________   Date: ____________", { size: 9 });
  writer.moveDown(14);
  writer.text("Carrier signature: ____________________________   Date: ____________   Pieces received: ______", { size: 9 });
  writer.moveDown(6);
  writer.text("Received subject to the classifications and tariffs in effect on the date of issue of this Bill of Lading.", { size: 7.5, muted: true });
}

export const manifestBolTemplate: PrintTemplate<ManifestRecord> = {
  recordSchema: manifestRecordSchema,
  async render(records, ctx) {
    const writer = await PdfWriter.create(undefined, 40, `${ctx.typeName} ${records[0]?.bolNumber ?? ""}`);
    for (const [index, record] of records.entries()) {
      for (let copy = 0; copy < ctx.options.copies; copy += 1) {
        if (index > 0 || copy > 0) writer.newPage();
        await renderManifest(writer, record, ctx.typeName);
      }
    }
    return pdfOutput(await writer.finish(ctx.options.companyName ?? "KitStaks WMS"));
  },
};
