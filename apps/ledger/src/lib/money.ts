/**
 * Money math for Ledger (docs/ledger/SPEC.md 4.2). Pure TypeScript, safe on the server and in the
 * browser. Totals are whole cents held in `bigint`; JS floats never touch money.
 *
 * The same rules as `@kitstak/programs-engine/money` (Pulse 4.2): `divRound` rounds half away
 * from zero, once, at the step that lands on whole cents. Decimal inputs are scaled to exact
 * integers first. Kept here because the app does not depend on programs-engine yet; the names and
 * results are the same, so the import can be switched with no other change.
 *
 * `BigInt(n)` is used instead of `10n` literals because the shared tsconfig targets ES2017.
 */
export type Cents = bigint;
export type CentsLike = bigint | number | string;
/** A decimal quantity or price: a number, or the exact string Postgres returns for `numeric`. */
export type Decimal = number | string;

export const ZERO: Cents = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

export const QUANTITY_SCALE = 3;
export const PRICE_SCALE = 4;
export const HOURS_SCALE = 2;
/** 1,000,000 millionths is 100%. 8.25% is 82500. */
export const MILLIONTHS_ONE = BigInt(1_000_000);
/** Cents bounds of the `ledger.cents` domain (plus or minus 10^13). */
export const CENTS_LIMIT = BigInt('10000000000000');
export const MAX_RATE_MILLIONTHS = 250_000;

export function pow10(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError('scale must be a whole number, 0 or more');
  let out = ONE;
  for (let i = 0; i < scale; i += 1) out *= TEN;
  return out;
}

export function absBig(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

/** The one rounding rule: `n / d` rounded half away from zero. `d` must be above zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= ZERO) throw new RangeError('divRound needs a divisor above zero');
  const q = (TWO * absBig(n) + d) / (TWO * d);
  return n < ZERO ? -q : q;
}

/** A `bigint`, a safe integer, or an integer string from Postgres as whole cents. */
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

const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** An exact decimal scaled to an integer: `toScaled('2.75', 4)` is 27500. Extra digits round half away from zero. */
export function toScaled(value: Decimal, scale: number): bigint {
  const text = typeof value === 'number' ? numberToPlain(value) : value.trim();
  const match = DECIMAL_TEXT.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) throw new RangeError(`Not a decimal number: "${value}"`);
  const negative = match[1] === '-';
  const whole = match[2] || '0';
  const fraction = match[3] ?? '';
  const kept = fraction.slice(0, scale).padEnd(scale, '0');
  let scaled = BigInt(whole) * pow10(scale) + BigInt(kept || '0');
  const next = fraction.charAt(scale);
  if (next !== '' && Number(next) >= 5) scaled += ONE;
  return negative ? -scaled : scaled;
}

function numberToPlain(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  const text = String(value);
  return /e/i.test(text) ? value.toFixed(12) : text;
}

/** Line amount (4.2): `divRound(qty x 1000 x price x 10000, 100000)`. */
export function mulQuantityPrice(quantity: Decimal, unitPrice: Decimal): Cents {
  return divRound(toScaled(quantity, QUANTITY_SCALE) * toScaled(unitPrice, PRICE_SCALE), pow10(QUANTITY_SCALE + PRICE_SCALE - 2));
}

/** Line tax (4.2): `divRound(line_cents x rate_millionths, 1000000)`, rounded per line. */
export function lineTax(lineCents: CentsLike, rateMillionths: number): Cents {
  if (!Number.isInteger(rateMillionths) || rateMillionths < 0 || rateMillionths > MAX_RATE_MILLIONTHS) {
    throw new RangeError(`A tax rate is 0 to ${MAX_RATE_MILLIONTHS} millionths, got ${rateMillionths}`);
  }
  return divRound(toCents(lineCents) * BigInt(rateMillionths), MILLIONTHS_ONE);
}

/** Hours times a rate in cents (4.2): `divRound(hours x 100 x rate_cents, 100)`. */
export function mulHoursRate(hours: Decimal, rateCents: CentsLike): Cents {
  return divRound(toScaled(hours, HOURS_SCALE) * toCents(rateCents), pow10(HOURS_SCALE));
}

export function sumCents(values: Iterable<CentsLike | null | undefined>): Cents {
  let total = ZERO;
  for (const value of values) if (value !== null && value !== undefined) total += toCents(value);
  return total;
}

/** True when cents sit inside the `ledger.cents` bounds. */
export function inCentsBounds(cents: Cents): boolean {
  return absBig(cents) <= CENTS_LIMIT;
}

/** Cents on the wire: a decimal string, so there is no safe integer edge (SPEC 2). */
export function centsToWire(cents: CentsLike): string {
  return toCents(cents).toString();
}

/** `$15,985.66`, `-$45.00`. Fixed `en-US`, no float on the way. */
export function formatCents(cents: CentsLike, currency = 'USD'): string {
  const value = toCents(cents);
  const negative = value < ZERO;
  const abs = absBig(value);
  const dollars = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = (abs % BigInt(100)).toString().padStart(2, '0');
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${dollars}.${rest}`;
}

/** Parses typed or imported money: `$1,234.50`, `1234.5`, `(45.00)` (negative), `-45`. Null when it is not money. */
export function parseMoney(text: string): Cents | null {
  let raw = text.trim();
  if (raw === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1).trim();
  }
  if (raw.startsWith('-')) {
    negative = !negative;
    raw = raw.slice(1).trim();
  }
  raw = raw.replace(/^\$/, '').trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d{0,2})?$/.test(raw) || raw === '' || raw === '.') return null;
  const cents = toScaled(raw.replace(/,/g, ''), 2);
  const signed = negative ? -cents : cents;
  return inCentsBounds(signed) ? signed : null;
}
