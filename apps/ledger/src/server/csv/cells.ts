/**
 * Reading one CSV cell into the canonical text Ledger stores and exports (docs/ledger/SPEC.md 7).
 * Canonical text is what an export writes, so an exported file read back compares equal: yes or
 * no, prices with 2 to 4 decimals, rates as a percent with up to 4 decimals, email lists
 * lower cased and joined by a comma and a space. Pure: no database, no server only imports.
 */
import { PRICE_SCALE, pow10, toScaled } from '@/lib/money';
import { unguardFormula } from '@/lib/csv/write';

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const no = (message: string): Read<never> => ({ ok: false, message });

/** Trims a cell, folds inner runs of spaces and removes the export formula guard. */
export function cleanCell(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  return unguardFormula(raw.replace(/ /g, ' ').trim()).trim();
}

const YES = new Set(['yes', 'y', 'true', 't', '1', 'on', 'x']);
const NO = new Set(['no', 'n', 'false', 'f', '0', 'off']);

/** `yes`, `true`, `1`, `on` and `x` are yes; `no`, `false`, `0` and `off` are no. */
export function readYesNo(text: string): Read<'yes' | 'no'> {
  const value = text.toLowerCase();
  if (YES.has(value)) return ok('yes');
  if (NO.has(value)) return ok('no');
  return no(`${text} is not yes or no.`);
}

export function readText(text: string, max = 2000): Read<string> {
  return text.length > max ? no(`This is longer than ${max} letters.`) : ok(text);
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** One or more emails split by commas, semicolons or spaces, lower cased, without repeats. */
export function readEmailList(text: string): Read<string> {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const bad = parts.find((part) => !EMAIL.test(part));
  if (bad) return no(`${bad} is not an email address.`);
  if (parts.length > 10) return no('Give 10 email addresses at most.');
  return ok([...new Set(parts)].join(', '));
}

export function readEmail(text: string): Read<string> {
  const value = text.toLowerCase();
  return EMAIL.test(value) ? ok(value) : no(`${text} is not an email address.`);
}

/** Splits a stored email list back into its addresses. */
export function emailListValues(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A whole number scaled by 10^4 as text with 2 to 4 decimals: 185000 is `18.50`, 350 is `0.035`. */
function scaledText(scaled: bigint, scale: number, minDecimals: number): string {
  const negative = scaled < BigInt(0);
  const abs = negative ? -scaled : scaled;
  const base = pow10(scale);
  const whole = (abs / base).toString();
  let fraction = (abs % base).toString().padStart(scale, '0');
  while (fraction.length > minDecimals && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** A unit price as Ledger writes it: `18.5000` from the database is `18.50`. */
export function priceText(stored: string | null | undefined): string {
  if (stored === null || stored === undefined || stored === '') return '';
  return scaledText(toScaled(stored, PRICE_SCALE), PRICE_SCALE, 2);
}

/** The exact numeric(14,4) text for the database: `18.50` is `18.5000`. */
export function priceForDb(text: string): string {
  const scaled = toScaled(text, PRICE_SCALE);
  const base = pow10(PRICE_SCALE);
  return `${scaled / base}.${(scaled % base).toString().padStart(PRICE_SCALE, '0')}`;
}

const PRICE_MAX = BigInt(1_000_000) * pow10(PRICE_SCALE);

/** A unit price: `$18.50`, `1,234.5`, at most 4 decimals, 0 or more and under 1,000,000. */
export function readPrice(text: string): Read<string> {
  const plain = text.replace(/^\$/, '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(plain)) return no(`${text} is not a price.`);
  if ((plain.split('.')[1] ?? '').length > PRICE_SCALE) return no(`${text} has more than ${PRICE_SCALE} decimals.`);
  const scaled = toScaled(plain, PRICE_SCALE);
  if (scaled >= PRICE_MAX) return no(`${text} is too large for a price.`);
  return ok(scaledText(scaled, PRICE_SCALE, 2));
}

const RATE_SCALE = 4;
/** 25% is the most a rate may be (`rate_millionths` 250000). */
const MAX_RATE_MILLIONTHS = 250_000;

/** A tax rate as a percent with up to 4 decimals (`8.25`, `7.125%`) to millionths of the amount. */
export function readRatePct(text: string): Read<number> {
  const plain = text.replace(/%$/, '').trim();
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(plain)) return no(`${text} is not a percent like 8.25.`);
  if ((plain.split('.')[1] ?? '').length > RATE_SCALE) return no(`${text} has more than ${RATE_SCALE} decimals.`);
  const millionths = Number(toScaled(plain, RATE_SCALE));
  if (millionths > MAX_RATE_MILLIONTHS) return no(`${text} is above 25%.`);
  return ok(millionths);
}

/** Millionths as the percent Ledger writes: 82500 is `8.25`, 71250 is `7.125`, 0 is `0`. */
export function ratePctText(millionths: number): string {
  return scaledText(BigInt(millionths), RATE_SCALE, 0);
}

/** Lower case words without punctuation, for matching a choice: `Temp agency` and `temp_agency` match. */
export function choiceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One of `values` by key or by one of its aliases (matched with `choiceKey`). */
export function readChoice<T extends string>(text: string, values: readonly T[], aliases: Readonly<Record<string, T>> = {}): Read<T> {
  const key = choiceKey(text);
  const direct = values.find((value) => choiceKey(value) === key);
  if (direct) return ok(direct);
  const viaAlias = Object.entries(aliases).find(([alias]) => choiceKey(alias) === key)?.[1];
  if (viaAlias) return ok(viaAlias);
  return no(`${text} is not one of: ${values.join(', ')}.`);
}

/** A comma list of choices, without repeats, in the order of `values`. */
export function readChoiceList<T extends string>(text: string, values: readonly T[], aliases: Readonly<Record<string, T>> = {}): Read<T[]> {
  const found = new Set<T>();
  for (const part of text.split(/[,;]+/).map((piece) => piece.trim()).filter(Boolean)) {
    const read = readChoice(part, values, aliases);
    if (!read.ok) return read;
    found.add(read.value);
  }
  return ok(values.filter((value) => found.has(value)));
}

/** A code: no line breaks, 40 letters at most. */
export function readCode(text: string, max = 40): Read<string> {
  if (/[\r\n]/.test(text)) return no('A code is one line.');
  return text.length > max ? no(`A code is ${max} letters at most.`) : ok(text);
}
