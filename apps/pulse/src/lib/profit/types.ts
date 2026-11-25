/**
 * Shared types for the Pulse cost model (docs/pulse/SPEC.md section 4). Pure types and small
 * constant lists: no server imports, no React.
 *
 * Conventions: money is whole cents in `bigint`; hours, quantities, prices and pace are `Decimal`
 * on the way in (a number, or the exact string Postgres returns) and plain numbers already
 * rounded to their stated places on the way out; percents are whole basis points (2500 = 25%);
 * dates are `YYYY-MM-DD` strings.
 */
import type { IsoDate, SharedSpread } from '@kitstak/programs-engine/types';
import type { Cents, Decimal } from '../money';

export type { Cents, Decimal };
/** `YYYY-MM-DD` dates and shared cost spreads live in the shared engine (docs/programs/SPEC.md 3.1). */
export type { IsoDate, SharedSpread };

export const PRICING_MODELS = ['per_unit', 'fixed', 'hourly'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const MATERIAL_METHODS = ['standard', 'actual'] as const;
export type MaterialMethod = (typeof MATERIAL_METHODS)[number];

export const PARTS_OWNERS = ['us', 'client'] as const;
export type PartsOwner = (typeof PARTS_OWNERS)[number];

export const JOB_KINDS = ['one_time', 'ongoing'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SHARED_COST_RULES = ['by_labor_hours', 'full', 'percent_of_labor', 'none'] as const;
export type SharedCostRule = (typeof SHARED_COST_RULES)[number];

/**
 * How company costs (monthly) are shared out over a range that is part of a month (4.9):
 * `calendar` gives every day of the month the same share, `work_days` gives the share only to
 * working days (`settings.working_days`). A whole month is the same either way.
 */
export const COMPANY_COST_SPREADS = ['calendar', 'work_days'] as const;
export type CompanyCostSpreadMode = (typeof COMPANY_COST_SPREADS)[number];

export const SHARED_SPREADS = ['day', 'week', 'month'] as const satisfies readonly SharedSpread[];

/** How a job is judged (4.13). */
export const JOB_MODES = ['projected', 'actuals', 'final'] as const;
export type JobMode = (typeof JOB_MODES)[number];

/** How sure the projection is (4.13). `plan` means there is no evidence day yet. */
export const CONFIDENCE_LEVELS = ['plan', 'early', 'good', 'solid'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** The words people see for each confidence level. */
export const CONFIDENCE_LABELS: Readonly<Record<Confidence, string>> = {
  plan: 'Based on the plan',
  early: 'Early guess',
  good: 'Good read',
  solid: 'Solid',
};

/**
 * Totals of a quote or a budget (`pulse.job_plans`). Blank totals count as 0.
 * Setup hours and setup cost sit inside the labor totals.
 */
export interface PlanTotals {
  readonly units: Decimal | null;
  readonly revenueCents: Cents | null;
  readonly laborHours: Decimal | null;
  readonly laborCents: Cents | null;
  readonly setupHours?: Decimal | null;
  readonly setupCents?: Cents | null;
  readonly materialCents: Cents | null;
  readonly otherCents: Cents | null;
  readonly sharedCents?: Cents | null;
}

/** What really happened on a job, or what is projected to happen by the finish. */
export interface ActualTotals {
  readonly unitsGood: Decimal;
  /** Total labor hours (people times hours each). */
  readonly hours: Decimal;
  readonly revenueCents: Cents;
  readonly laborCents: Cents;
  /** Material cost with scrap included. */
  readonly materialCents: Cents;
  /** The scrap cost inside `materialCents`. Default 0. */
  readonly scrapCents?: Cents;
  readonly otherCents: Cents;
  /** Time not on a job that this job carries. */
  readonly sharedCents: Cents;
  /** Setup hours inside `hours`. Default 0. */
  readonly setupHours?: Decimal;
  /** Units per person per hour from counted days (4.12). When left out it is units over non setup hours. */
  readonly uph?: number | null;
}

/** The four cost buckets plus revenue: the smallest input most summaries need. */
export interface MoneyBuckets {
  readonly revenueCents: Cents;
  readonly laborCents: Cents;
  readonly materialCents: Cents;
  readonly otherCents: Cents;
  readonly sharedCents: Cents;
}
