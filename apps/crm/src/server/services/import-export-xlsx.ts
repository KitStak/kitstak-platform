/**
 * Safe, dependency-free XLSX reader for imports (server only: uses node:zlib).
 *
 * Hardening:
 * - Zip is read from the central directory; entry names are matched exactly, never written
 *   to disk (no zip-slip). Only the handful of parts we need are inflated.
 * - Every inflate is capped (`maxOutputLength`) and the total uncompressed budget is bounded,
 *   so zip bombs fail fast with a clear message.
 * - XML is scanned with bounded regular expressions; DTDs/entities are never expanded (no XXE),
 *   only the five predefined entities and numeric character references are decoded.
 */
import 'server-only';
import { inflateRawSync } from 'node:zlib';

export class SpreadsheetReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetReadError';
  }
}

export interface ParsedSheet {
  readonly name: string;
  readonly rows: string[][];
  readonly totalRows: number;
  readonly truncated: boolean;
}

export interface XlsxReadOptions {
  readonly maxRows: number;
  readonly maxColumns: number;
  /** Total uncompressed bytes allowed across all inflated parts. */
  readonly maxUncompressedBytes?: number;
}

interface CentralEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

function readCentralDirectory(buf: Buffer): Map<string, CentralEntry> {
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let index = buf.length - 22; index >= min; index -= 1) {
    if (buf.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetReadError("This isn't a valid .xlsx workbook. Save it again from Excel or export it as CSV.");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count > 5_000) throw new SpreadsheetReadError('This workbook has too many parts to import.');
  const entries = new Map<string, CentralEntry>();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new SpreadsheetReadError("This workbook appears to be damaged. Save it again from Excel or export it as CSV.");
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

class PartReader {
  private budget: number;
  constructor(
    private readonly buf: Buffer,
    private readonly entries: Map<string, CentralEntry>,
    maxBytes: number,
  ) {
    this.budget = maxBytes;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): string | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const { buf } = this;
    const at = entry.localOffset;
    if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) {
      throw new SpreadsheetReadError("This workbook appears to be damaged. Save it again from Excel or export it as CSV.");
    }
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const raw = buf.subarray(start, start + entry.compressedSize);
    let data: Buffer;
    if (entry.method === 0) data = raw;
    else if (entry.method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, this.budget) });
      } catch {
        throw new SpreadsheetReadError('This workbook is too large to import. Split it into smaller files.');
      }
    } else throw new SpreadsheetReadError('This workbook uses an unsupported compression method.');
    this.budget -= data.length;
    if (this.budget < 0) {
      throw new SpreadsheetReadError('This workbook is too large to import. Split it into smaller files.');
    }
    return data.toString('utf8');
  }
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (match, body: string) => {
    if (body.startsWith('#x')) return safeCodePoint(Number.parseInt(body.slice(2), 16), match);
    if (body.startsWith('#')) return safeCodePoint(Number.parseInt(body.slice(1), 10), match);
    return ENTITY[body] ?? match;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback;
  return String.fromCodePoint(code);
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeXmlText(match[1] as string) : undefined;
}

/** Concatenate every <t>…</t> run (handles rich text in shared strings). */
function textRuns(xml: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) out += decodeXmlText(match[1] ?? '');
  return out;
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) out.push(textRuns(match[1] ?? ''));
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Style index → is a date format. */
function dateStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  const fmtRe = /<numFmt\s[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = fmtRe.exec(xml))) {
    const id = Number(attr(match[0], 'numFmtId'));
    const code = attr(match[0], 'formatCode') ?? '';
    custom.set(id, code);
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const out: boolean[] = [];
  const xfRe = /<xf\s[^>]*?\/?>/g;
  while ((match = xfRe.exec(cellXfs))) {
    const id = Number(attr(match[0], 'numFmtId') ?? '0');
    const code = custom.get(id);
    const isDate = code
      ? /[dmyh]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^[#0.,% ]+$/.test(code)
      : BUILTIN_DATE_FORMATS.has(id);
    out.push(isDate);
  }
  return out;
}

export function serialToIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86_400_000);
  const iso = new Date(ms).toISOString();
  const hasTime = Math.abs(serial - Math.floor(serial)) > 1e-9;
  return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const char of letters) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

function formatNumber(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  // Avoid binary float noise like 0.30000000000000004.
  return String(Number.parseFloat(value.toPrecision(15)));
}

function parseSheet(
  xml: string,
  strings: readonly string[],
  isDate: readonly boolean[],
  date1904: boolean,
  options: XlsxReadOptions,
): { rows: string[][]; totalRows: number } {
  const rows: string[][] = [];
  let totalRows = 0;
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  const cellRe = /<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells: string[] = [];
    const body = rowMatch[1] ?? '';
    let cellMatch: RegExpExecArray | null;
    let next = 0;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(body))) {
      const tag = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';
      const ref = attr(tag, 'r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      if (col < 0 || col >= options.maxColumns) continue;
      const type = attr(tag, 't') ?? 'n';
      const style = Number(attr(tag, 's') ?? '0');
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textRuns(inner);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = decodeXmlText(v ?? '');
      else if (v !== undefined) {
        value = isDate[style] ? (serialToIso(Number(v), date1904) ?? formatNumber(v)) : formatNumber(v);
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    if (cells.every((cell) => cell.trim() === '')) continue;
    totalRows += 1;
    if (rows.length < options.maxRows) rows.push(cells);
  }
  return { rows, totalRows };
}

function resolveTarget(target: string): string {
  const clean = target.replace(/^\//, '');
  return clean.startsWith('xl/') ? clean : `xl/${clean}`;
}

/** Read every worksheet of an .xlsx file into string rows. */
export function readXlsx(input: Uint8Array, options: XlsxReadOptions): ParsedSheet[] {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const entries = readCentralDirectory(buf);
  const reader = new PartReader(buf, entries, options.maxUncompressedBytes ?? 200 * 1024 * 1024);
  const workbook = reader.read('xl/workbook.xml');
  if (!workbook) throw new SpreadsheetReadError("This isn't a valid .xlsx workbook. Save it again from Excel or export it as CSV.");
  const rels = reader.read('xl/_rels/workbook.xml.rels') ?? '';
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(match[0], 'Id');
    const target = attr(match[0], 'Target');
    if (id && target) targets.set(id, resolveTarget(target));
  }
  const date1904 = /<workbookPr\s[^>]*date1904="(1|true)"/.test(workbook);
  const strings = sharedStrings(reader.read('xl/sharedStrings.xml'));
  const isDate = dateStyles(reader.read('xl/styles.xml'));

  const sheets: ParsedSheet[] = [];
  const sheetTags = [...workbook.matchAll(/<sheet\s[^>]*>/g)].slice(0, 50);
  sheetTags.forEach((match, index) => {
    const name = attr(match[0], 'name') ?? `Sheet${index + 1}`;
    const relId = attr(match[0], 'r:id');
    const path = (relId && targets.get(relId)) || `xl/worksheets/sheet${index + 1}.xml`;
    if (!reader.has(path)) return;
    const xml = reader.read(path) ?? '';
    const { rows, totalRows } = parseSheet(xml, strings, isDate, date1904, options);
    sheets.push({ name, rows, totalRows, truncated: totalRows > rows.length });
  });
  if (sheets.length === 0) throw new SpreadsheetReadError("We couldn't find any sheets in this workbook.");
  return sheets;
}
