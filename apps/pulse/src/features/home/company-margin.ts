/**
 * Company margin: what the company kept after time not on a job and overhead, as a share of
 * revenue. "Margin on jobs" leaves those costs out, so the two are shown side by side.
 */
import { marginBp } from '@/lib/money';

/** `null` when money is hidden or there is no revenue. */
export function companyMarginBp(companyProfitCents: number | null | undefined, revenueCents: number | null | undefined): number | null {
  if (companyProfitCents === null || companyProfitCents === undefined || revenueCents === null || revenueCents === undefined) return null;
  return marginBp(Math.round(companyProfitCents), Math.round(revenueCents));
}
