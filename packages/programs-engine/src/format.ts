/**
 * Formatting for program numbers (docs/programs/SPEC.md 3.12). Fixed `en-US` locale so the server
 * and the browser print the same text (hydration safe). Money is formatted from exact integers:
 * `bigint` cents never pass through a float. `@kitstak/pulse-bridge/format` re-exports
 * `formatCents` and `formatMarginBp` from here, so every app prints money the same way.
 *
 * Two percent formats, on purpose:
 * - `formatMarginBp` (a margin) rounds to the nearest tenth, half away from zero, like every
 *   other number the engine rounds (`divRound`). A margin is a measure, so the nearest value is
 *   the honest one: 9995 bp is "100%".
 * - `formatPercentBp` (progress to a goal, such as minimum or forecast attainment) cuts toward
 *   zero. It sits next to a health band, and rounding up could claim a band the number has not
 *   reached: 9995 bp is "99%" (or "99.9%"), never "100%", because on track starts at 10000.
 * A screen that shows both shows a margin with `formatMarginBp` and an attainment with
 * `formatPercentBp`; never print one kind of number with the other formatter, or the two can
 * be a tenth apart for the same basis points.
 */
import { type Cents, ZERO, absBig, divRound, fromScaled, priceToScaled, quantityToScaled, toScaled } from './money';

const HUNDRED = BigInt(100);
const LOCALE = 'en-US';

const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** A whole number with thousands separators, from a non negative `bigint`. */
function groupDigits(value: bigint): string {
  return integerFormat.format(value);
}

/** Splits a fixed decimal string into its grouped whole part and fraction digits. */
function splitDecimal(text: string): { negative: boolean; whole: string; fraction: string } {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [whole = '0', fraction = ''] = body.split('.');
  return { negative, whole, fraction };
}

function currencySymbol(currency: string): { prefix: string; suffix: string } {
  const parts = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 }).formatToParts(1);
  const index = parts.findIndex((part) => part.type === 'integer');
  const prefix = parts.slice(0, index).map((part) => part.value).join('');
  const suffix = parts.slice(index + 1).map((part) => part.value).join('');
  return { prefix, suffix };
}

const symbolCache = new Map<string, { prefix: string; suffix: string }>();

function symbolFor(currency: string): { prefix: string; suffix: string } {
  const key = currency.toUpperCase();
  let found = symbolCache.get(key);
  if (!found) {
    try {
      found = currencySymbol(key);
    } catch {
      found = { prefix: `${key} `, suffix: '' };
    }
    symbolCache.set(key, found);
  }
  return found;
}

function withCurrency(negative: boolean, body: string, currency: string): string {
  const { prefix, suffix } = symbolFor(currency);
  return `${negative ? '-' : ''}${prefix}${body}${suffix}`;
}

export interface FormatCentsOptions {
  /** Show cents ("$12,345.67"). Default whole dollars ("$12,346"). */
  readonly cents?: boolean;
  /** Short form for tight spaces ("$1.2M", "$38K"). Ignores `cents` at a thousand dollars and up. */
  readonly compact?: boolean;
  /** ISO currency code. Default USD. */
  readonly currency?: string;
  /** Text for a missing value. Default "Hidden" (money a person may not see). */
  readonly empty?: string;
}

const COMPACT_UNITS: readonly { readonly suffix: string; readonly dollars: bigint }[] = [
  { suffix: 'T', dollars: BigInt('1000000000000') },
  { suffix: 'B', dollars: BigInt('1000000000') },
  { suffix: 'M', dollars: BigInt('1000000') },
  { suffix: 'K', dollars: BigInt('1000') },
];

const THOUSAND = BigInt(1000);

/**
 * "1.2M", "38K" for amounts that round to a thousand dollars and up; null below that (shown in
 * full). One decimal under 10 of a unit, whole units from 10. When rounding reaches 1,000 of a unit and a
 * bigger unit exists, the next unit is used, so $999,500 prints "1M", never "1,000K".
 */
