/**
 * Pure, locale-aware formatting for cell displays (numbers, currency, dates, timelines,
 * relative times, file sizes). Everything takes `now`/`locale` so it is deterministic in tests.
 */

const DAY_MS = 86_400_000;
export const DEFAULT_LOCALE = 'en-US';

// ---------------------------------------------------------------------------------------------
// ISO dates (YYYY-MM-DD, interpreted in local time: a due date is a calendar day, not an instant)
// ---------------------------------------------------------------------------------------------

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole calendar days from `a` to `b` (b - a). */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

export function formatTime(time: string, locale = DEFAULT_LOCALE): string {
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return time;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** "Oct 30" in the current year, "Oct 30, 2025" otherwise. */
export function formatShortDate(date: Date, now: Date, locale = DEFAULT_LOCALE): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export type DateDisplayFormat = 'relative' | 'short' | 'long' | 'iso';

export function formatRelativeDay(date: Date, now: Date, locale = DEFAULT_LOCALE): string {
  const diff = dayDiff(now, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return date.toLocaleDateString(locale, { weekday: 'long' });
  if (diff < -1 && diff > -7) return `${-diff} days ago`;
  return formatShortDate(date, now, locale);
}

export function formatDateValue(
  value: { readonly date: string; readonly time?: string },
  now: Date,
  format: DateDisplayFormat = 'short',
  locale = DEFAULT_LOCALE,
): string {
  const date = parseIsoDate(value.date);
  if (!date) return '';
  let text: string;
  if (format === 'iso') text = value.date;
  else if (format === 'long') text = date.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
  else if (format === 'relative') text = formatRelativeDay(date, now, locale);
  else text = formatShortDate(date, now, locale);
  return value.time ? `${text}, ${formatTime(value.time, locale)}` : text;
}

export type DateUrgency = 'done' | 'overdue' | 'today' | 'soon' | 'none';

/** Deadline state of a due date: overdue / today / due within 3 days, unless done. */
export function dateUrgency(isoDate: string, now: Date, isDone: boolean): DateUrgency {
  const date = parseIsoDate(isoDate);
  if (!date) return 'none';
  if (isDone) return 'done';
  const diff = dayDiff(now, date);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 3) return 'soon';
  return 'none';
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

/** "May 1 – Oct 30"; years shown when not the current year or when the range spans years. */
export function formatTimelineRange(from: string, to: string, now: Date, locale = DEFAULT_LOCALE): string {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return '';
  const spansYears = start.getFullYear() !== end.getFullYear();
  const withYear = (date: Date) =>
    date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  if (spansYears) return `${withYear(start)} to ${withYear(end)}`;
  if (start.getTime() === end.getTime()) return formatShortDate(start, now, locale);
  if (start.getFullYear() !== now.getFullYear()) return `${formatShortDate(start, start, locale)} to ${withYear(end)}`;
  return `${formatShortDate(start, now, locale)} to ${formatShortDate(end, now, locale)}`;
}

/** Inclusive length in days ("May 1 – May 1" is 1 day). */
export function timelineDays(from: string, to: string): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return 0;
  return Math.max(1, dayDiff(start, end) + 1);
}

/** Elapsed fraction 0..1 of the range relative to `now`. */
export function timelineProgress(from: string, to: string, now: Date): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return 0;
  const total = timelineDays(from, to);
  const elapsed = dayDiff(start, now) + 1;
  return Math.min(1, Math.max(0, elapsed / total));
}

/** Timeline length: exact days for anything up to ~4 months, months only for long ranges. */
export function formatDuration(days: number): string {
  if (days === 1) return '1 day';
  if (days <= 120) return `${days} days`;
  return `${Math.round(days / 30.4)} mo`;
}

// ---------------------------------------------------------------------------------------------
// Relative time (last updated, creation log)
// ---------------------------------------------------------------------------------------------

export function formatRelativeTime(iso: string, now: Date, locale = DEFAULT_LOCALE): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const seconds = Math.round((now.getTime() - time) / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const date = new Date(time);
  const days = dayDiff(date, now);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return formatShortDate(date, now, locale);
}

export function formatTimestamp(iso: string, locale = DEFAULT_LOCALE): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Date(time).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------------------------
// Numbers & currency
// ---------------------------------------------------------------------------------------------

export interface NumberFormatSettings {
  readonly unit?: string;
  readonly unitPosition?: 'prefix' | 'suffix';
  readonly decimals?: number;
  readonly format?: 'plain' | 'compact' | 'percent';
}

