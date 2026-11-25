/**
 * Pure model of the New program wizard (docs/programs/SPEC.md 5.4): the editable state (saved as
 * a draft as is), the steps that show for a start mode, what to fix on each step, the live
 * projection for the preview rail and the price card step, the checklist, and the
 * `ProgramWizardPayload` that `createProgramAction` takes. No React here; unit tested.
 */
import {
  addDays,
  firstDayOfMonth,
  formatCents,
  fromScaled,
  monthOf,
  mulQuantityPrice,
  projectMonth,
  quantityToScaled,
  shiftMonth,
  unitLabel,
  type CardLine,
  type CardVersion,
  type ProgramCalendar,
} from '@kitstak/programs-engine';
import type { IsoDate, ProgramWizardPayload, UnitLabel } from '@/lib/program-types';
import type { ProjectRole } from '@/lib/constants';
import {
  DEFAULT_PRICE_LINES,
  EMPTY_GENERATOR,
  buildRows,
  centsToDollars,
  localId,
  newValue,
  priceLinesProblems,
  priceToInput,
  qtyCellProblem,
  rateCellProblem,
  readMoney,
  rowConflicts,
  rowRates,
  scheduleProblems,
  toAxisInputs,
  toCardLines,
  toOneTimeInputs,
  toPayloadRows,
  toRuleInputs,
  toSchedulePayload,
  type EditorAxis,
  type EditorRule,
  type OneTimeRow,
  type PriceLinesValue,
  type ScheduleEditorValue,
  type VariantGeneratorValue,
} from '@/features/programs/editors';

/* ---------------------------------------------------------------------------------------------- */
/* State                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export type StartMode = 'scratch' | 'deal' | 'template' | 'copy' | 'quick';
export type StepId = 'start' | 'basics' | 'variants' | 'price' | 'schedule' | 'review';
export type UnitChoice = 'kits' | 'orders' | 'units' | 'packs' | 'boxes' | 'custom';
export type VariantMode = 'matrix' | 'paste' | 'list';

export const ALL_STEPS: readonly { readonly id: StepId; readonly title: string }[] = [
  { id: 'start', title: 'Start' },
  { id: 'basics', title: 'Basics' },
  { id: 'variants', title: 'Variants' },
  { id: 'price', title: 'Price card' },
  { id: 'schedule', title: 'Schedule' },
  { id: 'review', title: 'Links and review' },
];

export const UNIT_CHOICES: readonly { readonly value: UnitChoice; readonly label: string; readonly unit: UnitLabel | null }[] = [
  { value: 'kits', label: 'Kits', unit: { singular: 'kit', plural: 'kits' } },
  { value: 'orders', label: 'Orders', unit: { singular: 'order', plural: 'orders' } },
  { value: 'units', label: 'Units', unit: { singular: 'unit', plural: 'units' } },
  { value: 'packs', label: 'Packs', unit: { singular: 'pack', plural: 'packs' } },
  { value: 'boxes', label: 'Boxes', unit: { singular: 'box', plural: 'boxes' } },
  { value: 'custom', label: 'Custom', unit: null },
];

export interface CopyInclude {
  readonly variants: boolean;
  readonly priceCard: boolean;
  readonly schedules: boolean;
  readonly members: boolean;
  readonly links: boolean;
}

export interface ManualRow {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly sku: string;
  readonly defaultQty: string;
  readonly unitPrice: string;
}

export interface WizardState {
  readonly v: 1;
  readonly step: StepId;
  readonly start: {
    readonly mode: StartMode | null;
    readonly crmItemId: string | null;
    readonly crmItemTitle: string | null;
    readonly templateId: string | null;
    readonly templateName: string | null;
    readonly copyKey: string | null;
    readonly copyInclude: CopyInclude;
  };
  readonly basics: {
    readonly name: string;
    readonly key: string;
    /** True once someone typed the key; until then it follows the name. */
    readonly keyEdited: boolean;
    readonly description: string;
    readonly customer: { readonly kind: 'core' | 'crm_account'; readonly id: string; readonly name: string } | null;
    readonly ownerId: string;
    readonly startDate: IsoDate;
    readonly endDate: IsoDate | null;
    readonly unitChoice: UnitChoice;
    readonly customOne: string;
    readonly customMany: string;
    readonly timezone: string;
    readonly useWorkspace: boolean;
    readonly workingDays: readonly number[];
    readonly extraDaysOff: readonly IsoDate[];
    readonly extraWorkDays: readonly IsoDate[];
    readonly color: string;
    readonly icon: string;
    /** Dollars as typed. */
    readonly target: string;
  };
  readonly variants: {
    readonly mode: VariantMode;
    readonly generator: VariantGeneratorValue;
    readonly pasteText: string;
    readonly manual: readonly ManualRow[];
  };
  readonly price: {
    readonly later: boolean;
    readonly effectiveFrom: IsoDate;
    readonly lines: PriceLinesValue;
    readonly oneTime: readonly OneTimeRow[];
    /** Lines filled from the CRM deal (they show a "From deal" chip). */
    readonly fromDeal: readonly ('perUnit' | 'monthlyFee' | 'minimum')[];
  };
  readonly schedule: ScheduleEditorValue;
  readonly links: {
    readonly members: readonly { readonly userId: string; readonly role: ProjectRole }[];
    readonly crmDealId: string | null;
    readonly crmDealTitle: string | null;
    readonly crmAccountId: string | null;
    readonly crmAccountTitle: string | null;
    readonly pulse: 'none' | 'link' | 'new';
    readonly pulseJobId: string | null;
    readonly projectIds: readonly string[];
    /** Null follows the default (on when there is no schedule). */
    readonly openPlanner: boolean | null;
    readonly importPast: boolean;
  };
}

