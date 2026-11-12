/**
 * Printout layout renderer (M14): turns a designer layout (paper / label stock, font, logo
 * position, ordered sections, ordered / hidden columns, free blocks: static text, bound data
 * fields incl. custom fields, barcodes in 8 symbologies, images, dividers, spacers) plus one or
 * more sample or real records into a PDF with pdf-lib, or into ZPL II for label printers.
 * Powers the designer's live preview and template-aware printing from the order rail.
 */
import { eq, inArray } from 'drizzle-orm';
import { asc, desc } from '@/server/db/order';
import { toBuffer } from 'bwip-js/node';
import {
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import { scopedWhere } from '@/server/auth/scope';
import * as s from '@/server/db/schema';
import { pdfSafe, wrapText } from '@/server/print/pdf';
import { dots, zplBox, zplField, zplLabel, zplText } from '@/server/print/zpl';
import {
  blockIdOf,
  columnsFor,
  CUSTOM_FIELD_PREFIX,
  DOCUMENT_COLUMNS,
  familyOf,
  isTwoDimensional,
  printFieldValue,
  type BarcodeSymbology,
  type PrintBlock,
  type PrintoutLayout,
  type PrintRecord,
  type PrintRecordLine,
} from '@/lib/grid-defs/admin/printouts';
import { mapSeq } from '@/server/db/sql';

export type DocLine = PrintRecordLine;
export type DocRecord = PrintRecord;

export interface RenderOptions {
  readonly companyName: string;
  readonly logo?: { readonly bytes: Uint8Array; readonly mime: string } | null;
  readonly now?: Date;
}

/** Points (1/72 in). Label stock is width x height in inches. */
export const PAPER_POINTS: Readonly<Record<PrintoutLayout['paper'], readonly [number, number]>> = {
  Letter: [612, 792],
  A4: [595.28, 841.89],
  Legal: [612, 1008],
  '4x6': [288, 432],
  '4x4': [288, 288],
  '4x3': [288, 216],
  '4x2': [288, 144],
  '3x2': [216, 144],
  '2x1': [144, 72],
};

const FONT_MAP = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold],
} as const;

function hexColor(hex: string): RGB {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.44, 0.5);
const RULE = rgb(0.82, 0.84, 0.88);
const HEAD_BG = rgb(0.94, 0.95, 0.97);
const WARN = rgb(0.75, 0.1, 0.15);

const money = (v: number | undefined): string => (v === undefined ? '' : v.toFixed(2));

