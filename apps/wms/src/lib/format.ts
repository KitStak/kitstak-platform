/**
 * Display formatting (BUILD_PLAN 0.1 / F4.1). Every function takes optional user
 * preferences; `<FormatProvider>` + `useFormat()` bind them for components.
 *
 *   date-time   default "M/D/YYYY h:mm:ss A" (Logiwa parity); tokens below
 *   input       "YYYY/MM/DD HH:mm" (pickers)
 *   money       grid "66.03 USD", summary rail "$66.03"
 *   quantity    integer, grouped ("1,025" or "1.025")
 *   weight      "1.5 lb"; age "16d"
 *
 * Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm m ss s A a. Text inside
 * [brackets] is literal.
 */
import * as React from "react";

export interface FormatPreferences {
  readonly dateFormat: string;
  readonly timeFormat: "12h" | "24h";
  readonly numberFormat: "1,025.00" | "1.025,00";
}

export const DEFAULT_DATETIME_FORMAT = "M/D/YYYY h:mm:ss A";
export const INPUT_DATETIME_FORMAT = "YYYY/MM/DD HH:mm";
export const INPUT_DATE_FORMAT = "YYYY/MM/DD";
export const INPUT_TIME_FORMAT = "HH:mm";
export const EMPTY_VALUE = "—";

export const DEFAULT_FORMAT_PREFERENCES: FormatPreferences = {
  dateFormat: DEFAULT_DATETIME_FORMAT,
  timeFormat: "12h",
  numberFormat: "1,025.00",
};

type DateInput = string | number | Date | null | undefined;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const TOKEN_RE = /\[([^\]]*)]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g;

export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    // A bare calendar date ("YYYY-MM-DD") is a local date, not UTC midnight.
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
    if (m) {
      const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(local.getTime()) ? null : local;
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

function tokenValue(token: string, d: Date): string {
  const hours = d.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  switch (token) {
    case "YYYY": return String(d.getFullYear());
    case "YY": return pad(d.getFullYear() % 100);
    case "MMMM": return MONTHS[d.getMonth()] ?? "";
    case "MMM": return (MONTHS[d.getMonth()] ?? "").slice(0, 3);
    case "MM": return pad(d.getMonth() + 1);
    case "M": return String(d.getMonth() + 1);
    case "DD": return pad(d.getDate());
    case "D": return String(d.getDate());
    case "dddd": return WEEKDAYS[d.getDay()] ?? "";
    case "ddd": return (WEEKDAYS[d.getDay()] ?? "").slice(0, 3);
    case "HH": return pad(hours);
    case "H": return String(hours);
    case "hh": return pad(h12);
    case "h": return String(h12);
    case "mm": return pad(d.getMinutes());
    case "m": return String(d.getMinutes());
    case "ss": return pad(d.getSeconds());
    case "s": return String(d.getSeconds());
    case "A": return hours < 12 ? "AM" : "PM";
    case "a": return hours < 12 ? "am" : "pm";
    default: return token;
  }
}

/** Formats with a token pattern (local time). Invalid / empty input → "—". */
export function formatPattern(value: DateInput, pattern: string): string {
  const d = toDate(value);
  if (!d) return EMPTY_VALUE;
  return pattern.replace(TOKEN_RE, (match, literal: string | undefined) => (literal !== undefined ? literal : tokenValue(match, d)));
}

/** Applies the 24h preference to a 12h pattern ("h:mm:ss A" → "HH:mm:ss"). */
function applyTimeFormat(pattern: string, timeFormat: FormatPreferences["timeFormat"]): string {
  if (timeFormat === "12h") return pattern;
  return pattern.replace(/\s*\b[Aa]\b/g, "").replace(/hh?/g, "HH");
}

function splitDatePart(pattern: string): string {
  const idx = pattern.search(/\s+[Hh]/);
  return idx > 0 ? pattern.slice(0, idx) : pattern;
}

export function formatDateTime(value: DateInput, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  return formatPattern(value, applyTimeFormat(prefs.dateFormat, prefs.timeFormat));
}

/**
 * Grid cells: the user's pattern without seconds and with zero-padded month/day, so a
 * date column is fixed-width ("11/05/2026 8:49 AM") and fits a 156px column.
 */
export function gridDateTimePattern(pattern: string): string {
  return pattern
    .replace(/[:.]s{1,2}/g, "")
    .replace(/(^|[^M])M(?!M)/g, "$1MM")
    .replace(/(^|[^D])D(?!D)/g, "$1DD");
}

export function formatGridDateTime(value: DateInput, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  return formatPattern(value, applyTimeFormat(gridDateTimePattern(prefs.dateFormat), prefs.timeFormat));
}

export function formatDate(value: DateInput, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  return formatPattern(value, splitDatePart(prefs.dateFormat));
}

export function formatTime(value: DateInput, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  return formatPattern(value, prefs.timeFormat === "24h" ? "HH:mm" : "h:mm A");
}

/** Picker display value, `YYYY/MM/DD HH:mm`. */
export function formatInputDateTime(value: DateInput): string {
  const d = toDate(value);
  return d ? formatPattern(d, INPUT_DATETIME_FORMAT) : "";
}

const INPUT_RE = /^\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/;

/** Parses `YYYY/MM/DD[ HH:mm]` (also `-` separators) as local time; null if invalid. */
export function parseInputDateTime(text: string): Date | null {
  const m = INPUT_RE.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0"].map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  return d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

/* ---------------- numbers ---------------- */

function numberLocale(prefs: FormatPreferences): string {
  return prefs.numberFormat === "1.025,00" ? "de-DE" : "en-US";
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function numberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, fmt);
  }
  return fmt;
}

