/**
 * The monthly program report as a PDF file (Letter, portrait), written by hand: the two standard
 * Helvetica fonts (no font files to embed), text, rules and shaded rows. No dependency and no
 * clock, so it is pure and testable. Every cell reads exactly as the report page reads it.
 *
 * Layout: the header (title, subtitle, org, version, built time), the month status, the totals in
 * a grid, each table with its header repeated on every page, then the notes. Each page ends with
 * "KitStak Pulse", the report title and "Page 1 of 2".
 */
import type { ReportCellKind } from '@/lib/types';
import type { ProgramReportDTO, ProgramReportTable } from './program-report';
import { builtWords, cellText, summaryColumns, summaryText } from './program-report-format';

/* ---------------------------------------------------------------- fonts */

/** Glyph widths (1/1000 em) of WinAnsi codes 32 to 255, from the Adobe metrics of the standard fonts. */
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 500, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 556, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556];

type FontId = 'F1' | 'F2';

/** Code points outside Latin 1 that WinAnsi still has. */
const WIN_ANSI_EXTRA: Readonly<Record<number, number>> = { 0x20ac: 0x80, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2026: 0x85 };

/** Text as WinAnsi byte codes. A character the font does not have becomes "?". */
export function winAnsiCodes(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const point = char.codePointAt(0) ?? 63;
    if (point >= 32 && point < 127) out.push(point);
    else if (point >= 160 && point <= 255) out.push(point);
    else if (WIN_ANSI_EXTRA[point] !== undefined) out.push(WIN_ANSI_EXTRA[point]!);
    else if (point === 0x202f || point === 0x2009) out.push(32);
    else out.push(63);
  }
  return out;
}

/** Width of a text in points. */
export function textWidth(text: string, font: FontId, size: number): number {
  const widths = font === 'F2' ? HELVETICA_BOLD : HELVETICA;
  let total = 0;
  for (const code of winAnsiCodes(text)) total += widths[code - 32] || 556;
  return (total * size) / 1000;
}

/** A PDF literal string: parentheses and backslashes escaped, anything past ASCII as an octal escape. */
function pdfString(text: string): string {
  let out = '(';
  for (const code of winAnsiCodes(text)) {
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code < 127) out += String.fromCharCode(code);
    else out += `\\${code.toString(8).padStart(3, '0')}`;
  }
  return `${out})`;
}

/** Cuts a text to fit `max` points, ending in "...". */
function fit(text: string, font: FontId, size: number, max: number): string {
  if (textWidth(text, font, size) <= max) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, font, size) > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/* ---------------------------------------------------------------- pages */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 56;

type Rgb = readonly [number, number, number];
const INK: Rgb = [0.086, 0.094, 0.114];
const MUTED: Rgb = [0.333, 0.357, 0.4];
const FAINT: Rgb = [0.541, 0.561, 0.6];
const RULE: Rgb = [0.89, 0.898, 0.918];
const SHADE: Rgb = [0.961, 0.965, 0.973];
const CAUTION_FILL: Rgb = [0.992, 0.973, 0.902];
const CAUTION_LINE: Rgb = [0.788, 0.635, 0.153];

const rgb = (color: Rgb): string => color.map((value) => value.toFixed(3)).join(' ');
const n = (value: number): string => (Math.round(value * 100) / 100).toString();

class Pages {
  readonly pages: string[][] = [];
  y = 0;

  constructor() {
    this.add();
  }

  private get ops(): string[] {
    return this.pages[this.pages.length - 1]!;
  }

  add(): void {
    this.pages.push([]);
    this.y = PAGE_H - MARGIN;
  }

  /** Starts a new page when fewer than `height` points are left. True when it did. */
  room(height: number): boolean {
    if (this.y - height >= BOTTOM) return false;
    this.add();
    return true;
  }

  text(x: number, y: number, text: string, font: FontId, size: number, color: Rgb = INK, align: 'left' | 'right' = 'left'): void {
    const left = align === 'right' ? x - textWidth(text, font, size) : x;
    this.ops.push(`BT /${font} ${n(size)} Tf ${rgb(color)} rg ${n(left)} ${n(y)} Td ${pdfString(text)} Tj ET`);
  }

  rule(x1: number, y: number, x2: number, width: number, color: Rgb = RULE): void {
    this.ops.push(`${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(y)} m ${n(x2)} ${n(y)} l S`);
  }

