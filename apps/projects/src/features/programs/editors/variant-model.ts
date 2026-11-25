/**
 * Pure model behind the variant generator, Paste a list and the rate rules editor
 * (docs/programs/SPEC.md 5.4 Step 2, 5.11). Holds axes with local ids, per combination overrides
 * (include, default qty, typed rate, kit), and turns them into rows, conflicts, rule results and
 * the wizard payload. All naming, codes and conflicts come from the engine. Unit tested.
 */
import {
  MAX_AXES,
  combinationCount,
  compileRateRules,
  conflictMessage,
  defaultPatterns,
  describeRateRule,
  findConflicts,
  formatQty,
  fromScaled,
  generateVariants,
  quantityToScaled,
  rateConflictMessage,
  rateTextMessage,
  readQtyCell,
  readRateText,
  suggestCode,
  unitLabel,
  variantLimitMessage,
  type InferResult,
} from '@kitstak/programs-engine';
import type { AttributeAxisInput, ProgramWizardPayload, RateRuleInput, UnitLabel } from '@/lib/program-types';

export interface EditorValue {
  readonly id: string;
  readonly label: string;
  readonly code: string;
  readonly color: string | null;
}

export interface EditorAxis {
  readonly id: string;
  readonly name: string;
  readonly values: readonly EditorValue[];
}

export interface EditorPatterns {
  readonly name: string;
  readonly key: string;
  /** Null when the SKU pattern was cleared (variants get no SKU). */
  readonly sku: string | null;
}

export interface ComboOverride {
  readonly include?: boolean;
  readonly defaultQty?: string | null;
  /** A typed rate. It always beats rules. */
  readonly unitPrice?: string | null;
  readonly coreItemId?: string | null;
}

export interface EditorRule {
  readonly id: string;
  readonly attributeId: string;
  readonly valueId: string;
  readonly op: 'add' | 'set';
  readonly amount: string;
}

export interface VariantGeneratorValue {
  readonly axes: readonly EditorAxis[];
  readonly patterns: EditorPatterns;
  /** By combination key. */
  readonly overrides: Readonly<Record<string, ComboOverride>>;
  readonly rules: readonly EditorRule[];
  /** True once someone typed a pattern; until then patterns follow the axis names. */
  readonly patternsEdited: boolean;
}

export interface EditorRow {
  readonly comboKey: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly name: string;
  readonly key: string;
  readonly sku: string | null;
  readonly include: boolean;
  readonly defaultQty: string | null;
  readonly unitPrice: string | null;
  readonly coreItemId: string | null;
}

export type RateSource = 'typed' | 'rule' | 'card' | 'none';

export interface RowRate {
  readonly price: string | null;
  readonly source: RateSource;
  /** "Size is XL: add $0.25" when a rule made it. */
  readonly ruleText: string | null;
}

