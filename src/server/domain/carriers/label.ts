/**
 * 4x6 shipping labels: real PDF (pdf-lib, Code 128 drawn as vector bars from bwip-js'
 * raw encoder) and ZPL II (native ^BC Code 128).
 */
import bwipjs from "bwip-js/node";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CarrierAddress, LabelType } from "./adapter";

export interface LabelData {
  readonly from: CarrierAddress;
  readonly to: CarrierAddress;
  readonly carrierCode: string;
  readonly serviceName: string;
  readonly trackingNumber: string;
  readonly orderCode: string;
  readonly weightOz: number;
  readonly packageSeq: number;
  readonly packageCount: number;
  readonly shipDate: string;
  readonly labelType: LabelType;
}

const W = 288; // 4in @ 72dpi
const H = 432; // 6in

/** Code 128 bar/space widths (modules), starting with a bar. */
export function code128Modules(text: string): number[] {
  const raw = bwipjs.raw("code128", text, {});
  const first = raw[0];
  if (!first || !("sbs" in first)) throw new Error("Code 128 encoding failed");
  return first.sbs;
}

function drawBarcode(page: PDFPage, text: string, x: number, y: number, width: number, height: number): void {
  const modules = code128Modules(text);
  const total = modules.reduce((s, m) => s + m, 0);
  const unit = width / total;
  let cursor = x;
  modules.forEach((m, i) => {
    if (i % 2 === 0) page.drawRectangle({ x: cursor, y, width: m * unit, height, color: rgb(0, 0, 0) });
    cursor += m * unit;
  });
}

const addressLines = (a: CarrierAddress): string[] => [
  a.name, a.company ?? "", a.line1, a.line2 ?? "", `${a.city}${a.state ? `, ${a.state}` : ""} ${a.postalCode}`, a.country,
].map((l) => l.trim()).filter((l) => l.length > 0);

function text(page: PDFPage, font: PDFFont, value: string, x: number, y: number, size: number): void {
  const safe = value.replace(/[^\x20-\x7E]/g, "?");
  page.drawText(safe, { x, y, size, font, color: rgb(0, 0, 0) });
}

export async function renderPdfLabel(data: LabelData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${data.labelType} ${data.trackingNumber}`);
  pdf.setProducer("KitStaks WMS");
  const page = pdf.addPage([W, H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 6, y: 6, width: W - 12, height: H - 12, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });

  text(page, bold, "FROM:", 14, H - 24, 7);
  addressLines(data.from).forEach((l, i) => text(page, regular, l, 14, H - 34 - i * 9, 7));
  text(page, bold, `${data.weightOz.toFixed(1)} OZ`, W - 80, H - 24, 9);
  text(page, regular, `${data.packageSeq} OF ${data.packageCount}`, W - 80, H - 36, 8);
  text(page, regular, data.shipDate, W - 80, H - 48, 7);
  page.drawLine({ start: { x: 6, y: H - 92 }, end: { x: W - 6, y: H - 92 }, thickness: 1 });

  text(page, bold, data.labelType === "Return Label" ? "RETURN TO:" : "SHIP TO:", 14, H - 108, 9);
  addressLines(data.to).forEach((l, i) => text(page, bold, l.toUpperCase(), 24, H - 124 - i * 14, 11));
  page.drawLine({ start: { x: 6, y: H - 214 }, end: { x: W - 6, y: H - 214 }, thickness: 2 });

  page.drawRectangle({ x: 6, y: H - 250, width: W - 12, height: 36, color: rgb(0, 0, 0) });
  page.drawText(`${data.carrierCode} ${data.serviceName}`.toUpperCase().slice(0, 34), { x: 14, y: H - 238, size: 13, font: bold, color: rgb(1, 1, 1) });

  text(page, bold, "TRACKING #:", 14, H - 268, 8);
  text(page, bold, data.trackingNumber, 80, H - 268, 10);
  drawBarcode(page, data.trackingNumber, 22, 84, W - 44, 70);
  page.drawLine({ start: { x: 6, y: 70 }, end: { x: W - 6, y: 70 }, thickness: 1 });
  text(page, regular, `REF: ${data.orderCode}`, 14, 52, 9);
  text(page, regular, "KitStak Sandbox - not valid for shipping", 14, 20, 7);
  return pdf.save();
}

const zplEscape = (s: string): string => s.replace(/[\^~\\]/g, " ").replace(/[^\x20-\x7E]/g, "?");

export function renderZplLabel(data: LabelData): string {
  const lines: string[] = ["^XA", "^CI28", "^PW812", "^LL1218", "^FO20,20^GB772,1178,3^FS"];
  const field = (x: number, y: number, size: number, value: string) => lines.push(`^FO${x},${y}^A0N,${size},${size}^FD${zplEscape(value)}^FS`);
  field(40, 40, 22, "FROM:");
  addressLines(data.from).forEach((l, i) => field(40, 66 + i * 24, 22, l));
  field(560, 40, 28, `${data.weightOz.toFixed(1)} OZ`);
  field(560, 76, 24, `${data.packageSeq} OF ${data.packageCount}`);
  field(560, 108, 20, data.shipDate);
  lines.push("^FO20,250^GB772,3,3^FS");
  field(40, 270, 28, data.labelType === "Return Label" ? "RETURN TO:" : "SHIP TO:");
  addressLines(data.to).forEach((l, i) => field(70, 310 + i * 40, 36, l.toUpperCase()));
  lines.push("^FO20,560^GB772,100,100^FS", `^FO40,585^A0N,50,50^FR^FD${zplEscape(`${data.carrierCode} ${data.serviceName}`.toUpperCase())}^FS`);
  field(40, 690, 26, `TRACKING #: ${data.trackingNumber}`);
  lines.push(`^FO60,740^BY3^BCN,220,N,N,N^FD${zplEscape(data.trackingNumber)}^FS`);
  field(40, 1010, 28, `REF: ${data.orderCode}`);
  field(40, 1150, 20, "KitStak Sandbox - not valid for shipping");
  lines.push("^XZ");
  return lines.join("\n");
}