function clampDecimals(decimals: number | undefined, max = 6): number {
  return Math.min(max, Math.max(0, Math.trunc(decimals ?? 0)));
}

function formatPlain(value: number, decimals: number, compact: boolean, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: compact ? 0 : decimals,
    maximumFractionDigits: compact ? Math.max(1, decimals) : decimals,
  }).format(value);
}

function withUnit(text: string, unit: string | undefined, position: 'prefix' | 'suffix'): string {
  if (!unit) return text;
  const negative = text.startsWith('-') || text.startsWith('−');
  if (position === 'prefix') return negative ? `-${unit}${text.slice(1)}` : `${unit}${text}`;
  const glue = /^[%°]$/.test(unit) ? '' : ' ';
  return `${text}${glue}${unit}`;
}

/** Numbers column display: thousands separators, decimals, unit prefix/suffix, compact option. */
export function formatNumberValue(
  value: number,
  settings: NumberFormatSettings = {},
  options: { readonly compact?: boolean; readonly locale?: string } = {},
): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const decimals = clampDecimals(settings.decimals);
  const compact = options.compact === true || settings.format === 'compact';
  const text = formatPlain(value, decimals, compact, locale);
  if (settings.format === 'percent') return `${text}%`;
  return withUnit(text, settings.unit, settings.unitPosition ?? 'suffix');
}

export function formatCurrencyValue(
  amount: number,
  currency: string,
  decimals = 0,
  options: { readonly compact?: boolean; readonly locale?: string } = {},
): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const digits = clampDecimals(decimals, 4);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: options.compact ? 'compact' : 'standard',
      minimumFractionDigits: options.compact ? 0 : digits,
      maximumFractionDigits: options.compact ? Math.max(1, digits) : digits,
    }).format(amount);
  } catch {
    return `${formatPlain(amount, digits, options.compact === true, locale)} ${currency}`;
  }
}

export function currencySymbol(currency: string, locale = DEFAULT_LOCALE): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency })
      .formatToParts(0)
      .find((entry) => entry.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

export type NumberParseResult =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly message: string };

const SUFFIX_MULTIPLIER: Readonly<Record<string, number>> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * Lenient numeric input: "1,234.5", "$1,200", "1.2k", "3M", "-45%", " 12 ". Blank clears.
 * Anything else is an explicit error (never silently dropped).
 */
export function parseNumberInput(text: string): NumberParseResult {
  const raw = text.trim();
  if (!raw) return { ok: true, value: null };
  const cleaned = raw.replace(/[\s,_]/g, '').replace(/^[$€£¥₹]/, '').replace(/%$/, '').replace('−', '-');
  const match = /^([-+]?(?:\d+\.?\d*|\.\d+))([kmb])?$/i.exec(cleaned);
  if (!match || match[1] === undefined) return { ok: false, message: 'Enter a number, like 1,250 or 1.2k' };
  const multiplier = match[2] ? (SUFFIX_MULTIPLIER[match[2].toLowerCase()] ?? 1) : 1;
  const value = Number(match[1]) * multiplier;
  if (!Number.isFinite(value) || Math.abs(value) > 1e15) return { ok: false, message: 'That number is too large' };
  return { ok: true, value: Math.round(value * 1e6) / 1e6 };
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export type FileKind = 'pdf' | 'sheet' | 'doc' | 'slides' | 'archive' | 'image' | 'media' | 'text' | 'other';

export function fileKind(mime: string, name = ''): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
  if (/spreadsheet|excel|csv/.test(mime) || ['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet';
  if (/presentation|powerpoint/.test(mime) || ['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
  if (/word|opendocument\.text|rtf/.test(mime) || ['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'doc';
  if (/zip|compressed|tar|gzip|7z|rar/.test(mime) || ['zip', 'gz', 'tar', '7z', 'rar'].includes(ext))
    return 'archive';
  if (mime.startsWith('text/') || ['txt', 'md', 'json'].includes(ext)) return 'text';
  return 'other';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

/** Accepts "example.com/x" (adds https://). Only http(s) URLs are allowed. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname) && url.hostname !== 'localhost') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** "https://www.acme.com/pricing?x" → "acme.com/pricing" for compact display. */
export function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(value: string): boolean {
  return value.length <= 320 && EMAIL_PATTERN.test(value.trim());
}