function dateText(value: string | undefined, now: Date): string {
  const d = value ? new Date(value) : now;
  return Number.isNaN(d.getTime())
    ? String(value)
    : `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** Value of a bindable field on a record ("" when the record has none). PURE. */
export function fieldValue(
  record: DocRecord,
  key: string,
  opts: Pick<RenderOptions, 'companyName' | 'now'>,
): string {
  return printFieldValue(record, key, opts);
}

/** bwip-js PNG for any supported symbology; null when the value can't be encoded. */
async function barcodePng(
  symbology: BarcodeSymbology,
  value: string,
  heightMm: number,
): Promise<Buffer | null> {
  const text = value.trim();
  if (!text || text.length > 200) return null;
  try {
    return await toBuffer({
      bcid: symbology,
      text,
      scale: 3,
      ...(isTwoDimensional(symbology) ? {} : { height: Math.max(4, heightMm), includetext: false }),
    });
  } catch {
    return null;
  }
}

class Cursor {
  page: PDFPage;
  y: number;
  constructor(
    readonly doc: PDFDocument,
    readonly size: readonly [number, number],
    readonly margin: number,
  ) {
    this.page = doc.addPage([size[0], size[1]]);
    this.y = size[1] - margin;
  }
  get width(): number {
    return this.size[0] - this.margin * 2;
  }
  /** Starts a new page when `height` doesn't fit (labels never overflow: they clip). */
  ensure(height: number, allowBreak = true): boolean {
    if (!allowBreak || this.y - height >= this.margin) return false;
    this.page = this.doc.addPage([this.size[0], this.size[1]]);
    this.y = this.size[1] - this.margin;
    return true;
  }
  xFor(align: 'left' | 'center' | 'right', width: number): number {
    return align === 'right'
      ? this.margin + this.width - width
      : align === 'center'
        ? this.margin + (this.width - width) / 2
        : this.margin;
  }
}

async function embedImage(doc: PDFDocument, bytes: Uint8Array, mime: string): Promise<PDFImage | null> {
  try {
    return mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

function decodeDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return null;
  return { mime: m[1] as string, bytes: new Uint8Array(Buffer.from(m[2] as string, 'base64')) };
}

function text(c: Cursor, value: string, font: PDFFont, size: number, x: number, color: RGB = INK): void {
  c.page.drawText(pdfSafe(value), { x, y: c.y - size, size, font, color });
}

interface Ctx {
  readonly doc: PDFDocument;
  readonly layout: PrintoutLayout;
  readonly record: DocRecord;
  readonly opts: RenderOptions;
  readonly logo: PDFImage | null;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly images: Map<string, PDFImage | null>;
  readonly breaks: boolean;
}

/** Draws one free block at the cursor (all kinds) and advances it. */
async function drawBlock(c: Cursor, b: PrintBlock, x: Ctx): Promise<void> {
  const color = hexColor(b.color);
  const font = b.bold ? x.bold : x.regular;
  if (b.kind === 'spacer') {
    c.y -= b.height;
    return;
  }
  if (b.kind === 'divider') {
    c.ensure(b.height + 6, x.breaks);
    c.y -= 3;
    c.page.drawLine({
      start: { x: c.margin, y: c.y },
      end: { x: c.margin + c.width, y: c.y },
      thickness: Math.max(0.5, Math.min(b.height, 6)),
      color,
    });
    c.y -= 3 + Math.min(b.height, 6);
    return;
  }
  if (b.kind === 'text' || b.kind === 'field') {
    const value = b.kind === 'text' ? b.text : `${b.text}${fieldValue(x.record, b.field, x.opts)}`;
    const lines = wrapText(value || ' ', font, b.size, c.width).slice(0, 12);
    for (const line of lines) {
      c.ensure(b.size + 3, x.breaks);
      const w = font.widthOfTextAtSize(pdfSafe(line), b.size);
      text(c, line, font, b.size, c.xFor(b.align, w), color);
      c.y -= b.size + 3;
    }
    c.y -= 3;
    return;
  }
  if (b.kind === 'barcode') {
    const value = fieldValue(x.record, b.field, x.opts);
    const png = await barcodePng(b.symbology, value, b.height / 2.83);
    const w = (c.width * b.widthPct) / 100;
    if (!png) {
      c.ensure(12, x.breaks);
      const msg = value ? `Can't encode "${value}" as ${b.symbology}` : 'Barcode field is empty';
      text(c, msg, x.regular, 8, c.xFor(b.align, x.regular.widthOfTextAtSize(pdfSafe(msg), 8)), WARN);
      c.y -= 14;
      return;
    }
    const img = await x.doc.embedPng(png);
    const h = isTwoDimensional(b.symbology) ? Math.min((img.height / img.width) * w, b.height * 3) : b.height;
    const iw = isTwoDimensional(b.symbology) ? (img.width / img.height) * h : w;
    c.ensure(h + 6, x.breaks);
    c.page.drawImage(img, { x: c.xFor(b.align, iw), y: c.y - h, width: iw, height: h });
    c.y -= h + 6;
    return;
  }
  // image: uploaded data URL, or the company logo when none was uploaded
  let img = x.logo;
  if (b.imageDataUrl) {
    if (!x.images.has(b.id)) {
      const decoded = decodeDataUrl(b.imageDataUrl);
      x.images.set(b.id, decoded ? await embedImage(x.doc, decoded.bytes, decoded.mime) : null);
    }
    img = x.images.get(b.id) ?? null;
  }
  if (!img) {
    if (!b.imageDataUrl) {
      c.y -= 2;
      return;
    }
    text(c, 'Image could not be read', x.regular, 8, c.margin, WARN);
    c.y -= 12;
    return;
  }
  const maxW = (c.width * b.widthPct) / 100;
  const h = Math.min(b.height, (img.height / img.width) * maxW);
  const w = (img.width / img.height) * h;
  c.ensure(h + 6, x.breaks);
  c.page.drawImage(img, { x: c.xFor(b.align, w), y: c.y - h, width: w, height: h });
  c.y -= h + 6;
}

