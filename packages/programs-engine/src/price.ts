/**
 * Price resolution (docs/programs/SPEC.md 3.3, D5). First match wins: build rate, variant rate on
 * the card version in force that day, card default rate in force that day, the Pulse job price in
 * force that day (only when the day goes to a job), else no price. Pure functions; all math in
 * scaled `bigint`.
 */
import { formatCents, formatUnitPrice } from './format';
import { type Cents, ZERO, fromScaled, priceToScaled, toCents } from './money';
import type { CardLine, CardVersion, IsoDate, JobPriceRow, PriceLineKind, PriceSource, RateRule } from './types';

/** A dated row (`pulse.job_prices`, a card version). */
export interface DatedRow {
  readonly effectiveFrom: IsoDate;
}

/** The row in force on a work date: the row with the latest `effectiveFrom` on or before it. Moved from Pulse, unchanged. */
export function priceFor<T extends DatedRow>(rows: readonly T[], workDate: IsoDate): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > workDate) continue;
    if (!best || row.effectiveFrom > best.effectiveFrom) best = row;
  }
  return best;
}

/** The published card version in force on a work date (M3). Callers pass published versions only. */
export function versionFor(versions: readonly CardVersion[], workDate: IsoDate): CardVersion | null {
  return priceFor(versions, workDate);
}

/** A price as a 4 decimal string, so equal prices compare equal as strings: `'2.05'` becomes `'2.0500'`. */
export function normalize4(price: string | number): string {
  return fromScaled(priceToScaled(price), 4);
}

export interface ResolveInput {
  readonly workDate: IsoDate;
  readonly variantId: string | null;
  readonly buildOverride: string | null;
  /** Published only; `[]` for a build outside a program. */
  readonly versions: readonly CardVersion[];
  /** Only when the posting is a job. */
  readonly jobPrices?: readonly JobPriceRow[];
}

export interface ResolvedPrice {
  readonly unitPrice: string;
  readonly source: PriceSource;
  readonly versionId: string | null;
  readonly lineId: string | null;
}

const NO_PRICE: ResolvedPrice = { unitPrice: '0.0000', source: 'none', versionId: null, lineId: null };

function isBlank(value: string | null | undefined): value is null | undefined {
  return value === null || value === undefined || value.trim() === '';
}

