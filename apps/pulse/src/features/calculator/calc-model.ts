/**
 * The calculator form as plain data, and the bridge from that form to the pure quote math in
 * `@/lib/profit`. No React, no server code: the page, the saved scenario, the job that gets made
 * from a scenario and the tests all run the same functions, so they cannot disagree.
 *
 * Nothing here works out a margin or a price. It only reads what a person typed, blends the crew
 * into one hourly cost, and hands the numbers to `quoteCalculator` and `quoteSensitivity`.
 */
import { centsToNumber, decimalToCents, divRound, fromScaled, toScaled, type Cents } from '@/lib/money';
import { priceBelow, quoteCalculator, quoteSensitivity, type QuoteAtPrice, type QuoteInput, type QuoteResult } from '@/lib/profit';

export interface CalcCrewLine {
  readonly laborClassId: string | null;
  readonly label: string;
  /** People, typed. */
  readonly headcount: string;
  /** Real cost of an hour in dollars, typed. */
  readonly rate: string;
}

export interface CalcServiceLine {
  readonly vasServiceId: string | null;
  readonly label: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly costPerUnit: string;
}

export interface CalcOtherLine {
  readonly label: string;
  /** Dollars for the whole job, typed. */
  readonly amount: string;
}

/** Everything a person can type on the calculator. Stored as is in `quote_scenarios.inputs`. */
export interface CalcInputs {
  readonly clientId: string | null;
  readonly jobTypeId: string | null;
  /** The real job this what if started from, if any. */
  readonly jobId: string | null;
  readonly unitLabel: string;
  readonly units: string;
  /** Target pace: units one person finishes in an hour. */
  readonly standardUph: string;
  readonly crew: readonly CalcCrewLine[];
  readonly shiftHours: string;
  readonly setupHours: string;
  readonly partsOwner: 'us' | 'client';
  readonly materialPerUnit: string;
  readonly services: readonly CalcServiceLine[];
  readonly otherCosts: readonly CalcOtherLine[];
  /** Time not on a job, as a percent of labor cost, typed. */
  readonly sharedPct: string;
  /** Target margin as a percent, typed. */
  readonly targetMarginPct: string;
  /** A price to test. Empty means "use the price for my target margin". */
  readonly pricePerUnit: string;
  readonly startDate: string | null;
}

export const EMPTY_CALC: CalcInputs = {
  clientId: null,
  jobTypeId: null,
  jobId: null,
  unitLabel: 'units',
  units: '',
  standardUph: '',
  crew: [{ laborClassId: null, label: 'Crew', headcount: '1', rate: '' }],
  shiftHours: '8',
  setupHours: '',
  partsOwner: 'us',
  materialPerUnit: '',
  services: [],
  otherCosts: [],
  sharedPct: '0',
  targetMarginPct: '30',
  pricePerUnit: '',
  startDate: null,
};

export type CalcErrors = Readonly<Record<string, string>>;

/** A typed number with commas, a dollar sign or a percent sign taken out. Empty stays empty. */
export function cleanNumber(value: string | null | undefined): string {
  return (value ?? '').replace(/[$,%\s]/g, '');
}

/** True when the text is a plain number of 0 or more with at most `scale` decimal places. */
export function isDecimal(value: string, scale: number): boolean {
  return new RegExp(`^\\d{1,9}(\\.\\d{0,${scale}})?$|^\\.\\d{1,${scale}}$`).test(value);
}

function normal(value: string): string {
  const text = value.startsWith('.') ? `0${value}` : value;
  return text.endsWith('.') ? text.slice(0, -1) : text;
}

/** Reads one typed field. `null` when it is empty, `'bad'` when it is not a number we can use. */
function read(value: string | null | undefined, scale: number): string | null | 'bad' {
  const text = cleanNumber(value);
  if (text === '') return null;
  return isDecimal(text, scale) ? normal(text) : 'bad';
}

/** People on the line, summed over the crew lines, as text with up to 2 places. */
export function crewHeadcount(crew: readonly CalcCrewLine[]): string {
  let total = BigInt(0);
  for (const line of crew) {
    const people = read(line.headcount, 2);
    if (people && people !== 'bad') total += toScaled(people, 2);
  }
  return fromScaled(total, 2);
}

