/**
 * Money math for Pulse (docs/pulse/SPEC.md 4.2). Pure TypeScript, safe on the server and in the
 * browser. Totals are whole cents held in `bigint`. JS floats are never used for money.
 *
 * One rounding rule everywhere: `divRound` rounds half away from zero, once, at the step that
 * lands on whole cents. Decimal inputs (hours, quantities, unit prices, multipliers) are first
 * scaled to exact integers, so `92.00 hours x $21.76` is `divRound(9200 * 2176, 100)`.
 *
 * `BigInt(n)` is used instead of `10n` literals because the shared tsconfig targets ES2017.
 */

/** Whole cents. Negative values are allowed (credits, losses). */
export type Cents = bigint;

/** Anything that can be read as whole cents: a `bigint`, a safe integer, or an integer string from Postgres. */
export type CentsLike = bigint | number | string;

/** A decimal quantity (hours, units, a unit price): a number, or the exact string Postgres returns for `numeric`. */
export type Decimal = number | string;

/** An exact fraction with a positive denominator. Estimates stay exact until the named output is rounded. */
export interface Fraction {
  readonly n: bigint;
  readonly d: bigint;
}

export const ZERO: Cents = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

/** Decimal places kept for each kind of number (4.2). */
export const HOURS_SCALE = 2;
export const QUANTITY_SCALE = 3;
export const PRICE_SCALE = 4;
export const MULTIPLIER_SCALE = 2;
export const HEADCOUNT_SCALE = 2;
/** 10000 basis points is 100%. */
export const BP_ONE = 10000;
/** Ratios outside plus or minus this many basis points are shown as "no number" (4.2). */
export const MAX_RATIO_BP = 1_000_000;

const BIG_BP_ONE = BigInt(BP_ONE);
const BIG_MAX_RATIO = BigInt(MAX_RATIO_BP);

/** 10 to the power `scale` as a `bigint`. */
export function pow10(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError('scale must be a whole number, 0 or more');
  let out = ONE;
  for (let i = 0; i < scale; i += 1) out *= TEN;
  return out;
}

/** Absolute value of a `bigint`. */
export function absBig(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

/**
 * The one rounding rule (4.2): integer division of `n` by `d`, rounded half away from zero.
 * `d` must be above zero.
 */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= ZERO) throw new RangeError('divRound needs a divisor above zero');
  const q = (TWO * absBig(n) + d) / (TWO * d);
  return n < ZERO ? -q : q;
}

/** Integer division rounded toward negative infinity. */
export function divFloor(n: bigint, d: bigint): bigint {
  if (d <= ZERO) throw new RangeError('divFloor needs a divisor above zero');
  const q = n / d;
  return n % d !== ZERO && n < ZERO ? q - ONE : q;
}

/** Integer division rounded toward positive infinity. */
export function divCeil(n: bigint, d: bigint): bigint {
  return -divFloor(-n, d);
}

/** Reads whole cents from a `bigint`, a safe integer or an integer string. Throws on anything else. */
export function toCents(value: CentsLike): Cents {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`Cents must be a whole number, got ${value}`);
    return BigInt(value);
  }
  const text = value.trim();
  if (!/^[+-]?\d+$/.test(text)) throw new RangeError(`Cents must be a whole number, got "${value}"`);
  return BigInt(text);
}

/** Like `toCents`, but `null` and `undefined` stay `null`. */
export function toCentsOrNull(value: CentsLike | null | undefined): Cents | null {
  return value === null || value === undefined ? null : toCents(value);
}

/** Cents as a JS number for charts and JSON. Throws when the value is too large to be exact. */
export function centsToNumber(cents: Cents): number {
  const n = Number(cents);
  if (!Number.isSafeInteger(n)) throw new RangeError('Cents value is too large for a number');
  return n;
}

const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** Turns a JS number into a plain decimal string (no exponent). */
function numberToPlain(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  const text = String(value);
  if (!/e/i.test(text)) return text;
  const [mantissa, expText] = text.toLowerCase().split('e');
  const exp = Number(expText);
  const negative = (mantissa ?? '').startsWith('-');
  const [whole, frac = ''] = (mantissa ?? '').replace('-', '').split('.');
  const digits = `${whole}${frac}`;
  const point = (whole ?? '').length + exp;
  let plain: string;
  if (point <= 0) plain = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) plain = `${digits}${'0'.repeat(point - digits.length)}`;
  else plain = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return negative ? `-${plain}` : plain;
}

