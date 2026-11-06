/**
 * Locale-tolerant parsers for spreadsheet values: dates (with day/month order detection),
 * numbers, currency, booleans, emails, phones and links. Pure; shared by inference,
 * conversion and validation.
 */

export type DateOrder = 'ymd' | 'mdy' | 'dmy';

export interface ParsedDate {
  readonly date: string;
  readonly time?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12,
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function fullYear(year: number): number {
  if (year >= 100) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

function build(year: number, month: number, day: number, time?: string): ParsedDate | null {
  const y = fullYear(year);
  if (y < 1000 || y > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(y, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const date = `${y}-${pad(month)}-${pad(day)}`;
  return time ? { date, time } : { date };
}

function parseTime(rest: string | undefined): string | undefined {
  if (!rest) return undefined;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?/i.exec(rest.trim());
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return hours === 0 && minutes === 0 && !meridiem ? undefined : `${pad(hours)}:${pad(minutes)}`;
}

/** Parse a date using the column's detected day/month order. Returns null when unparseable. */
export function parseDate(raw: string, order: DateOrder = 'mdy'): ParsedDate | null {
  const value = raw.trim();
  if (!value) return null;
  // ISO / year-first: 2024-03-05, 2024/3/5, 2024-03-05T10:30:00Z, 2024-03-05 10:30
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](.*))?$/.exec(value);
  if (match) return build(Number(match[1]), Number(match[2]), Number(match[3]), parseTime(match[4]));
  // Numeric with day/month ambiguity: 03/05/2024, 3.5.24, 05-03-2024
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s,]+(.*))?$/.exec(value);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = Number(match[3]);
    const time = parseTime(match[4]);
    if (order === 'dmy') return build(year, b, a, time);
    return build(year, a, b, time);
  }
  // Month names: Mar 5, 2024 · March 5 2024 · 5 Mar 2024 · 5-Mar-24
  match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})(?:[\s,]+(.*))?$/.exec(value);
  if (match) {
    const month = MONTHS[(match[1] as string).toLowerCase()];
    if (month) return build(Number(match[3]), month, Number(match[2]), parseTime(match[4]));
  }
  match = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?[\s,-]+(\d{2,4})(?:[\s,]+(.*))?$/.exec(value);
  if (match) {
    const month = MONTHS[(match[2] as string).toLowerCase()];
    if (month) return build(Number(match[3]), month, Number(match[1]), parseTime(match[4]));
  }
  return null;
}

/** Decide month/day order from sample values (a first part > 12 means day-first). */
export function detectDateOrder(samples: readonly string[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  let yearFirst = 0;
  for (const sample of samples) {
    const value = sample.trim();
    if (/^\d{4}[-/.]/.test(value)) {
      yearFirst += 1;
      continue;
    }
    const match = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(value);
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst += 1;
    else if (Number(match[2]) > 12) monthFirst += 1;
  }
  if (dayFirst > monthFirst) return 'dmy';
  if (monthFirst === 0 && dayFirst === 0 && yearFirst > 0) return 'ymd';
  return 'mdy';
}

export function dateOrderLabel(order: DateOrder): string {
  return order === 'dmy' ? 'DD/MM/YYYY' : order === 'ymd' ? 'YYYY-MM-DD' : 'MM/DD/YYYY';
}

/** Parse "1,234.56", "1.234,56", "(1,200)", "12%", "1 234". Returns null when not a number. */
export function parseNumber(raw: string): number | null {
  let value = raw.trim().replace(/[\s  ]/g, '');
  if (!value) return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/%$/, '');
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith('+')) value = value.slice(1);
  if (!/^[\d.,']+$/.test(value) || !/\d/.test(value)) return null;
  value = value.replace(/'/g, '');
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    value = lastComma > lastDot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (lastComma > -1) {
    const decimals = value.length - lastComma - 1;
    const groups = value.split(',');
    // "1,234" / "12,345,678" are thousands; "12,5" is a decimal comma.
    const thousands = decimals === 3 && groups.slice(1).every((group) => group.length === 3);
    value = thousands ? value.replace(/,/g, '') : groups.length === 2 ? value.replace(',', '.') : '';
  } else if (lastDot > -1 && value.split('.').length > 2) {
    value = value.replace(/\./g, '');
  }
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

const SYMBOLS: Record<string, string> = {
  $: 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'C$': 'CAD', 'A$': 'AUD',
  'CA$': 'CAD', 'AU$': 'AUD', '₩': 'KRW', 'R$': 'BRL', 'CHF': 'CHF', 'kr': 'SEK', '₪': 'ILS', 'zł': 'PLN',
};

export interface ParsedCurrency {
  readonly amount: number;
  readonly currency?: string;
  readonly hadSymbol: boolean;
}

/** Parse "$1,200", "€ 950,50", "1200 USD", "USD 1,200". */
export function parseCurrency(raw: string): ParsedCurrency | null {
  const value = raw.trim();
  if (!value) return null;
  const match = /^(-?)\s*([A-Z]{3}|[A-Z]{0,2}[$€£¥₹₩₪]|R\$|zł|kr|CHF)?\s*(-?[\d.,'\s()]+?)\s*([A-Z]{3}|[$€£¥₹₩₪]|zł|kr)?$/.exec(
    value,
  );
  if (!match) return null;
  const amount = parseNumber(`${match[1] ?? ''}${match[3] ?? ''}`);
  if (amount === null) return null;
  const token = match[2] ?? match[4];
  const currency = token ? (SYMBOLS[token] ?? (/^[A-Z]{3}$/.test(token) ? token : undefined)) : undefined;
  return { amount, currency, hadSymbol: Boolean(token) };
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'x', '✓', '✔', 'checked', 'done', 'on']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'unchecked', 'off', '-']);

export function parseBoolean(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(value) || value === '1') return true;
  if (FALSE_WORDS.has(value) || value === '0' || value === '') return false;
  return null;
}

export function isBooleanWord(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return TRUE_WORDS.has(value) || FALSE_WORDS.has(value);
}

const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[A-Za-z]{2,}$/;

/** Extract an email from "jane@x.com" or "Jane Doe <jane@x.com>". */
export function parseEmail(raw: string): { email: string; label?: string } | null {
  const value = raw.trim().replace(/^mailto:/i, '');
  if (EMAIL.test(value)) return { email: value.toLowerCase() };
  const match = /^"?([^"<]*)"?\s*<([^>]+)>$/.exec(value);
  if (match && EMAIL.test((match[2] as string).trim())) {
    const label = (match[1] as string).trim();
    return label ? { email: (match[2] as string).trim().toLowerCase(), label } : { email: (match[2] as string).trim().toLowerCase() };
  }
  return null;
}

export function parsePhone(raw: string): string | null {
  const value = raw.trim().replace(/^tel:/i, '').replace(/\s*(ext\.?|x)\s*\d+$/i, '');
  if (!/^\+?[0-9 ().-]{7,32}$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return value.replace(/\s+/g, ' ');
}

export function parseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : /^www\./i.test(value) ? `https://${value}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Split multi-value cells ("a, b; c"). */
export function splitList(raw: string): string[] {
  return raw
    .split(/[,;\n|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
