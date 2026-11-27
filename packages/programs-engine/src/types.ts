/**
 * Shared types for program money (docs/programs/SPEC.md 3.2). Pure types: no runtime code.
 *
 * Conventions: money is whole cents in `bigint` (`Cents`), or a decimal string of whole cents
 * when it crosses a JSON or database boundary (`"153000"`). Unit prices are dollar strings with 4
 * decimals (`"1.9500"`), quantities have 3 decimals, hours 2. Dates of work are `YYYY-MM-DD`
 * strings and never pass through a `Date` or a time zone after they are chosen.
 */
import type { Cents, Decimal } from './money';

export type { Cents, Decimal };

/** `YYYY-MM-DD`. */
export type IsoDate = string;
/** `YYYY-MM`. */
export type IsoMonth = string;

/** How a shared cost pool is cut in Pulse (docs/pulse/SPEC.md 4.5). Moved here so both apps share one name. */
export type SharedSpread = 'day' | 'week' | 'month';

export type PriceLineKind = 'per_unit' | 'per_order' | 'per_hour' | 'flat_monthly' | 'monthly_minimum';
export type LedgerKind = 'per_order' | 'per_hour' | 'flat_monthly' | 'setup' | 'adjustment' | 'minimum_top_up';
export type ChargeKind = 'per_unit' | LedgerKind;
export type PriceSource = 'build' | 'variant' | 'card' | 'job' | 'none';
export type Posting = 'program' | 'program_job' | 'build_job' | 'unbilled';

/** One charge on a price card version. */
export interface CardLine {
  readonly id: string;
  readonly kind: PriceLineKind;
  /** A variant rate (`per_unit` or `per_order`), or `null` for the card default. */
  readonly variantId: string | null;
  /** The rate rule that made this line, when it was compiled from one. */
  readonly ruleId: string | null;
  /** `per_unit`: dollars with 4 decimals. */
  readonly unitPrice: string | null;
  /** `per_hour`: whole cents per hour. */
  readonly rateCents: number | null;
  /** `per_order`, `flat_monthly`, `monthly_minimum`: whole cents as a decimal string. */
  readonly amountCents: string | null;
  /** Fixed lines: "Charge part of it in a partial month". */
  readonly prorate: boolean;
  /** Fixed lines: keep charging on paused days. */
  readonly chargeWhilePaused: boolean;
  /** Name on the statement. `null` uses the standard name. */
  readonly label: string | null;
}

/** "Size is XL: add $0.25". `attributeId` and `valueId` point at the program's attribute axes. */
export interface RateRule {
  readonly id: string;
  readonly attributeId: string;
  readonly valueId: string;
  readonly op: 'add' | 'set';
  /** Dollars, up to 4 decimals. `add` may be negative. */
  readonly amount: string;
}

/** A published card version. `effectiveFrom` is the first day it is in force. */
export interface CardVersion {
  readonly id: string;
  readonly number: number | null;
  readonly effectiveFrom: IsoDate;
  readonly lines: readonly CardLine[];
  readonly rules: readonly RateRule[];
}

/** A dated Pulse job price (`pulse.job_prices`). */
export interface JobPriceRow {
  readonly effectiveFrom: IsoDate;
  readonly unitPrice: string | null;
}

/** Inclusive date range. `to` null means open ended. */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate | null;
}

/** A program's days, already merged from the workspace calendar and the program settings (A15). */
export interface ProgramCalendar {
  readonly timezone: string;
  /** JS weekday numbers, 0 is Sunday. */
  readonly workingDays: readonly number[];
  /** Workspace holidays (when used) plus program extra days off. */
  readonly daysOff: readonly IsoDate[];
  readonly extraWorkDays: readonly IsoDate[];
  /** `pm.projects.start_date`. */
  readonly activeFrom: IsoDate | null;
  /** `pm.projects.due_date`. */
  readonly activeTo: IsoDate | null;
  readonly paused: readonly DateRange[];
}

/** One `pm.build_output` row: one build, one work date, with its price snapshot (M4). */
export interface OutputRow {
  readonly buildId: string;
  readonly variantId: string | null;
  readonly workDate: IsoDate;
  /** 3 decimals. */
  readonly qty: string;
  readonly scrapQty: string;
  /** Concrete, 4 decimals (`0.0000` when there is no price). */
  readonly unitPrice: string;
  readonly priceSource: PriceSource;
  readonly versionId: string | null;
  /** Snapshot, whole cents as a decimal string. */
  readonly revenueCents: string;
  readonly posting: Posting;
  readonly pulseJobId: string | null;
}

/** A live, not cancelled build first finished in the month. */
export interface FinishedBuild {
  readonly buildId: string;
  readonly buildKey: string;
  readonly variantId: string | null;
  readonly finishedOn: IsoDate;
  readonly builtQty: string;
}

/** Minutes of time on one day for one task. `buildId` and `variantId` are null for program level time. */
export interface TimeDay {
  readonly workDate: IsoDate;
  readonly buildId: string | null;
  readonly variantId: string | null;
  readonly minutes: number;
}

/** A setup fee or an adjustment (a charge or a credit), outside the versioned card. */
export interface OneTimeCharge {
  readonly id: string;
  readonly kind: 'setup' | 'adjustment';
  readonly chargeOn: IsoDate;
  /** Signed whole cents as a decimal string. */
  readonly amountCents: string;
  readonly label: string;
  readonly variantId: string | null;
  readonly countsTowardMinimum: boolean;
}

/** One `pm.program_ledger` row (A13). */
export interface LedgerRow {
  readonly ref: string;
  readonly kind: LedgerKind;
  readonly chargeDate: IsoDate;
  readonly cents: Cents;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly variantId: string | null;
  readonly buildId: string | null;
  readonly versionId: string | null;
  readonly lineId: string | null;
  readonly oneTimeId: string | null;
  readonly label: string;
  readonly countsTowardMinimum: boolean;
}