const blockFor = (layout: PrintoutLayout, key: string): PrintBlock | null => {
  const id = blockIdOf(key);
  return id === null ? null : (layout.blocks.find((b) => b.id === id) ?? null);
};

async function drawDocument(x: Ctx, typeKey: string): Promise<void> {
  const { doc, layout, record, opts, logo, regular, bold } = x;
  const size = layout.fontSize;
  const accent = hexColor(layout.accentColor);
  const c = new Cursor(doc, PAPER_POINTS[layout.paper], 40);
  const now = opts.now ?? new Date();
  const enabled = layout.sections.filter((sec) => sec.enabled).map((sec) => sec.key);
  const known = columnsFor(typeKey);
  const cols = layout.columns
    .filter((col) => col.enabled)
    .map((col) => known.find((k) => k.key === col.key) ?? DOCUMENT_COLUMNS.find((k) => k.key === col.key))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
  const totalWidth = cols.reduce((n, col) => n + col.width, 0) || 1;

  for (const section of enabled) {
    const block = blockFor(layout, section);
    if (block) {
      await drawBlock(c, block, x);
      continue;
    }
    if (section === 'logo') {
      if (layout.logoPosition === 'hidden') continue;
      const h = 36;
      if (logo) {
        const w = Math.min(160, (logo.width / logo.height) * h);
        c.page.drawImage(logo, {
          x: c.xFor(layout.logoPosition as 'left' | 'center' | 'right', w),
          y: c.y - h,
          width: w,
          height: h,
        });
      } else {
        const w = bold.widthOfTextAtSize(pdfSafe(opts.companyName), 16);
        c.page.drawText(pdfSafe(opts.companyName), {
          x: c.xFor(layout.logoPosition as 'left' | 'center' | 'right', w),
          y: c.y - 18,
          size: 16,
          font: bold,
          color: accent,
        });
      }
      c.y -= h + 10;
    } else if (section === 'header') {
      text(c, layout.title || 'Printout', bold, size + 8, c.margin, accent);
      c.y -= size + 14;
      const pairs: [string, string][] = [
        ['Code', record.code],
        ['Reference', record.reference ?? '-'],
        ['Date', dateText(record.date, now)],
        ['Client', record.clientName ?? '-'],
        ['Carrier', record.carrier ?? '-'],
      ];
      const colW = c.width / 3;
      pairs.forEach(([k, v], i) => {
        const px = c.margin + (i % 3) * colW;
        if (i > 0 && i % 3 === 0) c.y -= size * 2 + 8;
        c.page.drawText(pdfSafe(k.toUpperCase()), { x: px, y: c.y - 7, size: 7, font: bold, color: MUTED });
        c.page.drawText(pdfSafe(v), { x: px, y: c.y - 8 - size - 2, size, font: regular });
      });
      c.y -= size * 2 + 14;
    } else if (section === 'barcode') {
      const png = await barcodePng(layout.barcodeType, record.code, 10);
      if (!png) {
        text(c, `Can't encode ${record.code} as ${layout.barcodeType}`, regular, 8, c.margin, WARN);
        c.y -= 14;
        continue;
      }
      const img = await doc.embedPng(png);
      const twoD = isTwoDimensional(layout.barcodeType);
      const w = twoD ? 72 : Math.min(200, c.width);
      const h = (img.height / img.width) * w;
      c.ensure(h + 8);
      c.page.drawImage(img, {
        x: layout.logoPosition === 'right' ? c.margin : c.margin + c.width - w,
        y: c.y - h,
        width: w,
        height: h,
      });
      c.y -= h + 10;
    } else if (section === 'addresses') {
      const blocks: [string, readonly string[] | undefined][] = [
        ['SHIP TO', record.shipTo],
        ['SHIP FROM', record.shipFrom],
      ];
      const top = c.y;
      let lowest = c.y;
      blocks.forEach(([label, lines], i) => {
        if (!lines?.length) return;
        let y = top;
        const px = c.margin + i * (c.width / 2);
        c.page.drawText(label, { x: px, y: y - 7, size: 7, font: bold, color: MUTED });
        y -= 11;
        for (const line of lines) {
          c.page.drawText(pdfSafe(line), { x: px, y: y - size, size, font: regular });
          y -= size + 3;
        }
        lowest = Math.min(lowest, y);
      });
      c.y = lowest - 8;
      c.page.drawLine({
        start: { x: c.margin, y: c.y },
        end: { x: c.margin + c.width, y: c.y },
        thickness: 0.6,
        color: RULE,
      });
      c.y -= 8;
    } else if (section === 'lines' && cols.length > 0) {
      const rowH = size + 8;
      const header = () => {
        c.page.drawRectangle({ x: c.margin, y: c.y - rowH, width: c.width, height: rowH, color: HEAD_BG });
        let px = c.margin;
        for (const col of cols) {
          const w = (col.width / totalWidth) * c.width;
          const label = pdfSafe(col.label.toUpperCase());
          const tx = col.align === 'right' ? px + w - 4 - bold.widthOfTextAtSize(label, size - 2) : px + 4;
          c.page.drawText(label, { x: tx, y: c.y - rowH + 5, size: size - 2, font: bold, color: MUTED });
          px += w;
        }
        c.y -= rowH;
      };
      header();
      for (const line of record.lines) {
        const values: Record<string, string> = {
          location: line.location ?? '',
          sku: line.sku,
          description: line.description,
          lot: line.lot ?? '',
          uom: line.uom ?? 'Each',
          qty: String(line.qty),
          price: money(line.price),
          total: line.price === undefined ? '' : money(line.price * line.qty),
        };
        const wrapped = cols.map((col) =>
          wrapText(values[col.key] ?? '', regular, size, (col.width / totalWidth) * c.width - 8).slice(0, 3),
        );
        const lineCount = Math.max(1, ...wrapped.map((w) => w.length));
        const h = lineCount * (size + 2) + 6;
        if (c.ensure(h)) header();
        let px = c.margin;
        cols.forEach((col, i) => {
          const w = (col.width / totalWidth) * c.width;
          (wrapped[i] ?? []).forEach((t, li) => {
            const tx = col.align === 'right' ? px + w - 4 - regular.widthOfTextAtSize(t, size) : px + 4;
            c.page.drawText(t, { x: tx, y: c.y - 4 - (li + 1) * (size + 2) + 2, size, font: regular });
          });
          px += w;
        });
        c.y -= h;
        c.page.drawLine({
          start: { x: c.margin, y: c.y },
          end: { x: c.margin + c.width, y: c.y },
          thickness: 0.4,
          color: RULE,
        });
      }
      c.y -= 8;
    } else if (section === 'totals') {
      const units = record.lines.reduce((n, l) => n + l.qty, 0);
      const amount = record.lines.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0);
      const showAmount = cols.some((col) => col.key === 'price' || col.key === 'total');
      const label = `Total units: ${units}${showAmount ? `    Total: ${amount.toFixed(2)}` : ''}`;
      c.ensure(size + 10);
      c.page.drawText(pdfSafe(label), {
        x: c.margin + c.width - bold.widthOfTextAtSize(pdfSafe(label), size + 1),
        y: c.y - size - 1,
        size: size + 1,
        font: bold,
      });
      c.y -= size + 12;
    } else if (section === 'notes' && record.notes) {
      c.ensure(size * 3);
      text(c, 'NOTES', bold, 7, c.margin, MUTED);
      c.y -= 11;
      for (const line of wrapText(record.notes, regular, size, c.width).slice(0, 6)) {
        text(c, line, regular, size, c.margin);
        c.y -= size + 3;
      }
      c.y -= 6;
    }
  }
  if (enabled.includes('footer')) {
    const pages = doc.getPages();
    pages.forEach((pg, i) => {
      const footer = pdfSafe(
        `${layout.footerText}${layout.footerText ? '  ·  ' : ''}Page ${i + 1} of ${pages.length}`,
      );
      pg.drawText(footer, { x: c.margin, y: c.margin / 2, size: 7, font: regular, color: MUTED });
    });
  }
}

