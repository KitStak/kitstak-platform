/**
 * Pure layout / scale helpers for the analytics chart cards (unit tested):
 * balanced card widths, axis tick formats (money, thousands, category labels) and the
 * off-scale cap for bar charts with one outlier bar.
 */
import type { AnalyticsChart, AnalyticsColumn } from '@/server/repositories/analytics-types';
import { scatterYCap } from './scatter-scale';

/**
 * Two-column chart grid without holes: a half-width card that would sit alone on its row (the
 * next card is wide, or it is the last one) is widened to the full row.
 */
export function withBalancedWidths(charts: readonly AnalyticsChart[]): AnalyticsChart[] {
  const out: AnalyticsChart[] = [];
  let col = 0;
  charts.forEach((c, i) => {
    if (c.wide) {
      out.push(c);
      col = 0;
      return;
    }
    const next = charts[i + 1];
    const alone = col === 0 && (!next || Boolean(next.wide));
    out.push(alone ? { ...c, wide: true } : c);
    col = alone ? 0 : (col + 1) % 2;
  });
  return out;
}

/** The value kind shared by every plotted series (from the chart's columns), if any. */
export function seriesKind(
  chart: Pick<AnalyticsChart, 'series' | 'columns'>,
): AnalyticsColumn['kind'] | undefined {
  const kinds = new Set(
    chart.series.map((s) => chart.columns.find((c) => c.key === s.key)?.kind ?? 'number'),
  );
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const thousands = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Y-axis tick: `$12K` for money, `12,000` / `1.2M` for counts, `40%` for percents. */
export function axisTick(value: unknown, kind: AnalyticsColumn['kind'] | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const abs = Math.abs(n);
  if (kind === 'money')
    return `${n < 0 ? '-' : ''}$${abs >= 1000 ? compact.format(abs) : thousands.format(abs)}`;
  if (kind === 'percent') return `${thousands.format(n)}%`;
  return abs >= 100_000 ? compact.format(n) : thousands.format(n);
}

/** Category x labels (SKUs, clients, areas) shortened to fit under a bar; the full text is in the tooltip. */
export function shortCategory(value: unknown, max = 12): string {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** True when the x axis holds days (dates are labelled sparsely); categories show every label. */
export const isDayAxis = (rows: readonly Readonly<Record<string, unknown>>[], xKey: string): boolean =>
  rows.length > 0 && rows.every((r) => DAY_RE.test(String(r[xKey] ?? '')));

/**
 * Off-scale cap for a bar chart: same rule as the quadrant (top value > 3× the next highest and
 * the median of all bars). Returns null when every bar fits.
 */
export function barCap(
  chart: Pick<AnalyticsChart, 'series' | 'rows' | 'flagKey' | 'flagNormal'>,
): number | null {
  const valuesOf = (rows: readonly Readonly<Record<string, unknown>>[]) =>
    rows
      .flatMap((r) => chart.series.map((s) => Number(r[s.key] ?? 0)))
      .filter((v) => Number.isFinite(v) && v > 0);
  // Flagged rows (bulk moves, low timing confidence) never set the scale: the axis fits the
  // comparable bars and a flagged bar above it is drawn off scale.
  if (chart.flagKey) {
    const isFlagged = (r: Readonly<Record<string, unknown>>) =>
      r[chart.flagKey as string] !== undefined && r[chart.flagKey as string] !== chart.flagNormal;
    const flagged = valuesOf(chart.rows.filter(isFlagged));
    const normal = valuesOf(chart.rows.filter((r) => !isFlagged(r)));
    if (flagged.length && normal.length) {
      const top = Math.max(...normal);
      if (Math.max(...flagged) > top * 1.5) return niceCeil(top * 1.15);
    }
  }
  const values = valuesOf(chart.rows);
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med =
    sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return scatterYCap(values, med).cap;
}

/** Smallest 1/2/2.5/5 × 10^n at or above `v`. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/** Five evenly spaced ticks from 0 to `cap` (recharts picks uneven ticks for a fixed domain). */
export const capTicks = (cap: number): number[] =>
  [0, 1, 2, 3, 4].map((i) => Math.round(((cap * i) / 4) * 100) / 100);

/** Real-value key for a bar clamped to the cap. */
export const realKey = (seriesKey: string): string => `__real_${seriesKey}`;

/** Rows with every value above `cap` clamped to it (real value kept under `realKey`). */
export function clampRows(
  rows: readonly Readonly<Record<string, string | number | null>>[],
  keys: readonly string[],
  cap: number | null,
): Record<string, string | number | null>[] {
  if (cap === null) return rows.map((r) => ({ ...r }));
  return rows.map((r) => {
    const out: Record<string, string | number | null> = { ...r };
    for (const k of keys) {
      const v = Number(r[k] ?? 0);
      if (v > cap) {
        out[k] = cap;
        out[realKey(k)] = v;
      }
    }
    return out;
  });
}
