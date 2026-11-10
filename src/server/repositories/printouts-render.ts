/**
 * Printout layout renderer (M14): turns a designer layout (paper, font, logo position,
 * ordered sections, ordered / hidden columns) plus one or more sample or real records into
 * a PDF with pdf-lib. Powers the designer's live preview and, through REQ-1, template-aware
 * printing from the order rail.
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { scopedWhere } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { renderBarcodePng } from "@/server/print/barcode";
import { pdfSafe, wrapText } from "@/server/print/pdf";
import { columnsFor, DOCUMENT_COLUMNS, familyOf, type PrintoutLayout } from "@/lib/grid-defs/admin/printouts";

export interface DocLine {
  readonly location?: string;
  readonly sku: string;
  readonly description: string;
  readonly lot?: string;
  readonly uom?: string;
  readonly qty: number;
  readonly price?: number;
}

export interface DocRecord {
  readonly code: string;
  readonly reference?: string;
  readonly date?: string;
  readonly clientName?: string;
  readonly carrier?: string;
  readonly shipTo?: readonly string[];
  readonly shipFrom?: readonly string[];
  readonly lines: readonly DocLine[];
  readonly notes?: string;
  /** Label details (location / LP / product labels). */
  readonly details?: readonly string[];
}

export interface RenderOptions {
  readonly companyName: string;
  readonly logo?: { readonly bytes: Uint8Array; readonly mime: string } | null;
  readonly now?: Date;
}

const PAPER: Readonly<Record<PrintoutLayout["paper"], readonly [number, number]>> = {
  Letter: [612, 792], A4: [595.28, 841.89], "4x6": [288, 432], "4x2": [288, 144],
};

const FONT_MAP = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold],
} as const;