async function drawLabel(x: Ctx): Promise<void> {
  const { doc, layout, record, opts, logo, regular, bold } = x;
  const [pw, ph] = PAPER_POINTS[layout.paper];
  const tiny = ph <= 72;
  const small = ph <= 144;
  const c = new Cursor(doc, [pw, ph], tiny ? 5 : small ? 8 : 12);
  for (const section of layout.sections.filter((sec) => sec.enabled).map((sec) => sec.key)) {
    const block = blockFor(layout, section);
    if (block) {
      await drawBlock(c, block, x);
      continue;
    }
    if (section === 'logo' && logo && layout.logoPosition !== 'hidden') {
      const h = tiny ? 10 : small ? 14 : 24;
      const w = (logo.width / logo.height) * h;
      c.page.drawImage(logo, {
        x: c.xFor(layout.logoPosition as 'left' | 'center' | 'right', w),
        y: c.y - h,
        width: w,
        height: h,
      });
      c.y -= h + 4;
    } else if (section === 'title') {
      const sz = tiny ? 6 : small ? 9 : layout.fontSize + 4;
      text(c, layout.title, bold, sz, c.margin, hexColor(layout.accentColor));
      c.y -= sz + (tiny ? 2 : 6);
    } else if (section === 'barcode') {
      const twoD = isTwoDimensional(layout.barcodeType);
      const png = await barcodePng(layout.barcodeType, record.code, tiny ? 5 : small ? 8 : 18);
      if (!png) {
        text(c, `Can't encode ${record.code}`, regular, 7, c.margin, WARN);
        c.y -= 10;
        continue;
      }
      const img = await doc.embedPng(png);
      const maxH = tiny ? 26 : small ? 50 : 120;
      const h = twoD
        ? Math.min(maxH * (small ? 1 : 1.2), c.width)
        : Math.min((img.height / img.width) * c.width, maxH);
      const w = twoD ? (img.width / img.height) * h : c.width;
      c.page.drawImage(img, { x: c.xFor('center', w), y: c.y - h, width: w, height: h });
      c.y -= h + (tiny ? 2 : 4);
    } else if (section === 'code') {
      const t = pdfSafe(record.code);
      const sz = tiny ? 8 : small ? 12 : 20;
      c.page.drawText(t, {
        x: c.xFor('center', bold.widthOfTextAtSize(t, sz)),
        y: c.y - sz,
        size: sz,
        font: bold,
      });
      c.y -= sz + (tiny ? 2 : 6);
    } else if (section === 'details') {
      for (const d of (record.details ?? []).slice(0, tiny ? 0 : small ? 1 : 5)) {
        text(c, d, regular, layout.fontSize, c.margin);
        c.y -= layout.fontSize + 3;
      }
    } else if (section === 'footer' && !small) {
      c.page.drawText(
        pdfSafe(`Printed ${dateText(undefined, opts.now ?? new Date())} · ${opts.companyName}`),
        { x: c.margin, y: c.margin, size: 7, font: regular, color: MUTED },
      );
    }
  }
}

