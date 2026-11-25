/**
 * Pure model for the price lines and one time charges editors (docs/programs/SPEC.md 5.4 Step 3,
 * 5.12). People type dollars; this turns them into card line inputs (whole cents, 4 decimal unit
 * prices) and back, and says what is wrong in plain words. Never uses Number for money. Tested.
 */
import { decimalToCents, fromScaled, rateTextMessage, readRateText } from '@kitstak/programs-engine';
import type { CardLineDTO, CardLineInput, IsoDate } from '@/lib/program-types';

export interface FixedLineValue {
  readonly on: boolean;
  /** Dollars as typed ("1500" or "1,500.00"). */
  readonly amount: string;
  /** "Charge part of it in a partial month" (stored `prorate`). */
  readonly partialMonth: boolean;
  readonly chargeWhilePaused: boolean;
  readonly label: string | null;
}

export interface PriceLinesValue {
  readonly perUnit: { readonly on: boolean; readonly price: string; readonly label: string | null };
  /** Variant key to a typed rate ("" means the card rate). */
  readonly variantRates: Readonly<Record<string, string>>;
  readonly perOrder: { readonly on: boolean; readonly amount: string; readonly label: string | null };
  readonly perHour: { readonly on: boolean; readonly rate: string; readonly countAllTime: boolean; readonly label: string | null };
  readonly monthlyFee: FixedLineValue;
  readonly minimum: FixedLineValue;
}

export const EMPTY_FIXED: FixedLineValue = { on: false, amount: '', partialMonth: true, chargeWhilePaused: true, label: null };

export const DEFAULT_PRICE_LINES: PriceLinesValue = {
  perUnit: { on: true, price: '', label: null },
  variantRates: {},
  perOrder: { on: false, amount: '', label: null },
  perHour: { on: false, rate: '', countAllTime: false, label: null },
  monthlyFee: EMPTY_FIXED,
  minimum: EMPTY_FIXED,
};

export type MoneyRead = { readonly ok: true; readonly cents: string } | { readonly ok: false; readonly message: string };

/** Dollars with up to 2 decimals to whole cents ("1,500" is "150000"). */
export function readMoney(text: string, options: { readonly allowZero?: boolean } = {}): MoneyRead {
  const clean = text.replace(/[$,\s]/g, '');
  if (clean === '') return { ok: false, message: 'Add an amount.' };
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(clean)) {
    if (/^\d+\.\d{3,}$/.test(clean)) return { ok: false, message: 'Use up to 2 decimals for money.' };
    if (clean.startsWith('-')) return { ok: false, message: 'Use an amount of $0 or more.' };
    return { ok: false, message: 'Type an amount like 1500 or 1500.00.' };
  }
  const cents = decimalToCents(clean);
  if (!options.allowZero && cents === BigInt(0)) return { ok: false, message: 'Use an amount above $0.' };
  return { ok: true, cents: cents.toString() };
}

/** A rate with up to 4 decimals ("1.95" is "1.9500"). */
export function readPrice(text: string): { readonly ok: true; readonly price: string } | { readonly ok: false; readonly message: string } {
  if (!text.trim()) return { ok: false, message: 'Add a price.' };
  const read = readRateText(text);
  if (read.ok) return { ok: true, price: read.price };
  return { ok: false, message: rateTextMessage(read.problem, text) };
}

export type PriceLineField = 'perUnit' | 'perOrder' | 'perHour' | 'monthlyFee' | 'minimum' | 'lines' | `variant:${string}`;

/** What to fix, by field. Empty when the card is fine. `later` skips every check. */
export function priceLinesProblems(value: PriceLinesValue, options: { readonly later?: boolean } = {}): Partial<Record<PriceLineField, string>> {
  if (options.later) return {};
  const out: Partial<Record<PriceLineField, string>> = {};
  const anyOn = value.perUnit.on || value.perOrder.on || value.perHour.on || value.monthlyFee.on || value.minimum.on;
  if (!anyOn) out.lines = 'Turn on at least one line, or choose Set prices later.';
  if (value.perUnit.on) {
    const read = readPrice(value.perUnit.price);
    if (!read.ok) out.perUnit = read.message;
  }
  for (const [key, text] of Object.entries(value.variantRates)) {
    if (!text.trim()) continue;
    const read = readPrice(text);
    if (!read.ok) out[`variant:${key}`] = read.message;
  }
  if (value.perOrder.on) {
    const read = readMoney(value.perOrder.amount);
    if (!read.ok) out.perOrder = read.message;
  }
  if (value.perHour.on) {
    const read = readMoney(value.perHour.rate);
    if (!read.ok) out.perHour = read.message;
  }
  if (value.monthlyFee.on) {
    const read = readMoney(value.monthlyFee.amount);
    if (!read.ok) out.monthlyFee = read.message;
  }
  if (value.minimum.on) {
    const read = readMoney(value.minimum.amount);
    if (!read.ok) out.minimum = read.message === 'Use an amount above $0.' ? 'The minimum must be more than $0.' : read.message;
  }
  return out;
}