/**
 * Scales a decimal to an exact integer: `toScaled('92.5', 2)` is `9250n`. Extra decimal places are
 * rounded half away from zero. Throws when the text is not a plain decimal number.
 */
export function toScaled(value: Decimal | bigint, scale: number): bigint {
  if (typeof value === 'bigint') return value * pow10(scale);
  const text = typeof value === 'number' ? numberToPlain(value) : value.trim();
  const match = DECIMAL_TEXT.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) throw new RangeError(`Not a decimal number: "${String(value)}"`);
  const negative = match[1] === '-';
  const whole = match[2] === '' ? '0' : (match[2] as string);
  const frac = match[3] ?? '';
  const kept = frac.slice(0, scale).padEnd(scale, '0');
  let scaled = BigInt(`${whole}${kept}`);
  const next = frac.charCodeAt(scale);
  if (next >= 53 && next <= 57) scaled += ONE;
  return negative ? -scaled : scaled;
}

/** Scaled integer back to a fixed decimal string: `fromScaled(9250n, 2)` is `"92.50"`. */
export function fromScaled(scaled: bigint, scale: number): string {
  const negative = scaled < ZERO;
  const digits = absBig(scaled).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${frac}`;
}

/** Scaled integer as a JS number (for display values such as hours and pace, never for money). */
export function scaledToNumber(scaled: bigint, scale: number): number {
  return Number(fromScaled(scaled, scale));
}

/** Hours x 100 as an exact integer. */
export function hoursToScaled(hours: Decimal): bigint {
  return toScaled(hours, HOURS_SCALE);
}

/** Quantity x 1000 as an exact integer. */
export function quantityToScaled(quantity: Decimal): bigint {
  return toScaled(quantity, QUANTITY_SCALE);
}

/** Unit price in currency units x 10000 as an exact integer. */
export function priceToScaled(price: Decimal): bigint {
  return toScaled(price, PRICE_SCALE);
}

/** Dollars and cents text or number to whole cents: `decimalToCents('1234.5')` is `123450n`. */
export function decimalToCents(amount: Decimal): Cents {
  return toScaled(amount, 2);
}

/** Whole cents to a plain decimal string with two places: `123450n` is `"1234.50"`. */
export function centsToDecimal(cents: CentsLike): string {
  return fromScaled(toCents(cents), 2);
}

/** Adds any number of cent amounts. */
export function addCents(...values: readonly CentsLike[]): Cents {
  let total = ZERO;
  for (const value of values) total += toCents(value);
  return total;
}

/** `a - b` in cents. */
export function subCents(a: CentsLike, b: CentsLike): Cents {
  return toCents(a) - toCents(b);
}

/** Sum of a list of cent amounts. `null` and `undefined` entries count as 0. */
export function sumCents(values: Iterable<CentsLike | null | undefined>): Cents {
  let total = ZERO;
  for (const value of values) if (value !== null && value !== undefined) total += toCents(value);
  return total;
}

/** Sum of one cents field over a list of rows. */
export function sumBy<T>(rows: Iterable<T>, pick: (row: T) => CentsLike | null | undefined): Cents {
  let total = ZERO;
  for (const row of rows) {
    const value = pick(row);
    if (value !== null && value !== undefined) total += toCents(value);
  }
  return total;
}

/** The smaller of two cent amounts. */
export function minCents(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}

/** The larger of two cent amounts. */
export function maxCents(a: Cents, b: Cents): Cents {
  return a > b ? a : b;
}

/** `hours x rate per hour`, rounded once to whole cents: `divRound(hours100 * rate, 100)`. */
export function mulHoursRate(hours: Decimal, rateCents: CentsLike): Cents {
  return divRound(hoursToScaled(hours) * toCents(rateCents), pow10(HOURS_SCALE));
}

/** `quantity x unit price`, rounded once to whole cents: `divRound(qty1000 * price10000, 100000)`. */
export function mulQuantityPrice(quantity: Decimal, unitPrice: Decimal): Cents {
  return divRound(quantityToScaled(quantity) * priceToScaled(unitPrice), pow10(QUANTITY_SCALE + PRICE_SCALE - 2));
}

/** `quantity x a whole cent amount`, rounded once to whole cents. */
export function mulQuantityCents(quantity: Decimal, cents: CentsLike): Cents {
  return divRound(quantityToScaled(quantity) * toCents(cents), pow10(QUANTITY_SCALE));
}

/** `cents x basis points / 10000`, rounded once: 8% of $100.00 is `mulBp(10000n, 800)`. */
export function mulBp(cents: CentsLike, bp: number | bigint): Cents {
  return divRound(toCents(cents) * BigInt(bp), BIG_BP_ONE);
}

/** `cents x numerator / denominator`, rounded once. The denominator must be above zero. */
export function mulRatio(cents: CentsLike, numerator: bigint, denominator: bigint): Cents {
  return divRound(toCents(cents) * numerator, denominator);
}

/**
 * The share of a monthly amount that belongs to days `firstDay` to `lastDay` of a month with
 * `daysInMonth` days (4.9). It is the rounded running total through `lastDay` less the rounded
 * running total through the day before `firstDay`, so the parts of a month always add back to
 * the whole month to the cent, and a whole month is the amount itself.
 * Example: $70,500.00 for days 1 to 18 of 30 is `divRound(7050000 * 18, 30) = 4230000`.
 */
export function prorateDays(monthCents: CentsLike, firstDay: number, lastDay: number, daysInMonth: number): Cents {
  if (!Number.isInteger(firstDay) || !Number.isInteger(lastDay) || !Number.isInteger(daysInMonth) || daysInMonth < 1 || firstDay < 1 || lastDay > daysInMonth || lastDay < firstDay) {
    throw new RangeError('prorateDays needs whole days inside the month');
  }
  return prorateCounted(monthCents, firstDay - 1, lastDay, daysInMonth);
}

/**
 * The same rule counted in any unit, such as work days (4.9): the share of a monthly amount for
 * the days after the first `before` of the month's `total` and through the first `through`. It is
 * the rounded running total through `through` less the rounded running total through `before`, so
 * the parts of a month add back to the whole month to the cent, and `0` to `total` is the amount.
 * Example: $70,500.00 with 21 work days, work days 1 to 12: `divRound(7050000 * 12, 21) = 4028571`.
 */
export function prorateCounted(monthCents: CentsLike, before: number, through: number, total: number): Cents {
  if (!Number.isInteger(before) || !Number.isInteger(through) || !Number.isInteger(total) || total < 1 || before < 0 || through > total || through < before) {
    throw new RangeError('prorateCounted needs whole counts inside the month');
  }
  const cents = toCents(monthCents);
  const whole = BigInt(total);
  return divRound(cents * BigInt(through), whole) - divRound(cents * BigInt(before), whole);
}

/**
 * A ratio in basis points for people to read (4.2): `divRound(part * 10000, whole)`.
 * `null` when the whole is 0 or less, or when the answer is outside plus or minus 1,000,000 bp.
 */
export function ratioBp(part: CentsLike, whole: CentsLike): number | null {
  const w = toCents(whole);
  if (w <= ZERO) return null;
  const bp = divRound(toCents(part) * BIG_BP_ONE, w);
  if (bp > BIG_MAX_RATIO || bp < -BIG_MAX_RATIO) return null;
  return Number(bp);
}

/** Margin in basis points: profit as a share of revenue. `null` when revenue is 0 or less. */
export function marginBp(profitCents: CentsLike, revenueCents: CentsLike): number | null {
  return ratioBp(profitCents, revenueCents);
}

/** Why a margin has no number: `'no_revenue'` at 0, `'negative_revenue'` under 0, `'out_of_range'`, or `null` when it has one. */
export function marginGap(profitCents: CentsLike, revenueCents: CentsLike): 'no_revenue' | 'negative_revenue' | 'out_of_range' | null {
  const revenue = toCents(revenueCents);
  if (revenue === ZERO) return 'no_revenue';
  if (revenue < ZERO) return 'negative_revenue';
  return ratioBp(profitCents, revenue) === null ? 'out_of_range' : null;
}

/**
 * Change from `before` to `after` in basis points of `|before|`. `null` when `before` is 0.
 * Used for "Difference %" and period over period.
 */
export function changeBp(after: CentsLike, before: CentsLike): number | null {
  const b = toCents(before);
  if (b === ZERO) return null;
  const bp = divRound((toCents(after) - b) * BIG_BP_ONE, absBig(b));
  if (bp > BIG_MAX_RATIO || bp < -BIG_MAX_RATIO) return null;
  return Number(bp);
}

/** Cents divided by a quantity, as cents per one unit (rounded to a whole cent). `null` when the quantity is 0 or less. */
export function perUnitCents(cents: CentsLike, quantity: Decimal): Cents | null {
  const q = quantityToScaled(quantity);
  if (q <= ZERO) return null;
  return divRound(toCents(cents) * pow10(QUANTITY_SCALE), q);
}

/** Cents divided by hours, as cents per hour (rounded to a whole cent). `null` when hours are 0 or less. */
export function perHourCents(cents: CentsLike, hours: Decimal): Cents | null {
  const h = hoursToScaled(hours);
  if (h <= ZERO) return null;
  return divRound(toCents(cents) * pow10(HOURS_SCALE), h);
}

/**
 * Splits `total` over `weights` with the largest remainder method (4.5), so the parts always add
 * up to the total to the cent. `base_i = floor(total * w_i / W)`; the cents left over go, one
 * each, to the largest remainders. Ties go to the earlier position in the list, so pass the rows
 * already sorted by the tie break you want (for shared cost: work date, then id).
 * Weights must be 0 or more. When every weight is 0 the result is all zeros (nothing is spread).
 */
export function allocate(total: CentsLike, weights: readonly bigint[]): Cents[] {
  const amount = toCents(total);
  let weightSum = ZERO;
  for (const weight of weights) {
    if (weight < ZERO) throw new RangeError('allocate needs weights of 0 or more');
    weightSum += weight;
  }
  if (weightSum === ZERO) return weights.map(() => ZERO);
  const negative = amount < ZERO;
  const pool = absBig(amount);
  const parts: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let handed = ZERO;
  weights.forEach((weight, index) => {
    const product = pool * weight;
    const base = product / weightSum;
    parts.push(base);
    handed += base;
    remainders.push({ index, remainder: product % weightSum });
  });
  let left = pool - handed;
  remainders.sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const entry of remainders) {
    if (left <= ZERO) break;
    parts[entry.index] = (parts[entry.index] as bigint) + ONE;
    left -= ONE;
  }
  return negative ? parts.map((part) => -part) : parts;
}

/** Splits `total` into `count` near equal parts that add up exactly. The first parts get the extra cents. */
export function splitEvenly(total: CentsLike, count: number): Cents[] {
  if (!Number.isInteger(count) || count <= 0) throw new RangeError('splitEvenly needs a whole count above zero');
  return allocate(total, Array.from({ length: count }, () => ONE));
}

/* ------------------------------------------------------------------------------------------ */
/* Exact fractions (used by estimates, 4.13)                                                   */
/* ------------------------------------------------------------------------------------------ */

function gcd(a: bigint, b: bigint): bigint {
  let x = absBig(a);
  let y = absBig(b);
  while (y !== ZERO) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === ZERO ? ONE : x;
}

/** Builds a reduced fraction. The denominator may be negative, but not 0. */
export function frac(n: bigint, d: bigint = ONE): Fraction {
  if (d === ZERO) throw new RangeError('A fraction cannot have 0 underneath');
  const sign = d < ZERO ? -ONE : ONE;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
}

/** An exact fraction from a decimal: `fracOf('92.5', 2)` is 185/2. */
export function fracOf(value: Decimal, scale: number): Fraction {
  return frac(toScaled(value, scale), pow10(scale));
}

export function fracAdd(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function fracSub(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function fracMul(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.n, a.d * b.d);
}

/** `a / b`. Throws when `b` is 0. */
export function fracDiv(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d, a.d * b.n);
}

/** -1, 0 or 1 as `a` is below, equal to or above `b`. */
export function fracCmp(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function fracMin(a: Fraction, b: Fraction): Fraction {
  return fracCmp(a, b) <= 0 ? a : b;
}

export function fracMax(a: Fraction, b: Fraction): Fraction {
  return fracCmp(a, b) >= 0 ? a : b;
}

/** Rounds a fraction to a whole number, half away from zero. */
export function fracRound(value: Fraction): bigint {
  return divRound(value.n, value.d);
}

/** Rounds a fraction up to a whole number. */
export function fracCeil(value: Fraction): bigint {
  return divCeil(value.n, value.d);
}

/** Rounds a fraction to `scale` decimal places and returns the scaled integer. */
export function fracToScaled(value: Fraction, scale: number): bigint {
  return divRound(value.n * pow10(scale), value.d);
}

/** Rounds a fraction to `scale` decimal places and returns a JS number (display values only). */
export function fracToNumber(value: Fraction, scale: number): number {
  return scaledToNumber(fracToScaled(value, scale), scale);
}

export const FRAC_ZERO: Fraction = { n: ZERO, d: ONE };
export const FRAC_ONE: Fraction = { n: ONE, d: ONE };