/** Renders `records` with `layout` to PDF bytes (one record per page group). */
export async function renderLayoutPdf(
  typeKey: string,
  layout: PrintoutLayout,
  records: readonly DocRecord[],
  opts: RenderOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pair = FONT_MAP[layout.font];
  const [regular, bold] = [await doc.embedFont(pair[0]), await doc.embedFont(pair[1])];
  const logo = opts.logo ? await embedImage(doc, opts.logo.bytes, opts.logo.mime) : null;
  const images = new Map<string, PDFImage | null>();
  const label = familyOf(typeKey) === 'label';
  for (const record of records) {
    const ctx: Ctx = { doc, layout, record, opts, logo, regular, bold, images, breaks: !label };
    if (label) await drawLabel(ctx);
    else await drawDocument(ctx, typeKey);
  }
  doc.setTitle(layout.title || 'Printout');
  doc.setProducer('KitStaks');
  return doc.save();
}

/* ---------------- ZPL II (label printers) ---------------- */

/** Native ZPL barcode command for a symbology (Code 128 fallback for GS1 data without FNC1). */
function zplBarcode(
  sym: BarcodeSymbology,
  x: number,
  y: number,
  value: string,
  height: number,
  moduleWidth: number,
): string {
  const data = `^FH\\^FD${zplField(value)}^FS`;
  const by = `^BY${moduleWidth}`;
  switch (sym) {
    case 'qrcode':
      return `^FO${x},${y}^BQN,2,${Math.max(2, moduleWidth + 2)}^FH\\^FDQA,${zplField(value)}^FS`;
    case 'datamatrix':
      return `^FO${x},${y}^BXN,${Math.max(3, moduleWidth * 2)},200${data}`;
    case 'pdf417':
      return `^FO${x},${y}${by}^B7N,${Math.max(4, Math.round(height / 12))},3,,,N${data}`;
    case 'code39':
      return `^FO${x},${y}${by}^B3N,N,${height},N,N${data}`;
    case 'ean13':
      return `^FO${x},${y}${by}^BEN,${height},N,N${data}`;
    case 'upca':
      return `^FO${x},${y}${by}^BUN,${height},N,N,N${data}`;
    case 'gs1-128':
    case 'code128':
    default:
      return `^FO${x},${y}${by}^BCN,${height},N,N,N${data}`;
  }
}