/**
 * One hourly cost for a mixed crew: each class's real cost of an hour, weighted by its people.
 * Two packers at $20.00 and one lead at $26.00 blend to $22.00. `null` when no line has both.
 */
export function blendedRateCents(crew: readonly CalcCrewLine[]): Cents | null {
  let people = BigInt(0);
  let weighted = BigInt(0);
  for (const line of crew) {
    const count = read(line.headcount, 2);
    const rate = read(line.rate, 2);
    if (!count || count === 'bad' || !rate || rate === 'bad') continue;
    const scaled = toScaled(count, 2);
    people += scaled;
    weighted += scaled * decimalToCents(rate);
  }
  return people > BigInt(0) ? divRound(weighted, people) : null;
}

/** Percent typed as "30" or "30.5" to basis points. */
export function percentToBp(value: string): number | null {
  const text = read(value, 2);
  if (!text || text === 'bad') return null;
  return Number(toScaled(text, 2));
}

export function bpToPercent(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '';
  const text = fromScaled(BigInt(Math.round(bp)), 2);
  return text.replace(/\.?0+$/, '');
}

/** Other costs for the whole job, in cents. Lines that cannot be read count as 0 and get an error elsewhere. */
export function otherCostCents(lines: readonly CalcOtherLine[]): Cents {
  let total = BigInt(0);
  for (const line of lines) {
    const amount = read(line.amount, 2);
    if (amount && amount !== 'bad') total += decimalToCents(amount);
  }
  return total;
}

export interface CalcQuote {
  readonly input: QuoteInput | null;
  readonly errors: CalcErrors;
  /** True when something needed is still empty (as opposed to wrong). */
  readonly incomplete: boolean;
}

/** Checks the form and builds the input for `quoteCalculator`. Every message says what to type. */
export function toQuoteInput(form: CalcInputs, options: { workingDays?: readonly number[] } = {}): CalcQuote {
  const errors: Record<string, string> = {};
  let incomplete = false;
  const need = (key: string, value: string, scale: number, emptyMessage: string, badMessage: string, positive = false): string | null => {
    const got = read(value, scale);
    if (got === null) {
      incomplete = true;
      errors[key] = emptyMessage;
      return null;
    }
    if (got === 'bad' || (positive && Number(got) <= 0)) {
      errors[key] = badMessage;
      return null;
    }
    return got;
  };
  const optional = (key: string, value: string, scale: number, badMessage: string): string | null => {
    const got = read(value, scale);
    if (got === 'bad') {
      errors[key] = badMessage;
      return null;
    }
    return got;
  };

  const units = need('units', form.units, 3, 'Type how many units the job is.', 'Type a number above zero, like 5000.', true);
  const pace = need('standardUph', form.standardUph, 3, 'Type how many units one person finishes in an hour.', 'Type a pace above zero, like 40.', true);
  const shift = optional('shiftHours', form.shiftHours, 2, 'Type hours in a shift, like 8.');
  const setup = optional('setupHours', form.setupHours, 2, 'Type setup hours as a number, like 4.');
  const material = optional('materialPerUnit', form.materialPerUnit, 4, 'Type the material cost for one unit, like 0.45.');
  const shared = optional('sharedPct', form.sharedPct, 2, 'Type a percent, like 8.');
  const target = need('targetMarginPct', form.targetMarginPct, 2, 'Type the margin you want, like 30.', 'Type a percent from 0 to 99, like 30.');
  if (target !== null && Number(target) >= 100) errors.targetMarginPct = 'A margin of 100% or more cannot be reached. Type a percent from 0 to 99.';
  const price = optional('pricePerUnit', form.pricePerUnit, 4, 'Type a price for one unit, like 2.75.');

  form.crew.forEach((line, index) => {
    const people = read(line.headcount, 2);
    const rate = read(line.rate, 2);
    if (people === 'bad' || (people !== null && Number(people) <= 0)) errors[`crew.${index}.headcount`] = 'Type how many people, like 4.';
    if (rate === 'bad') errors[`crew.${index}.rate`] = 'Type what an hour costs, like 22.50.';
    if (people === null) errors[`crew.${index}.headcount`] = 'Type how many people, like 4.';
    if (rate === null) {
      incomplete = true;
      errors[`crew.${index}.rate`] = 'Type what an hour really costs for this labor class.';
    }
  });
  if (form.crew.length === 0) {
    incomplete = true;
    errors.crew = 'Add at least one crew line.';
  }
  form.services.forEach((line, index) => {
    if (read(line.quantity, 3) === 'bad' || read(line.quantity, 3) === null) errors[`services.${index}.quantity`] = 'Type how many.';
    if (read(line.unitPrice, 4) === 'bad' || read(line.unitPrice, 4) === null) errors[`services.${index}.unitPrice`] = 'Type the price for one.';
    if (read(line.costPerUnit, 4) === 'bad') errors[`services.${index}.costPerUnit`] = 'Type what one costs you, or leave it empty.';
  });
  form.otherCosts.forEach((line, index) => {
    const amount = read(line.amount, 2);
    if (amount === 'bad' || amount === null) errors[`otherCosts.${index}.amount`] = 'Type the cost in dollars, like 350.';
  });

  const rate = blendedRateCents(form.crew);
  if (Object.keys(errors).length > 0 || units === null || pace === null || target === null || rate === null) return { input: null, errors, incomplete };
  return {
    input: {
      units,
      standardUph: pace,
      crewSize: crewHeadcount(form.crew),
      shiftHours: shift && Number(shift) > 0 ? shift : '8',
      laborRateCents: rate,
      setupHours: setup ?? '0',
      materialPerUnit: form.partsOwner === 'client' ? '0' : (material ?? '0'),
      otherCostCents: otherCostCents(form.otherCosts),
      services: form.services.map((line) => ({ label: line.label, quantity: normal(cleanNumber(line.quantity)), unitPrice: normal(cleanNumber(line.unitPrice)), costPerUnit: read(line.costPerUnit, 4) as string | null })),
      sharedPctBp: shared ? Number(toScaled(shared, 2)) : 0,
      targetMarginBp: Number(toScaled(target, 2)),
      pricePerUnit: price,
      startDate: form.startDate,
      workingDays: options.workingDays,
    },
    errors,
    incomplete,
  };
}