  box(x: number, y: number, w: number, h: number, fill: Rgb, stroke?: Rgb): void {
    this.ops.push(`${rgb(fill)} rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
    if (stroke) this.ops.push(`${rgb(stroke)} RG 0.75 w ${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`);
  }
}

const NUMERIC: ReadonlySet<ReportCellKind> = new Set<ReportCellKind>(['money', 'percent', 'number', 'hours', 'pace']);

/** Column widths that fit the page: numbers as wide as their widest text, the first column takes the rest. */
function layoutColumns(table: ProgramReportTable, size: number): { widths: number[]; size: number } {
  const texts = (key: string, kind: ReportCellKind): string[] => [
    ...table.rows.map((row) => cellText(row.cells[key] ?? null, kind)),
    table.total ? cellText(table.total[key] ?? null, kind) : '',
  ];
  const pad = 12;
  let widths = table.columns.map((column, index) => {
    const header = textWidth(column.label, 'F2', size - 1);
    const body = Math.max(0, ...texts(column.key, column.kind).map((text) => textWidth(text, index === 0 ? 'F1' : 'F2', size)));
    return Math.max(header, body) + pad;
  });
  const first = widths[0] ?? 0;
  const rest = widths.slice(1).reduce((sum, width) => sum + width, 0);
  if (rest + Math.min(first, 120) > CONTENT_W && size > 7) return layoutColumns(table, size - 0.5);
  const firstWidth = Math.max(Math.min(first, CONTENT_W - rest), Math.min(first, 120));
  widths = [firstWidth, ...widths.slice(1)];
  // Spread what is left over the number columns, so the table spans the page.
  // A narrow table keeps its numbers close together and gives the rest to the first column.
  const spare = CONTENT_W - widths.reduce((sum, width) => sum + width, 0);
  if (spare > 0 && widths.length > 1) {
    const extra = Math.min(spare / (widths.length - 1), 36);
    const left = spare - extra * (widths.length - 1);
    widths = widths.map((width, index) => (index === 0 ? width + left : width + extra));
  }
  return { widths, size };
}

function drawTable(pages: Pages, table: ProgramReportTable): void {
  const { widths, size } = layoutColumns(table, 9);
  const rowH = size + 7;
  const xs: number[] = [];
  let x = MARGIN;
  for (const width of widths) {
    xs.push(x);
    x += width;
  }
  const cellX = (index: number): number => (NUMERIC.has(table.columns[index]!.kind) ? xs[index]! + widths[index]! - 6 : xs[index]! + (index === 0 ? 0 : 6));
  const header = (): void => {
    pages.text(MARGIN, pages.y - 12, table.title, 'F2', 11);
    pages.y -= 24;
    table.columns.forEach((column, index) => pages.text(cellX(index), pages.y - size + 1, fit(column.label, 'F2', size - 1, widths[index]! - 8), 'F2', size - 1, MUTED, NUMERIC.has(column.kind) ? 'right' : 'left'));
    pages.y -= rowH;
    pages.rule(MARGIN, pages.y + 2, MARGIN + CONTENT_W, 0.9, INK);
  };
  pages.room(24 + rowH * 3);
  header();
  if (table.rows.length === 0) {
    pages.text(MARGIN, pages.y - size - 2, 'Nothing this month.', 'F1', size, MUTED);
    pages.y -= rowH + 4;
    return;
  }
  table.rows.forEach((row, rowIndex) => {
    if (pages.room(rowH)) header();
    if (rowIndex % 2 === 1) pages.box(MARGIN, pages.y - rowH + 2, CONTENT_W, rowH, SHADE);
    table.columns.forEach((column, index) => {
      const text = cellText(row.cells[column.key] ?? null, column.kind);
      pages.text(cellX(index), pages.y - size - 1, index === 0 ? fit(text, 'F1', size, widths[0]! - 6) : text, 'F1', size, INK, NUMERIC.has(column.kind) ? 'right' : 'left');
    });
    pages.y -= rowH;
  });
  if (table.total) {
    if (pages.room(rowH + 4)) header();
    pages.rule(MARGIN, pages.y + 2, MARGIN + CONTENT_W, 1.2, INK);
    pages.y -= 2;
    table.columns.forEach((column, index) => {
      const text = cellText(table.total?.[column.key] ?? null, column.kind);
      pages.text(cellX(index), pages.y - size - 1, index === 0 ? fit(text, 'F2', size, widths[0]! - 6) : text, 'F2', size, INK, NUMERIC.has(column.kind) ? 'right' : 'left');
    });
    pages.y -= rowH;
  }
  pages.y -= 14;
}

/** Wraps a sentence into lines of at most `max` points. */
function wrap(text: string, font: FontId, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, font, size) > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function layout(report: ProgramReportDTO, orgName: string): string[][] {
  const pages = new Pages();
  // Header
  pages.text(MARGIN, pages.y - 18, report.title, 'F2', 18);
  pages.text(MARGIN, pages.y - 36, fit(report.subtitle, 'F1', 10, CONTENT_W - 190), 'F1', 10, MUTED);
  const right = MARGIN + CONTENT_W;
  pages.text(right, pages.y - 12, fit(orgName, 'F1', 9, 180), 'F1', 9, MUTED, 'right');
  pages.text(right, pages.y - 24, [report.versionLabel, report.cardLabel].filter(Boolean).join(', '), 'F1', 9, MUTED, 'right');
  pages.text(right, pages.y - 36, `Built ${builtWords(report.generatedAt)}`, 'F1', 9, MUTED, 'right');
  pages.y -= 46;
  pages.rule(MARGIN, pages.y, right, 1.5, INK);
  pages.y -= 12;
  // Month status
  pages.box(MARGIN, pages.y - 22, CONTENT_W, 22, report.final ? SHADE : CAUTION_FILL, report.final ? RULE : CAUTION_LINE);
  pages.text(MARGIN + 10, pages.y - 15, report.statusNote, 'F2', 9.5);
  pages.y -= 38;
  // Totals: up to four across, never one alone on a row
  const across = summaryColumns(report.summary.length);
  const cell = CONTENT_W / across;
  report.summary.forEach((item, index) => {
    const column = index % across;
    if (column === 0 && index > 0) pages.y -= 46;
    const x = MARGIN + column * cell;
    pages.text(x, pages.y - 8, item.label.toUpperCase(), 'F1', 7.5, MUTED);
    pages.text(x, pages.y - 24, fit(summaryText(item), 'F2', 14, cell - 10), 'F2', 14);
    if (item.note) pages.text(x, pages.y - 36, fit(item.note, 'F1', 7.5, cell - 10), 'F1', 7.5, MUTED);
  });
  pages.y -= 62;
  for (const table of report.tables) drawTable(pages, table);
  if (report.notes.length > 0) {
    pages.room(40);
    pages.text(MARGIN, pages.y - 12, 'Notes', 'F2', 11);
    pages.y -= 26;
    for (const note of report.notes) {
      for (const [index, line] of wrap(note, 'F1', 9, CONTENT_W - 12).entries()) {
        pages.room(13);
        if (index === 0) pages.text(MARGIN, pages.y - 9, '-', 'F1', 9, MUTED);
        pages.text(MARGIN + 10, pages.y - 9, line, 'F1', 9);
        pages.y -= 13;
      }
      pages.y -= 2;
    }
  }
  // Footer on every page
  const total = pages.pages.length;
  pages.pages.forEach((ops, index) => {
    const footer = `KitStak Pulse, ${report.title}, ${report.monthLabel}`;
    ops.push(`${rgb(RULE)} RG 0.75 w ${MARGIN} 40 m ${right} 40 l S`);
    ops.push(`BT /F1 8 Tf ${rgb(FAINT)} rg ${MARGIN} 28 Td ${pdfString(footer)} Tj ET`);
    const page = `Page ${index + 1} of ${total}`;
    ops.push(`BT /F1 8 Tf ${rgb(FAINT)} rg ${n(right - textWidth(page, 'F1', 8))} 28 Td ${pdfString(page)} Tj ET`);
  });
  return pages.pages;
}

/** The report as PDF bytes. */
export function programReportToPdf(report: ProgramReportDTO, options: { readonly orgName: string }): Uint8Array {
  const pages = layout(report, options.orgName);
  const objects: string[] = [];
  // 1 catalog, 2 pages, 3 and 4 fonts, 5 info, then a page and its content per page.
  const pageIds = pages.map((_, index) => 6 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title ${pdfString(`${report.title}, ${report.monthLabel}`)} /Producer (KitStak Pulse) >>`;
  pages.forEach((ops, index) => {
    const id = pageIds[index]!;
    const stream = ops.join('\n');
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  // Every byte is ASCII (pdfString escapes the rest), so string length is byte length.
  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  const bytesOf = (text: string): number => {
    let count = 0;
    for (const char of text) count += (char.codePointAt(0) ?? 0) > 127 ? 2 : 1;
    return count;
  };
  let length = bytesOf(body);
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = length;
    const chunk = `${id} 0 obj\n${objects[id]}\nendobj\n`;
    body += chunk;
    length += chunk.length;
  }
  const xref = [`xref`, `0 ${objects.length}`, '0000000000 65535 f ', ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)].join('\n');
  body += `${xref}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