/**
 * ZPL II for label layouts (203 dpi), one `^XA…^XZ` per record. Sections and blocks print top
 * to bottom like the PDF; images are skipped (ZPL needs ^GF bitmaps) and noted in a comment.
 */
export function renderLayoutZpl(
  layout: PrintoutLayout,
  records: readonly DocRecord[],
  opts: RenderOptions,
  copies = 1,
): string {
  const [pw, ph] = PAPER_POINTS[layout.paper];
  const widthDots = dots(pw / 72);
  const lengthDots = dots(ph / 72);
  const margin = dots(ph <= 72 ? 0.06 : 0.12);
  const inner = widthDots - margin * 2;
  const pt = (points: number) => Math.round((points / 72) * 203);
  const alignOf = (a: 'left' | 'center' | 'right') => (a === 'right' ? 'R' : a === 'center' ? 'C' : 'L');
  return records
    .map((record) => {
      const cmds: string[] = [];
      let y = margin;
      for (const key of layout.sections.filter((sec) => sec.enabled).map((sec) => sec.key)) {
        const b = blockFor(layout, key);
        if (b) {
          if (b.kind === 'spacer') y += pt(b.height);
          else if (b.kind === 'divider') {
            cmds.push(
              zplBox(
                margin,
                y,
                inner,
                Math.max(2, pt(Math.min(b.height, 6))),
                Math.max(2, pt(Math.min(b.height, 6))),
              ),
            );
            y += pt(Math.min(b.height, 6)) + 8;
          } else if (b.kind === 'text' || b.kind === 'field') {
            const h = pt(b.size);
            const value = b.kind === 'text' ? b.text : `${b.text}${fieldValue(record, b.field, opts)}`;
            cmds.push(
              zplText({
                x: margin,
                y,
                text: value,
                height: h,
                blockWidth: inner,
                maxLines: 3,
                align: alignOf(b.align),
              }),
            );
            y += Math.ceil((value.length * h * 0.55) / inner + 0.5) * (h + 4);
          } else if (b.kind === 'barcode') {
            const h = pt(b.height);
            const width = Math.round((inner * b.widthPct) / 100);
            const x =
              b.align === 'center'
                ? margin + Math.round((inner - width) / 2)
                : b.align === 'right'
                  ? margin + inner - width
                  : margin;
            cmds.push(zplBarcode(b.symbology, x, y, fieldValue(record, b.field, opts), h, 2));
            y += (isTwoDimensional(b.symbology) ? Math.min(h * 2, inner) : h) + 12;
          } else {
            cmds.push(`^FX image block ${b.id} not sent: images need a ^GF bitmap from the printer driver`);
          }
          continue;
        }
        if (key === 'title' && layout.title) {
          const h = pt(Math.min(layout.fontSize + 4, ph <= 72 ? 6 : 18));
          cmds.push(zplText({ x: margin, y, text: layout.title, height: h }));
          y += h + 8;
        } else if (key === 'barcode') {
          const h = Math.round(lengthDots * (ph <= 72 ? 0.35 : 0.3));
          cmds.push(zplBarcode(layout.barcodeType, margin, y, record.code, h, ph <= 72 ? 1 : 3));
          y += (isTwoDimensional(layout.barcodeType) ? Math.min(h * 2, inner) : h) + 10;
        } else if (key === 'code') {
          const h = pt(ph <= 72 ? 8 : ph <= 144 ? 12 : 20);
          cmds.push(zplText({ x: margin, y, text: record.code, height: h, blockWidth: inner, align: 'C' }));
          y += h + 8;
        } else if (key === 'details') {
          for (const d of (record.details ?? []).slice(0, ph <= 72 ? 0 : ph <= 144 ? 1 : 5)) {
            const h = pt(layout.fontSize);
            cmds.push(zplText({ x: margin, y, text: d, height: h }));
            y += h + 6;
          }
        } else if (key === 'footer' && ph > 144)
          cmds.push(
            zplText({
              x: margin,
              y: lengthDots - margin - 20,
              text: `Printed ${dateText(undefined, opts.now ?? new Date())} · ${opts.companyName}`,
              height: 18,
            }),
          );
      }
      return zplLabel(widthDots, lengthDots, cmds, copies);
    })
    .join('\n');
}