export interface WizardEnv {
  readonly today: IsoDate;
  readonly userId: string;
  readonly timezone: string;
  readonly workingDays: readonly number[];
  readonly holidays: readonly { readonly date: IsoDate; readonly name: string }[];
}

const DEFAULT_COPY: CopyInclude = { variants: true, priceCard: true, schedules: true, members: true, links: false };

export function emptyState(env: WizardEnv): WizardState {
  return {
    v: 1,
    step: 'start',
    start: { mode: null, crmItemId: null, crmItemTitle: null, templateId: null, templateName: null, copyKey: null, copyInclude: DEFAULT_COPY },
    basics: {
      name: '',
      key: '',
      keyEdited: false,
      description: '',
      customer: null,
      ownerId: env.userId,
      startDate: env.today,
      endDate: null,
      unitChoice: 'kits',
      customOne: '',
      customMany: '',
      timezone: env.timezone,
      useWorkspace: true,
      workingDays: env.workingDays,
      extraDaysOff: [],
      extraWorkDays: [],
      color: 'orange',
      icon: 'package',
      target: '',
    },
    variants: { mode: 'matrix', generator: EMPTY_GENERATOR, pasteText: '', manual: [] },
    price: { later: false, effectiveFrom: env.today, lines: DEFAULT_PRICE_LINES, oneTime: [], fromDeal: [] },
    schedule: { enabled: true, name: '', pattern: 'weekdays', days: [1, 2, 3, 4, 5], intervalWeeks: 1, startsOn: env.today, endsOn: null, leadDays: 7, skipHolidays: true, lines: [] },
    links: { members: [], crmDealId: null, crmDealTitle: null, crmAccountId: null, crmAccountTitle: null, pulse: 'none', pulseJobId: null, projectIds: [], openPlanner: null, importPast: false },
  };
}

/** Reads a saved draft; anything that does not look like wizard state starts fresh. */
export function stateFromDraft(payload: unknown, env: WizardEnv): WizardState | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Partial<WizardState>;
  if (value.v !== 1 || !value.basics || !value.variants || !value.price || !value.schedule || !value.links || !value.start) return null;
  const base = emptyState(env);
  return {
    ...base,
    ...value,
    start: { ...base.start, ...value.start },
    basics: { ...base.basics, ...value.basics },
    variants: { ...base.variants, ...value.variants },
    price: { ...base.price, ...value.price, lines: { ...base.price.lines, ...value.price.lines } },
    schedule: { ...base.schedule, ...value.schedule },
    links: { ...base.links, ...value.links },
  } as WizardState;
}

export function unitOf(basics: WizardState['basics']): UnitLabel {
  if (basics.unitChoice === 'custom') {
    const one = basics.customOne.trim() || 'unit';
    return { singular: one, plural: basics.customMany.trim() || `${one}s` };
  }
  return UNIT_CHOICES.find((choice) => choice.value === basics.unitChoice)?.unit ?? { singular: 'kit', plural: 'kits' };
}

function choiceFor(unit: UnitLabel): Pick<WizardState['basics'], 'unitChoice' | 'customOne' | 'customMany'> {
  const found = UNIT_CHOICES.find((choice) => choice.unit && choice.unit.plural.toLowerCase() === unit.plural.toLowerCase());
  return found ? { unitChoice: found.value, customOne: '', customMany: '' } : { unitChoice: 'custom', customOne: unit.singular, customMany: unit.plural };
}

/* ---------------------------------------------------------------------------------------------- */
/* Prefill                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Wizard state from a server prefill (deal, template, copy or customer). Inputs from the prefill
 * become the starting values; nothing is locked.
 */
