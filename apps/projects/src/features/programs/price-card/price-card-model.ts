/**
 * Pure helpers for the Price card tab (docs/programs/SPEC.md 5.12 and 4.4): version labels and
 * states, editor values to the draft payload (variant keys to ids, rules to ids), the two column
 * compare of two versions, and the impact text. No money math here beyond comparing strings.
 */
import { formatCents, formatUnitPrice, shortDate } from '@kitstak/programs-engine';
import type { AttributeDTO, CardLineDTO, CardLineInput, CardVersionDTO, IsoDate, RateRuleDTO, RateRuleInput, UnitLabel, VariantDTO } from '@/lib/program-types';
import { priceToInput, toCardLines, type PriceLinesValue } from '../editors/price-model';
import type { EditorAxis, EditorRule } from '../editors/variant-model';

/** "v3" or "Draft". */
export function versionName(version: Pick<CardVersionDTO, 'number' | 'status'>): string {
  return version.number ? `v${version.number}` : 'Draft';
}

/** The chip under a version: Draft, Scheduled "Starts Jan 1", In force, Ended. */
export function stateText(version: Pick<CardVersionDTO, 'state' | 'effectiveFrom'>): string {
  switch (version.state) {
    case 'draft':
      return 'Draft';
    case 'scheduled':
      return `Starts ${shortDate(version.effectiveFrom)}`;
    case 'in_force':
      return 'In force';
    case 'ended':
      return 'Ended';
  }
}

export const STATE_TONE = { draft: 'neutral', scheduled: 'info', in_force: 'success', ended: 'neutral' } as const;

/**
 * Date ranges for published versions, newest first: the in force one reads "Nov 1 to now", an
 * ended one "Sep 15 to Oct 31", a scheduled one "From Jan 1", a draft "Would start Dec 1".
 */
export function versionRanges(versions: readonly CardVersionDTO[]): Map<string, string> {
  const published = versions.filter((version) => version.status === 'published').sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const out = new Map<string, string>();
  for (const [index, version] of published.entries()) {
    const next = published[index + 1];
    if (version.state === 'scheduled') out.set(version.id, `From ${shortDate(version.effectiveFrom)}`);
    else if (version.state === 'in_force') out.set(version.id, `${shortDate(version.effectiveFrom)} to now`);
    else out.set(version.id, next ? `${shortDate(version.effectiveFrom)} to ${shortDate(dayBefore(next.effectiveFrom))}` : `From ${shortDate(version.effectiveFrom)}`);
  }
  for (const version of versions) if (version.status === 'draft') out.set(version.id, `Would start ${shortDate(version.effectiveFrom)}`);
  return out;
}

function dayBefore(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const value = new Date(Date.UTC(y, m - 1, d - 1));
  return value.toISOString().slice(0, 10);
}

/** Versions in rail order: drafts first, then published newest first. */
export function railOrder(versions: readonly CardVersionDTO[]): CardVersionDTO[] {
  const drafts = versions.filter((version) => version.status === 'draft').sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const published = versions.filter((version) => version.status === 'published').sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return [...drafts, ...published];
}

/** The version to open first: `?version=`, else the in force one, else the newest. */
export function defaultVersionId(versions: readonly CardVersionDTO[], requested: string | null | undefined): string | null {
  if (requested && versions.some((version) => version.id === requested)) return requested;
  return versions.find((version) => version.state === 'in_force')?.id ?? railOrder(versions)[0]?.id ?? null;
}

/** Saved rules as editor rules. */
export function toEditorRules(rules: readonly RateRuleDTO[]): EditorRule[] {
  return rules.map((rule) => ({ id: rule.id, attributeId: rule.attributeId, valueId: rule.valueId, op: rule.op, amount: rule.op === 'add' && rule.amount.startsWith('-') ? `-${priceToInput(rule.amount.slice(1))}` : priceToInput(rule.amount) }));
}

/** Saved attributes as editor axes. */
export function toEditorAxes(attributes: readonly AttributeDTO[]): EditorAxis[] {
  return attributes.map((attribute) => ({ id: attribute.id, name: attribute.name, values: attribute.values.map((value) => ({ id: value.id, label: value.label, code: value.code, color: value.color })) }));
}

/** Editor rules as the draft payload (ids, amount without "$"). Rules with no amount are left out. */
export function toRulePayload(rules: readonly EditorRule[]): RateRuleInput[] {
  return rules.filter((rule) => rule.amount.trim() !== '').map((rule) => ({ attributeId: rule.attributeId, valueId: rule.valueId, op: rule.op, amount: rule.amount.trim().replace('$', '') }));
}

/** Editor lines as the draft payload: variant keys become variant ids. */
export function toLinePayload(value: PriceLinesValue, variants: readonly Pick<VariantDTO, 'id' | 'key'>[]): CardLineInput[] {
  const idByKey = new Map(variants.map((variant) => [variant.key, variant.id]));
  return toCardLines(value).flatMap((line) => {
    if (!line.variantKey) return [{ ...line, variantKey: undefined }];
    const variantId = idByKey.get(line.variantKey);
    return variantId ? [{ ...line, variantKey: undefined, variantId }] : [];
  });
}

