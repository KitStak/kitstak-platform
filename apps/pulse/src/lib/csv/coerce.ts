/**
 * Cell readers: turn the text of one CSV cell into a typed value, or say what is wrong in plain
 * words. Every reader takes trimmed, non empty text and returns `{ ok: true, value }` or
 * `{ ok: false, message }`. The message completes the sentence "Row 14, labor_hours: ...".
 */
import { fromScaled, pow10, toScaled } from '../money';
import { isRealDate } from '../profit/calendar';
import { unguardFormula } from './write';

export type Coerced<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export type DateOrder = 'MDY' | 'DMY';
/** Which character marks decimals. `auto` reads both `1,234.50` and `1.234,50`. */
export type DecimalMark = 'auto' | '.' | ',';

const ZERO = BigInt(0);
const NBSP = String.fromCharCode(0xa0);
const NARROW_NBSP = String.fromCharCode(0x202f);
const UNICODE_MINUS = String.fromCharCode(0x2212);
const EN_DASH = String.fromCharCode(0x2013);
/** Zero width characters and a stray byte order mark that spreadsheets sometimes leave in cells. */
const INVISIBLE = new RegExp(`[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0xfeff)}]`, 'g');

const ok = <T>(value: T): Coerced<T> => ({ ok: true, value });
const fail = <T>(message: string): Coerced<T> => ({ ok: false, message });