/* ---------------- sample records ---------------- */

export interface SampleOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** Recent shipment orders in scope, offered as preview samples for order-based types. */
export async function sampleOrders(db: AppDb, auth: AuthContext, limit = 12): Promise<SampleOption[]> {
  const where = scopedWhere(s.shipmentOrders, auth.viewScope);
  return (
    await db
      .select({
        id: s.shipmentOrders.id,
        code: s.shipmentOrders.code,
        customer: s.shipmentOrders.customerName,
        qty: s.shipmentOrders.totalQuantity,
        status: s.shipmentOrders.status,
      })
      .from(s.shipmentOrders)
      .where(where)
      .orderBy(desc(s.shipmentOrders.orderDate))
      .limit(limit)
  ).map((o) => ({ id: o.id, label: o.code, description: `${o.customer} · ${o.qty} units · ${o.status}` }));
}

/** Active custom field definitions for an entity, as bindable fields (`custom:<slot>`). */
export async function customBindableFields(
  db: AppDb,
  entityType: 'shipment_order' | 'product' | 'location',
): Promise<{ key: string; label: string; sample: string }[]> {
  return (
    await db
      .select({ slot: s.customFieldDefs.slot, name: s.customFieldDefs.name })
      .from(s.customFieldDefs)
      .where(eq(s.customFieldDefs.entityType, entityType))
  ).map((d) => ({ key: `${CUSTOM_FIELD_PREFIX}${d.slot}`, label: `Custom · ${d.name}`, sample: d.name }));
}

const customValues = (raw: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((raw ?? {}) as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => [
        `${CUSTOM_FIELD_PREFIX}${k}`,
        typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v),
      ]),
  );

