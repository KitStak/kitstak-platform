/**
 * Small PDF layout layer over pdf-lib for list printouts: flowing text, key/value blocks,
 * paginated tables with repeated headers, embedded barcodes and "Page i of n" footers.
 * Standard Helvetica fonts only (WinAnsi), so text is normalised by `pdfSafe`.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

export const PAGE_LETTER: readonly [number, number] = [612, 792];
export const PAGE_LABEL_4X6: readonly [number, number] = [288, 432];
export const PAGE_LABEL_4X2: readonly [number, number] = [288, 144];
export const INCH = 72;

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.38, 0.42, 0.48);
const RULE = rgb(0.8, 0.82, 0.86);
const HEADER_BG = rgb(0.93, 0.94, 0.96);

const REPLACEMENTS: Readonly<Record<string, string>> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  ' ': ' ',
};

/** Maps text into the WinAnsi range pdf-lib's standard fonts can encode. */
export function pdfSafe(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return Array.from(text.replace(/[\r\n\t]+/g, ' '), (ch) => {
    if (REPLACEMENTS[ch]) return REPLACEMENTS[ch];
    const code = ch.charCodeAt(0);
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) ? ch : '?';
  }).join('');
}

/** Greedy word wrap; long words are hard-broken. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = pdfSafe(text)
    .split(' ')
    .filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  const fits = (s: string): boolean => font.widthOfTextAtSize(s, size) <= maxWidth;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    let rest = word;
    while (!fits(rest) && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export interface TableColumn<Row> {
  readonly label: string;
  /** Fraction of the content width. */
  readonly width: number;
  readonly align?: 'left' | 'right';
  value(row: Row): string;
}

export interface TextOptions {
  readonly size?: number;
  readonly bold?: boolean;
  readonly muted?: boolean;
  readonly x?: number;
  readonly width?: number;
  readonly align?: 'left' | 'right' | 'center';
}

/** Stateful page cursor. One writer per document. */
export class PdfWriter {
  private page: PDFPage;
  private cursorY: number;

