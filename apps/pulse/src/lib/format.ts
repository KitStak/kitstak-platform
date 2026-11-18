/**
 * Display formatters for Pulse: money, percents, hours, units, pace and changes with a sign.
 * Pure TypeScript, safe on the server and in the browser. Display uses a fixed `en-US` locale and
 * the org currency by default (docs/pulse/SPEC.md 4.2), and every function takes a locale and
 * currency so tests and other regions can ask for something else.
 *
 * Nothing here does money math. Cents go in as `bigint` (or a whole number) and come out as text.
 * A `null` or `undefined` value gives the `empty` text (default: an empty string) so the caller
 * decides what a missing number looks like, for example "No revenue yet".
 */
import { type CentsLike, type Decimal, centsToDecimal, toCents, toScaled, fromScaled } from './money';

export const DEFAULT_LOCALE = 'en-US';
export const DEFAULT_CURRENCY = 'USD';

export interface FormatOptions {
  /** BCP 47 locale. Default `en-US`. */
  readonly locale?: string;
  /** Text for `null` and `undefined`. Default `''`. */
  readonly empty?: string;
}

export interface MoneyFormatOptions extends FormatOptions {
  /** ISO 4217 code. Default `USD`. */
  readonly currency?: string;
  /** `false` drops the cents ("$1,235"). Default `true`. */
  readonly cents?: boolean;
  /** `true` writes negatives in brackets, the way accountants do: "($45.00)". */
  readonly accounting?: boolean;
}

export type Tone = 'good' | 'bad' | 'neutral';

type Missing = null | undefined;

const formatterCache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Intl accepts exact decimal strings at run time; the DOM typings only list numbers and bigints. */
function formatExact(formatter: Intl.NumberFormat, decimalText: string): string {
  return formatter.format(decimalText as unknown as number);
}

function isMissing(value: unknown): value is Missing {
  return value === null || value === undefined;
}

function toNumber(value: Decimal): number {
  return typeof value === 'number' ? value : Number(value);
}

/** "$1,234.50". Negative amounts read "-$45.00", or "($45.00)" with `accounting`. */
export function formatMoney(cents: CentsLike | Missing, options: MoneyFormatOptions = {}): string {
  if (isMissing(cents)) return options.empty ?? '';
  const showCents = options.cents ?? true;
  const formatter = numberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: 'currency',
    currency: options.currency ?? DEFAULT_CURRENCY,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
    currencySign: options.accounting ? 'accounting' : 'standard',
  });
  const text = formatExact(formatter, centsToDecimal(cents));
  // A value that rounds to zero must not read "-$0".
  return showCents ? text : text.replace(/^-(\D*0)$/, '$1');
}

/** Whole dollars, for big headline numbers: "$48,210". */
export function formatMoneyWhole(cents: CentsLike | Missing, options: Omit<MoneyFormatOptions, 'cents'> = {}): string {
  return formatMoney(cents, { ...options, cents: false });
}

/** Short money for tiles and chart axes: "$950", "$48.2K", "$1.3M". */
export function formatMoneyCompact(cents: CentsLike | Missing, options: MoneyFormatOptions = {}): string {
  if (isMissing(cents)) return options.empty ?? '';
  const formatter = numberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: 'currency',
    currency: options.currency ?? DEFAULT_CURRENCY,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  return formatExact(formatter, centsToDecimal(cents));
}

/** A per unit price or cost kept to 4 places where needed: "$2.75", "$0.035". */
export function formatUnitPrice(price: Decimal | Missing, options: MoneyFormatOptions = {}): string {
  if (isMissing(price) || price === '') return options.empty ?? '';
  const formatter = numberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: 'currency',
    currency: options.currency ?? DEFAULT_CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return formatExact(formatter, fromScaled(toScaled(price, 4), 4));
}

/** Money for each hour: "$21.76 an hour". */
export function formatMoneyPerHour(cents: CentsLike | Missing, options: MoneyFormatOptions = {}): string {
  if (isMissing(cents)) return options.empty ?? '';
  return `${formatMoney(cents, options)} an hour`;
}

/** Money for each unit: "$3.12 a unit" (or "a kit" with a unit word). */
export function formatMoneyPerUnit(cents: CentsLike | Missing, unitLabel = 'unit', options: MoneyFormatOptions = {}): string {
  if (isMissing(cents)) return options.empty ?? '';
  return `${formatMoney(cents, options)} a ${unitLabel}`;
}

export interface NumberFormatOptions extends FormatOptions {
  /** Fewest decimal places. Default 0. */
  readonly minDigits?: number;
  /** Most decimal places. Default 2. */
  readonly maxDigits?: number;
}