/** One price with what it earns, as plain JSON numbers (cents and basis points). */
export interface CalcPrice {
  readonly pricePerUnit: string;
  readonly revenueCents: number;
  readonly profitCents: number;
  readonly marginBp: number | null;
  readonly marginBeforeSharedBp: number | null;
  readonly profitPerUnitCents: number | null;
  readonly breakevenUnits: number | null;
  readonly meetsTarget: boolean;
}

/** The answer of one calculator run, safe to store and to send to the browser. */
export interface CalcSummary {
  readonly units: string;
  readonly laborHours: number;
  readonly runHours: number;
  readonly setupHours: number;
  readonly workDays: number | null;
  readonly finishDate: string | null;
  readonly blendedRateCents: number;
  readonly laborCents: number;
  readonly materialCents: number;
  readonly otherCents: number;
  readonly serviceCostCents: number;
  readonly serviceRevenueCents: number;
  readonly sharedCents: number;
  readonly costCents: number;
  readonly costBeforeSharedCents: number;
  readonly costPerUnit: string | null;
  readonly fixedCostCents: number;
  readonly variableCostPerUnit: string | null;
  readonly targetMarginBp: number;
  readonly target: CalcPrice | null;
  readonly breakeven: CalcPrice | null;
  readonly lowest: CalcPrice | null;
  readonly atPrice: CalcPrice | null;
  /** The price the rest of the screen talks about: the typed price, else the target price. */
  readonly chosen: CalcPrice | null;
  /** True when the typed price is under the lowest price worth taking. */
  readonly belowLowest: boolean;
}

const price = (at: QuoteAtPrice | null): CalcPrice | null =>
  at
    ? {
        pricePerUnit: at.pricePerUnit,
        revenueCents: centsToNumber(at.revenueCents),
        profitCents: centsToNumber(at.profitCents),
        marginBp: at.marginBp,
        marginBeforeSharedBp: at.marginBeforeSharedBp,
        profitPerUnitCents: at.profitPerUnitCents === null ? null : centsToNumber(at.profitPerUnitCents),
        breakevenUnits: at.breakevenUnits,
        meetsTarget: at.meetsTarget,
      }
    : null;

