/**
 * The margin line on the client trend chart. A week with very little revenue can show a huge
 * margin swing ($433 of revenue at -3,900%), which stretches the axis and flattens every other
 * week to a line at zero. Such weeks are left off the line (their bars still show), and the chart
 * says how many were left off.
 */
const SMALL_SHARE_BP = BigInt(500); // 5% of the biggest week
const BP_ONE = BigInt(10_000);

export interface TrendPoint {
  readonly revenueCents: number | null;
  readonly marginBp: number | null;
}

export function trendMarginLine(points: readonly TrendPoint[]): { readonly values: (number | null)[]; readonly skipped: number } {
  const biggest = points.reduce((max, point) => {
    const revenue = BigInt(point.revenueCents ?? 0);
    return revenue > max ? revenue : max;
  }, BigInt(0));
  let skipped = 0;
  const values = points.map((point) => {
    if (point.marginBp === null) return null;
    const revenue = BigInt(point.revenueCents ?? 0);
    if (revenue * BP_ONE < biggest * SMALL_SHARE_BP) {
      skipped += 1;
      return null;
    }
    return point.marginBp;
  });
  return { values, skipped };
}