function compactBody(absCents: bigint): string | null {
  const ten = BigInt(10);
  let index = COMPACT_UNITS.findIndex((unit) => absCents >= unit.dollars * HUNDRED);
  // $999.99 rounds to $1,000, so it prints "$1K" like any other thousand.
  if (index < 0 && divRound(absCents, HUNDRED) >= THOUSAND) index = COMPACT_UNITS.length - 1;
  if (index < 0) return null;
  for (;;) {
    const unit = COMPACT_UNITS[index] as { suffix: string; dollars: bigint };
    const size = unit.dollars * HUNDRED;
    const tenths = divRound(absCents * ten, size);
    const whole = divRound(absCents, size);
    if (whole >= THOUSAND && index > 0) {
      index -= 1;
      continue;
    }
    if (tenths >= BigInt(100)) return `${groupDigits(whole)}${unit.suffix}`;
    return `${fromScaled(tenths, 1).replace(/\.0$/, '')}${unit.suffix}`;
  }
}

function readCents(value: Cents | number | string): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  const text = value.trim();
  return /^[+-]?\d+$/.test(text) ? BigInt(text) : null;
}

/**
 * Whole cents to money text: 1234567 becomes "$12,346" (or "$12,345.67" with `cents`). Accepts a
 * `bigint`, a safe integer or an integer string. Rounds half away from zero, like `divRound`.
 */
export function formatCents(cents: Cents | number | string | null | undefined, options: FormatCentsOptions = {}): string {
  const empty = options.empty ?? 'Hidden';
  if (cents === null || cents === undefined) return empty;
  if (typeof cents === 'number' && !Number.isFinite(cents)) return empty;
  const currency = options.currency ?? 'USD';
  const exact = readCents(cents);
  if (exact === null) {
    // A number with a fraction of a cent: a display value only, never used for math.
    const numeric = typeof cents === 'number' ? cents : Number(cents);
    if (!Number.isFinite(numeric)) return empty;
    const digits = options.cents ? 2 : 0;
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(numeric / 100);
  }
  const negative = exact < ZERO;
  const abs = absBig(exact);
  if (options.compact) {
    const short = compactBody(abs);
    if (short !== null) return withCurrency(negative, short, currency);
  }
  if (options.cents) {
    const whole = abs / HUNDRED;
    const fraction = String(abs % HUNDRED).padStart(2, '0');
    return withCurrency(negative, `${groupDigits(whole)}.${fraction}`, currency);
  }
  const dollars = divRound(abs, HUNDRED);
  return withCurrency(negative && dollars !== ZERO, groupDigits(dollars), currency);
}

/**
 * Basis points to a margin with up to one decimal: 3150 becomes "31.5%", 3000 becomes "30%".
 *
 * Rounds to the tenth with the engine's one rounding rule (`divRound`, half away from zero), so
 * +5 bp is "0.1%" and -5 bp is "-0.1%". A value that rounds to zero prints "0%", never "-0%".
 */
export function formatMarginBp(bp: number | null | undefined, options: { readonly empty?: string } = {}): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return options.empty ?? 'No margin yet';
  // A fractional bp rounds half away from zero too, so the sign never changes the result.
  const whole = BigInt(Math.sign(bp) * Math.round(Math.abs(bp)));
  const tenths = divRound(whole, BigInt(10));
  const { whole: digits, fraction } = splitDecimal(fromScaled(absBig(tenths), 1));
  const body = fraction === '0' ? groupDigits(BigInt(digits)) : `${groupDigits(BigInt(digits))}.${fraction}`;
  return `${tenths < ZERO ? '-' : ''}${body}%`;
}

/**
 * Basis points to a whole percent: 10533 becomes "105%". With `decimals: 1`, "105.3%".
 *
 * The percent is cut toward zero, never rounded up, so it can never claim a band the number has
 * not reached: 9999 is "99%" (with one decimal "99.9%"), which sits next to "At risk" from
 * `programHealth` (on track starts at exactly 10000), and 8999 is "89%" next to "Off track".
 * A credit cuts toward zero too: -450 is "-4%".
 */