export function summarize(input: QuoteInput, result: QuoteResult): CalcSummary {
  const chosen = result.atPrice ?? result.target;
  return {
    units: String(input.units),
    laborHours: result.laborHours,
    runHours: result.runHours,
    setupHours: result.setupHours,
    workDays: result.workDays,
    finishDate: result.finishDate,
    blendedRateCents: centsToNumber(BigInt(input.laborRateCents)),
    laborCents: centsToNumber(result.laborCents),
    materialCents: centsToNumber(result.materialCents),
    otherCents: centsToNumber(result.otherCents),
    serviceCostCents: centsToNumber(result.serviceCostCents),
    serviceRevenueCents: centsToNumber(result.serviceRevenueCents),
    sharedCents: centsToNumber(result.sharedCents),
    costCents: centsToNumber(result.costCents),
    costBeforeSharedCents: centsToNumber(result.costBeforeSharedCents),
    costPerUnit: result.costPerUnit,
    fixedCostCents: centsToNumber(result.fixedCostCents),
    variableCostPerUnit: result.variableCostPerUnit,
    targetMarginBp: input.targetMarginBp,
    target: price(result.target),
    breakeven: price(result.breakeven),
    lowest: price(result.lowest),
    atPrice: price(result.atPrice),
    chosen: price(chosen),
    belowLowest: Boolean(result.atPrice && result.lowest && priceBelow(result.atPrice.pricePerUnit, result.lowest.pricePerUnit)),
  };
}

export const PACE_STEPS_BP = [8000, 9000, 10000, 11000, 12000] as const;
export const PRICE_STEPS_BP = [9000, 9500, 10000, 10500, 11000] as const;

export interface SensitivityCell {
  readonly marginBp: number | null;
  readonly profitCents: number;
}

export interface SensitivityGrid {
  /** Prices across the top, lowest first, to 4 places. */
  readonly prices: readonly string[];
  /** Index of the price the rest of the screen uses. */
  readonly baseColumn: number;
  readonly rows: readonly { readonly paceBp: number; readonly uph: number; readonly cells: readonly SensitivityCell[] }[];
}

/** A price moved by basis points, rounded to 4 places. */
export function scalePrice(pricePerUnit: string, bp: number): string {
  return fromScaled(divRound(toScaled(pricePerUnit, 4) * BigInt(bp), BigInt(10000)), 4);
}

/**
 * The grid of "what if the crew is slower or faster" by "what if the price is lower or higher".
 * Rows are pace from 80% to 120% of the target pace, columns are price from 10% under to 10% over.
 */
export function sensitivityGrid(input: QuoteInput, basePrice: string): SensitivityGrid {
  const prices = PRICE_STEPS_BP.map((bp) => scalePrice(basePrice, bp));
  const columns = prices.map((value) => quoteSensitivity(input, value, PACE_STEPS_BP));
  return {
    prices,
    baseColumn: PRICE_STEPS_BP.indexOf(10000),
    rows: PACE_STEPS_BP.map((paceBp, rowIndex) => ({
      paceBp,
      uph: columns[0]?.[rowIndex]?.uph ?? 0,
      cells: columns.map((column) => ({ marginBp: column[rowIndex]?.marginBp ?? null, profitCents: centsToNumber(column[rowIndex]?.profitCents ?? BigInt(0)) })),
    })),
  };
}

export interface CalcRun {
  readonly errors: CalcErrors;
  readonly incomplete: boolean;
  readonly input: QuoteInput | null;
  readonly summary: CalcSummary | null;
  readonly grid: SensitivityGrid | null;
  /** The quote as plan totals, ready to save as a job's quote. Cents are numbers. */
  readonly plan: {
    readonly units: string;
    readonly revenueCents: number;
    readonly laborHours: string;
    readonly laborCents: number;
    readonly setupHours: string;
    readonly setupCents: number;
    readonly materialCents: number;
    readonly otherCents: number;
    readonly sharedCents: number;
  } | null;
}

