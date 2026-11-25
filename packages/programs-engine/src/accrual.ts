/**
 * Accrual and posting (docs/programs/SPEC.md 3.4). Per unit revenue is computed per output row
 * with one rounding step to whole cents (M1). Where a build day's revenue goes is decided by one
 * rule (M2, D4). Pure functions.
 *
 * `perUnitRevenue` and `hourlyRevenue` moved here from `apps/pulse/src/lib/profit/revenue.ts`
 * (Pulse re-exports them), so both apps stamp a row with the same number.
 */
import { type Cents, type CentsLike, type Decimal, ZERO, divRound, fromScaled, mulHoursRate, mulQuantityPrice } from './money';

/** Per unit pricing: `units good x unit price`. 3,000 units at $2.75 is $8,250.00. */
export function perUnitRevenue(unitsGood: Decimal, unitPrice: Decimal | null | undefined): Cents {
  if (unitPrice === null || unitPrice === undefined || unitPrice === '') return ZERO;
  return mulQuantityPrice(unitsGood, unitPrice);
}

/** Hourly pricing: `hours x bill rate`. */
export function hourlyRevenue(hours: Decimal, billRateCents: CentsLike | null | undefined): Cents {
  if (billRateCents === null || billRateCents === undefined) return ZERO;
  return mulHoursRate(hours, billRateCents);
}

/** The revenue of one output row: `divRound(qty1000 * price10000, 100000)`. 0 when there is no price. */
export function accrueDay(qty: Decimal, unitPrice: Decimal | null): Cents {
  return perUnitRevenue(qty, unitPrice);
}

/**
 * Minutes to hours with 2 decimals, rounded once half away from zero:
 * `fromScaled(divRound(minutes * 100, 60), 2)`. 95 minutes is `'1.58'`. Matches the Pulse
 * `projectTimeByDay` rounding.
 */
export function minutesToHours(minutes: number): string {
  if (!Number.isSafeInteger(minutes)) throw new RangeError(`Minutes must be a whole number, got ${minutes}`);
  return fromScaled(divRound(BigInt(minutes) * BigInt(100), BigInt(60)), 2);
}

/** A Pulse job behind a link. `live` is false when the job is gone or deleted (`getJobFacts`). */
export interface LiveJob {
  readonly id: string;
  readonly live: boolean;
}

export type PostingTarget =
  | { readonly posting: 'build_job'; readonly jobId: string }
  | { readonly posting: 'program_job'; readonly jobId: string }
  | { readonly posting: 'program'; readonly jobId: null }
  | { readonly posting: 'unbilled'; readonly jobId: null };

/**
 * Where a build day's revenue goes (D4, M2): a live build job beats a live program job beats the
 * program. With no program and no live build job the day is not billed anywhere. A job that is not
 * live counts as no job (the domain raises `pulse_out_of_sync`).
 */
export function postingTarget(input: { readonly buildJob: LiveJob | null; readonly programId: string | null; readonly programJob: LiveJob | null }): PostingTarget {
  if (input.buildJob && input.buildJob.live) return { posting: 'build_job', jobId: input.buildJob.id };
  if (input.programId !== null) {
    if (input.programJob && input.programJob.live) return { posting: 'program_job', jobId: input.programJob.id };
    return { posting: 'program', jobId: null };
  }
  return { posting: 'unbilled', jobId: null };
}

export type LinkJobRefusal = 'not_per_unit' | 'not_ongoing' | 'work_order_fed' | 'has_typed_units' | 'other_program';

export interface LinkableJob {
  readonly pricingModel: 'per_unit' | 'fixed' | 'hourly';
  readonly kind: 'one_time' | 'ongoing';
  /** The job gets its units from a WMS work order. */
  readonly feedsFromWorkOrder: boolean;
  /** The job has units typed by hand in an open month. */
  readonly hasTypedUnits: boolean;
  /** The program that already takes revenue from this job, if any. */
  readonly programId: string | null;
}

/**
 * Whether a Pulse job can take revenue from a program or a build (3.4). A program job must be
 * per unit and ongoing; a build job must be per unit. Neither may be fed by a WMS work order, have
 * typed units in an open month, or take revenue from another program.
 */
export function canLinkJob(job: LinkableJob, target: { readonly kind: 'program' | 'build'; readonly programId: string | null }): { ok: true } | { ok: false; reason: LinkJobRefusal } {
  if (job.pricingModel !== 'per_unit') return { ok: false, reason: 'not_per_unit' };
  if (target.kind === 'program' && job.kind !== 'ongoing') return { ok: false, reason: 'not_ongoing' };
  if (job.feedsFromWorkOrder) return { ok: false, reason: 'work_order_fed' };
  if (job.hasTypedUnits) return { ok: false, reason: 'has_typed_units' };
  if (job.programId !== null && job.programId !== target.programId) return { ok: false, reason: 'other_program' };
  return { ok: true };
}

/** The words for a refused job link (UI copy). */
export const LINK_JOB_MESSAGES: Readonly<Record<LinkJobRefusal, string>> = {
  not_per_unit: 'Only per unit jobs can take build output.',
  not_ongoing: 'Programs link to ongoing jobs.',
  work_order_fed: 'This job gets units from a WMS work order, so builds cannot feed it.',
  has_typed_units: 'This job already has units typed in an open month. Move them to an adjustment in Pulse first.',
  other_program: 'This job already takes revenue from another program.',
};

/** The words for where a build day's revenue goes, shown after "Revenue goes to" (SPEC 2.2.17, word for word). */
export const POSTING_LABELS: Readonly<Record<PostingTarget['posting'], string>> = {
  program: 'This program',
  program_job: "The program's Pulse job",
  build_job: "This build's Pulse job",
  unbilled: 'Not billed',
};
