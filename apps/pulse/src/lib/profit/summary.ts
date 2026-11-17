/**
 * Cost, profit, margin and the company profit bridge (docs/pulse/SPEC.md 4.9). Pure functions.
 * Ratios are `null` when the divisor is 0 or less, never 0 and never infinity.
 */
import { type Cents, type CentsLike, type Decimal, ZERO, marginBp, marginGap, perUnitCents, ratioBp, toCents } from '../money';
import type { MoneyBuckets, SharedCostRule } from './types';

/** The kinds of row in `pulse.v_facts`. */
export const FACT_KINDS = ['revenue_base', 'revenue_vas', 'revenue_other', 'labor', 'material', 'other', 'shared', 'billed_memo'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Fact kinds that count in profit. `billed_memo` rows are never summed into revenue. */
export const PROFIT_KINDS: readonly FactKind[] = ['revenue_base', 'revenue_vas', 'revenue_other', 'labor', 'material', 'other', 'shared'];
export const REVENUE_KINDS: readonly FactKind[] = ['revenue_base', 'revenue_vas', 'revenue_other'];
export const COST_KINDS: readonly FactKind[] = ['labor', 'material', 'other', 'shared'];

export interface FactTotals extends MoneyBuckets {
  readonly baseRevenueCents: Cents;
  readonly serviceRevenueCents: Cents;
  readonly otherRevenueCents: Cents;
  readonly billedCents: Cents;
}

/** Rolls fact rows up by kind. The answer equals the sum of the rows to the cent. */
export function sumFacts(rows: Iterable<{ kind: FactKind; amountCents: CentsLike }>): FactTotals {
  const totals: Record<FactKind, Cents> = { revenue_base: ZERO, revenue_vas: ZERO, revenue_other: ZERO, labor: ZERO, material: ZERO, other: ZERO, shared: ZERO, billed_memo: ZERO };
  for (const row of rows) totals[row.kind] += toCents(row.amountCents);
  return {
    baseRevenueCents: totals.revenue_base,
    serviceRevenueCents: totals.revenue_vas,
    otherRevenueCents: totals.revenue_other,
    revenueCents: totals.revenue_base + totals.revenue_vas + totals.revenue_other,
    laborCents: totals.labor,
    materialCents: totals.material,
    otherCents: totals.other,
    sharedCents: totals.shared,
    billedCents: totals.billed_memo,
  };
}

export interface ProfitSummary extends MoneyBuckets {
  /** Labor plus material plus other plus shared. */
  readonly costCents: Cents;
  /** Revenue minus cost. */
  readonly profitCents: Cents;
  /** "Margin after all costs", in basis points. */
  readonly marginBp: number | null;
  /** Why the margin has no number, when it has none. */
  readonly marginGap: 'no_revenue' | 'negative_revenue' | 'out_of_range' | null;
  /** Revenue minus labor, material and other. */
  readonly profitBeforeSharedCents: Cents;
  /** "Margin before shared costs", in basis points. */
  readonly marginBeforeSharedBp: number | null;
  /** Labor as a share of revenue, in basis points. */
  readonly laborPctOfRevenueBp: number | null;
  readonly costPerUnitCents: Cents | null;
  readonly profitPerUnitCents: Cents | null;
  readonly revenuePerUnitCents: Cents | null;
  readonly laborCostPerUnitCents: Cents | null;
}

/** Every headline number for a job, a client, a service or a date range, from the money buckets. */
export function profitSummary(buckets: MoneyBuckets, unitsGood: Decimal = 0): ProfitSummary {
  const costCents = buckets.laborCents + buckets.materialCents + buckets.otherCents + buckets.sharedCents;
  const profitCents = buckets.revenueCents - costCents;
  const profitBeforeSharedCents = profitCents + buckets.sharedCents;
  return {
    revenueCents: buckets.revenueCents,
    laborCents: buckets.laborCents,
    materialCents: buckets.materialCents,
    otherCents: buckets.otherCents,
    sharedCents: buckets.sharedCents,
    costCents,
    profitCents,
    marginBp: marginBp(profitCents, buckets.revenueCents),
    marginGap: marginGap(profitCents, buckets.revenueCents),
    profitBeforeSharedCents,
    marginBeforeSharedBp: marginBp(profitBeforeSharedCents, buckets.revenueCents),
    laborPctOfRevenueBp: ratioBp(buckets.laborCents, buckets.revenueCents),
    costPerUnitCents: perUnitCents(costCents, unitsGood),
    profitPerUnitCents: perUnitCents(profitCents, unitsGood),
    revenuePerUnitCents: perUnitCents(buckets.revenueCents, unitsGood),
    laborCostPerUnitCents: perUnitCents(buckets.laborCents, unitsGood),
  };
}

/** Adds money buckets together (jobs into a client, clients into a company). */
export function addBuckets(list: Iterable<MoneyBuckets>): MoneyBuckets {
  let revenueCents = ZERO;
  let laborCents = ZERO;
  let materialCents = ZERO;
  let otherCents = ZERO;
  let sharedCents = ZERO;
  for (const item of list) {
    revenueCents += item.revenueCents;
    laborCents += item.laborCents;
    materialCents += item.materialCents;
    otherCents += item.otherCents;
    sharedCents += item.sharedCents;
  }
  return { revenueCents, laborCents, materialCents, otherCents, sharedCents };
}

/** Plain words for a margin with no number. */
export function marginGapLabel(gap: ProfitSummary['marginGap']): string | null {
  if (gap === 'no_revenue') return 'No revenue yet';
  if (gap === 'negative_revenue') return 'Revenue is below zero';
  if (gap === 'out_of_range') return 'Too far off to show as a percent';
  return null;
}

export interface CompanyBridgeInput {
  /** "Profit on jobs": the sum of profit facts for jobs and client level rows. */
  readonly workProfitCents: CentsLike;
  /** "Time not on a job that no job carried" (4.5). */
  readonly sharedGapCents: CentsLike;
  /** "Paid time not on any job". Counted as 0 under the `full` rule, because it is in the pool already. */
  readonly missingCents: CentsLike;
  /** Company costs in the range: rent, utilities, salaried staff and so on. */
  readonly companyCostCents: CentsLike;
  /** Overhead cents stamped on production, service and indirect entries. */
  readonly overheadAbsorbedCents: CentsLike;
  readonly rule: SharedCostRule;
}

export interface CompanyBridgeLine {
  readonly key: 'work_profit' | 'shared_gap' | 'missing_time' | 'overhead_gap' | 'company_profit';
  readonly label: string;
  /** The signed effect on profit: costs are below zero. */
  readonly amountCents: Cents;
}

export interface CompanyBridge {
  readonly workProfitCents: Cents;
  readonly sharedGapCents: Cents;
  readonly missingCents: Cents;
  /** Company costs minus overhead absorbed, or 0 when no company costs were entered. */
  readonly overheadGapCents: Cents;
  /** False when no company costs were entered: Pulse trusts the hourly overhead rate and hides the line. */
  readonly showsOverheadGap: boolean;
  readonly companyProfitCents: Cents;
  /** The walk from job profit to company profit, line by line. The lines add up to company profit. */
  readonly lines: CompanyBridgeLine[];
}

/**
 * The walk from job profit to company profit.
 * Example: $48,210.00 on jobs, less a $1,150.00 shared gap, $2,360.00 of paid time on no job and a
 * $4,800.00 overhead gap, leaves $39,900.00 for the company.
 */
export function companyBridge(input: CompanyBridgeInput): CompanyBridge {
  const workProfitCents = toCents(input.workProfitCents);
  const sharedGapCents = toCents(input.sharedGapCents);
  const missingCents = input.rule === 'full' ? ZERO : toCents(input.missingCents);
  const companyCost = toCents(input.companyCostCents);
  const showsOverheadGap = companyCost > ZERO;
  const overheadGapCents = showsOverheadGap ? companyCost - toCents(input.overheadAbsorbedCents) : ZERO;
  const companyProfitCents = workProfitCents - sharedGapCents - missingCents - overheadGapCents;
  const lines: CompanyBridgeLine[] = [
    { key: 'work_profit', label: 'Profit on jobs', amountCents: workProfitCents },
    { key: 'shared_gap', label: 'Time not on a job that no job carried', amountCents: -sharedGapCents },
    { key: 'missing_time', label: 'Paid time not on any job', amountCents: -missingCents },
  ];
  if (showsOverheadGap) {
    lines.push({
      key: 'overhead_gap',
      label: overheadGapCents < ZERO ? 'Your hourly rate covered more overhead than you spent' : 'Overhead your hourly rate did not cover',
      amountCents: -overheadGapCents,
    });
  }
  lines.push({ key: 'company_profit', label: 'Company profit', amountCents: companyProfitCents });
  return { workProfitCents, sharedGapCents, missingCents, overheadGapCents, showsOverheadGap, companyProfitCents, lines };
}