  private constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly size: readonly [number, number],
    readonly margin: number,
  ) {
    this.page = doc.addPage([size[0], size[1]]);
    this.cursorY = size[1] - margin;
  }

  static async create(
    size: readonly [number, number] = PAGE_LETTER,
    margin = 40,
    title = 'KitStaks printout',
  ): Promise<PdfWriter> {
    const doc = await PDFDocument.create();
    doc.setTitle(pdfSafe(title));
    doc.setProducer('KitStaks WMS');
    doc.setCreator('KitStaks WMS');
    const [regular, bold] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
    ]);
    return new PdfWriter(doc, regular, bold, size, margin);
  }

  get y(): number {
    return this.cursorY;
  }
  get contentWidth(): number {
    return this.size[0] - this.margin * 2;
  }
  get currentPage(): PDFPage {
    return this.page;
  }

  newPage(): void {
    this.page = this.doc.addPage([this.size[0], this.size[1]]);
    this.cursorY = this.size[1] - this.margin;
  }

  /** Starts a new page when fewer than `height` points remain (footer reserved). */
  ensureSpace(height: number): void {
    if (this.cursorY - height < this.margin + 16) this.newPage();
  }

  moveDown(points: number): void {
    this.cursorY -= points;
  }

  text(value: unknown, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.regular;
    const x0 = options.x ?? this.margin;
    const width = options.width ?? this.contentWidth - (x0 - this.margin);
    for (const line of wrapText(String(value ?? ''), font, size, width)) {
      this.ensureSpace(size + 3);
      const lineWidth = font.widthOfTextAtSize(line, size);
      const x =
        options.align === 'right'
          ? x0 + width - lineWidth
          : options.align === 'center'
            ? x0 + (width - lineWidth) / 2
            : x0;
      this.page.drawText(line, { x, y: this.cursorY - size, size, font, color: options.muted ? MUTED : INK });
      this.cursorY -= size + 3;
    }
  }

  rule(): void {
    this.ensureSpace(8);
    this.page.drawLine({
      start: { x: this.margin, y: this.cursorY - 4 },
      end: { x: this.size[0] - this.margin, y: this.cursorY - 4 },
      thickness: 0.75,
      color: RULE,
    });
    this.cursorY -= 10;
  }

  /** Two-column "Label: value" block. */
  keyValues(pairs: readonly (readonly [string, unknown])[], columns = 2): void {
    const colWidth = this.contentWidth / columns;
    for (let i = 0; i < pairs.length; i += columns) {
      const rowPairs = pairs.slice(i, i + columns);
      this.ensureSpace(14);
      rowPairs.forEach(([key, value], index) => {
        const x = this.margin + index * colWidth;
        const label = `${pdfSafe(key)}: `;
        this.page.drawText(label, { x, y: this.cursorY - 9, size: 9, font: this.bold, color: MUTED });
        const labelWidth = this.bold.widthOfTextAtSize(label, 9);
        const [first = ''] = wrapText(
          String(value ?? '-') || '-',
          this.regular,
          9,
          colWidth - labelWidth - 6,
        );
        this.page.drawText(first, {
          x: x + labelWidth,
          y: this.cursorY - 9,
          size: 9,
          font: this.regular,
          color: INK,
        });
      });
      this.cursorY -= 14;
    }
  }

  image(img: PDFImage, width: number, height: number, x: number = this.margin): void {
    this.ensureSpace(height + 4);
    this.page.drawImage(img, { x, y: this.cursorY - height, width, height });
    this.cursorY -= height + 4;
  }

  private tableHeader<Row>(columns: readonly TableColumn<Row>[]): void {
    this.ensureSpace(18);
    this.page.drawRectangle({
      x: this.margin,
      y: this.cursorY - 16,
      width: this.contentWidth,
      height: 16,
      color: HEADER_BG,
    });
    let x = this.margin;
    for (const column of columns) {
      const width = column.width * this.contentWidth;
      const label = pdfSafe(column.label).toUpperCase();
      const textWidth = this.bold.widthOfTextAtSize(label, 7.5);
      const tx = column.align === 'right' ? x + width - textWidth - 4 : x + 4;
      this.page.drawText(label, { x: tx, y: this.cursorY - 11, size: 7.5, font: this.bold, color: MUTED });
      x += width;
    }
    this.cursorY -= 18;
  }

  table<Row>(columns: readonly TableColumn<Row>[], rows: readonly Row[]): void {
    this.tableHeader(columns);
    for (const row of rows) {
      const cells = columns.map((column) =>
        wrapText(column.value(row), this.regular, 9, column.width * this.contentWidth - 8),
      );
      const height = Math.max(...cells.map((lines) => lines.length)) * 11 + 5;
      if (this.cursorY - height < this.margin + 16) {
        this.newPage();
        this.tableHeader(columns);
      }
      let x = this.margin;
      columns.forEach((column, index) => {
        const width = column.width * this.contentWidth;
        (cells[index] ?? []).forEach((line, lineIndex) => {
          const textWidth = this.regular.widthOfTextAtSize(line, 9);
          const tx = column.align === 'right' ? x + width - textWidth - 4 : x + 4;
          this.page.drawText(line, {
            x: tx,
            y: this.cursorY - 10 - lineIndex * 11,
            size: 9,
            font: this.regular,
            color: INK,
          });
        });
        x += width;
      });
      this.cursorY -= height;
      this.page.drawLine({
        start: { x: this.margin, y: this.cursorY + 1 },
        end: { x: this.size[0] - this.margin, y: this.cursorY + 1 },
        thickness: 0.5,
        color: RULE,
      });
    }
  }

  /** Adds "Page i of n" footers (with optional left text) and serialises. */
  async finish(footerLeft = ''): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      const label = `Page ${index + 1} of ${pages.length}`;
      const width = this.regular.widthOfTextAtSize(label, 7.5);
      page.drawText(label, {
        x: this.size[0] - this.margin - width,
        y: this.margin / 2,
        size: 7.5,
        font: this.regular,
        color: MUTED,
      });
      if (footerLeft)
        page.drawText(pdfSafe(footerLeft), {
          x: this.margin,
          y: this.margin / 2,
          size: 7.5,
          font: this.regular,
          color: MUTED,
        });
    });
    return this.doc.save();
  }
}