function hexColor(hex: string): RGB {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const MUTED = rgb(0.4, 0.44, 0.5);
const RULE = rgb(0.82, 0.84, 0.88);
const HEAD_BG = rgb(0.94, 0.95, 0.97);

const money = (v: number | undefined): string => (v === undefined ? "" : v.toFixed(2));

function dateText(value: string | undefined, now: Date): string {
  const d = value ? new Date(value) : now;
  return Number.isNaN(d.getTime()) ? String(value) : `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

class Cursor {
  page: PDFPage;
  y: number;
  constructor(readonly doc: PDFDocument, readonly size: readonly [number, number], readonly margin: number) {
    this.page = doc.addPage([size[0], size[1]]);
    this.y = size[1] - margin;
  }
  get width(): number { return this.size[0] - this.margin * 2; }
  ensure(height: number): boolean {
    if (this.y - height >= this.margin) return false;
    this.page = this.doc.addPage([this.size[0], this.size[1]]);
    this.y = this.size[1] - this.margin;
    return true;
  }
}

async function embedLogo(doc: PDFDocument, logo: RenderOptions["logo"]): Promise<PDFImage | null> {
  if (!logo) return null;
  try {
    return logo.mime === "image/png" ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
  } catch {
    return null;
  }
}

function text(c: Cursor, value: string, font: PDFFont, size: number, x: number, color: RGB = rgb(0.1, 0.12, 0.16)): void {
  c.page.drawText(pdfSafe(value), { x, y: c.y - size, size, font, color });
}

async function drawDocument(doc: PDFDocument, layout: PrintoutLayout, typeKey: string, record: DocRecord, opts: RenderOptions, logo: PDFImage | null, fonts: [PDFFont, PDFFont]): Promise<void> {
  const [regular, bold] = fonts;
  const size = layout.fontSize;
  const accent = hexColor(layout.accentColor);
  const c = new Cursor(doc, PAPER[layout.paper], layout.paper === "4x6" || layout.paper === "4x2" ? 14 : 40);
  const now = opts.now ?? new Date();
  const enabled = layout.sections.filter((x) => x.enabled).map((x) => x.key);
  const known = columnsFor(typeKey);
  const cols = layout.columns.filter((col) => col.enabled).map((col) => known.find((k) => k.key === col.key) ?? DOCUMENT_COLUMNS.find((k) => k.key === col.key)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const totalWidth = cols.reduce((n, col) => n + col.width, 0) || 1;

  for (const section of enabled) {
    if (section === "logo") {
      if (layout.logoPosition === "hidden") continue;
      const h = 36;
      if (logo) {
        const w = Math.min(160, (logo.width / logo.height) * h);
        const x = layout.logoPosition === "right" ? c.margin + c.width - w : layout.logoPosition === "center" ? c.margin + (c.width - w) / 2 : c.margin;
        c.page.drawImage(logo, { x, y: c.y - h, width: w, height: h });
      } else {
        const w = bold.widthOfTextAtSize(pdfSafe(opts.companyName), 16);
        const x = layout.logoPosition === "right" ? c.margin + c.width - w : layout.logoPosition === "center" ? c.margin + (c.width - w) / 2 : c.margin;
        c.page.drawText(pdfSafe(opts.companyName), { x, y: c.y - 18, size: 16, font: bold, color: accent });
      }
      c.y -= h + 10;
    } else if (section === "header") {
      text(c, layout.title || "Printout", bold, size + 8, c.margin, accent);
      c.y -= size + 14;
      const pairs: [string, string][] = [["Code", record.code], ["Reference", record.reference ?? "-"], ["Date", dateText(record.date, now)], ["Client", record.clientName ?? "-"], ["Carrier", record.carrier ?? "-"]];
      const colW = c.width / 3;
      pairs.forEach(([k, v], i) => {
        const x = c.margin + (i % 3) * colW;
        if (i > 0 && i % 3 === 0) c.y -= size * 2 + 8;
        c.page.drawText(pdfSafe(k.toUpperCase()), { x, y: c.y - 7, size: 7, font: bold, color: MUTED });
        c.page.drawText(pdfSafe(v), { x, y: c.y - 8 - size - 2, size, font: regular });
      });
      c.y -= size * 2 + 14;
    } else if (section === "barcode") {
      const png = await renderBarcodePng({ text: record.code, heightMm: 10, scale: 2 });
      const img = await doc.embedPng(png);
      const w = Math.min(200, c.width);
      const h = (img.height / img.width) * w;
      c.ensure(h + 8);
      c.page.drawImage(img, { x: layout.logoPosition === "right" ? c.margin : c.margin + c.width - w, y: c.y - h, width: w, height: h });
      c.y -= h + 10;
    } else if (section === "addresses") {
      const blocks: [string, readonly string[] | undefined][] = [["SHIP TO", record.shipTo], ["SHIP FROM", record.shipFrom]];
      const top = c.y;
      let lowest = c.y;
      blocks.forEach(([label, lines], i) => {
        if (!lines?.length) return;
        let y = top;
        const x = c.margin + i * (c.width / 2);
        c.page.drawText(label, { x, y: y - 7, size: 7, font: bold, color: MUTED });
        y -= 11;
        for (const line of lines) { c.page.drawText(pdfSafe(line), { x, y: y - size, size, font: regular }); y -= size + 3; }
        lowest = Math.min(lowest, y);
      });
      c.y = lowest - 8;
      c.page.drawLine({ start: { x: c.margin, y: c.y }, end: { x: c.margin + c.width, y: c.y }, thickness: 0.6, color: RULE });
      c.y -= 8;
    } else if (section === "lines" && cols.length > 0) {
      const rowH = size + 8;
      const header = () => {
        c.page.drawRectangle({ x: c.margin, y: c.y - rowH, width: c.width, height: rowH, color: HEAD_BG });
        let x = c.margin;
        for (const col of cols) {
          const w = (col.width / totalWidth) * c.width;
          const label = pdfSafe(col.label.toUpperCase());
          const tx = col.align === "right" ? x + w - 4 - bold.widthOfTextAtSize(label, size - 2) : x + 4;
          c.page.drawText(label, { x: tx, y: c.y - rowH + 5, size: size - 2, font: bold, color: MUTED });
          x += w;
        }
        c.y -= rowH;
      };
      header();
      for (const line of record.lines) {
        const values: Record<string, string> = {
          location: line.location ?? "", sku: line.sku, description: line.description, lot: line.lot ?? "", uom: line.uom ?? "Each",
          qty: String(line.qty), price: money(line.price), total: line.price === undefined ? "" : money(line.price * line.qty),
        };
        const wrapped = cols.map((col) => wrapText(values[col.key] ?? "", regular, size, (col.width / totalWidth) * c.width - 8).slice(0, 3));
        const lines = Math.max(1, ...wrapped.map((w) => w.length));
        const h = lines * (size + 2) + 6;
        if (c.ensure(h)) header();
        let x = c.margin;
        cols.forEach((col, i) => {
          const w = (col.width / totalWidth) * c.width;
          (wrapped[i] ?? []).forEach((t, li) => {
            const tx = col.align === "right" ? x + w - 4 - regular.widthOfTextAtSize(t, size) : x + 4;
            c.page.drawText(t, { x: tx, y: c.y - 4 - (li + 1) * (size + 2) + 2, size, font: regular });
          });
          x += w;
        });
        c.y -= h;
        c.page.drawLine({ start: { x: c.margin, y: c.y }, end: { x: c.margin + c.width, y: c.y }, thickness: 0.4, color: RULE });
      }
      c.y -= 8;
    } else if (section === "totals") {
      const units = record.lines.reduce((n, l) => n + l.qty, 0);
      const amount = record.lines.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0);
      const showAmount = cols.some((col) => col.key === "price" || col.key === "total");
      const label = `Total units: ${units}${showAmount ? `    Total: ${amount.toFixed(2)}` : ""}`;
      c.ensure(size + 10);
      c.page.drawText(pdfSafe(label), { x: c.margin + c.width - bold.widthOfTextAtSize(pdfSafe(label), size + 1), y: c.y - size - 1, size: size + 1, font: bold });
      c.y -= size + 12;
    } else if (section === "notes" && record.notes) {
      c.ensure(size * 3);
      text(c, "NOTES", bold, 7, c.margin, MUTED);
      c.y -= 11;
      for (const line of wrapText(record.notes, regular, size, c.width).slice(0, 6)) { text(c, line, regular, size, c.margin); c.y -= size + 3; }
      c.y -= 6;
    }
  }
  if (enabled.includes("footer")) {
    const pages = doc.getPages();
    pages.forEach((p, i) => {
      const footer = pdfSafe(`${layout.footerText}${layout.footerText ? "  ·  " : ""}Page ${i + 1} of ${pages.length}`);
      p.drawText(footer, { x: c.margin, y: c.margin / 2, size: 7, font: regular, color: MUTED });
    });
  }
}

async function drawLabel(doc: PDFDocument, layout: PrintoutLayout, record: DocRecord, opts: RenderOptions, logo: PDFImage | null, fonts: [PDFFont, PDFFont]): Promise<void> {
  const [regular, bold] = fonts;
  const c = new Cursor(doc, PAPER[layout.paper], 12);
  const small = layout.paper === "4x2";
  for (const section of layout.sections.filter((x) => x.enabled).map((x) => x.key)) {
    if (section === "logo" && logo && layout.logoPosition !== "hidden") {
      const h = small ? 14 : 24;
      const w = (logo.width / logo.height) * h;
      c.page.drawImage(logo, { x: layout.logoPosition === "right" ? c.margin + c.width - w : layout.logoPosition === "center" ? c.margin + (c.width - w) / 2 : c.margin, y: c.y - h, width: w, height: h });
      c.y -= h + 4;
    } else if (section === "title") {
      text(c, layout.title, bold, small ? 9 : layout.fontSize + 4, c.margin, hexColor(layout.accentColor));
      c.y -= (small ? 9 : layout.fontSize + 4) + 6;
    } else if (section === "barcode") {
      const png = await renderBarcodePng({ text: record.code, heightMm: small ? 8 : 18, scale: 3 });
      const img = await doc.embedPng(png);
      const w = c.width;
      const h = Math.min((img.height / img.width) * w, small ? 50 : 120);
      c.page.drawImage(img, { x: c.margin, y: c.y - h, width: w, height: h });
      c.y -= h + 4;
    } else if (section === "code") {
      const t = pdfSafe(record.code);
      const sz = small ? 12 : 20;
      c.page.drawText(t, { x: c.margin + (c.width - bold.widthOfTextAtSize(t, sz)) / 2, y: c.y - sz, size: sz, font: bold });
      c.y -= sz + 6;
    } else if (section === "details") {
      for (const d of (record.details ?? []).slice(0, small ? 1 : 5)) { text(c, d, regular, layout.fontSize, c.margin); c.y -= layout.fontSize + 3; }
    } else if (section === "footer" && !small) {
      c.page.drawText(pdfSafe(`Printed ${dateText(undefined, opts.now ?? new Date())} · ${opts.companyName}`), { x: c.margin, y: c.margin, size: 7, font: regular, color: MUTED });
    }
  }
}

/** Renders `records` with `layout` to PDF bytes (one record per page group). */
export async function renderLayoutPdf(typeKey: string, layout: PrintoutLayout, records: readonly DocRecord[], opts: RenderOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pair = FONT_MAP[layout.font];
  const fonts: [PDFFont, PDFFont] = [await doc.embedFont(pair[0]), await doc.embedFont(pair[1])];
  const logo = await embedLogo(doc, opts.logo);
  for (const record of records) {
    if (familyOf(typeKey) === "label") await drawLabel(doc, layout, record, opts, logo, fonts);
    else await drawDocument(doc, layout, typeKey, record, opts, logo, fonts);
  }
  doc.setTitle(layout.title || "Printout");
  doc.setProducer("KitStaks");
  return doc.save();
}

/* ---------------- sample records ---------------- */

export interface SampleOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** Recent shipment orders in scope, offered as preview samples for order-based types. */
export function sampleOrders(db: AppDb, auth: AuthContext, limit = 12): SampleOption[] {
  const where = scopedWhere(s.shipmentOrders, auth.viewScope);
  return db.select({ id: s.shipmentOrders.id, code: s.shipmentOrders.code, customer: s.shipmentOrders.customerName, qty: s.shipmentOrders.totalQuantity, status: s.shipmentOrders.status })
    .from(s.shipmentOrders).where(where).orderBy(desc(s.shipmentOrders.orderDate)).limit(limit).all()
    .map((o) => ({ id: o.id, label: o.code, description: `${o.customer} · ${o.qty} units · ${o.status}` }));
}

/** A real order as a printable record (scope-checked). */
export function orderRecord(db: AppDb, auth: AuthContext, orderId: string): DocRecord | null {
  const o = db.select().from(s.shipmentOrders).where(eq(s.shipmentOrders.id, orderId)).get();
  if (!o || !auth.scope.warehouseIds.includes(o.warehouseId) || (auth.scope.clientIds !== "all" && !auth.scope.clientIds.includes(o.clientId))) return null;
  const client = db.select({ name: s.clients.name }).from(s.clients).where(eq(s.clients.id, o.clientId)).get();
  const wh = db.select().from(s.warehouses).where(eq(s.warehouses.id, o.warehouseId)).get();
  const lines = db.select({ sku: s.products.sku, name: s.products.name, qty: s.orderLines.quantity, price: s.orderLines.unitPrice, lot: s.orderLines.lotNumber, uom: s.orderLines.packType })
    .from(s.orderLines).innerJoin(s.products, eq(s.products.id, s.orderLines.productId)).where(eq(s.orderLines.orderId, o.id)).orderBy(asc(s.products.sku)).all();
  return {
    code: o.code, reference: o.storeOrderNumber ?? undefined, date: o.orderDate, clientName: client?.name, carrier: [o.carrier, o.shippingService].filter(Boolean).join(" / ") || undefined,
    shipTo: [o.customerName, o.shipAddress, o.shipAddress2 ?? "", `${o.shipCity}, ${o.shipState} ${o.shipZip}`, o.shipCountry].filter(Boolean),
    shipFrom: wh ? [wh.name, wh.addressLine, `${wh.city}, ${wh.state} ${wh.postalCode ?? ""}`.trim()] : undefined,
    lines: lines.map((l) => ({ sku: l.sku, description: l.name, qty: l.qty, price: l.price, lot: l.lot ?? undefined, uom: l.uom, location: "" })),
    notes: [o.giftNote, o.note].filter(Boolean).join(" · ") || undefined,
  };
}

/** Built-in sample used when no record is chosen (believable data, no real customer). */
export function builtInSample(typeKey: string): DocRecord {
  if (familyOf(typeKey) === "label") {
    const code = typeKey === "location-label" ? "A-01-03-2" : typeKey === "product-label" ? "BMS-M8-BLK" : typeKey === "mobile-cart-label" ? "CART-07-B3" : "LP000124";
    return { code, lines: [], details: ["MLT1 - Main Fulfillment", "Apex Threads Co.", "Zone A · Level 3"] };
  }
  return {
    code: "SO010412", reference: "#40117", date: "2026-11-05T14:00:00.000Z", clientName: "Apex Threads Co.", carrier: "UPS / Ground",
    shipTo: ["Jordan Reyes", "418 Lakeview Ave Apt 2", "Columbus, OH 43215", "United States"],
    shipFrom: ["MLT1 - Main Fulfillment", "2200 Commerce Pkwy", "Columbus, OH 43219"],
    lines: [
      { location: "A-01-03-2", sku: "APX-TEE-BLK-M", description: "Heavyweight crew tee, black, M", qty: 2, price: 24, lot: "L2611" },
      { location: "A-02-01-1", sku: "APX-HOOD-OAT-L", description: "Brushed fleece hoodie, oatmeal, L", qty: 1, price: 58 },
      { location: "B-04-02-3", sku: "APX-CAP-NVY", description: "Six-panel cap, navy", qty: 1, price: 18.5 },
    ],
    notes: "Gift order: please include the gift receipt.",
  };
}

export function recordsForPreview(db: AppDb, auth: AuthContext, typeKey: string, sampleIds: readonly string[]): DocRecord[] {
  if (familyOf(typeKey) === "document" && sampleIds.length) {
    const ids = sampleIds.slice(0, 5);
    const found = db.select({ id: s.shipmentOrders.id }).from(s.shipmentOrders).where(inArray(s.shipmentOrders.id, ids)).all().map((r) => orderRecord(db, auth, r.id)).filter((r): r is DocRecord => r !== null);
    if (found.length) return found;
  }
  return [builtInSample(typeKey)];
}