/** The whole calculator in one call: check the form, run the math, build the grid. Never throws. */
export function runCalc(form: CalcInputs, options: { workingDays?: readonly number[] } = {}): CalcRun {
  const quote = toQuoteInput(form, options);
  if (!quote.input) return { errors: quote.errors, incomplete: quote.incomplete, input: null, summary: null, grid: null, plan: null };
  try {
    const result = quoteCalculator(quote.input);
    const summary = summarize(quote.input, result);
    const totals = result.planTotals;
    return {
      errors: {},
      incomplete: false,
      input: quote.input,
      summary,
      grid: summary.chosen ? sensitivityGrid(quote.input, summary.chosen.pricePerUnit) : null,
      plan: totals
        ? {
            units: String(totals.units ?? '0'),
            revenueCents: centsToNumber(totals.revenueCents ?? BigInt(0)),
            laborHours: String(totals.laborHours ?? 0),
            laborCents: centsToNumber(totals.laborCents ?? BigInt(0)),
            setupHours: String(totals.setupHours ?? 0),
            setupCents: centsToNumber(totals.setupCents ?? BigInt(0)),
            materialCents: centsToNumber(totals.materialCents ?? BigInt(0)),
            otherCents: centsToNumber(totals.otherCents ?? BigInt(0)),
            sharedCents: centsToNumber(totals.sharedCents ?? BigInt(0)),
          }
        : null,
    };
  } catch {
    return { errors: { form: 'Those numbers are too big to work with. Check the units, the pace and the costs.' }, incomplete: false, input: null, summary: null, grid: null, plan: null };
  }
}

/** Reads stored scenario inputs back into a full form, filling anything missing with the defaults. */
export function reviveInputs(stored: unknown): CalcInputs {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof CalcInputs, unknown>>;
  const text = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback);
  const id = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
  const list = <T,>(value: unknown, each: (item: Record<string, unknown>) => T): T[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object').map((item) => each(item as Record<string, unknown>)) : []);
  const crew = list(raw.crew, (item) => ({ laborClassId: id(item.laborClassId), label: text(item.label, 'Crew'), headcount: text(item.headcount, '1'), rate: text(item.rate, '') }));
  return {
    clientId: id(raw.clientId),
    jobTypeId: id(raw.jobTypeId),
    jobId: id(raw.jobId),
    unitLabel: text(raw.unitLabel, EMPTY_CALC.unitLabel) || EMPTY_CALC.unitLabel,
    units: text(raw.units, ''),
    standardUph: text(raw.standardUph, ''),
    crew: crew.length > 0 ? crew : EMPTY_CALC.crew,
    shiftHours: text(raw.shiftHours, '8'),
    setupHours: text(raw.setupHours, ''),
    partsOwner: raw.partsOwner === 'client' ? 'client' : 'us',
    materialPerUnit: text(raw.materialPerUnit, ''),
    services: list(raw.services, (item) => ({ vasServiceId: id(item.vasServiceId), label: text(item.label, 'Extra service'), quantity: text(item.quantity, ''), unitPrice: text(item.unitPrice, ''), costPerUnit: text(item.costPerUnit, '') })),
    otherCosts: list(raw.otherCosts, (item) => ({ label: text(item.label, 'Other cost'), amount: text(item.amount, '') })),
    sharedPct: text(raw.sharedPct, '0'),
    targetMarginPct: text(raw.targetMarginPct, '30'),
    pricePerUnit: text(raw.pricePerUnit, ''),
    startDate: typeof raw.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate) ? raw.startDate : null,
  };
}

/** Drops trailing zeros of a stored decimal for an input box: "2.7500" reads "2.75". */
export function trimDecimal(value: string | null | undefined): string {
  if (!value) return '';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

/** The word for one unit: "kits" gives "kit", "boxes" gives "box", "assemblies" gives "assembly". Empty gives "unit". */
export function singularUnit(unitLabel: string | null | undefined): string {
  const word = (unitLabel ?? '').trim();
  if (!word) return 'unit';
  if (/ies$/i.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(xes|ses|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 2) return word.slice(0, -1);
  return word;
}
