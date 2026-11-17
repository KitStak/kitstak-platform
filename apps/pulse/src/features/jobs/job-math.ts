/**
 * Glue between job DTOs and the pure profit library. Nothing here invents a formula: it turns
 * DTO fields (cents as numbers, decimals as strings) into the library's inputs and calls it.
 * Safe in client components and tests.
 */
import { hoursToScaled, scaledToNumber, toCents, type Cents } from '@/lib/money';
import {
  evidenceDayCount,
  lastEvidenceWindow,
  materialLeftFromUsage,
  paceDays,
  projectJob,
  type ActualTotals,
  type PlanTotals,
  type Projection,
  type ProjectionInput,
  unitsPerHour,
} from '@/lib/profit';
import type {
  JobDetailDTO,
  JobListItemDTO,
  JobPlanDTO,
  JobStatsDTO,
  MaterialUsageDTO,
  ProductionEntryDTO,
  ProfitRowDTO,
  VasEntryDTO,
} from '@/lib/types';
import type { NextStep } from '@/lib/profit/risk';
import { routes } from '@/lib/routes';

const ZERO = BigInt(0);
const c = (value: number | null | undefined): Cents => toCents(value ?? 0);

/** "kits" to "kit": the formatters add the plural themselves. Mirrors the server's `singular`. */
export function singularUnit(unitLabel: string | null | undefined): string {
  const word = (unitLabel ?? '').trim();
  if (!word) return 'unit';
  if (/ies$/i.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(xes|ses|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 2) return word.slice(0, -1);
  return word;
}

/** What happened so far, as the library's totals. Null when the reader may not see money. */
export function statsToActual(stats: JobStatsDTO): ActualTotals | null {
  if (stats.moneyHidden || stats.revenueCents === null) return null;
  return {
    unitsGood: stats.unitsGood,
    hours: stats.hours,
    revenueCents: c(stats.revenueCents),
    laborCents: c(stats.laborCents),
    materialCents: c(stats.materialCents),
    scrapCents: c(stats.scrapCents),
    otherCents: c(stats.otherCents),
    sharedCents: c(stats.sharedCents),
    setupHours: stats.setupHours,
    uph: stats.uph === null ? null : Number(stats.uph),
  };
}

/** A saved quote or budget as the library's plan totals. Null when money is hidden. */
export function planToTotals(plan: JobPlanDTO | null | undefined): PlanTotals | null {
  if (!plan || plan.moneyHidden || plan.revenueCents === null) return null;
  return {
    units: plan.units,
    revenueCents: c(plan.revenueCents),
    laborHours: plan.laborHours,
    laborCents: c(plan.laborCents),
    setupHours: plan.setupHours,
    setupCents: c(plan.setupCents),
    materialCents: c(plan.materialCents),
    otherCents: c(plan.otherCents),
    sharedCents: c(plan.sharedCents),
  };
}

/** The plan a job is judged by: the budget when there is one, else the quote. */
export function planInUse(job: Pick<JobDetailDTO, 'quote' | 'budget'>): JobPlanDTO | null {
  return job.budget ?? job.quote ?? null;
}

export interface ProjectionSources {
  readonly job: JobDetailDTO;
  readonly production: readonly ProductionEntryDTO[];
  readonly services: readonly VasEntryDTO[];
  readonly usage: readonly MaterialUsageDTO[];
  /** The job's numbers per day (for ongoing work: the last 30 days). */
  readonly days: readonly ProfitRowDTO[];
  readonly today: string;
  readonly workingDays: readonly number[];
  /** Today's real cost of an hour for the job's labor class, else the workspace default. */
  readonly fallbackRateCents: number | null;
}

/**
 * Rebuilds the exact input the server gives `projectJob` for this job, from the same rows the
 * job page already shows. The what if sliders change a copy of this and call the library again.
 */
export function buildProjectionInput(sources: ProjectionSources): ProjectionInput | null {
  const { job } = sources;
  const actual = statsToActual(job.stats);
  if (!actual) return null;
  const days = paceDays(
    sources.production
      .filter((row) => row.deletedAt === null)
      .map((row) => ({
        workDate: row.workDate,
        unitsGood: row.unitsGood,
        hours: row.hours,
        setupHours: row.setupHours,
        hoursConfirmed: row.hoursConfirmed,
        source: row.source,
        laborCostCents: c(row.laborCostCents),
      })),
  );
  const window = lastEvidenceWindow(days);
  const live = sources.services.filter((row) => row.deletedAt === null);
  const serviceMaterial = live.reduce((sum, row) => sum + c(row.materialCents), ZERO);
  const serviceCost =
    live.reduce((sum, row) => sum + c(row.laborCostCents) + c(row.sharedCents), ZERO) + serviceMaterial;
  const plannedLeft =
    job.materialMethod === 'actual'
      ? materialLeftFromUsage(
          sources.usage
            .filter((row) => row.deletedAt === null)
            .map((row) => ({
              quantityPlanned: row.quantityPlanned,
              quantityUsed: row.quantityUsed,
              quantityScrapped: row.quantityScrapped,
              unitCost: row.unitCost ?? '0',
              suppliedBy: row.resolvedSuppliedBy,
            })),
        )
      : null;
  const cutoff = shiftDate(sources.today, -30);
  const last = sources.days.filter((row) => row.key > cutoff);
  const sum = (pick: (row: ProfitRowDTO) => number | null): Cents =>
    last.reduce((total, row) => total + c(pick(row)), ZERO);
  return {
    status: job.status,
    kind: job.kind,
    pricingModel: job.pricingModel,
    plannedUnits: job.plannedUnits,
    plan: planToTotals(planInUse(job)),
    actual,
    serviceRevenueCents: c(job.stats.vasRevenueCents),
    otherRevenueCents: c(job.stats.otherRevenueCents),
    serviceCostCents: serviceCost,
    serviceMaterialCents: serviceMaterial,
    window:
      window.days > 0
        ? {
            days: window.days,
            unitsGood: window.unitsGood,
            paceHours: window.paceHours,
            hours: window.hours,
            laborCostCents: window.laborCostCents,
          }
        : null,
    evidenceDays: evidenceDayCount(days),
    targetPace: job.stats.standardUph,
    unitPrice: job.unitPrice,
    fixedPriceCents: job.fixedPriceCents === null ? null : c(job.fixedPriceCents),
    billRateCents: job.billRateCents === null ? null : c(job.billRateCents),
    materialMethod: job.materialMethod,
    materialCostPerUnit: job.materialCostPerUnit,
    plannedMaterialLeftCents: plannedLeft,
    fallbackRateCents: sources.fallbackRateCents === null ? null : c(sources.fallbackRateCents),
    today: sources.today,
    workingDays: sources.workingDays,
    last30: {
      revenueCents: sum((row) => row.revenueCents),
      laborCents: sum((row) => row.laborCents),
      materialCents: sum((row) => row.materialCents),
      otherCents: sum((row) => row.otherCents),
      sharedCents: sum((row) => row.sharedCents),
      unitsGood: last.reduce((total, row) => total + Number(row.unitsGood), 0),
      hours: last.reduce((total, row) => total + Number(row.hours), 0),
    },
  };
}

export interface WhatIfChange {
  /** Units per person per hour for the rest of the job. */
  readonly pace?: number | null;
  /** Real cost of an hour for the rest of the job, in cents. */
  readonly rateCents?: number | null;
  /** Price for one unit, as text with up to 4 places. */
  readonly unitPrice?: string | null;
  /** The total units the job will make. */
  readonly plannedUnits?: string | null;
}

/**
 * Runs the library's projection again with a few inputs changed. A typed pace or hourly cost
 * replaces the evidence window with one that runs at exactly that pace and cost, with full
 * trust, so the rest of the job is projected at the numbers on the sliders.
 */
export function projectWhatIf(base: ProjectionInput, change: WhatIfChange, baseline: Projection): Projection {
  let input: ProjectionInput = base;
  if (change.unitPrice !== undefined && change.unitPrice !== null)
    input = { ...input, unitPrice: change.unitPrice };
  if (change.plannedUnits !== undefined && change.plannedUnits !== null)
    input = { ...input, plannedUnits: change.plannedUnits };
  const paceChanged = change.pace !== undefined && change.pace !== null;
  const rateChanged = change.rateCents !== undefined && change.rateCents !== null;
  if (paceChanged || rateChanged) {
    const pace = paceChanged ? (change.pace as number) : (baseline.paceUph ?? 0);
    const rate = rateChanged ? (change.rateCents as number) : Number(baseline.rateLeftCents ?? ZERO);
    if (pace > 0) {
      // Keep the crew hours a day of the real window, so the finish date still follows the crew size.
      const real = base.window;
      const days = real?.days ?? 5;
      const paceHours = real ? Number(real.paceHours) : 200;
      const hours = real && real.hours !== null && real.hours !== undefined ? Number(real.hours) : paceHours;
      input = {
        ...input,
        window: {
          days,
          unitsGood: Math.round(pace * paceHours * 1000) / 1000,
          paceHours,
          hours,
          laborCostCents: toCents(Math.round(Math.round(rate) * hours)),
        },
        evidenceDays: Math.max(3, input.evidenceDays),
        targetPace: pace,
      };
    }
  }
  return projectJob(input);
}

/** `YYYY-MM-DD` moved by whole days, in UTC so it never slips a day. */
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Where a next step button goes for a job. */
export function nextStepHref(step: string | null, job: Pick<JobListItemDTO, 'number'>): string {
  const ref = job.number;
  switch (step as NextStep | null) {
    case 'check_crew':
    case 'add_hours':
      return routes.jobTab(ref, 'work');
    case 'log_missing_days':
      return routes.log({ job: ref });
    case 'add_labor_rate':
      return routes.labor('rates');
    case 'review_price':
    case 'add_price':
      return routes.jobTab(ref, 'money-in');
    case 'check_materials':
    case 'check_parts':
      return routes.jobTab(ref, 'materials');
    case 'review_job':
    case 'add_plan':
    case 'update_plan':
      return routes.jobTab(ref, 'plan');
    default:
      return routes.job(ref);
  }
}

/** Worst first: the order the open jobs list uses. */
export const RISK_ORDER: Readonly<Record<string, number>> = {
  losing: 0,
  at_risk: 1,
  no_data: 2,
  heads_up: 3,
  on_track: 4,
  none: 5,
};

export function riskRank(job: JobListItemDTO): number {
  return RISK_ORDER[job.stats.riskStatus ?? 'none'] ?? 5;
}

/** Pace of one work entry: good units over its hours that are not setup. Null with no such hours. */
export function rowPace(
  row: Pick<ProductionEntryDTO, 'unitsGood' | 'hours' | 'setupHours' | 'hoursConfirmed'>,
): number | null {
  if (!row.hoursConfirmed || Number(row.unitsGood) <= 0) return null;
  const paceHours = hoursToScaled(row.hours) - hoursToScaled(row.setupHours);
  return paceHours > ZERO ? unitsPerHour(row.unitsGood, scaledToNumber(paceHours, 2)) : null;
}