/** The card lines for a valid value (lines that do not read are left out; check problems first). */
export function toCardLines(value: PriceLinesValue): CardLineInput[] {
  const lines: CardLineInput[] = [];
  if (value.perUnit.on) {
    const read = readPrice(value.perUnit.price);
    if (read.ok) lines.push({ kind: 'per_unit', variantId: null, unitPrice: read.price, label: value.perUnit.label });
  }
  for (const [variantKey, text] of Object.entries(value.variantRates)) {
    if (!text.trim()) continue;
    const read = readPrice(text);
    if (read.ok) lines.push({ kind: 'per_unit', variantKey, unitPrice: read.price, label: null });
  }
  if (value.perOrder.on) {
    const read = readMoney(value.perOrder.amount);
    if (read.ok) lines.push({ kind: 'per_order', variantId: null, amountCents: read.cents, label: value.perOrder.label });
  }
  if (value.perHour.on) {
    const read = readMoney(value.perHour.rate);
    if (read.ok) lines.push({ kind: 'per_hour', rateCents: Number(read.cents), label: value.perHour.label });
  }
  for (const [kind, line] of [['flat_monthly', value.monthlyFee], ['monthly_minimum', value.minimum]] as const) {
    if (!line.on) continue;
    const read = readMoney(line.amount);
    if (read.ok) lines.push({ kind, amountCents: read.cents, prorate: line.partialMonth, chargeWhilePaused: line.chargeWhilePaused, label: line.label });
  }
  return lines;
}

/** Cents to the dollars people type ("150000" is "1500.00"). */
export function centsToDollars(cents: string | number | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return '';
  return fromScaled(BigInt(cents), 2);
}

/** "1.9500" to "1.95" for an input. */
export function priceToInput(price: string | null | undefined): string {
  if (!price) return '';
  return price.includes('.') ? price.replace(/0+$/, '').replace(/\.$/, '') : price;
}

/** The editor value for a saved version's lines (Price card tab, new version from the one in force). */
export function fromCardLines(lines: readonly CardLineDTO[], variantKeyById: ReadonlyMap<string, string>, hourlyAll = false): PriceLinesValue {
  const fixed = (kind: 'flat_monthly' | 'monthly_minimum'): FixedLineValue => {
    const line = lines.find((entry) => entry.kind === kind);
    return line ? { on: true, amount: centsToDollars(line.amountCents), partialMonth: line.prorate, chargeWhilePaused: line.chargeWhilePaused, label: line.label } : EMPTY_FIXED;
  };
  const perUnit = lines.find((line) => line.kind === 'per_unit' && line.variantId === null);
  const perOrder = lines.find((line) => line.kind === 'per_order' && line.variantId === null);
  const perHour = lines.find((line) => line.kind === 'per_hour');
  const variantRates: Record<string, string> = {};
  for (const line of lines) {
    if (line.kind !== 'per_unit' || line.variantId === null || line.ruleId !== null) continue;
    const key = variantKeyById.get(line.variantId);
    if (key) variantRates[key] = priceToInput(line.unitPrice);
  }
  return {
    perUnit: { on: Boolean(perUnit), price: priceToInput(perUnit?.unitPrice), label: perUnit?.label ?? null },
    variantRates,
    perOrder: { on: Boolean(perOrder), amount: centsToDollars(perOrder?.amountCents), label: perOrder?.label ?? null },
    perHour: { on: Boolean(perHour), rate: perHour?.rateCents !== null && perHour?.rateCents !== undefined ? centsToDollars(perHour.rateCents) : '', countAllTime: hourlyAll, label: perHour?.label ?? null },
    monthlyFee: fixed('flat_monthly'),
    minimum: fixed('monthly_minimum'),
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* One time charges                                                                               */
/* ---------------------------------------------------------------------------------------------- */

export interface OneTimeRow {
  readonly id: string;
  readonly label: string;
  /** Dollars as typed. */
  readonly amount: string;
  readonly chargeOn: IsoDate;
}

/** Row id to the problem ("Add an amount."), for rows that cannot be saved. */
export function oneTimeProblems(rows: readonly OneTimeRow[], options: { readonly notBefore?: IsoDate | null } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.label.trim()) out[row.id] = 'Name the charge.';
    else {
      const read = readMoney(row.amount);
      if (!read.ok) out[row.id] = read.message;
      else if (!row.chargeOn) out[row.id] = 'Pick the day to charge it.';
      else if (options.notBefore && row.chargeOn < options.notBefore) out[row.id] = 'The day cannot be before the program starts.';
    }
  }
  return out;
}

/** The wizard `priceCard.oneTime` list for rows that read. */
export function toOneTimeInputs(rows: readonly OneTimeRow[]): { label: string; amountCents: string; chargeOn: IsoDate }[] {
  const out: { label: string; amountCents: string; chargeOn: IsoDate }[] = [];
  for (const row of rows) {
    const read = readMoney(row.amount);
    if (read.ok && row.label.trim() && row.chargeOn) out.push({ label: row.label.trim(), amountCents: read.cents, chargeOn: row.chargeOn });
  }
  return out;
}
