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