/** A plain number with thousands separators: "12,480", "7.5". */
export function formatNumber(value: Decimal | bigint | Missing, options: NumberFormatOptions = {}): string {
  if (isMissing(value) || value === '') return options.empty ?? '';
  const max = options.maxDigits ?? 2;
  const formatter = numberFormat(options.locale ?? DEFAULT_LOCALE, { minimumFractionDigits: Math.min(options.minDigits ?? 0, max), maximumFractionDigits: max });
  return typeof value === 'bigint' ? formatter.format(value) : formatter.format(toNumber(value));
}

/** A short count for tiles: "950", "12.5K", "1.2M". */
export function formatCompactNumber(value: Decimal | bigint | Missing, options: FormatOptions = {}): string {
  if (isMissing(value) || value === '') return options.empty ?? '';
  const formatter = numberFormat(options.locale ?? DEFAULT_LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
  return typeof value === 'bigint' ? formatter.format(value) : formatter.format(toNumber(value));
}

export interface PercentFormatOptions extends FormatOptions {
  /** Decimal places. Default 1 ("22.4%"). */
  readonly digits?: number;
  /** Always show every decimal place ("38.0%"), so a table column lines up. Default false. */
  readonly fixed?: boolean;
}

/** Basis points as a percent: 2236 is "22.4%". */
export function formatPercentBp(bp: number | bigint | Missing, options: PercentFormatOptions = {}): string {
  if (isMissing(bp)) return options.empty ?? '';
  return formatPercent(Number(bp) / 10000, options);
}

/** A ratio as a percent: 0.2236 is "22.4%". */
export function formatPercent(ratio: number | Missing, options: PercentFormatOptions = {}): string {
  if (isMissing(ratio) || !Number.isFinite(ratio)) return options.empty ?? '';
  const digits = options.digits ?? 1;
  const formatter = numberFormat(options.locale ?? DEFAULT_LOCALE, { style: 'percent', minimumFractionDigits: options.fixed ? digits : 0, maximumFractionDigits: digits });
  const text = formatter.format(ratio);
  return /^-0(?:[.,]0+)?\s?%$/.test(text) ? text.slice(1) : text;
}

/** A whole percent for sentences: 2236 is "22%". */
export function formatPercentWhole(bp: number | bigint | Missing, options: FormatOptions = {}): string {
  return formatPercentBp(bp, { ...options, digits: 0 });
}

export interface HoursFormatOptions extends FormatOptions {
  /**
   * `decimal` (default): "7.5". `unit`: "7.5 hours", "1 hour". `short`: "7.5 h".
   * `clock`: "7:30".
   */
  readonly style?: 'decimal' | 'unit' | 'short' | 'clock';
  /** Most decimal places for the decimal styles. Default 2. */
  readonly maxDigits?: number;
}

/** Labor hours: "7.5", "7.5 hours", "7.5 h" or "7:30". */
export function formatHours(hours: Decimal | Missing, options: HoursFormatOptions = {}): string {
  if (isMissing(hours) || hours === '') return options.empty ?? '';
  const style = options.style ?? 'decimal';
  if (style === 'clock') {
    const scaled = toScaled(hours, 2);
    const negative = scaled < BigInt(0);
    const abs = negative ? -scaled : scaled;
    const totalMinutes = Number((abs * BigInt(60) + BigInt(50)) / BigInt(100));
    const text = `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
    return negative ? `-${text}` : text;
  }
  const value = toNumber(hours);
  const text = formatNumber(value, { locale: options.locale, maxDigits: options.maxDigits ?? 2 });
  if (style === 'unit') return `${text} ${value === 1 ? 'hour' : 'hours'}`;
  if (style === 'short') return `${text} h`;
  return text;
}

/** Units finished, with an optional unit word: "3,000", "3,000 kits", "1 kit". */
export function formatUnits(quantity: Decimal | Missing, unitLabel?: string | null, options: NumberFormatOptions = {}): string {
  if (isMissing(quantity) || quantity === '') return options.empty ?? '';
  const text = formatNumber(quantity, { maxDigits: 3, ...options });
  if (!unitLabel) return text;
  return `${text} ${toNumber(quantity) === 1 ? unitLabel : pluralize(unitLabel)}`;
}

/** Simple English plural for unit words: kit to kits, box to boxes, assembly to assemblies. */
export function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

export interface PaceFormatOptions extends FormatOptions {
  /** `true` adds the words "units per person per hour". */
  readonly withWords?: boolean;
  /** Decimal places. Default 1. */
  readonly digits?: number;
}

/** Pace (units per person per hour): "32.0", or "32.0 units per person per hour". */
export function formatPace(uph: Decimal | Missing, options: PaceFormatOptions = {}): string {
  if (isMissing(uph) || uph === '') return options.empty ?? '';
  const digits = options.digits ?? 1;
  const text = formatNumber(uph, { locale: options.locale, minDigits: digits, maxDigits: digits });
  return options.withWords ? `${text} units per person per hour` : text;
}

/** Headcount: "12", "12.5". */
export function formatHeadcount(people: Decimal | Missing, options: FormatOptions = {}): string {
  return formatNumber(people, { ...options, maxDigits: 2 });
}

function withSign(sign: number, body: string, zeroText: string): string {
  if (sign === 0) return zeroText;
  return `${sign > 0 ? '+' : '-'}${body}`;
}

/** A money change with its sign: "+$600.00", "-$235.00", "$0.00". */
export function formatMoneyDelta(cents: CentsLike | Missing, options: MoneyFormatOptions = {}): string {
  if (isMissing(cents)) return options.empty ?? '';
  const value = toCents(cents);
  const zero = BigInt(0);
  const abs = value < zero ? -value : value;
  const body = formatMoney(abs, { ...options, accounting: false });
  return withSign(value === zero ? 0 : value > zero ? 1 : -1, body, body);
}

/** A percent change with its sign, from basis points: "+12.5%", "-3.0%", "0%". */
export function formatPercentDelta(bp: number | bigint | Missing, options: PercentFormatOptions = {}): string {
  if (isMissing(bp)) return options.empty ?? '';
  const value = Number(bp);
  const body = formatPercentBp(Math.abs(value), options);
  // A change that rounds to nothing carries no sign: "0%", never "-0%".
  const rounded = Number((Math.abs(value) / 100).toFixed(options.digits ?? 1));
  return withSign(rounded === 0 ? 0 : Math.sign(value), body, body);
}

/** A change in margin, in points: "+2.4 points", "-1 point", "0 points". */
export function formatPointsDelta(bp: number | bigint | Missing, options: PercentFormatOptions = {}): string {
  if (isMissing(bp)) return options.empty ?? '';
  const value = Number(bp);
  const points = Math.abs(value) / 100;
  const text = formatNumber(points, { locale: options.locale, maxDigits: options.digits ?? 1 });
  const body = `${text} ${text === '1' ? 'point' : 'points'}`;
  return withSign(text === '0' ? 0 : Math.sign(value), body, body);
}

/** A plain number change with its sign: "+120", "-7.5", "0". */
export function formatNumberDelta(value: Decimal | Missing, options: NumberFormatOptions = {}): string {
  if (isMissing(value) || value === '') return options.empty ?? '';
  const n = toNumber(value);
  const body = formatNumber(Math.abs(n), options);
  return withSign(body === '0' ? 0 : Math.sign(n), body, body);
}

/** An hours change with its sign: "+25 hours", "-1 hour". */
export function formatHoursDelta(hours: Decimal | Missing, options: FormatOptions = {}): string {
  if (isMissing(hours) || hours === '') return options.empty ?? '';
  const n = toNumber(hours);
  const body = formatHours(Math.abs(n), { locale: options.locale, style: 'unit' });
  return withSign(Math.sign(n), body, body);
}

/**
 * Good, bad or neutral for a change. `goodWhen` says which way is good: `up` for revenue, profit,
 * margin, units and pace; `down` for costs and hours.
 */
export function deltaTone(delta: number | bigint | Missing, goodWhen: 'up' | 'down'): Tone {
  if (isMissing(delta)) return 'neutral';
  const sign = typeof delta === 'bigint' ? (delta > BigInt(0) ? 1 : delta < BigInt(0) ? -1 : 0) : Math.sign(delta);
  if (sign === 0 || Number.isNaN(sign)) return 'neutral';
  return (sign > 0) === (goodWhen === 'up') ? 'good' : 'bad';
}

/** "up", "down" or "flat" for arrows next to a change. */
export function deltaDirection(delta: number | bigint | Missing): 'up' | 'down' | 'flat' {
  if (isMissing(delta)) return 'flat';
  const sign = typeof delta === 'bigint' ? (delta > BigInt(0) ? 1 : delta < BigInt(0) ? -1 : 0) : Math.sign(delta);
  return sign > 0 ? 'up' : sign < 0 ? 'down' : 'flat';
}

/** Whole cents as a plain decimal for CSV cells and inputs: "1234.50" (no symbol, no separators). */
export function formatMoneyPlain(cents: CentsLike | Missing, options: FormatOptions = {}): string {
  if (isMissing(cents)) return options.empty ?? '';
  return centsToDecimal(cents);
}

/** A decimal trimmed for inputs and CSV cells: "96.00" is "96", "7.50" is "7.5". */
export function formatDecimalPlain(value: Decimal | Missing, scale: number, options: FormatOptions = {}): string {
  if (isMissing(value) || value === '') return options.empty ?? '';
  const fixed = fromScaled(toScaled(value, scale), scale);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