/** The `kind` line of a version for a variant, falling back to the card default line. Lines that fail `isUsableLine` are skipped. */
function lineFor(version: CardVersion, kind: PriceLineKind, variantId: string | null): { line: CardLine; byVariant: boolean } | null {
  if (variantId !== null) {
    const own = version.lines.find((line) => line.kind === kind && line.variantId === variantId && isUsableLine(line));
    if (own) return { line: own, byVariant: true };
  }
  const card = version.lines.find((line) => line.kind === kind && line.variantId === null && isUsableLine(line));
  return card ? { line: card, byVariant: false } : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Typed rates and the $0 floor                                                               */
/* ------------------------------------------------------------------------------------------ */

/** The most decimals a unit rate can have (prices are stored with 4). */
export const MAX_RATE_DECIMALS = 4;

/** Why typed rate text cannot be used. */
export type RateTextProblem = 'not_number' | 'too_many_decimals' | 'below_zero' | 'too_large';

/**
 * The largest rate the database takes, scaled by 10^4 (999,999.9999). Every rate column has
 * the same CHECK: `price_card_lines.unit_price`, `builds.rate_override`,
 * `program_variants.material_cost_per_unit` and Pulse `production_entries.unit_price` are
 * `< 1000000`, and `price_card_rules.amount` is `> -1000000 AND < 1000000`.
 */
export const MAX_RATE_SCALED = BigInt('9999999999');
/** The largest whole number of cents the database takes for a batch fee, monthly fee, minimum or one time charge (`amount_cents <= 10000000000000`). */
export const MAX_AMOUNT_CENTS = BigInt('10000000000000');
/** The largest rate per hour in cents the database takes (`rate_cents <= 10000000`, $100,000.00 an hour). */
export const MAX_HOUR_RATE_CENTS = 10000000;

const PLAIN_DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const GROUPED_WHOLE = /^\d{1,3}(,\d{3})+$/;

/**
 * Reads a rate the way people type it: `2.05`, `$2.05`, `$ 2.05`, `2,050.00` or `-$1.00`. A
 * comma must group thousands (`1,5` is refused, so a European decimal comma is never read as 15).
 * More than 4 decimals is refused unless the extra digits are zeros (`1.23450` is fine), a value
 * below $0 is refused (unless `allowNegative`, for an "add" rate rule that takes off), and a
 * value at or above $1,000,000 (the database CHECK) is refused. Nothing is rounded quietly.
 */
export function readRateText(text: string | number, options: { readonly allowNegative?: boolean } = {}): { readonly ok: true; readonly scaled: bigint; readonly price: string } | { readonly ok: false; readonly problem: RateTextProblem } {
  let body = String(text).trim().replace(/\s+/g, '');
  let sign = '';
  if (body.startsWith('-') || body.startsWith('+')) {
    sign = body[0] === '-' ? '-' : '';
    body = body.slice(1);
  }
  if (body.startsWith('$')) body = body.slice(1);
  if (body.startsWith('-') || body.startsWith('+')) {
    if (sign !== '' || body[0] === '+') return { ok: false, problem: 'not_number' };
    sign = '-';
    body = body.slice(1);
  }
  if (body.includes(',')) {
    const [whole = '', ...rest] = body.split('.');
    if (rest.length > 1 || !GROUPED_WHOLE.test(whole)) return { ok: false, problem: 'not_number' };
    body = [whole.replace(/,/g, ''), ...rest].join('.');
  }
  if (!PLAIN_DECIMAL.test(body)) return { ok: false, problem: 'not_number' };
  const frac = body.split('.')[1] ?? '';
  if (frac.length > MAX_RATE_DECIMALS && /[1-9]/.test(frac.slice(MAX_RATE_DECIMALS))) return { ok: false, problem: 'too_many_decimals' };
  const scaled = priceToScaled(`${sign}${body}`);
  if (scaled < ZERO && !options.allowNegative) return { ok: false, problem: 'below_zero' };
  if (scaled > MAX_RATE_SCALED || -scaled > MAX_RATE_SCALED) return { ok: false, problem: 'too_large' };
  return { ok: true, scaled, price: fromScaled(scaled, 4) };
}

/** UI copy for a build rate below $0 (the same floor the card rate rules use). */
export const NEGATIVE_BUILD_RATE_MESSAGE = 'A build rate cannot be less than $0.';
/** UI copy for a build rate with more than 4 decimals. */
export const BUILD_RATE_DECIMALS_MESSAGE = 'Use up to 4 decimals for a build rate.';
/** UI copy for any price card line below $0 (per unit, per batch, per hour, monthly fee or minimum). */
export const NEGATIVE_RATE_MESSAGE = 'A rate cannot be less than $0.';
/** UI copy for a card rate with more than 4 decimals. */
export const RATE_DECIMALS_MESSAGE = 'Use up to 4 decimals for a rate.';
/** UI copy for a rate above what the database holds. */
export const RATE_TOO_LARGE_MESSAGE = 'The rate is too large. Use up to $999,999.9999.';

/** UI copy for a typed rate that cannot be read (`readRateText`). */
export function rateTextMessage(problem: RateTextProblem, text: string | number): string {
  switch (problem) {
    case 'not_number':
      return `The rate ${String(text).trim()} is not a number.`;
    case 'too_many_decimals':
      return RATE_DECIMALS_MESSAGE;
    case 'below_zero':
      return NEGATIVE_RATE_MESSAGE;
    case 'too_large':
      return RATE_TOO_LARGE_MESSAGE;
  }
}

/** What is wrong with a build rate someone typed, as UI copy, or null when it is blank or fine. `$2.05` and `2,050.00` are fine. */
export function buildRateProblem(rate: string | null | undefined): string | null {
  if (isBlank(rate)) return null;
  const read = readRateText(rate);
  if (read.ok) return null;
  switch (read.problem) {
    case 'not_number':
      return `The build rate ${rate.trim()} is not a number.`;
    case 'too_many_decimals':
      return BUILD_RATE_DECIMALS_MESSAGE;
    case 'below_zero':
      return NEGATIVE_BUILD_RATE_MESSAGE;
    case 'too_large':
      return RATE_TOO_LARGE_MESSAGE;
  }
}

function wholeCentsProblem(amount: string, what: string): string | null {
  const text = amount.trim();
  if (/^-\d+$/.test(text)) return BigInt(text) < ZERO ? NEGATIVE_RATE_MESSAGE : null;
  if (!/^\+?\d+$/.test(text)) return `The ${what} must be a whole number of cents.`;
  if (BigInt(text.replace(/^\+/, '')) > MAX_AMOUNT_CENTS) return `The ${what} is too large.`;
  return null;
}

const AMOUNT_WORDS: Readonly<Record<'per_order' | 'flat_monthly' | 'monthly_minimum', string>> = {
  per_order: 'batch fee',
  flat_monthly: 'monthly fee',
  monthly_minimum: 'monthly minimum',
};

/**
 * What is wrong with one price card line, as UI copy for the price card editor, or null when it
 * is fine or still empty. Every line kind has the same floor: "A rate cannot be less than $0."
 * The engine skips any line with a problem (`isUsableLine`), so a bad line can never post
 * negative revenue, even if it reaches a published version.
 */
export function cardLineProblem(line: Pick<CardLine, 'kind' | 'unitPrice' | 'rateCents' | 'amountCents'>): string | null {
  switch (line.kind) {
    case 'per_unit': {
      if (isBlank(line.unitPrice)) return null;
      const read = readRateText(line.unitPrice);
      if (read.ok) return null;
      return rateTextMessage(read.problem, line.unitPrice);
    }
    case 'per_hour': {
      if (line.rateCents === null) return null;
      if (!Number.isFinite(line.rateCents)) return 'The rate per hour is not a number.';
      if (line.rateCents < 0) return NEGATIVE_RATE_MESSAGE;
      if (!Number.isSafeInteger(line.rateCents)) return 'The rate per hour must be a whole number of cents.';
      if (line.rateCents > MAX_HOUR_RATE_CENTS) return 'The rate per hour is too large.';
      return null;
    }
    case 'per_order':
    case 'flat_monthly':
    case 'monthly_minimum':
      return isBlank(line.amountCents) ? null : wholeCentsProblem(line.amountCents, AMOUNT_WORDS[line.kind]);
  }
}

/** The 4 decimal price of a usable per unit line (`'$2.05'` gives `'2.0500'`). */
function linePrice(line: CardLine): string {
  const read = readRateText(line.unitPrice as string);
  return read.ok ? read.price : '0.0000';
}

/** True when a card line has a value and no problem (`cardLineProblem`), so it can charge. */
export function isUsableLine(line: Pick<CardLine, 'kind' | 'unitPrice' | 'rateCents' | 'amountCents'>): boolean {
  switch (line.kind) {
    case 'per_unit':
      return !isBlank(line.unitPrice) && cardLineProblem(line) === null;
    case 'per_hour':
      return line.rateCents !== null && cardLineProblem(line) === null;
    default:
      return !isBlank(line.amountCents) && cardLineProblem(line) === null;
  }
}

/**
 * The unit price of one build day (3.3). Always concrete: no price is `'0.0000'` with source
 * `none`. A build rate is read like typed text (`$2.05`, `2,050.00`); one that is not a number,
 * has more than 4 decimals or is below $0 is refused with a RangeError carrying the
 * `buildRateProblem` copy, so a build can never earn negative or quietly rounded revenue (the
 * domain checks `buildRateProblem` before it saves). Card and variant lines and job prices below
 * $0 are skipped as unusable, the same floor for every source.
 */
export function resolveUnitPrice(input: ResolveInput): ResolvedPrice {
  if (!isBlank(input.buildOverride)) {
    const read = readRateText(input.buildOverride);
    if (!read.ok) throw new RangeError(buildRateProblem(input.buildOverride) as string);
    return { unitPrice: read.price, source: 'build', versionId: null, lineId: null };
  }
  const version = versionFor(input.versions, input.workDate);
  if (version) {
    const found = lineFor(version, 'per_unit', input.variantId);
    if (found) {
      return { unitPrice: linePrice(found.line), source: found.byVariant ? 'variant' : 'card', versionId: version.id, lineId: found.line.id };
    }
  }
  if (input.jobPrices) {
    const row = priceFor(input.jobPrices, input.workDate);
    const read = row && !isBlank(row.unitPrice) ? readRateText(row.unitPrice) : null;
    if (read && read.ok) return { unitPrice: read.price, source: 'job', versionId: null, lineId: null };
  }
  return NO_PRICE;
}

/** The per batch line that charges a build finished on `finishedOn` (variant line, then the card default). */
export function orderLineFor(versions: readonly CardVersion[], variantId: string | null, finishedOn: IsoDate): { line: CardLine; version: CardVersion } | null {
  const version = versionFor(versions, finishedOn);
  if (!version) return null;
  const found = lineFor(version, 'per_order', variantId);
  return found ? { line: found.line, version } : null;
}

/** The per batch charge of a build finished on `finishedOn`, or null when the card has no per batch line that day. */
export function resolveOrderCharge(versions: readonly CardVersion[], variantId: string | null, finishedOn: IsoDate): { amountCents: Cents; versionId: string; lineId: string } | null {
  const found = orderLineFor(versions, variantId, finishedOn);
  if (!found) return null;
  return { amountCents: toCents(found.line.amountCents as string), versionId: found.version.id, lineId: found.line.id };
}

/** The per hour line in force on a work date. */
export function hourLineFor(versions: readonly CardVersion[], workDate: IsoDate): { line: CardLine; version: CardVersion } | null {
  const version = versionFor(versions, workDate);
  if (!version) return null;
  const usable = (line: CardLine): boolean => line.kind === 'per_hour' && isUsableLine(line);
  const line = version.lines.find((row) => usable(row) && row.variantId === null) ?? version.lines.find(usable);
  return line ? { line, version } : null;
}

/** The hourly rate in force on a work date, or null when the card has no per hour line that day. */
export function resolveHourRate(versions: readonly CardVersion[], workDate: IsoDate): { rateCents: number; versionId: string; lineId: string } | null {
  const found = hourLineFor(versions, workDate);
  if (!found) return null;
  return { rateCents: found.line.rateCents as number, versionId: found.version.id, lineId: found.line.id };
}

/* ------------------------------------------------------------------------------------------ */
/* Rate rules                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Why rate rules cannot price a variant. */
export type RateConflictReason = 'two_sets' | 'no_default' | 'below_zero' | 'bad_amount';

export interface CompileRateRulesInput {
  /** The card default per unit rate, or null when the card has none. */
  readonly defaultUnitPrice: string | null;
  /** In position order. */
  readonly rules: readonly RateRule[];
  /** `attributes` maps attribute id to value id. */
  readonly variants: readonly { readonly id: string; readonly attributes: Readonly<Record<string, string>> }[];
  /** Hand typed variant rates. They always win over rules. */
  readonly handLines: readonly { readonly variantId: string; readonly unitPrice: string }[];
}

export interface CompiledRateRules {
  readonly lines: readonly { readonly variantId: string; readonly unitPrice: string; readonly ruleId: string }[];
  /**
   * `amount` and `problem` are set for `bad_amount`: the text that could not be read (a rule
   * amount, or the card default when `ruleIds` is empty of a bad rule) and why.
   */
  readonly conflicts: readonly RateConflict[];
}

export interface RateConflict {
  readonly variantId: string;
  readonly ruleIds: readonly string[];
  readonly reason: RateConflictReason;
  readonly amount?: string;
  readonly problem?: RateTextProblem;
}

/**
 * Compiles rate rules into variant lines (3.3). For each variant with no hand typed line, the
 * rules matching its attributes apply: one `set` gives its amount plus the matching `add` rules;
 * only `add` rules give the card default plus their sum. Two `set` rules, `add` rules without a
 * card default, or a result below 0 are conflicts. Every amount is read like typed text
 * (`readRateText`, so `$1.95` works); an amount that is not a number, has more than 4 decimals
 * or is too large is a `bad_amount` conflict, never rounded quietly. Only an `add` amount may be
 * below $0. A card default below $0 counts as no default.
 */
export function compileRateRules(input: CompileRateRulesInput): CompiledRateRules {
  const hand = new Set(input.handLines.map((line) => line.variantId));
  const lines: { variantId: string; unitPrice: string; ruleId: string }[] = [];
  const conflicts: RateConflict[] = [];
  type Read = { ok: true; scaled: bigint } | { ok: false; amount: string; problem: RateTextProblem };
  const read = (text: string, allowNegative: boolean): Read => {
    const result = readRateText(text, { allowNegative });
    return result.ok ? { ok: true, scaled: result.scaled } : { ok: false, amount: String(text).trim(), problem: result.problem };
  };
  let defaultRead: Read | null = null;
  if (!isBlank(input.defaultUnitPrice)) {
    const result = read(input.defaultUnitPrice, false);
    // A card default below $0 is never usable (isUsableLine skips it), so it is no default.
    defaultRead = !result.ok && result.problem === 'below_zero' ? null : result;
  }
  const ruleReads = new Map<string, Read>();
  for (const rule of input.rules) ruleReads.set(rule.id, read(rule.amount, rule.op === 'add'));
  for (const variant of input.variants) {
    if (hand.has(variant.id)) continue;
    const matching = input.rules.filter((rule) => variant.attributes[rule.attributeId] === rule.valueId);
    if (matching.length === 0) continue;
    const sets = matching.filter((rule) => rule.op === 'set');
    const adds = matching.filter((rule) => rule.op === 'add');
    if (sets.length > 1) {
      conflicts.push({ variantId: variant.id, ruleIds: sets.map((rule) => rule.id), reason: 'two_sets' });
      continue;
    }
    const bad = matching.find((rule) => !(ruleReads.get(rule.id) as Read).ok);
    if (bad) {
      const problem = ruleReads.get(bad.id) as Extract<Read, { ok: false }>;
      if (problem.problem === 'below_zero') conflicts.push({ variantId: variant.id, ruleIds: [bad.id], reason: 'below_zero' });
      else conflicts.push({ variantId: variant.id, ruleIds: [bad.id], reason: 'bad_amount', amount: problem.amount, problem: problem.problem });
      continue;
    }
    let base: bigint;
    if (sets.length === 1) base = (ruleReads.get((sets[0] as RateRule).id) as Extract<Read, { ok: true }>).scaled;
    else if (defaultRead === null) {
      conflicts.push({ variantId: variant.id, ruleIds: adds.map((rule) => rule.id), reason: 'no_default' });
      continue;
    } else if (!defaultRead.ok) {
      conflicts.push({ variantId: variant.id, ruleIds: adds.map((rule) => rule.id), reason: 'bad_amount', amount: defaultRead.amount, problem: defaultRead.problem });
      continue;
    } else base = defaultRead.scaled;
    let price = base;
    for (const rule of adds) price += (ruleReads.get(rule.id) as Extract<Read, { ok: true }>).scaled;
    if (price < ZERO) {
      conflicts.push({ variantId: variant.id, ruleIds: matching.map((rule) => rule.id), reason: 'below_zero' });
      continue;
    }
    // The database takes rates below $1,000,000, so a sum at or above it is refused here.
    if (price > MAX_RATE_SCALED) {
      conflicts.push({ variantId: variant.id, ruleIds: matching.map((rule) => rule.id), reason: 'bad_amount', amount: fromScaled(price, 4), problem: 'too_large' });
      continue;
    }
    lines.push({ variantId: variant.id, unitPrice: fromScaled(price, 4), ruleId: (matching[0] as RateRule).id });
  }
  return { lines, conflicts };
}

/**
 * The words for a rate rule conflict: "Two rules set a price for XL Yellow." For `bad_amount`,
 * pass the conflict's `amount` and `problem`: "Use up to 4 decimals for a rate.", "The rate abc
 * is not a number." or "The rate is too large. Use up to $999,999.9999."
 */
export function rateConflictMessage(reason: RateConflictReason, variantName: string, detail: { readonly amount?: string; readonly problem?: RateTextProblem } = {}): string {
  switch (reason) {
    case 'bad_amount':
      return rateTextMessage(detail.problem ?? 'not_number', detail.amount ?? '');
    case 'two_sets':
      return `Two rules set a price for ${variantName}.`;
    case 'no_default':
      return 'Add a card rate before you add to it.';
    case 'below_zero':
      return `This rule makes the ${variantName} rate less than $0.`;
  }
}

/** A rate rule as words: "Size is XL: add $0.25". */
export function describeRateRule(rule: Pick<RateRule, 'op' | 'amount'>, attributeName: string, valueLabel: string): string {
  const read = readRateText(rule.amount, { allowNegative: true });
  // An amount that cannot be read is shown as typed (the editor flags it with rateTextMessage).
  if (!read.ok) return `${attributeName} is ${valueLabel}: ${rule.op} ${String(rule.amount).trim()}`;
  const scaled = read.scaled;
  if (rule.op === 'set') return `${attributeName} is ${valueLabel}: set ${formatUnitPrice(fromScaled(scaled, 4))}`;
  const verb = scaled < ZERO ? 'take off' : 'add';
  return `${attributeName} is ${valueLabel}: ${verb} ${formatUnitPrice(fromScaled(scaled < ZERO ? -scaled : scaled, 4))}`;
}

/* ------------------------------------------------------------------------------------------ */
/* Card summary                                                                               */
/* ------------------------------------------------------------------------------------------ */

function money(cents: string): string {
  const value = toCents(cents);
  const hundred = BigInt(100);
  return formatCents(value, { cents: value % hundred !== ZERO });
}

/**
 * One line that sums up a card version: "$1.95 per kit · $1,500 monthly · $30,000 minimum".
 * Variant rates without a card default show as a range ("$1.90 to $2.20 per kit").
 */
export function cardSummary(version: CardVersion | null, unitSingular: string): string {
  if (!version) return 'No prices yet';
  const parts: string[] = [];
  const unit = unitSingular.trim() || 'unit';
  const perUnit = version.lines.filter((line) => line.kind === 'per_unit' && isUsableLine(line));
  const cardUnit = perUnit.find((line) => line.variantId === null);
  if (cardUnit) parts.push(`${formatUnitPrice(linePrice(cardUnit))} per ${unit}`);
  else if (perUnit.length > 0) {
    const prices = perUnit.map((line) => priceToScaled(linePrice(line))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const low = prices[0] as bigint;
    const high = prices[prices.length - 1] as bigint;
    parts.push(low === high ? `${formatUnitPrice(fromScaled(low, 4))} per ${unit}` : `${formatUnitPrice(fromScaled(low, 4))} to ${formatUnitPrice(fromScaled(high, 4))} per ${unit}`);
  }
  const order = version.lines.find((line) => line.kind === 'per_order' && line.variantId === null && isUsableLine(line));
  if (order) parts.push(`${money(order.amountCents as string)} per batch`);
  const hour = version.lines.find((line) => line.kind === 'per_hour' && isUsableLine(line));
  if (hour) parts.push(`${money(String(hour.rateCents))} per hour`);
  const fee = version.lines.find((line) => line.kind === 'flat_monthly' && isUsableLine(line));
  if (fee) parts.push(`${money(fee.amountCents as string)} monthly`);
  const minimum = version.lines.find((line) => line.kind === 'monthly_minimum' && isUsableLine(line));
  if (minimum) parts.push(`${money(minimum.amountCents as string)} minimum`);
  return parts.length > 0 ? parts.join(' · ') : 'No prices yet';
}
