/**
 * End of the Day report PDFs (M02): the carrier manifest (one section per manifest, every
 * package with a Code 128 tracking barcode) and the custom report (totals by client and
 * service). Rendered with the foundation PdfWriter.
 */
import { PDFDocument } from "pdf-lib";
import { renderBarcodePng } from "@/server/print/barcode";
import { PdfWriter, pdfSafe } from "@/server/print/pdf";
import { formatPrintDate, formatPrintDay } from "@/server/print/types";

export interface ReportPackage {
  readonly orderCode: string;
  readonly clientName: string;
  readonly customerName: string;
  readonly serviceName: string;
  readonly trackingNumber: string;
  readonly weightOz: number;
  readonly labelCreatedAt: string;
}

export interface ReportManifest {
  readonly title: string;
  readonly carrierCode: string;
  readonly carrierPrefix: string;
  readonly shipFrom: string;
  readonly shipDate: string;
  readonly closeDate: string | null;
  readonly packages: readonly ReportPackage[];
}

const BARCODE_W = 150;
const ROW_H = 40;

function header(writer: PdfWriter, m: ReportManifest, subtitle: string): void {
  writer.text(subtitle.toUpperCase(), { size: 16, bold: true });
  writer.text(`${m.carrierCode} - ${m.carrierPrefix}`, { size: 11, bold: true });
  writer.moveDown(4);
  writer.keyValues([
    ["Ship from", m.shipFrom],
    ["Ship date", formatPrintDay(`${m.shipDate}T12:00:00Z`)],
    ["Close date", m.closeDate ? formatPrintDate(m.closeDate) : "Open"],
    ["Total packages", m.packages.length],
    ["Total weight", `${(m.packages.reduce((s, p) => s + p.weightOz, 0) / 16).toFixed(2)} lb`],
    ["Orders", new Set(m.packages.map((p) => p.orderCode)).size],
  ]);
  writer.rule();
}

async function manifestSection(writer: PdfWriter, m: ReportManifest): Promise<void> {
  header(writer, m, m.title);
  let index = 0;
  for (const p of m.packages) {
    index += 1;
    writer.ensureSpace(ROW_H + 4);
    const top = writer.y;
    const page = writer.currentPage;
    const x = writer.margin;
    page.drawText(pdfSafe(`${index}.`), { x, y: top - 12, size: 9, font: writer.bold });
    page.drawText(pdfSafe(p.orderCode), { x: x + 22, y: top - 12, size: 9, font: writer.bold });
    page.drawText(pdfSafe(`${p.clientName} - ${p.customerName}`.slice(0, 48)), { x: x + 22, y: top - 24, size: 8, font: writer.regular });
    page.drawText(pdfSafe(p.serviceName), { x: x + 200, y: top - 12, size: 9, font: writer.regular });
    page.drawText(pdfSafe(`${(p.weightOz / 16).toFixed(2)} lb`), { x: x + 200, y: top - 24, size: 8, font: writer.regular });
    const png = await writer.doc.embedPng(await renderBarcodePng({ text: p.trackingNumber, heightMm: 8, scale: 2 }));
    const h = Math.min(30, (png.height / png.width) * BARCODE_W);
    page.drawImage(png, { x: writer.size[0] - writer.margin - BARCODE_W, y: top - h - 2, width: BARCODE_W, height: h });
    writer.moveDown(ROW_H);
  }
  writer.moveDown(10);
  writer.ensureSpace(40);
  writer.text("Driver signature: ____________________________   Pickup date/time: ____________   Pieces: ______", { size: 9 });
}

export async function renderManifestReport(manifests: readonly ReportManifest[], companyName = "KitStaks WMS"): Promise<Uint8Array> {
  const writer = await PdfWriter.create(undefined, 40, "End of the Day Report");
  for (const [i, m] of manifests.entries()) {
    if (i > 0) writer.newPage();
    await manifestSection(writer, m);
  }
  return writer.finish(companyName);
}

export async function renderCustomReport(manifests: readonly ReportManifest[], companyName = "KitStaks WMS"): Promise<Uint8Array> {
  const writer = await PdfWriter.create(undefined, 40, "Custom End of the Day Report");
  for (const [i, m] of manifests.entries()) {
    if (i > 0) writer.newPage();
    header(writer, m, "Custom end of the day report");
    const groups = new Map<string, { client: string; service: string; packages: number; orders: Set<string>; weightOz: number }>();
    for (const p of m.packages) {
      const key = `${p.clientName}|${p.serviceName}`;
      const g = groups.get(key) ?? { client: p.clientName, service: p.serviceName, packages: 0, orders: new Set<string>(), weightOz: 0 };
      groups.set(key, { ...g, packages: g.packages + 1, orders: new Set([...g.orders, p.orderCode]), weightOz: g.weightOz + p.weightOz });
    }
    const rows = [...groups.values()].sort((a, b) => a.client.localeCompare(b.client) || a.service.localeCompare(b.service));
    writer.table([
      { label: "Client", width: 0.32, value: (r: (typeof rows)[number]) => r.client },
      { label: "Service", width: 0.3, value: (r) => r.service },
      { label: "Orders", width: 0.12, align: "right", value: (r) => String(r.orders.size) },
      { label: "Packages", width: 0.12, align: "right", value: (r) => String(r.packages) },
      { label: "Weight (lb)", width: 0.14, align: "right", value: (r) => (r.weightOz / 16).toFixed(2) },
    ], rows);
  }
  return writer.finish(companyName);
}

/** Number of pages (tests). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}