let counter = 0;
/** A short local id ("a3", "v12"). Only used inside the editor; payloads use names and codes. */
export function localId(prefix: 'a' | 'v' | 'r'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export const EMPTY_GENERATOR: VariantGeneratorValue = { axes: [], patterns: { name: '', key: '', sku: '' }, overrides: {}, rules: [], patternsEdited: false };

/* ---------------------------------------------------------------------------------------------- */
/* Axes                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export interface AxisPreset {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly values: readonly { readonly label: string; readonly code?: string; readonly color?: string }[];
}

/** "Use a preset" (5.4 Step 2). */
export const AXIS_PRESETS: readonly AxisPreset[] = [
  { id: 'sizes', label: 'Sizes S M L XL', name: 'Size', values: [{ label: 'Small', code: 'S' }, { label: 'Medium', code: 'M' }, { label: 'Large', code: 'L' }, { label: 'Extra large', code: 'XL' }] },
  { id: 'sizes-wide', label: 'Sizes XS to XXL', name: 'Size', values: [{ label: 'Extra small', code: 'XS' }, { label: 'Small', code: 'S' }, { label: 'Medium', code: 'M' }, { label: 'Large', code: 'L' }, { label: 'Extra large', code: 'XL' }, { label: '2X large', code: 'XXL' }] },
  {
    id: 'colors',
    label: 'Colors',
    name: 'Color',
    values: [
      { label: 'Black', code: 'BLK', color: 'gray' },
      { label: 'White', code: 'WHT', color: 'sky' },
      { label: 'Brown', code: 'BRN', color: 'brown' },
      { label: 'Yellow', code: 'YLW', color: 'yellow' },
      { label: 'Red', code: 'RED', color: 'red' },
      { label: 'Blue', code: 'BLU', color: 'blue' },
    ],
  },
  { id: 'sides', label: 'Left and Right', name: 'Side', values: [{ label: 'Left', code: 'L' }, { label: 'Right', code: 'R' }] },
];

/** A value for a typed label, with a code that is free on this axis. */
export function newValue(axis: Pick<EditorAxis, 'values'>, label: string, code?: string, color?: string | null): EditorValue {
  const taken = new Set(axis.values.map((value) => value.code.toUpperCase()));
  const wanted = code?.trim().toUpperCase();
  return { id: localId('v'), label: label.trim(), code: wanted && !taken.has(wanted) ? wanted : suggestCode(label, taken), color: color ?? null };
}

/** An axis from a preset (a name already used gets a number: "Size 2"). */
export function axisFromPreset(preset: AxisPreset, axes: readonly Pick<EditorAxis, 'name'>[]): EditorAxis {
  const names = new Set(axes.map((axis) => axis.name.trim().toLowerCase()));
  let name = preset.name;
  for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${preset.name} ${n}`;
  let axis: EditorAxis = { id: localId('a'), name, values: [] };
  for (const value of preset.values) axis = { ...axis, values: [...axis.values, newValue(axis, value.label, value.code, value.color ?? null)] };
  return axis;
}

export function canAddAxis(axes: readonly EditorAxis[]): boolean {
  return axes.length < MAX_AXES;
}

/** Moves an axis up (-1) or down (+1). */
export function moveAxis(axes: readonly EditorAxis[], id: string, by: -1 | 1): EditorAxis[] {
  const index = axes.findIndex((axis) => axis.id === id);
  const target = index + by;
  if (index < 0 || target < 0 || target >= axes.length) return [...axes];
  const next = [...axes];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as EditorAxis);
  return next;
}

/** Moves a value inside its axis to a new index. */
export function moveValue(axis: EditorAxis, valueId: string, toIndex: number): EditorAxis {
  const from = axis.values.findIndex((value) => value.id === valueId);
  if (from < 0) return axis;
  const values = [...axis.values];
  const [moved] = values.splice(from, 1);
  values.splice(Math.max(0, Math.min(values.length, toIndex)), 0, moved as EditorValue);
  return { ...axis, values };
}

/* ---------------------------------------------------------------------------------------------- */
/* Rows                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/** The patterns in use: typed ones, or the defaults that follow the axis names. */
export function effectivePatterns(value: Pick<VariantGeneratorValue, 'axes' | 'patterns' | 'patternsEdited'>): EditorPatterns {
  if (value.patternsEdited) return value.patterns;
  const defaults = defaultPatterns(value.axes);
  return { name: defaults.namePattern, key: defaults.keyPattern, sku: value.patterns.sku === null ? null : defaults.skuPattern };
}

export interface BuildRowsResult {
  readonly rows: readonly EditorRow[];
  /** Why rows cannot be made (too many, bad pattern, repeated attribute names), or null. */
  readonly error: string | null;
  readonly count: number;
}

/** Every combination as a row, with its overrides applied. */
export function buildRows(value: VariantGeneratorValue, programKey: string): BuildRowsResult {
  const axes = value.axes.filter((axis) => axis.values.length > 0);
  if (axes.length === 0) return { rows: [], error: null, count: 0 };
  const count = combinationCount(axes);
  if (count > 200) return { rows: [], error: variantLimitMessage(count), count };
  const patterns = effectivePatterns(value);
  try {
    const generated = generateVariants({ axes, namePattern: patterns.name, keyPattern: patterns.key, skuPattern: patterns.sku, programKey: programKey || 'KEY' });
    return {
      count,
      error: null,
      rows: generated.map((variant) => {
        const override = value.overrides[variant.comboKey] ?? {};
        return {
          comboKey: variant.comboKey,
          attributes: variant.attributes,
          name: variant.name,
          key: variant.key,
          sku: variant.sku,
          include: override.include ?? true,
          defaultQty: override.defaultQty === undefined ? null : override.defaultQty,
          unitPrice: override.unitPrice ?? null,
          coreItemId: override.coreItemId ?? null,
        };
      }),
    };
  } catch (error) {
    return { rows: [], error: error instanceof RangeError ? error.message : 'These patterns cannot make variants.', count };
  }
}

/** Sets a patch on many combinations at once (the selection toolbar). */
export function patchOverrides(overrides: Readonly<Record<string, ComboOverride>>, comboKeys: readonly string[], patch: ComboOverride): Record<string, ComboOverride> {
  const next: Record<string, ComboOverride> = { ...overrides };
  for (const key of comboKeys) next[key] = { ...next[key], ...patch };
  return next;
}

/** Row and column keys of a 2 attribute matrix. */
export function matrixKeys(rows: readonly EditorRow[], axes: readonly EditorAxis[]): { readonly byCell: ReadonlyMap<string, EditorRow>; readonly rowAxis: EditorAxis; readonly colAxis: EditorAxis } | null {
  const used = axes.filter((axis) => axis.values.length > 0);
  if (used.length !== 2) return null;
  const [rowAxis, colAxis] = used as [EditorAxis, EditorAxis];
  const byCell = new Map<string, EditorRow>();
  for (const row of rows) byCell.set(`${row.attributes[rowAxis.id]}|${row.attributes[colAxis.id]}`, row);
  return { byCell, rowAxis, colAxis };
}

/** Combination keys on one matrix row or column. */
export function lineKeys(rows: readonly EditorRow[], axisId: string, valueId: string): string[] {
  return rows.filter((row) => row.attributes[axisId] === valueId).map((row) => row.comboKey);
}

/** "8 variants · 800 kits per run at default qty" (included rows only). */
export function generatorSummary(rows: readonly EditorRow[], unit: UnitLabel): string {
  const included = rows.filter((row) => row.include);
  const total = included.reduce((sum, row) => sum + (row.defaultQty ? quantityToScaled(row.defaultQty) : BigInt(0)), BigInt(0));
  const variants = `${included.length} ${included.length === 1 ? 'variant' : 'variants'}`;
  if (total === BigInt(0)) return variants;
  return `${variants} · ${unitLabel(fromScaled(total, 3), unit)} per run at default qty`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Rates and rules                                                                                */
/* ---------------------------------------------------------------------------------------------- */

/** "Size is XL: add $0.25" for a rule, using the axis and value names. */
export function ruleText(rule: EditorRule, axes: readonly EditorAxis[]): string {
  const axis = axes.find((entry) => entry.id === rule.attributeId);
  const value = axis?.values.find((entry) => entry.id === rule.valueId);
  return describeRateRule(rule, axis?.name ?? 'Attribute', value?.label ?? 'value');
}

export interface RuleResults {
  readonly rates: ReadonlyMap<string, RowRate>;
  /** Combination key to the conflict message. */
  readonly conflicts: ReadonlyMap<string, string>;
  /** Rule id to how many variants it prices. */
  readonly ruleUse: ReadonlyMap<string, number>;
}

/**
 * The rate each row ends up with: typed beats rules, rules beat the card rate (3.3). Conflicts
 * ("Two rules set a price for XL Yellow.") come from `compileRateRules`.
 */
export function rowRates(rows: readonly EditorRow[], rules: readonly EditorRule[], axes: readonly EditorAxis[], cardRate: string | null): RuleResults {
  const typed = rows.filter((row) => row.unitPrice && readRateText(row.unitPrice).ok);
  const compiled = compileRateRules({
    defaultUnitPrice: cardRate && cardRate.trim() ? cardRate : null,
    rules,
    variants: rows.map((row) => ({ id: row.comboKey, attributes: row.attributes })),
    handLines: typed.map((row) => ({ variantId: row.comboKey, unitPrice: row.unitPrice as string })),
  });
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const fromRules = new Map(compiled.lines.map((line) => [line.variantId, line]));
  const rates = new Map<string, RowRate>();
  const ruleUse = new Map<string, number>();
  for (const row of rows) {
    if (row.unitPrice && readRateText(row.unitPrice).ok) {
      rates.set(row.comboKey, { price: (readRateText(row.unitPrice) as { price: string }).price, source: 'typed', ruleText: null });
      continue;
    }
    const line = fromRules.get(row.comboKey);
    if (line) {
      const rule = ruleById.get(line.ruleId);
      ruleUse.set(line.ruleId, (ruleUse.get(line.ruleId) ?? 0) + 1);
      rates.set(row.comboKey, { price: line.unitPrice, source: 'rule', ruleText: rule ? ruleText(rule, axes) : null });
      continue;
    }
    const card = cardRate && readRateText(cardRate).ok ? (readRateText(cardRate) as { price: string }).price : null;
    rates.set(row.comboKey, card ? { price: card, source: 'card', ruleText: null } : { price: null, source: 'none', ruleText: null });
  }
  const names = new Map(rows.map((row) => [row.comboKey, row.name]));
  const conflicts = new Map<string, string>();
  for (const conflict of compiled.conflicts) conflicts.set(conflict.variantId, rateConflictMessage(conflict.reason, names.get(conflict.variantId) ?? 'this variant', { amount: conflict.amount, problem: conflict.problem }));
  return { rates, conflicts, ruleUse };
}

/** Problems with a typed rate cell, or null. */
export function rateCellProblem(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const read = readRateText(text);
  if (read.ok) return null;
  return rateTextMessage(read.problem, text);
}

/** Problems with a typed default qty cell, or null. */
export function qtyCellProblem(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const read = readQtyCell(text, 'qty');
  if ('why' in read) return read.why;
  if (quantityToScaled(read.plain) <= BigInt(0)) return 'Default qty must be more than 0.';
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Conflicts                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** Clashes with existing variants and among included rows: combination key to the message. */
export function rowConflicts(rows: readonly EditorRow[], existing: readonly { readonly key: string; readonly name: string; readonly sku: string | null; readonly attributes: Record<string, string> }[] = []): ReadonlyMap<string, string> {
  const included = rows.filter((row) => row.include);
  const out = new Map<string, string>();
  for (const conflict of findConflicts(included, existing)) {
    if (!out.has(conflict.comboKey)) out.set(conflict.comboKey, conflictMessage(conflict));
  }
  return out;
}

type ExistingVariant = { readonly key: string; readonly name: string; readonly sku: string | null; readonly attributes: Record<string, string> };

/** True when the row's attribute combination is one the program already has. */
function matchesExisting(row: EditorRow, existing: readonly ExistingVariant[]): boolean {
  const keys = Object.keys(row.attributes);
  if (keys.length === 0) return false;
  return existing.some((variant) => keys.length === Object.keys(variant.attributes).length && keys.every((key) => variant.attributes[key] === row.attributes[key]));
}

/**
 * The combinations the program already has (Add variants, Edit attributes). With `lockedExisting`
 * the generator shows them checked and locked with "Already a variant", and leaves them out of the
 * new count and the conflict checks.
 */
export function existingComboKeys(rows: readonly EditorRow[], existing: readonly ExistingVariant[]): ReadonlySet<string> {
  return new Set(rows.filter((row) => matchesExisting(row, existing)).map((row) => row.comboKey));
}

/** The included rows that would be new variants (not already in the program). */
export function newRows(rows: readonly EditorRow[], existing: readonly ExistingVariant[]): EditorRow[] {
  const locked = existingComboKeys(rows, existing);
  return rows.filter((row) => row.include && !locked.has(row.comboKey));
}

/** "2 new variants · 200 kits per run at default qty · 8 already in the program". */
export function newVariantsSummary(rows: readonly EditorRow[], existing: readonly ExistingVariant[], unit: UnitLabel): string {
  const locked = existingComboKeys(rows, existing);
  const fresh = rows.filter((row) => !locked.has(row.comboKey));
  const included = fresh.filter((row) => row.include);
  const total = included.reduce((sum, row) => sum + (row.defaultQty ? quantityToScaled(row.defaultQty) : BigInt(0)), BigInt(0));
  const parts = [`${included.length} new ${included.length === 1 ? 'variant' : 'variants'}`];
  if (total > BigInt(0)) parts.push(`${unitLabel(fromScaled(total, 3), unit)} per run at default qty`);
  if (locked.size > 0) parts.push(`${locked.size} already in the program`);
  return parts.join(' · ');
}

/* ---------------------------------------------------------------------------------------------- */
/* Paste a list                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/**
 * The generator value for an `inferAxes` result: axes with their codes, and each pasted row's qty
 * and rate as overrides on its combination. Combinations nobody pasted are left out.
 */
export function valueFromInferred(result: InferResult, previous: VariantGeneratorValue = EMPTY_GENERATOR): VariantGeneratorValue {
  const axes: EditorAxis[] = result.axes.map((axis) => {
    let next: EditorAxis = { id: localId('a'), name: axis.name, values: [] };
    for (const value of axis.values) next = { ...next, values: [...next.values, newValue(next, value.label, value.code)] };
    return next;
  });
  const overrides: Record<string, ComboOverride> = {};
  const pasted = new Set<string>();
  for (const row of result.rows) {
    const parts: string[] = [];
    for (const axis of axes) {
      const label = row.attributes[axis.name];
      const value = axis.values.find((entry) => entry.label === label);
      if (value) parts.push(`${axis.id}=${value.id}`);
    }
    if (parts.length !== axes.length) continue;
    const comboKey = parts.join('|');
    pasted.add(comboKey);
    overrides[comboKey] = { include: true, defaultQty: row.qty ? row.qty : null, unitPrice: row.rate ? row.rate : null };
  }
  // Leave out combinations the list did not have (a sparse list stays sparse).
  const all = axes.reduce<string[]>((keys, axis) => (keys.length === 0 ? axis.values.map((value) => `${axis.id}=${value.id}`) : keys.flatMap((key) => axis.values.map((value) => `${key}|${axis.id}=${value.id}`))), []);
  for (const key of all) if (!pasted.has(key)) overrides[key] = { include: false };
  return { ...previous, axes, overrides, rules: [], patternsEdited: false };
}

/** "Found 2 attributes and 8 kits". */
export function foundText(result: Pick<InferResult, 'axes' | 'rows'>, unit: UnitLabel): string {
  const axes = `${result.axes.length} ${result.axes.length === 1 ? 'attribute' : 'attributes'}`;
  return `Found ${axes} and ${unitLabel(String(result.rows.length), unit)}`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Payload                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/** Axes as the payload wants them (names and codes, no local ids). */
export function toAxisInputs(axes: readonly EditorAxis[]): AttributeAxisInput[] {
  return axes.filter((axis) => axis.values.length > 0).map((axis) => ({ name: axis.name.trim(), values: axis.values.map((value) => ({ label: value.label, code: value.code, color: value.color })) }));
}

/** Rules as the wizard payload wants them: attribute name and value code. */
export function toRuleInputs(rules: readonly EditorRule[], axes: readonly EditorAxis[]): RateRuleInput[] {
  const out: RateRuleInput[] = [];
  for (const rule of rules) {
    const axis = axes.find((entry) => entry.id === rule.attributeId);
    const value = axis?.values.find((entry) => entry.id === rule.valueId);
    if (!axis || !value || !rule.amount.trim()) continue;
    out.push({ attributeId: axis.name.trim(), valueId: value.code, op: rule.op, amount: rule.amount.trim() });
  }
  return out;
}

/** The wizard `variants.rows` (every combination, with include). */
export function toPayloadRows(rows: readonly EditorRow[]): ProgramWizardPayload['variants']['rows'] {
  return rows.map((row) => ({
    comboKey: row.comboKey,
    include: row.include,
    name: row.name,
    key: row.key,
    sku: row.sku,
    defaultQty: row.defaultQty ? qtyPlain(row.defaultQty) : null,
    unitPrice: row.unitPrice && readRateText(row.unitPrice).ok ? (readRateText(row.unitPrice) as { price: string }).price : null,
    coreItemId: row.coreItemId,
  }));
}

function qtyPlain(text: string): string {
  return formatQty(text.replace(/,/g, '')).replace(/,/g, '');
}