export function stateFromPrefill(prefill: ProgramWizardPayload, env: WizardEnv, extra: { readonly customerName?: string | null; readonly crmItemTitle?: string | null; readonly templateName?: string | null } = {}): WizardState {
  const base = emptyState(env);
  const b = prefill.basics;
  // Axes with local ids; rules point at those ids.
  const axes: EditorAxis[] = prefill.variants.axes.map((axis) => {
    let next: EditorAxis = { id: localId('a'), name: axis.name, values: [] };
    for (const value of axis.values) next = { ...next, values: [...next.values, newValue(next, value.label, value.code, value.color ?? null)] };
    return next;
  });
  const idOfAxis = new Map<string, EditorAxis>();
  prefill.variants.axes.forEach((axis, index) => {
    const local = axes[index]!;
    idOfAxis.set(axis.id ?? axis.name, local);
    idOfAxis.set(axis.name, local);
  });
  const valueOf = (axis: EditorAxis, ref: string) => {
    const source = prefill.variants.axes[axes.indexOf(axis)];
    const index = source?.values.findIndex((value) => value.id === ref || value.code === ref || value.label === ref) ?? -1;
    return index >= 0 ? axis.values[index] : undefined;
  };
  const generator: VariantGeneratorValue = { ...EMPTY_GENERATOR, axes, rules: [] as EditorRule[] };
  // Variant keys and rates the server gave, by combination of local ids.
  const overrides: Record<string, { include: boolean; defaultQty: string | null; unitPrice: string | null; coreItemId: string | null }> = {};
  if (axes.length > 0) {
    const all = buildRows(generator, b.key);
    const seen = new Set<string>();
    for (const row of prefill.variants.rows) {
      const parts = row.comboKey.split('|').map((part) => part.split('='));
      const attrs: Record<string, string> = {};
      parts.forEach(([axisRef, valueRef], index) => {
        const axis = idOfAxis.get(axisRef ?? '') ?? axes[index];
        const value = axis ? valueOf(axis, valueRef ?? '') : undefined;
        if (axis && value) attrs[axis.id] = value.id;
      });
      const combo = axes.map((axis) => `${axis.id}=${attrs[axis.id] ?? ''}`).join('|');
      seen.add(combo);
      overrides[combo] = { include: row.include, defaultQty: row.defaultQty, unitPrice: row.unitPrice ? priceToInput(row.unitPrice) : null, coreItemId: row.coreItemId ?? null };
    }
    if (prefill.variants.rows.length > 0) for (const row of all.rows) if (!seen.has(row.comboKey)) overrides[row.comboKey] = { include: false, defaultQty: null, unitPrice: null, coreItemId: null };
  }
  const rules: EditorRule[] = [];
  for (const rule of prefill.priceCard.rules) {
    const axis = idOfAxis.get(rule.attributeId);
    const value = axis ? valueOf(axis, rule.valueId) : undefined;
    if (axis && value) rules.push({ id: localId('r'), attributeId: axis.id, valueId: value.id, op: rule.op, amount: rule.amount });
  }
  const manual: ManualRow[] = prefill.variants.manual.map((row) => ({ id: localId('v'), name: row.name, key: row.key, sku: row.sku ?? '', defaultQty: row.defaultQty ? row.defaultQty.replace(/\.0+$/, '') : '', unitPrice: row.unitPrice ? priceToInput(row.unitPrice) : '' }));
  // Price lines.
  let lines: PriceLinesValue = { ...DEFAULT_PRICE_LINES };
  const variantRates: Record<string, string> = {};
  for (const line of prefill.priceCard.lines) {
    if (line.kind === 'per_unit' && line.variantKey) variantRates[line.variantKey] = priceToInput(line.unitPrice);
    else if (line.kind === 'per_unit') lines = { ...lines, perUnit: { on: true, price: priceToInput(line.unitPrice), label: line.label ?? null } };
    else if (line.kind === 'per_order') lines = { ...lines, perOrder: { on: true, amount: centsToDollars(line.amountCents), label: line.label ?? null } };
    else if (line.kind === 'per_hour') lines = { ...lines, perHour: { on: true, rate: line.rateCents === null || line.rateCents === undefined ? '' : centsToDollars(line.rateCents), countAllTime: false, label: line.label ?? null } };
    else {
      const fixed = { on: true, amount: centsToDollars(line.amountCents), partialMonth: line.prorate ?? true, chargeWhilePaused: line.chargeWhilePaused ?? true, label: line.label ?? null };
      lines = line.kind === 'flat_monthly' ? { ...lines, monthlyFee: fixed } : { ...lines, minimum: fixed };
    }
  }
  const fromDeal: ('perUnit' | 'monthlyFee' | 'minimum')[] = [];
  if (prefill.start.mode === 'deal') {
    if (lines.perUnit.price) fromDeal.push('perUnit');
    if (lines.monthlyFee.on) fromDeal.push('monthlyFee');
    if (lines.minimum.on) fromDeal.push('minimum');
  }
  const hadPrice = prefill.priceCard.lines.length > 0;
  const variantMode: VariantMode = prefill.variants.mode === 'list' && manual.length > 0 ? 'list' : 'matrix';
  return {
    ...base,
    start: {
      ...base.start,
      mode: prefill.start.mode,
      crmItemId: prefill.start.crmItemId ?? null,
      crmItemTitle: extra.crmItemTitle ?? null,
      templateId: prefill.start.templateId ?? null,
      templateName: extra.templateName ?? null,
      copyKey: prefill.start.copyKey ?? null,
    },
    basics: {
      ...base.basics,
      name: b.name,
      key: b.key,
      keyEdited: Boolean(b.key),
      description: b.description ?? '',
      customer: b.customer ? { ...b.customer, name: extra.customerName ?? 'Customer' } : null,
      ownerId: b.ownerId || env.userId,
      startDate: b.startDate,
      endDate: b.endDate ?? null,
      ...choiceFor(b.unit),
      timezone: b.timezone || env.timezone,
      useWorkspace: b.calendar.useWorkspace,
      workingDays: b.calendar.workingDays ?? env.workingDays,
      extraDaysOff: b.calendar.extraDaysOff,
      extraWorkDays: b.calendar.extraWorkDays,
      color: b.color ?? base.basics.color,
      icon: b.icon ?? base.basics.icon,
      target: b.monthlyTargetCents ? centsToDollars(b.monthlyTargetCents) : '',
    },
    variants: { ...base.variants, mode: variantMode, generator: { ...generator, overrides, rules }, manual },
    price: {
      later: prefill.priceCard.later,
      effectiveFrom: prefill.priceCard.effectiveFrom || b.startDate,
      lines: { ...lines, variantRates: { ...lines.variantRates, ...variantRates }, perUnit: hadPrice ? lines.perUnit : base.price.lines.perUnit },
      oneTime: prefill.priceCard.oneTime.map((charge) => ({ id: localId('r'), label: charge.label, amount: centsToDollars(charge.amountCents), chargeOn: charge.chargeOn })),
      fromDeal,
    },
    schedule: {
      ...base.schedule,
      enabled: prefill.start.mode === 'copy' ? prefill.schedule.enabled : true,
      name: prefill.schedule.name,
      pattern: prefill.schedule.pattern,
      days: prefill.schedule.days.length ? prefill.schedule.days : base.schedule.days,
      intervalWeeks: prefill.schedule.intervalWeeks,
      startsOn: prefill.schedule.startsOn || b.startDate,
      endsOn: prefill.schedule.endsOn,
      leadDays: prefill.schedule.leadDays,
      lines: prefill.schedule.lines.map((line) => ({ variantKey: line.variantKey, include: true, qty: line.qty.replace(/\.0+$/, ''), qtyByWeekday: line.qtyByWeekday ?? null, assigneeId: line.assigneeId ?? null })),
    },
    links: {
      ...base.links,
      members: prefill.links.members ?? [],
      crmDealId: prefill.links.crmDealId ?? null,
      crmDealTitle: extra.crmItemTitle ?? null,
      crmAccountId: prefill.links.crmAccountId ?? null,
      projectIds: prefill.links.projectIds ?? [],
    },
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Steps                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** Step 0 shows unless the URL already said how to start (5.4). */
export function visibleSteps(skipStart: boolean): readonly { readonly id: StepId; readonly title: string }[] {
  return skipStart ? ALL_STEPS.filter((step) => step.id !== 'start') : ALL_STEPS;
}

/** "Step 2 of 6 · Variants" for small screens. */
export function stepCaption(steps: readonly { readonly id: StepId; readonly title: string }[], current: StepId): string {
  const index = Math.max(0, steps.findIndex((step) => step.id === current));
  return `Step ${index + 1} of ${steps.length} · ${steps[index]?.title ?? ''}`;
}

/** The draft's step number (0 is Start), for "Step 3 of 6" on draft chips. */
export function stepNumber(step: StepId): number {
  return ALL_STEPS.findIndex((entry) => entry.id === step);
}

export function stepFromNumber(step: number): StepId {
  return ALL_STEPS[Math.max(0, Math.min(ALL_STEPS.length - 1, step))]!.id;
}

/* ---------------------------------------------------------------------------------------------- */
/* Variants as the later steps see them                                                           */
/* ---------------------------------------------------------------------------------------------- */

export interface WizardVariant {
  readonly key: string;
  readonly name: string;
  readonly sku: string | null;
  readonly color: string | null;
  readonly defaultQty: string | null;
  /** Combination key (matrix) or the manual row id. */
  readonly ref: string;
  /** The rate typed for this variant, as typed. */
  readonly typedRate: string | null;
  readonly attributes: Readonly<Record<string, string>>;
}

/** Included variants, in order, whatever mode made them. */
export function wizardVariants(state: WizardState): WizardVariant[] {
  if (state.variants.mode === 'list') {
    return state.variants.manual
      .filter((row) => row.name.trim() && row.key.trim())
      .map((row) => ({ key: row.key.trim().toUpperCase(), name: row.name.trim(), sku: row.sku.trim() || null, color: null, defaultQty: row.defaultQty.trim() || null, ref: row.id, typedRate: row.unitPrice.trim() || null, attributes: {} }));
  }
  const { rows } = buildRows(state.variants.generator, state.basics.key);
  const axes = state.variants.generator.axes;
  return rows
    .filter((row) => row.include)
    .map((row) => {
      // The variant color follows the first attribute value that has one (Brown, Yellow).
      let color: string | null = null;
      for (const axis of axes) {
        const value = axis.values.find((entry) => entry.id === row.attributes[axis.id]);
        if (value?.color) {
          color = value.color;
          break;
        }
      }
      return { key: row.key, name: row.name, sku: row.sku, color, defaultQty: row.defaultQty, ref: row.comboKey, typedRate: row.unitPrice, attributes: row.attributes };
    });
}

/** Each included variant's rate on the card: typed, from a rule, the card rate, or none. */
export function variantRates(state: WizardState): Map<string, { readonly price: string | null; readonly source: 'typed' | 'rule' | 'card' | 'none'; readonly ruleText: string | null }> {
  const cardRate = state.price.lines.perUnit.on && state.price.lines.perUnit.price.trim() ? state.price.lines.perUnit.price : null;
  const out = new Map<string, { price: string | null; source: 'typed' | 'rule' | 'card' | 'none'; ruleText: string | null }>();
  if (state.variants.mode === 'list') {
    for (const variant of wizardVariants(state)) {
      const typed = variant.typedRate && !rateCellProblem(variant.typedRate) ? variant.typedRate : null;
      out.set(variant.key, typed ? { price: typed, source: 'typed', ruleText: null } : cardRate ? { price: cardRate, source: 'card', ruleText: null } : { price: null, source: 'none', ruleText: null });
    }
    return out;
  }
  const { rows } = buildRows(state.variants.generator, state.basics.key);
  const included = rows.filter((row) => row.include);
  const results = rowRates(included, state.variants.generator.rules, state.variants.generator.axes, cardRate);
  for (const row of included) {
    const rate = results.rates.get(row.comboKey);
    if (rate) out.set(row.key, rate);
  }
  return out;
}

/** Sets (or clears) the typed rate of one variant, whichever mode made it. */
export function setTypedRate(state: WizardState, variantKey: string, rate: string): WizardState {
  const variant = wizardVariants(state).find((entry) => entry.key === variantKey);
  if (!variant) return state;
  if (state.variants.mode === 'list') {
    return { ...state, variants: { ...state.variants, manual: state.variants.manual.map((row) => (row.id === variant.ref ? { ...row, unitPrice: rate } : row)) } };
  }
  const generator = state.variants.generator;
  const overrides = { ...generator.overrides, [variant.ref]: { ...generator.overrides[variant.ref], unitPrice: rate.trim() ? rate : null } };
  return { ...state, variants: { ...state.variants, generator: { ...generator, overrides } } };
}

/* ---------------------------------------------------------------------------------------------- */
/* Validation                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

const KEY = /^[A-Z][A-Z0-9]{1,5}$/;

export type Problems = Readonly<Record<string, string>>;

export function basicsProblems(state: WizardState, taken: ReadonlyMap<string, string> = new Map()): Problems {
  const b = state.basics;
  const out: Record<string, string> = {};
  if (!b.name.trim()) out.name = 'Give the program a name.';
  else if (b.name.trim().length > 80) out.name = 'Use up to 80 characters.';
  const key = b.key.trim().toUpperCase();
  if (!key) out.key = 'Add a key.';
  else if (!KEY.test(key)) out.key = 'Use 2 to 6 letters or numbers, starting with a letter.';
  else if (taken.has(key)) out.key = taken.get(key)!;
  if (!b.startDate) out.startDate = 'Pick the start date.';
  if (b.endDate && b.startDate && b.endDate < b.startDate) out.endDate = 'The end has to be on or after the start.';
  if (!b.useWorkspace && b.workingDays.length === 0) out.workingDays = 'Pick at least one work day.';
  if (b.unitChoice === 'custom' && (!b.customOne.trim() || !b.customMany.trim())) out.unit = 'Name one unit and many units.';
  if (b.target.trim()) {
    const read = readMoney(b.target);
    if (!read.ok) out.target = read.message;
  }
  return out;
}

export function variantsProblems(state: WizardState): Problems {
  const out: Record<string, string> = {};
  if (state.variants.mode === 'list') {
    const rows = state.variants.manual.filter((row) => row.name.trim() || row.key.trim() || row.sku.trim());
    if (rows.length === 0) out.variants = 'Add at least one variant.';
    const keys = new Map<string, number>();
    const skus = new Map<string, number>();
    const names = new Map<string, number>();
    for (const row of rows) {
      const key = row.key.trim().toUpperCase();
      if (!row.name.trim()) out[`row:${row.id}`] = 'Name the variant.';
      else if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(key)) out[`row:${row.id}`] = 'Use up to 16 letters, numbers or dashes for the key.';
      else if (qtyCellProblem(row.defaultQty)) out[`row:${row.id}`] = qtyCellProblem(row.defaultQty)!;
      else if (rateCellProblem(row.unitPrice)) out[`row:${row.id}`] = rateCellProblem(row.unitPrice)!;
      keys.set(key, (keys.get(key) ?? 0) + 1);
      names.set(row.name.trim().toLowerCase(), (names.get(row.name.trim().toLowerCase()) ?? 0) + 1);
      if (row.sku.trim()) skus.set(row.sku.trim().toUpperCase(), (skus.get(row.sku.trim().toUpperCase()) ?? 0) + 1);
    }
    for (const row of rows) {
      if (out[`row:${row.id}`]) continue;
      if ((keys.get(row.key.trim().toUpperCase()) ?? 0) > 1) out[`row:${row.id}`] = `Another variant already uses the key ${row.key.trim().toUpperCase()}.`;
      else if ((names.get(row.name.trim().toLowerCase()) ?? 0) > 1) out[`row:${row.id}`] = `Another variant is already named ${row.name.trim()}.`;
      else if (row.sku.trim() && (skus.get(row.sku.trim().toUpperCase()) ?? 0) > 1) out[`row:${row.id}`] = `Another variant already uses ${row.sku.trim().toUpperCase()}.`;
    }
    return out;
  }
  if (state.variants.mode === 'paste' && state.variants.generator.axes.length === 0) {
    out.variants = 'Paste your list, then choose Use these kits.';
    return out;
  }
  const built = buildRows(state.variants.generator, state.basics.key);
  if (built.error) out.variants = built.error;
  const included = built.rows.filter((row) => row.include);
  if (!built.error && included.length === 0) out.variants = 'Include at least one variant.';
  for (const [combo, message] of rowConflicts(built.rows)) out[`row:${combo}`] = message;
  for (const row of included) {
    const problem = qtyCellProblem(row.defaultQty) ?? rateCellProblem(row.unitPrice);
    if (problem) out[`row:${row.comboKey}`] = problem;
  }
  // The card rate comes on the next step: an "add" rule is checked against it there.
  const cardRate = state.price.lines.perUnit.on && state.price.lines.perUnit.price.trim() ? state.price.lines.perUnit.price : '0';
  const rules = rowRates(included, state.variants.generator.rules, state.variants.generator.axes, cardRate);
  const first = [...rules.conflicts.values()][0];
  if (first) out.rules = first;
  for (const rule of state.variants.generator.rules) if (!rule.amount.trim()) out.rules = out.rules ?? 'Type an amount for each rule, or remove it.';
  return out;
}

/** Rule problems against the real card rate (an "add" rule needs a per unit rate). */
function ruleProblemsWithCard(state: WizardState): string | null {
  if (state.variants.mode === 'list' || state.variants.generator.rules.length === 0) return null;
  const included = buildRows(state.variants.generator, state.basics.key).rows.filter((row) => row.include);
  const cardRate = state.price.lines.perUnit.on && state.price.lines.perUnit.price.trim() ? state.price.lines.perUnit.price : null;
  const results = rowRates(included, state.variants.generator.rules, state.variants.generator.axes, cardRate);
  return [...results.conflicts.values()][0] ?? null;
}

export function priceProblems(state: WizardState): Problems {
  if (state.price.later) return {};
  const out: Record<string, string> = {};
  for (const [field, message] of Object.entries(priceLinesProblems(state.price.lines))) if (message) out[field] = message;
  const ruleProblem = ruleProblemsWithCard(state);
  if (ruleProblem && !out.perUnit) out.perUnit = ruleProblem;
  if (state.price.effectiveFrom && state.basics.startDate && state.price.effectiveFrom < state.basics.startDate) out.effectiveFrom = 'The card cannot start before the program does.';
  for (const row of state.price.oneTime) {
    if (!row.label.trim()) out[`fee:${row.id}`] = 'Name the charge.';
    else {
      const read = readMoney(row.amount);
      if (!read.ok) out[`fee:${row.id}`] = read.message;
      else if (row.chargeOn < state.basics.startDate) out[`fee:${row.id}`] = 'The day cannot be before the program starts.';
    }
  }
  return out;
}

export function scheduleStepProblems(state: WizardState): Problems {
  const out: Record<string, string> = {};
  for (const [field, message] of Object.entries(scheduleProblems(state.schedule))) if (message) out[field] = message;
  if (state.schedule.enabled && state.schedule.startsOn < state.basics.startDate) out.startsOn = 'The first day cannot be before the program starts.';
  return out;
}

export function reviewProblems(state: WizardState): Problems {
  if (state.links.pulse === 'link' && !state.links.pulseJobId) return { pulse: 'Pick the Pulse job, or choose Do not link a job.' };
  return {};
}

export function stepProblems(state: WizardState, step: StepId, taken?: ReadonlyMap<string, string>): Problems {
  switch (step) {
    case 'start':
      return startProblems(state);
    case 'basics':
      return basicsProblems(state, taken);
    case 'variants':
      return variantsProblems(state);
    case 'price':
      return priceProblems(state);
    case 'schedule':
      return scheduleStepProblems(state);
    case 'review':
      return reviewProblems(state);
  }
}

export function startProblems(state: WizardState): Problems {
  const mode = state.start.mode;
  if (!mode) return { mode: 'Pick how to start.' };
  if (mode === 'deal' && !state.start.crmItemId) return { mode: 'Pick the won deal.' };
  if (mode === 'template' && !state.start.templateId) return { mode: 'Pick a template.' };
  if (mode === 'copy' && !state.start.copyKey) return { mode: 'Pick the program to copy.' };
  return {};
}

/** Which step owns a server field error (`basics.key`, `variants.rows.3.key`, `priceCard.lines`). */
export function stepForField(field: string): StepId {
  if (field.startsWith('basics') || field === 'key' || field === 'name') return 'basics';
  if (field.startsWith('variants')) return 'variants';
  if (field.startsWith('priceCard')) return 'price';
  if (field.startsWith('schedule')) return 'schedule';
  if (field.startsWith('links')) return 'review';
  if (field.startsWith('start')) return 'start';
  return 'review';
}

/** "2 to fix". */
export function fixCountText(problems: Problems): string | null {
  const count = Object.keys(problems).length;
  return count ? `${count} to fix` : null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Calendar, projection and checklist                                                             */
/* ---------------------------------------------------------------------------------------------- */

export function wizardCalendar(state: WizardState, env: WizardEnv): ProgramCalendar {
  const b = state.basics;
  return {
    timezone: b.timezone,
    workingDays: b.useWorkspace ? env.workingDays : b.workingDays,
    daysOff: [...env.holidays.map((holiday) => holiday.date), ...b.extraDaysOff],
    extraWorkDays: b.extraWorkDays,
    activeFrom: b.startDate || null,
    activeTo: b.endDate,
    paused: [],
  };
}

/** The first full month on or after the later of today and the start date. */
export function projectionMonth(state: WizardState, env: WizardEnv): string {
  const from = state.basics.startDate && state.basics.startDate > env.today ? state.basics.startDate : env.today;
  return from === firstDayOfMonth(monthOf(from)) ? monthOf(from) : shiftMonth(monthOf(from), 1);
}

/** The card the wizard would publish, as an engine version (variant ids are variant keys). */
export function wizardVersion(state: WizardState): CardVersion | null {
  if (state.price.later) return null;
  const lines: CardLine[] = [];
  let n = 0;
  const id = () => `w${(n += 1)}`;
  for (const line of toCardLines({ ...state.price.lines, variantRates: {} })) {
    lines.push({ id: id(), kind: line.kind, variantId: null, ruleId: null, unitPrice: line.unitPrice ?? null, rateCents: line.rateCents ?? null, amountCents: line.amountCents ?? null, prorate: line.prorate ?? true, chargeWhilePaused: line.chargeWhilePaused ?? true, label: line.label ?? null });
  }
  for (const [key, rate] of variantRates(state)) {
    if ((rate.source === 'typed' || rate.source === 'rule') && rate.price) lines.push({ id: id(), kind: 'per_unit', variantId: key, ruleId: null, unitPrice: rate.price, rateCents: null, amountCents: null, prorate: true, chargeWhilePaused: true, label: null });
  }
  if (lines.length === 0) return null;
  return { id: 'wizard', number: 1, effectiveFrom: state.price.effectiveFrom || state.basics.startDate, lines, rules: [] };
}

export interface WizardProjection {
  readonly month: string;
  readonly monthName: string;
  readonly workDays: number;
  readonly units: string;
  readonly totalCents: string | null;
  readonly workCents: string;
  readonly feeCents: string;
  readonly topUpCents: string;
  readonly setupCents: string;
  readonly hasSchedule: boolean;
  readonly hasPrices: boolean;
  /** "Based on 22 work days in December". */
  readonly basisText: string;
  readonly hoursNotProjected: boolean;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

function scheduleLinesFor(state: WizardState): { variantId: string; qty: string; qtyByWeekday: Record<string, string> | null }[] {
  const keys = new Set(wizardVariants(state).map((variant) => variant.key));
  return toSchedulePayload(state.schedule).lines.filter((line) => keys.has(line.variantKey)).map((line) => ({ variantId: line.variantKey, qty: line.qty, qtyByWeekday: line.qtyByWeekday ?? null }));
}

/** The "Projected month" card (3.13): the next full month at this schedule and card. */
export function wizardProjection(input: WizardState, env: WizardEnv): WizardProjection {
  // Before the Schedule step the default schedule (every work day, default qty) is the guess.
  const state = input.schedule.enabled && input.schedule.lines.length === 0 ? syncScheduleLines(input) : input;
  const month = projectionMonth(state, env);
  const calendar = wizardCalendar(state, env);
  const version = wizardVersion(state);
  const lines = state.schedule.enabled ? scheduleLinesFor(state) : [];
  const hasSchedule = state.schedule.enabled && lines.length > 0 && Object.keys(scheduleProblems(state.schedule)).length === 0;
  const oneTime = toOneTimeInputs(state.price.oneTime).map((charge, index) => ({ id: `setup${index}`, kind: 'setup' as const, chargeOn: charge.chargeOn, amountCents: charge.amountCents, label: charge.label, variantId: null, countsTowardMinimum: false }));
  try {
    const { workDays, result, hoursNotProjected } = projectMonth({
      month,
      calendar,
      versions: version ? [{ ...version, effectiveFrom: version.effectiveFrom > firstDayOfMonth(month) ? version.effectiveFrom : firstDayOfMonth(month) }] : [],
      schedules: hasSchedule ? [{ rule: { pattern: state.schedule.pattern, days: state.schedule.days, intervalWeeks: state.schedule.intervalWeeks, startsOn: state.schedule.startsOn, endsOn: state.schedule.endsOn, skipHolidays: state.schedule.skipHolidays, skipDates: [] }, lines }] : [],
      oneTime: state.price.later ? [] : oneTime,
    });
    return {
      month,
      monthName: monthName(month),
      workDays,
      units: result.units,
      totalCents: version ? result.totalCents.toString() : null,
      workCents: result.work.totalCents.toString(),
      feeCents: result.fixed.monthlyFeeCents.toString(),
      topUpCents: result.minimum.topUpCents.toString(),
      setupCents: result.fixed.setupCents.toString(),
      hasSchedule,
      hasPrices: Boolean(version),
      basisText: `Based on ${workDays} work ${workDays === 1 ? 'day' : 'days'} in ${monthName(month)}`,
      hoursNotProjected,
    };
  } catch {
    return { month, monthName: monthName(month), workDays: 0, units: '0.000', totalCents: null, workCents: '0', feeCents: '0', topUpCents: '0', setupCents: '0', hasSchedule, hasPrices: Boolean(version), basisText: `Based on ${monthName(month)}`, hoursNotProjected: false };
  }
}

/** "One run of every variant earns $1,610.00" (per unit charges of one occurrence at the row qty). */
export function oneRunCents(input: WizardState): bigint | null {
  if (input.price.later) return null;
  const state = input.schedule.enabled && input.schedule.lines.length === 0 ? syncScheduleLines(input) : input;
  const rates = variantRates(state);
  const lines = state.schedule.enabled && state.schedule.lines.length ? scheduleLinesFor(state) : wizardVariants(state).filter((variant) => variant.defaultQty).map((variant) => ({ variantId: variant.key, qty: variant.defaultQty!, qtyByWeekday: null }));
  let total = BigInt(0);
  let priced = false;
  for (const line of lines) {
    const rate = rates.get(line.variantId);
    if (!rate?.price) continue;
    try {
      total += mulQuantityPrice(line.qty, rate.price);
      priced = true;
    } catch {
      // A qty that does not read is flagged on the schedule step.
    }
  }
  return priced ? total : null;
}

export function moneyText(cents: string | bigint | null, withCents = true): string {
  return cents === null ? 'No price yet' : formatCents(cents, { cents: withCents });
}

/** "17,600 kits in December" when prices come later. */
export function unitsInMonthText(projection: WizardProjection, unit: UnitLabel): string {
  return `${unitLabel(projection.units, unit)} in ${projection.monthName}`;
}

export interface ChecklistItem {
  readonly id: StepId;
  readonly label: string;
  readonly done: boolean;
  /** "Optional" or "Later". */
  readonly note: string | null;
}

export function checklist(state: WizardState): ChecklistItem[] {
  const b = state.basics;
  const variants = wizardVariants(state);
  return [
    { id: 'basics', label: 'Name and key', done: Boolean(b.name.trim()) && KEY.test(b.key.trim().toUpperCase()), note: null },
    { id: 'basics', label: 'Customer', done: Boolean(b.customer), note: 'Optional' },
    { id: 'variants', label: 'Variants', done: variants.length > 0, note: variants.length ? `${variants.length}` : null },
    { id: 'price', label: 'Price card', done: !state.price.later && Object.keys(priceProblems(state)).length === 0 && toCardLines(state.price.lines).length > 0, note: state.price.later ? 'Later' : null },
    { id: 'schedule', label: 'Schedule', done: state.schedule.enabled && state.schedule.lines.some((line) => line.include), note: 'Optional' },
    { id: 'review', label: 'Links', done: Boolean(state.links.crmDealId || state.links.crmAccountId || state.links.pulseJobId || state.links.projectIds.length), note: 'Optional' },
  ];
}

/* ---------------------------------------------------------------------------------------------- */
/* Payload                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/** A combination key with axis names and value codes ("Size=XL|Color=BRN"), which the server reads. */
export function namedCombo(comboKey: string, axes: readonly EditorAxis[]): string {
  return comboKey
    .split('|')
    .map((pair) => {
      const [axisId, valueId] = pair.split('=');
      const axis = axes.find((entry) => entry.id === axisId);
      const value = axis?.values.find((entry) => entry.id === valueId);
      return axis && value ? `${axis.name.trim()}=${value.code}` : pair;
    })
    .join('|');
}

export function toPayload(state: WizardState): ProgramWizardPayload {
  const b = state.basics;
  const unit = unitOf(b);
  const variants = wizardVariants(state);
  const keys = new Set(variants.map((variant) => variant.key));
  const generator = state.variants.generator;
  const matrix = state.variants.mode !== 'list';
  const built = matrix ? buildRows(generator, b.key) : null;
  const target = b.target.trim() ? readMoney(b.target) : null;
  const schedule = toSchedulePayload(state.schedule);
  return {
    start: {
      mode: state.start.mode ?? 'scratch',
      ...(state.start.crmItemId ? { crmItemId: state.start.crmItemId } : {}),
      ...(state.start.templateId ? { templateId: state.start.templateId } : {}),
      ...(state.start.copyKey ? { copyKey: state.start.copyKey } : {}),
    },
    basics: {
      name: b.name.trim(),
      key: b.key.trim().toUpperCase(),
      ...(b.description.trim() ? { description: b.description.trim() } : {}),
      customer: b.customer ? { kind: b.customer.kind, id: b.customer.id } : null,
      ownerId: b.ownerId,
      startDate: b.startDate,
      endDate: b.endDate,
      unit,
      timezone: b.timezone,
      calendar: { useWorkspace: b.useWorkspace, workingDays: b.useWorkspace ? null : [...b.workingDays], extraDaysOff: [...b.extraDaysOff], extraWorkDays: [...b.extraWorkDays] },
      color: b.color,
      icon: b.icon,
      monthlyTargetCents: target && target.ok ? target.cents : null,
    },
    variants: {
      mode: matrix ? 'matrix' : 'list',
      axes: matrix ? toAxisInputs(generator.axes) : [],
      patterns: matrix ? { name: generator.patterns.name, key: generator.patterns.key, sku: generator.patterns.sku } : { name: '', key: '', sku: null },
      rows: matrix && built ? toPayloadRows(built.rows).map((row) => ({ ...row, comboKey: namedCombo(row.comboKey, generator.axes) })) : [],
      manual: matrix
        ? []
        : variants.map((variant) => ({ name: variant.name, key: variant.key, sku: variant.sku, defaultQty: variant.defaultQty ? variant.defaultQty.replace(/,/g, '') : null, unitPrice: variant.typedRate && !rateCellProblem(variant.typedRate) ? (toCardLines({ ...DEFAULT_PRICE_LINES, perUnit: { on: true, price: variant.typedRate, label: null } })[0]?.unitPrice ?? null) : null })),
    },
    priceCard: {
      later: state.price.later,
      effectiveFrom: state.price.effectiveFrom || b.startDate,
      lines: state.price.later ? [] : toCardLines({ ...state.price.lines, variantRates: {} }),
      rules: state.price.later || !matrix ? [] : toRuleInputs(generator.rules, generator.axes),
      oneTime: state.price.later ? [] : toOneTimeInputs(state.price.oneTime),
    },
    schedule: {
      ...schedule,
      enabled: schedule.enabled && schedule.lines.some((line) => keys.has(line.variantKey)),
      name: schedule.name || `${b.name.trim()} run`,
      lines: schedule.lines.filter((line) => keys.has(line.variantKey)),
    },
    links: {
      crmDealId: state.links.crmDealId,
      crmAccountId: state.links.crmAccountId,
      pulseJobId: state.links.pulse === 'link' ? state.links.pulseJobId : null,
      createPulseJob: state.links.pulse === 'new',
      projectIds: [...state.links.projectIds],
      members: state.links.members.filter((member) => member.userId !== b.ownerId).map((member) => ({ ...member })),
    },
  };
}

/** The toast after create: "GLOVE is ready. 40 builds were planned for the next 7 days." */
export function readyText(key: string, generated: { readonly builds: number }, leadDays: number, scheduled: boolean): string {
  if (!scheduled || generated.builds === 0) return `${key} is ready.`;
  return `${key} is ready. ${generated.builds} ${generated.builds === 1 ? 'build was' : 'builds were'} planned for the next ${leadDays} ${leadDays === 1 ? 'day' : 'days'}.`;
}

/** Default qty for every variant in Quick setup ("How many of each"). */
export function applyQuickQty(state: WizardState, qty: string): WizardState {
  const variants = wizardVariants(state);
  return {
    ...state,
    schedule: { ...state.schedule, lines: variants.map((variant) => ({ variantKey: variant.key, include: true, qty, qtyByWeekday: null, assigneeId: null })) },
  };
}

/** Keeps schedule lines in step with the variants: new variants join at their default qty, gone ones leave. */
export function syncScheduleLines(state: WizardState, fallbackQty = '100'): WizardState {
  const variants = wizardVariants(state);
  const existing = new Map(state.schedule.lines.map((line) => [line.variantKey, line]));
  const lines = variants.map((variant) => existing.get(variant.key) ?? { variantKey: variant.key, include: true, qty: variant.defaultQty ? variant.defaultQty.replace(/\.0+$/, '') : fallbackQty, qtyByWeekday: null, assigneeId: null });
  const same = lines.length === state.schedule.lines.length && lines.every((line, index) => line === state.schedule.lines[index]);
  return same ? state : { ...state, schedule: { ...state.schedule, lines } };
}

/** Units for one run at the schedule qty, as text ("800 kits"). */
export function runUnitsText(state: WizardState): string {
  const total = toSchedulePayload(state.schedule).lines.reduce((sum, line) => {
    try {
      return sum + quantityToScaled(line.qty);
    } catch {
      return sum;
    }
  }, BigInt(0));
  return unitLabel(fromScaled(total, 3), unitOf(state.basics));
}

export { addDays };

/** Copy mode: leaves out the parts that were not ticked on the Start step. */
export function applyCopyInclude(state: WizardState, include: CopyInclude, env: WizardEnv): WizardState {
  const base = emptyState(env);
  let next: WizardState = { ...state, start: { ...state.start, copyInclude: include } };
  if (!include.variants) next = { ...next, variants: base.variants, schedule: { ...next.schedule, lines: [] } };
  if (!include.priceCard) next = { ...next, price: { ...base.price, effectiveFrom: next.basics.startDate } };
  if (!include.schedules) next = { ...next, schedule: { ...base.schedule, startsOn: next.basics.startDate } };
  if (!include.members) next = { ...next, links: { ...next.links, members: [] } };
  if (!include.links) next = { ...next, links: { ...next.links, crmDealId: null, crmDealTitle: null, crmAccountId: null, crmAccountTitle: null, projectIds: [] } };
  return next;
}

/** `?include=variants,priceCard` to the copy choices (missing means the defaults). */
export function readCopyInclude(text: string | null): CopyInclude {
  if (!text) return DEFAULT_COPY;
  const parts = new Set(text.split(','));
  return { variants: parts.has('variants'), priceCard: parts.has('priceCard'), schedules: parts.has('schedules'), members: parts.has('members'), links: parts.has('links') };
}

export function copyIncludeText(include: CopyInclude): string {
  return (Object.keys(include) as (keyof CopyInclude)[]).filter((key) => include[key]).join(',');
}