export function formatPercentBp(bp: number | bigint | null | undefined, options: { readonly decimals?: 0 | 1; readonly empty?: string } = {}): string {
  if (bp === null || bp === undefined) return options.empty ?? 'No number yet';
  if (typeof bp === 'number' && !Number.isFinite(bp)) return options.empty ?? 'No number yet';
  const value = typeof bp === 'bigint' ? bp : BigInt(Math.trunc(bp));
  if (options.decimals === 1) {
    // bigint division cuts toward zero.
    const tenths = value / BigInt(10);
    const { negative, whole, fraction } = splitDecimal(fromScaled(tenths, 1));
    const body = fraction === '0' ? groupDigits(BigInt(whole)) : `${groupDigits(BigInt(whole))}.${fraction}`;
    return `${negative && tenths !== ZERO ? '-' : ''}${body}%`;
  }
  const percent = value / HUNDRED;
  return `${percent < ZERO ? '-' : ''}${groupDigits(absBig(percent))}%`;
}

/**
 * Runs a scaling step and returns null when the value is not a number, so one bad stored value
 * shows the empty text instead of breaking a whole page render (the same as `formatCents`).
 */
function safeScaled(scale: () => bigint): bigint | null {
  try {
    return scale();
  } catch {
    return null;
  }
}

/** Trims trailing zeros of a fixed decimal string, keeping at least `keep` fraction digits. */
function trimFraction(fraction: string, keep: number): string {
  let out = fraction;
  while (out.length > keep && out.endsWith('0')) out = out.slice(0, -1);
  return out;
}

/**
 * A unit price to text: "1.9500" becomes "$1.95", "1.8525" stays "$1.8525". Shows 2 decimals
 * unless more are needed.
 */
export function formatUnitPrice(price: string | number | null | undefined, options: { readonly currency?: string; readonly empty?: string } = {}): string {
  if (price === null || price === undefined || (typeof price === 'string' && price.trim() === '')) return options.empty ?? 'No price';
  if (typeof price === 'number' && !Number.isFinite(price)) return options.empty ?? 'No price';
  const scaled = safeScaled(() => priceToScaled(price));
  if (scaled === null) return options.empty ?? 'No price';
  const { negative, whole, fraction } = splitDecimal(fromScaled(scaled, 4));
  const body = `${groupDigits(BigInt(whole))}.${trimFraction(fraction, 2)}`;
  return withCurrency(negative && scaled !== ZERO, body, options.currency ?? 'USD');
}

/** A quantity to text: "1200.000" becomes "1,200", "12.500" becomes "12.5". */
export function formatQty(qty: string | number | bigint | null | undefined, options: { readonly empty?: string } = {}): string {
  if (qty === null || qty === undefined || (typeof qty === 'string' && qty.trim() === '')) return options.empty ?? '0';
  if (typeof qty === 'number' && !Number.isFinite(qty)) return options.empty ?? '0';
  const scaled = safeScaled(() => quantityToScaled(typeof qty === 'bigint' ? qty.toString() : qty));
  if (scaled === null) return options.empty ?? '0';
  const { negative, whole, fraction } = splitDecimal(fromScaled(scaled, 3));
  const trimmed = trimFraction(fraction, 0);
  return `${negative && scaled !== ZERO ? '-' : ''}${groupDigits(BigInt(whole))}${trimmed ? `.${trimmed}` : ''}`;
}

/** A count with its unit word: "1 kit", "1,200 kits", "2.5 kits". Text that is not a number counts as 0. */
export function unitLabel(n: string | number | bigint, unit: { readonly singular: string; readonly plural: string }): string {
  const scaled = safeScaled(() => quantityToScaled(typeof n === 'bigint' ? n.toString() : n)) ?? ZERO;
  const one = BigInt(1000);
  return `${formatQty(fromScaled(scaled, 3))} ${scaled === one || scaled === -one ? unit.singular : unit.plural}`;
}

/** Hours to text: "1.58" becomes "1.58 h", "2.00" becomes "2 h". */
export function formatHours(hours: string | number | null | undefined, options: { readonly empty?: string } = {}): string {
  if (hours === null || hours === undefined || (typeof hours === 'string' && hours.trim() === '')) return options.empty ?? '0 h';
  if (typeof hours === 'number' && !Number.isFinite(hours)) return options.empty ?? '0 h';
  const scaled = safeScaled(() => toScaled(hours, 2));
  if (scaled === null) return options.empty ?? '0 h';
  const { negative, whole, fraction } = splitDecimal(fromScaled(scaled, 2));
  const trimmed = trimFraction(fraction, 0);
  return `${negative && scaled !== ZERO ? '-' : ''}${groupDigits(BigInt(whole))}${trimmed ? `.${trimmed}` : ''} h`;
}