const isNum = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export function formatNumber(value: number | null | undefined, decimals?: number, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  if (!isNum(value)) return EMPTY_VALUE;
  const options: Intl.NumberFormatOptions = decimals === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return numberFormatter(numberLocale(prefs), options).format(value);
}

/** Quantities are integers in the UOM (primary) unit. */
export function formatQuantity(value: number | null | undefined, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  return isNum(value) ? formatNumber(Math.round(value), 0, prefs) : EMPTY_VALUE;
}

export type MoneyStyle = "grid" | "summary";

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { USD: "$", CAD: "CA$", AUD: "A$", EUR: "€", GBP: "£", MXN: "MX$", INR: "₹", NZD: "NZ$", SGD: "S$" };

/** grid → "66.03 USD"; summary → "$66.03" (symbol, or code prefix when unknown). */
export function formatMoney(value: number | null | undefined, currency = "USD", style: MoneyStyle = "grid", prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  if (!isNum(value)) return EMPTY_VALUE;
  const amount = formatNumber(Math.round(value * 100) / 100, 2, prefs);
  if (style === "grid") return `${amount} ${currency}`;
  const symbol = CURRENCY_SYMBOLS[currency];
  const negative = value < 0;
  const abs = amount.replace(/^-/, "");
  return `${negative ? "-" : ""}${symbol ?? `${currency} `}${abs}`;
}

export function formatPercent(value: number | null | undefined, decimals = 0, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  return isNum(value) ? `${formatNumber(value, decimals, prefs)}%` : EMPTY_VALUE;
}

const UNIT_ABBREVIATIONS: Readonly<Record<string, string>> = {
  Pound: "lb", Ounce: "oz", Kilogram: "kg", Gram: "g",
  Inch: "in", Foot: "ft", Centimeter: "cm", Meter: "m",
  "Cubic Inch": "in³", "Cubic Meter": "m³", "Cubic Foot": "ft³", Liter: "L", Gallon: "gal", "Cubic Centimeter": "cm³",
};

export function unitAbbreviation(unit: string): string {
  return UNIT_ABBREVIATIONS[unit] ?? unit;
}