/** One line in plain words: "$1.95 per kit", "$500.00 monthly fee", "Small Brown: $2.10". */
export function lineText(line: Pick<CardLineDTO, 'kind' | 'unitPrice' | 'rateCents' | 'amountCents' | 'variantId'>, unit: UnitLabel, variantName?: string | null): string {
  switch (line.kind) {
    case 'per_unit':
      return variantName ? `${variantName}: ${formatUnitPrice(line.unitPrice)} per ${unit.singular}` : `${formatUnitPrice(line.unitPrice)} per ${unit.singular}`;
    case 'per_order':
      return `${formatCents(line.amountCents, { cents: true })} per batch${variantName ? ` · ${variantName}` : ''}`;
    case 'per_hour':
      return `${formatCents(line.rateCents, { cents: true })} an hour`;
    case 'flat_monthly':
      return `${formatCents(line.amountCents, { cents: true })} monthly fee`;
    case 'monthly_minimum':
      return `${formatCents(line.amountCents, { cents: true })} monthly minimum`;
  }
}

export const LINE_KIND_LABEL: Readonly<Record<CardLineDTO['kind'], string>> = {
  per_unit: 'Per unit',
  per_order: 'Per batch',
  per_hour: 'Per hour',
  flat_monthly: 'Monthly fee',
  monthly_minimum: 'Monthly minimum',
};

export type DiffState = 'same' | 'changed' | 'added' | 'removed';

export interface DiffRow {
  readonly slot: string;
  readonly label: string;
  readonly left: string | null;
  readonly right: string | null;
  readonly state: DiffState;
}

function lineValue(line: CardLineDTO): string {
  switch (line.kind) {
    case 'per_unit':
      return formatUnitPrice(line.unitPrice);
    case 'per_hour':
      return `${formatCents(line.rateCents, { cents: true })} an hour`;
    default:
      return formatCents(line.amountCents, { cents: true });
  }
}

/**
 * Two column compare of two versions: one row per line slot (kind plus variant) and per rule
 * (attribute plus value). Hand typed variant rates and rule made ones both show, by variant name.
 */
export function compareVersions(left: CardVersionDTO, right: CardVersionDTO, unit: UnitLabel, variantName: (id: string) => string | null): DiffRow[] {
  const rows = new Map<string, { label: string; left: string | null; right: string | null; order: number }>();
  const kindOrder: Record<CardLineDTO['kind'], number> = { per_unit: 0, per_order: 2, per_hour: 3, flat_monthly: 4, monthly_minimum: 5 };
  const put = (side: 'left' | 'right', version: CardVersionDTO) => {
    for (const line of version.lines) {
      const slot = `${line.kind}:${line.variantId ?? 'card'}`;
      const name = line.variantId ? variantName(line.variantId) ?? 'Variant' : null;
      const label = name ? `${name} · ${line.kind === 'per_unit' ? `per ${unit.singular}` : LINE_KIND_LABEL[line.kind].toLowerCase()}` : line.kind === 'per_unit' ? `Per ${unit.singular}` : LINE_KIND_LABEL[line.kind];
      const entry = rows.get(slot) ?? { label, left: null, right: null, order: kindOrder[line.kind] + (line.variantId ? 1 : 0) };
      rows.set(slot, { ...entry, [side]: lineValue(line) });
    }
    for (const rule of version.rules) {
      const slot = `rule:${rule.attributeId}:${rule.valueId}`;
      const text = rule.text.split(':');
      const entry = rows.get(slot) ?? { label: `Rule · ${text[0] ?? rule.text}`, left: null, right: null, order: 1.5 };
      rows.set(slot, { ...entry, [side]: (text.slice(1).join(':') || rule.text).trim() });
    }
  };
  put('left', left);
  put('right', right);
  return [...rows.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label))
    .map(([slot, row]) => ({ slot, label: row.label, left: row.left, right: row.right, state: row.left === null ? 'added' : row.right === null ? 'removed' : row.left === row.right ? 'same' : 'changed' }));
}

/** "+$120.00 (3%)" or "No change". */
export function deltaText(deltaCents: string, deltaBp: number | null): string {
  const value = BigInt(deltaCents);
  if (value === BigInt(0)) return 'No change';
  const sign = value > BigInt(0) ? '+' : '-';
  const abs = value < BigInt(0) ? -value : value;
  const pct = deltaBp === null ? '' : ` (${sign}${(Math.abs(deltaBp) / 100).toFixed(Math.abs(deltaBp) < 1000 ? 1 : 0)}%)`;
  return `${sign}${formatCents(abs, { cents: true })}${pct}`;
}

export const WARNING_TEXT: Readonly<Record<string, string>> = {
  no_per_unit_line: 'This version has no per unit price, so output earns nothing from it.',
  lower_than_current: 'Some rates are lower than the card in force.',
  starts_in_past: 'It starts before today, so open days get the new prices.',
  locked_days_keep_old_price: 'Closed days keep their old price.',
  unpriced_variants: 'Some variants would have no price.',
};

/** The first open day a draft may start on: the day after the last locked day, or today for non owners. */
export function firstStartDay(today: IsoDate, lockedThrough: IsoDate | null, canBackdate: boolean): IsoDate {
  const afterLock = lockedThrough ? nextDay(lockedThrough) : null;
  if (!canBackdate) return afterLock && afterLock > today ? afterLock : today;
  return afterLock ?? '2000-01-01';
}

function nextDay(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
