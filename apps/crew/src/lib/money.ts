/**
 * Exact number math for Crew (docs/crew/SPEC.md 4.1): scaled integers as `bigint`, and the one
 * rounding rule, half away from zero. The parts of the Pulse money module Crew uses, copied so
 * Crew needs no Pulse package. Pure module.
 */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

/** 10 to the power `scale`, as a `bigint`. */
export function pow10(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError('scale must be a whole number, 0 or more');
  let out = ONE;
  for (let i = 0; i < scale; i += 1) out *= TEN;
  return out;
}

export function absBig(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

/** Integer division of `n` by `d`, rounded half away from zero. `d` must be above zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= ZERO) throw new RangeError('divRound needs a divisor above zero');
  const q = (TWO * absBig(n) + d) / (TWO * d);
  return n < ZERO ? -q : q;
}

const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function numberToPlain(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

/** A decimal (`"19.505"`, `19.5`, `19n`) as an integer scaled by 10^scale, rounded half away from zero. */
export function toScaled(value: string | number | bigint, scale: number): bigint {
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

/** Scaled integer back to a fixed decimal string: `fromScaled(1950n, 2)` is `"19.50"`. */
export function fromScaled(scaled: bigint, scale: number): string {
  const negative = scaled < ZERO;
  const digits = absBig(scaled).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${frac}`;
}

/** Whole cents as a plain decimal string: 1950 is `"19.50"`. */
export function centsToDecimal(cents: number | bigint): string {
  return fromScaled(BigInt(cents), 2);
}

/** Whole cents as dollars for the screen: 1950 is `"$19.50"`. Only for readers who may see pay. */
export function formatCents(cents: number | bigint): string {
  const text = centsToDecimal(cents);
  const negative = text.startsWith('-');
  const [whole, frac] = (negative ? text.slice(1) : text).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${frac ?? '00'}`;
}
