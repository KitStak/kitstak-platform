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

/** The `kind` line of a version for a variant, falling back to the card default line. */
function lineFor(version: CardVersion, kind: PriceLineKind, variantId: string | null, usable: (line: CardLine) => boolean): { line: CardLine; byVariant: boolean } | null {
  if (variantId !== null) {
    const own = version.lines.find((line) => line.kind === kind && line.variantId === variantId && usable(line));
    if (own) return { line: own, byVariant: true };
  }
  const card = version.lines.find((line) => line.kind === kind && line.variantId === null && usable(line));
  return card ? { line: card, byVariant: false } : null;
}

/** The unit price of one build day (3.3). Always concrete: no price is `'0.0000'` with source `none`. */
export function resolveUnitPrice(input: ResolveInput): ResolvedPrice {
  if (!isBlank(input.buildOverride)) return { unitPrice: normalize4(input.buildOverride), source: 'build', versionId: null, lineId: null };
  const version = versionFor(input.versions, input.workDate);
  if (version) {
    const found = lineFor(version, 'per_unit', input.variantId, (line) => !isBlank(line.unitPrice));
    if (found) {
      return { unitPrice: normalize4(found.line.unitPrice as string), source: found.byVariant ? 'variant' : 'card', versionId: version.id, lineId: found.line.id };
    }
  }
  if (input.jobPrices) {
    const row = priceFor(input.jobPrices, input.workDate);
    if (row && !isBlank(row.unitPrice)) return { unitPrice: normalize4(row.unitPrice), source: 'job', versionId: null, lineId: null };
  }
  return NO_PRICE;
}

/** The per batch line that charges a build finished on `finishedOn` (variant line, then the card default). */
export function orderLineFor(versions: readonly CardVersion[], variantId: string | null, finishedOn: IsoDate): { line: CardLine; version: CardVersion } | null {
  const version = versionFor(versions, finishedOn);
  if (!version) return null;
  const found = lineFor(version, 'per_order', variantId, (line) => !isBlank(line.amountCents));
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
  const usable = (line: CardLine): boolean => line.kind === 'per_hour' && line.rateCents !== null && Number.isSafeInteger(line.rateCents);
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
export type RateConflictReason = 'two_sets' | 'no_default' | 'below_zero';

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
  readonly conflicts: readonly { readonly variantId: string; readonly ruleIds: readonly string[]; readonly reason: RateConflictReason }[];
}

/**
 * Compiles rate rules into variant lines (3.3). For each variant with no hand typed line, the
 * rules matching its attributes apply: one `set` gives its amount plus the matching `add` rules;
 * only `add` rules give the card default plus their sum. Two `set` rules, `add` rules without a
 * card default, or a result below 0 are conflicts.
 */
export function compileRateRules(input: CompileRateRulesInput): CompiledRateRules {
  const hand = new Set(input.handLines.map((line) => line.variantId));
  const lines: { variantId: string; unitPrice: string; ruleId: string }[] = [];
  const conflicts: { variantId: string; ruleIds: string[]; reason: RateConflictReason }[] = [];
  const defaultScaled = isBlank(input.defaultUnitPrice) ? null : priceToScaled(input.defaultUnitPrice);
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
    let base: bigint;
    if (sets.length === 1) base = priceToScaled((sets[0] as RateRule).amount);
    else if (defaultScaled !== null) base = defaultScaled;
    else {
      conflicts.push({ variantId: variant.id, ruleIds: adds.map((rule) => rule.id), reason: 'no_default' });
      continue;
    }
    let price = base;
    for (const rule of adds) price += priceToScaled(rule.amount);
    if (price < ZERO) {
      conflicts.push({ variantId: variant.id, ruleIds: matching.map((rule) => rule.id), reason: 'below_zero' });
      continue;
    }
    lines.push({ variantId: variant.id, unitPrice: fromScaled(price, 4), ruleId: (matching[0] as RateRule).id });
  }
  return { lines, conflicts };
}

/** The words for a rate rule conflict: "Two rules set a price for XL Yellow." */
export function rateConflictMessage(reason: RateConflictReason, variantName: string): string {
  switch (reason) {
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
  const scaled = priceToScaled(rule.amount);
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
  const perUnit = version.lines.filter((line) => line.kind === 'per_unit' && !isBlank(line.unitPrice));
  const cardUnit = perUnit.find((line) => line.variantId === null);
  if (cardUnit) parts.push(`${formatUnitPrice(cardUnit.unitPrice as string)} per ${unit}`);
  else if (perUnit.length > 0) {
    const prices = perUnit.map((line) => priceToScaled(line.unitPrice as string)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const low = prices[0] as bigint;
    const high = prices[prices.length - 1] as bigint;
    parts.push(low === high ? `${formatUnitPrice(fromScaled(low, 4))} per ${unit}` : `${formatUnitPrice(fromScaled(low, 4))} to ${formatUnitPrice(fromScaled(high, 4))} per ${unit}`);
  }
  const order = version.lines.find((line) => line.kind === 'per_order' && line.variantId === null && !isBlank(line.amountCents));
  if (order) parts.push(`${money(order.amountCents as string)} per batch`);
  const hour = version.lines.find((line) => line.kind === 'per_hour' && line.rateCents !== null);
  if (hour) parts.push(`${money(String(hour.rateCents))} per hour`);
  const fee = version.lines.find((line) => line.kind === 'flat_monthly' && !isBlank(line.amountCents));
  if (fee) parts.push(`${money(fee.amountCents as string)} monthly`);
  const minimum = version.lines.find((line) => line.kind === 'monthly_minimum' && !isBlank(line.amountCents));
  if (minimum) parts.push(`${money(minimum.amountCents as string)} minimum`);
  return parts.length > 0 ? parts.join(' · ') : 'No prices yet';
}