/** "1.5 lb". Accepts enum names ("Pound") or abbreviations. */
export function formatMeasure(value: number | null | undefined, unit: string, decimals?: number, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  return isNum(value) ? `${formatNumber(value, decimals, prefs)} ${unitAbbreviation(unit)}` : EMPTY_VALUE;
}

export const formatWeight = formatMeasure;

/** "L × W × H in". */
export function formatDimensions(l: number | null | undefined, w: number | null | undefined, h: number | null | undefined, unit: string, prefs: FormatPreferences = DEFAULT_FORMAT_PREFERENCES): string {
  if (!isNum(l) || !isNum(w) || !isNum(h)) return EMPTY_VALUE;
  return `${formatNumber(l, undefined, prefs)} × ${formatNumber(w, undefined, prefs)} × ${formatNumber(h, undefined, prefs)} ${unitAbbreviation(unit)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age: "now", "45m", "3h", "16d" (future dates are prefixed "in "). */
export function formatAge(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return EMPTY_VALUE;
  const diff = now.getTime() - d.getTime();
  const abs = Math.abs(diff);
  const text = abs < MINUTE ? "now" : abs < HOUR ? `${Math.floor(abs / MINUTE)}m` : abs < DAY ? `${Math.floor(abs / HOUR)}h` : `${Math.floor(abs / DAY)}d`;
  return diff < 0 && text !== "now" ? `in ${text}` : text;
}

/** Long relative text for tooltips: "3 hours ago". */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return EMPTY_VALUE;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  return rtf.format(Math.round(diff / DAY), "day");
}

/* ---------------- React binding ---------------- */

export interface Formatter {
  readonly prefs: FormatPreferences;
  readonly dateTime: (value: DateInput) => string;
  /** Compact grid form: no seconds, padded month/day. */
  readonly gridDateTime: (value: DateInput) => string;
  readonly date: (value: DateInput) => string;
  readonly time: (value: DateInput) => string;
  readonly number: (value: number | null | undefined, decimals?: number) => string;
  readonly quantity: (value: number | null | undefined) => string;
  readonly money: (value: number | null | undefined, currency?: string, style?: MoneyStyle) => string;
  readonly percent: (value: number | null | undefined, decimals?: number) => string;
  readonly measure: (value: number | null | undefined, unit: string, decimals?: number) => string;
  readonly age: (value: DateInput) => string;
}

export function createFormatter(prefs: Partial<FormatPreferences> = {}): Formatter {
  const p: FormatPreferences = {
    dateFormat: prefs.dateFormat ?? DEFAULT_FORMAT_PREFERENCES.dateFormat,
    timeFormat: prefs.timeFormat ?? DEFAULT_FORMAT_PREFERENCES.timeFormat,
    numberFormat: prefs.numberFormat ?? DEFAULT_FORMAT_PREFERENCES.numberFormat,
  };
  return {
    prefs: p,
    dateTime: (v) => formatDateTime(v, p),
    gridDateTime: (v) => formatGridDateTime(v, p),
    date: (v) => formatDate(v, p),
    time: (v) => formatTime(v, p),
    number: (v, d) => formatNumber(v, d, p),
    quantity: (v) => formatQuantity(v, p),
    money: (v, c, s) => formatMoney(v, c, s, p),
    percent: (v, d) => formatPercent(v, d, p),
    measure: (v, u, d) => formatMeasure(v, u, d, p),
    age: (v) => formatAge(v),
  };
}

const FormatContext = React.createContext<Formatter>(createFormatter());

export function FormatProvider({ preferences, children }: { readonly preferences?: Partial<FormatPreferences>; readonly children: React.ReactNode }) {
  const { dateFormat, timeFormat, numberFormat } = preferences ?? {};
  const value = React.useMemo(() => createFormatter({ dateFormat, timeFormat, numberFormat }), [dateFormat, timeFormat, numberFormat]);
  return React.createElement(FormatContext.Provider, { value }, children);
}

export function useFormat(): Formatter {
  return React.useContext(FormatContext);
}
