/**
 * Company margin: what the company kept after time not on a job and overhead, as a share of
 * revenue. "Job margin" leaves those costs out, so the two are shown side by side.
 */
import { marginBp } from '@/lib/money';

/** `null` when money is hidden or there is no revenue. */
export function companyMarginBp(companyProfitCents: number | null | undefined, revenueCents: number | null | undefined): number | null {
  if (companyProfitCents === null || companyProfitCents === undefined || revenueCents === null || revenueCents === undefined) return null;
  return marginBp(Math.round(companyProfitCents), Math.round(revenueCents));
}

/**
 * The words that sit beside a company number. Overhead is only named when company costs were
 * counted for these days (SPEC 4.9), so a screen never says "after overhead" with no overhead step.
 */
export function companyWords(bridge: { readonly hasCompanyCosts: boolean; readonly companyCostNote: string | null }): { readonly lead: string; readonly tile: string; readonly note: string | null } {
  if (bridge.hasCompanyCosts) {
    return { lead: 'After time not on a job and overhead', tile: 'After overhead and paid time not on any job', note: bridge.companyCostNote };
  }
  return { lead: 'After time not on a job', tile: 'After paid time not on any job', note: null };
}

/** The bridge numbers the company sentence reads. Money in cents, null when hidden. */
export interface CompanySentenceInput {
  readonly hasCompanyCosts: boolean;
  readonly companyCostNote: string | null;
  readonly companyCostPartial: boolean;
  /** Left out by older callers: read as calendar days. */
  readonly companyCostSpread?: 'calendar' | 'work_days';
  readonly workProfitCents: number | null;
  readonly sharedGapCents: number | null;
  readonly missingCostCents: number | null;
  readonly overheadGapCents: number | null;
  readonly companyProfitCents: number | null;
}

export interface CompanySentence {
  /**
   * The words before the company number: "After time not on a job and overhead, the company made"
   * or "The company made more than its jobs:". Never holds money.
   */
  readonly lead: string;
  /** One plain sentence on the bridge step that moved the number most, or null when nothing moved it. */
  readonly reason: string | null;
  /** The part month note, like "Company costs for 12 of 21 work days.", or null. */
  readonly note: string | null;
}

/**
 * The line under the cards: what the company made, and in plain words why it is more or less than
 * the jobs made (round four, designer issue 9). It names the bridge step with the biggest effect.
 * Example: jobs $132,009, overhead step +$10,841 (the hourly rates covered more overhead than the
 * company costs for these days), paid time not on any job -$7,002: company $135,849, "The company
 * made more than its jobs:", "Your hourly rates covered more overhead than the company costs for
 * these days, so overhead added to profit."
 */
export function companySentence(bridge: CompanySentenceInput): CompanySentence {
  const words = companyWords(bridge);
  const steps = [
    { key: 'shared', effect: -(bridge.sharedGapCents ?? 0) },
    { key: 'missing', effect: -(bridge.missingCostCents ?? 0) },
    { key: 'overhead', effect: bridge.hasCompanyCosts ? -(bridge.overheadGapCents ?? 0) : 0 },
  ] as const;
  const company = bridge.companyProfitCents ?? 0;
  const jobs = bridge.workProfitCents ?? 0;
  const more = bridge.companyProfitCents !== null && bridge.workProfitCents !== null && company > jobs;
  const biggest = [...steps].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))[0]!;
  let reason: string | null = null;
  if (more) {
    // Only the overhead step can add to profit: the hourly rates carried more than was spent.
    reason = 'Your hourly rates covered more overhead than the company costs for these days, so overhead added to profit.';
    if (bridge.companyCostPartial && (bridge.companyCostSpread ?? 'calendar') === 'calendar') {
      reason = `${reason} Company costs are shared by calendar day, so days off carry a share and a work week carries less than its part of the month.`;
    }
  } else if (biggest.effect < 0) {
    reason =
      biggest.key === 'overhead'
        ? 'The biggest step down is overhead your hourly rates did not cover.'
        : biggest.key === 'missing'
          ? 'The biggest step down is paid time not on any job.'
          : 'The biggest step down is time not on a job that no job carried.';
  }
  return { lead: more ? 'The company made more than its jobs:' : `${words.lead}, the company made`, reason, note: words.note };
}