/** A real order as a printable record (scope-checked). */
export async function orderRecord(db: AppDb, auth: AuthContext, orderId: string): Promise<DocRecord | null> {
  const o = (await db.select().from(s.shipmentOrders).where(eq(s.shipmentOrders.id, orderId)).limit(1))[0];
  if (
    !o ||
    !auth.scope.warehouseIds.includes(o.warehouseId) ||
    (auth.scope.clientIds !== 'all' && !auth.scope.clientIds.includes(o.clientId))
  )
    return null;
  const client = (
    await db.select({ name: s.clients.name }).from(s.clients).where(eq(s.clients.id, o.clientId)).limit(1)
  )[0];
  const wh = (await db.select().from(s.warehouses).where(eq(s.warehouses.id, o.warehouseId)).limit(1))[0];
  const lines = await db
    .select({
      sku: s.products.sku,
      name: s.products.name,
      qty: s.orderLines.quantity,
      price: s.orderLines.unitPrice,
      lot: s.orderLines.lotNumber,
      uom: s.orderLines.packType,
    })
    .from(s.orderLines)
    .innerJoin(s.products, eq(s.products.id, s.orderLines.productId))
    .where(eq(s.orderLines.orderId, o.id))
    .orderBy(asc(s.products.sku));
  return {
    code: o.code,
    reference: o.storeOrderNumber ?? undefined,
    date: o.orderDate,
    clientName: client?.name,
    carrier: [o.carrier, o.shippingService].filter(Boolean).join(' / ') || undefined,
    shipTo: [
      o.customerName,
      o.shipAddress,
      o.shipAddress2 ?? '',
      `${o.shipCity}, ${o.shipState} ${o.shipZip}`,
      o.shipCountry,
    ].filter(Boolean),
    shipFrom: wh
      ? [wh.name, wh.addressLine, `${wh.city}, ${wh.state} ${wh.postalCode ?? ''}`.trim()]
      : undefined,
    lines: lines.map((l) => ({
      sku: l.sku,
      description: l.name,
      qty: l.qty,
      price: l.price,
      lot: l.lot ?? undefined,
      uom: l.uom,
      location: '',
    })),
    notes: [o.giftNote, o.note].filter(Boolean).join(' · ') || undefined,
    fields: customValues(o.customFields),
  };
}

/** Built-in sample used when no record is chosen (believable data, no real customer). */
export function builtInSample(typeKey: string): DocRecord {
  if (familyOf(typeKey) === 'label') {
    const code =
      typeKey === 'location-label'
        ? 'A-01-03-2'
        : typeKey === 'product-label'
          ? 'BMS-M8-BLK'
          : typeKey === 'mobile-cart-label'
            ? 'CART-07-B3'
            : 'LP000124';
    return {
      code,
      lines: [],
      details: ['MLT1 - Main Fulfillment', 'Apex Threads Co.', 'Zone A · Level 3'],
      clientName: 'Apex Threads Co.',
      shipFrom: ['MLT1 - Main Fulfillment'],
    };
  }
  return {
    code: 'SO010412',
    reference: '#40117',
    date: '2026-11-05T14:00:00.000Z',
    clientName: 'Apex Threads Co.',
    carrier: 'UPS / Ground',
    shipTo: ['Jordan Reyes', '418 Lakeview Ave Apt 2', 'Columbus, OH 43215', 'United States'],
    shipFrom: ['MLT1 - Main Fulfillment', '2200 Commerce Pkwy', 'Columbus, OH 43219'],
    lines: [
      {
        location: 'A-01-03-2',
        sku: 'APX-TEE-BLK-M',
        description: 'Heavyweight crew tee, black, M',
        qty: 2,
        price: 24,
        lot: 'L2611',
      },
      {
        location: 'A-02-01-1',
        sku: 'APX-HOOD-OAT-L',
        description: 'Brushed fleece hoodie, oatmeal, L',
        qty: 1,
        price: 58,
      },
      { location: 'B-04-02-3', sku: 'APX-CAP-NVY', description: 'Six-panel cap, navy', qty: 1, price: 18.5 },
    ],
    notes: 'Gift order: please include the gift receipt.',
  };
}

export async function recordsForPreview(
  db: AppDb,
  auth: AuthContext,
  typeKey: string,
  sampleIds: readonly string[],
): Promise<DocRecord[]> {
  if (familyOf(typeKey) === 'document' && sampleIds.length) {
    const ids = sampleIds.slice(0, 5);
    const found = (
      await mapSeq(
        await db
          .select({ id: s.shipmentOrders.id })
          .from(s.shipmentOrders)
          .where(inArray(s.shipmentOrders.id, ids)),
        async (r) => await orderRecord(db, auth, r.id),
      )
    ).filter((r): r is DocRecord => r !== null);
    if (found.length) return found;
  }
  return [builtInSample(typeKey)];
}