/** Shortens a long cell for an error message. */
function show(text: string): string {
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

/**
 * Cleans one raw cell: drops invisible characters, turns odd spaces into plain ones, trims, and
 * removes the one leading apostrophe the export formula guard adds.
 */
export function cleanCell(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const text = raw.replace(INVISIBLE, '').split(NBSP).join(' ').split(NARROW_NBSP).join(' ').trim();
  return unguardFormula(text);
}

/* ------------------------------------------------------------------------------------------ */
/* Numbers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * Turns number text with thousands separators into a plain decimal string, or `null` when it is
 * not a number. Reads `1,234.50`, `1.234,50`, `1 234,50`, `1'234.50` and `12,5`.
 */
export function normalizeNumber(text: string, decimal: DecimalMark = 'auto'): string | null {
  let s = text.replace(/[\s']/g, '');
  if (s === '') return null;
  let negative = false;
  if (/^[+-]/.test(s)) {
    negative = s[0] === '-';
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let mark: '.' | ',' | null;
  if (decimal === '.' || decimal === ',') {
    mark = decimal;
  } else if (commas > 0 && dots > 0) {
    mark = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  } else if (commas > 0) {
    // 1,234 is one thousand two hundred thirty four. 0,035 can only be a decimal comma.
    mark = /^[1-9]\d{0,2}(,\d{3})+$/.test(s) ? '.' : ',';
  } else if (dots > 1) {
    mark = ',';
  } else {
    mark = '.';
  }
  const group = mark === '.' ? ',' : '.';
  const pieces = s.split(mark);
  if (pieces.length > 2) return null;
  const whole = pieces[0] ?? '';
  const fraction = pieces[1] ?? '';
  if (fraction.includes(group)) return null;
  if (whole.includes(group)) {
    const groups = whole.split(group);
    const first = groups[0] ?? '';
    if (first.length < 1 || first.length > 3 || groups.slice(1).some((part) => part.length !== 3)) return null;
  }
  const digits = whole.split(group).join('');
  if (digits === '' && fraction === '') return null;
  const plain = `${digits === '' ? '0' : digits}${fraction === '' ? '' : `.${fraction}`}`;
  return negative && /[1-9]/.test(plain) ? `-${plain}` : plain;
}

export interface NumberOptions {
  /** Decimal places kept. Extra places are rounded. */
  readonly scale: number;
  /** Smallest allowed value, as a plain decimal. Default 0 (no negatives). `null` for no floor. */
  readonly min?: string | null;
  /** The value must be below this. Default 100,000,000. `null` for no ceiling. */
  readonly below?: string | null;
  /** The value must be above zero. */
  readonly positive?: boolean;
  readonly decimal?: DecimalMark;
  /** The word used in the message: "a number", "a price". Default "a number". */
  readonly noun?: string;
}

/** Reads a number into a fixed decimal string such as `"3000.000"`. */
export function parseNumber(text: string, options: NumberOptions): Coerced<string> {
  const plain = normalizeNumber(text, options.decimal);
  if (plain === null) return fail(`${show(text)} is not ${options.noun ?? 'a number'}.`);
  const scaled = toScaled(plain, options.scale);
  const min = options.min === undefined ? '0' : options.min;
  if (options.positive && scaled <= ZERO) return fail(`${show(text)} must be more than zero.`);
  if (min !== null && scaled < toScaled(min, options.scale)) return fail(min === '0' ? `${show(text)} cannot be below zero.` : `${show(text)} is too low. The lowest allowed is ${min}.`);
  const below = options.below === undefined ? '100000000' : options.below;
  if (below !== null && scaled >= toScaled(below, options.scale)) return fail(`${show(text)} is too big. It must be under ${Number(below).toLocaleString('en-US')}.`);
  return ok(fromScaled(scaled, options.scale));
}

/** Reads a whole number. */
export function parseInteger(text: string, options: { min?: number; max?: number; decimal?: DecimalMark } = {}): Coerced<number> {
  const plain = normalizeNumber(text, options.decimal);
  if (plain === null) return fail(`${show(text)} is not a whole number.`);
  if (/\.\d*[1-9]/.test(plain)) return fail(`${show(text)} is not a whole number.`);
  const value = Number(plain.split('.')[0]);
  if (!Number.isSafeInteger(value)) return fail(`${show(text)} is too big.`);
  const min = options.min ?? 0;
  if (value < min) return fail(min === 0 ? `${show(text)} cannot be below zero.` : `${show(text)} is too low. The lowest allowed is ${min}.`);
  if (options.max !== undefined && value > options.max) return fail(`${show(text)} is too big. The most allowed is ${options.max.toLocaleString('en-US')}.`);
  return ok(value);
}

const CURRENCY_NOISE = /(?:[A-Za-z]{0,3}[$€£¥])|(?:\b(?:USD|CAD|EUR|GBP|AUD|MXN)\b)/gi;
const MONEY_LIMIT = pow10(13);

export interface MoneyOptions {
  /** Allow amounts below zero (credits, vendor credits). Default true. */
  readonly allowNegative?: boolean;
  readonly decimal?: DecimalMark;
}

/**
 * Reads money into whole cents. Accepts `1234.5`, `$1,234.50`, `1.234,50 €`, `USD 45`, and
 * `(45.00)`, `-45` or `45-` for negatives. Extra decimal places are rounded to the cent.
 */
export function parseMoney(text: string, options: MoneyOptions = {}): Coerced<bigint> {
  let s = text.split(UNICODE_MINUS).join('-').split(EN_DASH).join('-').replace(CURRENCY_NOISE, '').trim();
  let negative = false;
  const bracket = /^\((.*)\)$/.exec(s);
  if (bracket) {
    negative = true;
    s = (bracket[1] ?? '').replace(CURRENCY_NOISE, '').trim();
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  const plain = normalizeNumber(s, options.decimal);
  if (plain === null || plain.startsWith('-')) return fail(`${show(text)} is not an amount of money.`);
  let cents = toScaled(plain, 2);
  if (negative) cents = -cents;
  if (cents < ZERO && options.allowNegative === false) return fail(`${show(text)} cannot be below zero.`);
  if (cents >= MONEY_LIMIT || cents <= -MONEY_LIMIT) return fail(`${show(text)} is too big.`);
  return ok(cents);
}

/** Reads a per unit price or cost with up to 4 places (`$0.0350`) into a fixed decimal string. Never negative. */
export function parsePrice(text: string, options: { decimal?: DecimalMark } = {}): Coerced<string> {
  const s = text.replace(CURRENCY_NOISE, '').trim();
  const plain = normalizeNumber(s, options.decimal);
  if (plain === null) return fail(`${show(text)} is not a price.`);
  const scaled = toScaled(plain, 4);
  if (scaled < ZERO) return fail(`${show(text)} cannot be below zero.`);
  if (scaled >= toScaled('1000000', 4)) return fail(`${show(text)} is too big. It must be under 1,000,000.`);
  return ok(fromScaled(scaled, 4));
}

/**
 * Reads a percent into basis points. `28` and `28%` both mean 28 percent (2800).
 * Default range: 0 to 1,000 percent.
 */
export function parsePercent(text: string, options: { minBp?: number; maxBp?: number; decimal?: DecimalMark } = {}): Coerced<number> {
  const s = text.replace(/%/g, '').replace(/\bpercent\b|\bpct\b/gi, '').split(UNICODE_MINUS).join('-').trim();
  const plain = normalizeNumber(s, options.decimal);
  if (plain === null) return fail(`${show(text)} is not a percent. Use a number like 28 or 28%.`);
  const bp = Number(toScaled(plain, 2));
  const min = options.minBp ?? 0;
  const max = options.maxBp ?? 100000;
  if (bp < min) return fail(min === 0 ? `${show(text)} cannot be below zero.` : `${show(text)} is too low. The lowest allowed is ${min / 100}%.`);
  if (bp > max) return fail(`${show(text)} is too high. The most allowed is ${max / 100}%.`);
  return ok(bp);
}

/**
 * Reads hours into a fixed decimal string with 2 places. Accepts `7.5`, `7,5`, `7:30`, `7h 30m`,
 * `7.5 hrs`, `90 min` and `7:30:00`.
 */
export function parseHours(text: string, options: { decimal?: DecimalMark; below?: string } = {}): Coerced<string> {
  const s = text.toLowerCase().trim();
  const limit = toScaled(options.below ?? '100000000', 2);
  const done = (scaled: bigint): Coerced<string> => {
    if (scaled < ZERO) return fail(`${show(text)} cannot be below zero.`);
    if (scaled >= limit) return fail(`${show(text)} is too big.`);
    return ok(fromScaled(scaled, 2));
  };
  const minutesToScaled = (hours: bigint, minutes: bigint, seconds: bigint = ZERO): bigint => {
    const totalSeconds = hours * BigInt(3600) + minutes * BigInt(60) + seconds;
    return (totalSeconds * BigInt(100) * BigInt(2) + BigInt(3600)) / (BigInt(3600) * BigInt(2));
  };
  const clock = /^(\d{1,6}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (clock) {
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3] ?? '0');
    if (minutes > 59 || seconds > 59) return fail(`${show(text)} is not a time. Minutes go from 00 to 59.`);
    return done(minutesToScaled(BigInt(clock[1] as string), BigInt(minutes), BigInt(seconds)));
  }
  const words = /^(?:(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minute|minutes))?$/.exec(s);
  if (words && (words[1] !== undefined || words[2] !== undefined)) {
    const hours = words[1] === undefined ? ZERO : toScaled(words[1].replace(',', '.'), 4);
    const minutes = words[2] === undefined ? ZERO : toScaled(words[2].replace(',', '.'), 4);
    // hours x 10000 plus minutes x 10000 / 60, rounded to hours x 100
    const total = hours * BigInt(60) + minutes;
    return done((total * BigInt(2) + BigInt(6000)) / (BigInt(6000) * BigInt(2)));
  }
  const plain = normalizeNumber(s, options.decimal);
  if (plain === null) return fail(`${show(text)} is not a number of hours. Use 7.5 or 7:30.`);
  return done(toScaled(plain, 2));
}

/* ------------------------------------------------------------------------------------------ */
/* Dates                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function fullYear(text: string): number {
  const year = Number(text);
  if (text.length > 2) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

function build(year: number, month: number, day: number): string | null {
  const iso = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  return isRealDate(iso) ? iso : null;
}

/** Excel day serial (1900 date system) to a date. 45000 is 2023-03-15. */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const whole = Math.floor(serial);
  const utc = new Date(Date.UTC(1899, 11, 30) + whole * 86_400_000);
  return `${pad(utc.getUTCFullYear(), 4)}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

export interface DateOptions {
  /** How to read `3/4/2026`: month first (`MDY`, the default) or day first (`DMY`). */
  readonly dateOrder?: DateOrder;
  /** Earliest year allowed. Default 1990. */
  readonly minYear?: number;
  /** Latest year allowed. Default 2100. */
  readonly maxYear?: number;
}

/**
 * Reads a date into `YYYY-MM-DD`. Accepts `2026-11-03`, `2026/11/03`, `20261103`,
 * `11/3/2026` or `3/11/2026` (by `dateOrder`), `11-3-26`, `Nov 3 2026`, `3 Nov 2026`,
 * `November 3rd, 2026`, a date with a time after it, and Excel serial numbers.
 */
export function parseDate(text: string, options: DateOptions = {}): Coerced<string> {
  const order = options.dateOrder ?? 'MDY';
  const minYear = options.minYear ?? 1990;
  const maxYear = options.maxYear ?? 2100;
  const s = text.trim();
  const notDate = (): Coerced<string> => fail(`${show(text)} is not a date. Use a date like 2026-11-03.`);
  const finish = (iso: string | null): Coerced<string> => {
    if (iso === null) return fail(`${show(text)} is not a real date. Check the month and the day.`);
    const year = Number(iso.slice(0, 4));
    if (year < minYear || year > maxYear) return fail(`${show(text)} has the year ${year}. Check the year.`);
    return ok(iso);
  };

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (match) return finish(build(Number(match[1]), Number(match[2]), Number(match[3])));

  match = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (match && Number(match[1]) >= 1900 && Number(match[1]) <= 2200) return finish(build(Number(match[1]), Number(match[2]), Number(match[3])));

  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s.*)?$/.exec(s);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = fullYear(match[3] as string);
    const month = order === 'MDY' ? first : second;
    const day = order === 'MDY' ? second : first;
    const iso = build(year, month, day);
    if (iso === null && build(year, day, month) !== null) {
      return fail(
        order === 'MDY'
          ? `${show(text)} is not a real date when read as month/day/year. If your file has the day first, change the date order.`
          : `${show(text)} is not a real date when read as day/month/year. If your file has the month first, change the date order.`,
      );
    }
    return finish(iso);
  }

  const named = s.replace(/,/g, ' ').replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/[-/.]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  match = /^([a-z]{3,9}) (\d{1,2}) (\d{4}|\d{2})$/.exec(named);
  if (match && MONTHS[match[1] as string]) return finish(build(fullYear(match[3] as string), MONTHS[match[1] as string] as number, Number(match[2])));
  match = /^(\d{1,2}) ([a-z]{3,9}) (\d{4}|\d{2})$/.exec(named);
  if (match && MONTHS[match[2] as string]) return finish(build(fullYear(match[3] as string), MONTHS[match[2] as string] as number, Number(match[1])));

  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial <= 80000) return finish(excelSerialToDate(serial));
  }
  return notDate();
}

/**
 * Looks at a whole column of date cells and says which order they must be in: `DMY` when some
 * first number is above 12, `MDY` when some second number is above 12, `null` when either works
 * or the column disagrees with itself.
 */
export function sniffDateOrder(values: Iterable<string>): DateOrder | null {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of values) {
    const match = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(value);
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (dayFirst === monthFirst) return null;
  return dayFirst ? 'DMY' : 'MDY';
}

/** Reads a month into `YYYY-MM`. Accepts `2026-11`, `2026-11-01`, `11/2026`, `Nov 2026` and `November 2026`. */
export function parseMonth(text: string): Coerced<string> {
  const s = text.trim().toLowerCase();
  const done = (year: number, month: number): Coerced<string> => {
    if (month < 1 || month > 12 || year < 1990 || year > 2100) return fail(`${show(text)} is not a month. Use a month like 2026-11.`);
    return ok(`${pad(year, 4)}-${pad(month)}`);
  };
  let match = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(s);
  if (match) return done(Number(match[1]), Number(match[2]));
  match = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (match) return done(Number(match[2]), Number(match[1]));
  match = /^([a-z]{3,9})[\s,.-]+(\d{4})$/.exec(s);
  if (match && MONTHS[match[1] as string]) return done(Number(match[2]), MONTHS[match[1] as string] as number);
  return fail(`${show(text)} is not a month. Use a month like 2026-11.`);
}

/* ------------------------------------------------------------------------------------------ */
/* Yes and no, lists, text                                                                     */
/* ------------------------------------------------------------------------------------------ */

const TRUE_WORDS = new Set(['yes', 'y', 'true', 't', '1', 'on', 'active']);
const FALSE_WORDS = new Set(['no', 'n', 'false', 'f', '0', 'off', 'inactive']);

/** Reads yes or no: `yes`, `no`, `true`, `false`, `1`, `0` (also `y`, `n`, `on`, `off`). */
export function parseBoolean(text: string): Coerced<boolean> {
  const s = text.trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return ok(true);
  if (FALSE_WORDS.has(s)) return ok(false);
  return fail(`${show(text)} is not yes or no.`);
}

/** Lower case with every run of other characters turned into one underscore: "Per unit" is `per_unit`. */
export function normalizeChoice(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Reads one value out of a fixed list, ignoring case, spaces and punctuation. `aliases` maps
 * other words people use to a value of the list.
 */
export function parseChoice<T extends string>(text: string, values: readonly T[], aliases: Readonly<Record<string, T>> = {}): Coerced<T> {
  const wanted = normalizeChoice(text);
  const direct = values.find((value) => normalizeChoice(value) === wanted);
  if (direct !== undefined) return ok(direct);
  for (const [alias, value] of Object.entries(aliases)) if (normalizeChoice(alias) === wanted) return ok(value);
  return fail(`${show(text)} is not one of: ${values.join(', ')}.`);
}

/** Reads free text. Refuses text over `maxLength` characters (default 2,000). */
export function parseText(text: string, maxLength = 2000): Coerced<string> {
  if (text.length > maxLength) return fail(`This text is longer than ${maxLength.toLocaleString('en-US')} characters.`);
  return ok(text);
}

/** Reads a code such as a job number or a SKU: text with no line breaks, up to 120 characters. */
export function parseCode(text: string, maxLength = 120): Coerced<string> {
  if (/[\r\n]/.test(text)) return fail('A code cannot have a line break in it.');
  if (text.length > maxLength) return fail(`${show(text)} is longer than ${maxLength} characters.`);
  return ok(text);
}

/** Reads an email address, lower cased. */
export function parseEmail(text: string): Coerced<string> {
  const s = text.trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return fail(`${show(text)} is not an email address.`);
  return ok(s);
}
