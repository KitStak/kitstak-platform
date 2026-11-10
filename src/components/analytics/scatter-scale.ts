/**
 * Y-axis cap for the Performance Quadrant scatter. One associate with a handful of very
 * fast tasks (e.g. 3 tasks in 1 minute → 180 tasks/h) used to squash every other dot onto
 * the median line. When the top value is an outlier (more than 3× the next highest and
 * the median), the axis stops at a "nice" cap above the rest of the team and the outlier
 * is drawn pinned to the top edge with its real value in the label.
 */
export interface ScatterCap {
  /** Upper bound of the Y domain, or null to let recharts auto-scale. */
  readonly cap: number | null;
}

const nice = (v: number): number => {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
};

export function scatterYCap(values: readonly number[], median: number): ScatterCap {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => b - a);
  if (sorted.length < 3) return { cap: null };
  const [max = 0, second = 0] = sorted;
  const ref = Math.max(second, median, 0);
  if (ref <= 0 || max <= ref * 3) return { cap: null };
  return { cap: nice(Math.max(ref * 1.5, median * 2)) };
}

/** True when the point is drawn pinned to the cap (its real value is above it). */
export const isAboveCap = (value: number, cap: number | null): boolean => cap !== null && value > cap;

/**
 * Upper bound of an auto-scaled scatter Y axis: about 15 % headroom above the highest point,
 * rounded up to a tick step, so dot labels near the top never touch the plot border.
 */
export function scatterYMax(values: readonly number[]): number {
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (max <= 0) return 1;
  const padded = max * 1.15;
  const step = nice(padded / 4);
  const top = Math.ceil(padded / step) * step;
  return top - max < step * 0.25 ? top + step : top;
}

/** Evenly spaced ticks from 0 to `scatterYMax(values)` (no odd last tick). */
export function scatterYTicks(values: readonly number[]): number[] {
  const top = scatterYMax(values);
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  const step = max <= 0 ? 0.25 : nice((max * 1.15) / 4);
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/**
 * Label placement for the quadrant scatter, decided in data space (the chart's pixel size is
 * not known here). A point in the right 15 % of the X range gets its label on the left
 * (`__labelLeft`), so names never run off the plot; a point whose label would land on a
 * neighbour's (within 8 % of X and 6 % of Y) puts its label below the dot (`__labelBelow`).
 */
export function scatterLabelPlacement<R extends Readonly<Record<string, unknown>>>(rows: readonly R[], xKey: string, yKey: string): (R & { __labelLeft?: boolean; __labelBelow?: boolean })[] {
  const xs = rows.map((r) => Number(r[xKey] ?? 0));
  const ys = rows.map((r) => Number(r[yKey] ?? 0));
  const xMax = Math.max(1, ...xs);
  const yMax = Math.max(1, ...ys);
  const order = rows.map((_, i) => i).sort((a, b) => (ys[b] ?? 0) - (ys[a] ?? 0) || (xs[a] ?? 0) - (xs[b] ?? 0));
  const placed: { x: number; y: number; below: boolean; left: boolean }[] = [];
  const out: (R & { __labelLeft?: boolean; __labelBelow?: boolean })[] = rows.map((r) => ({ ...r }));
  for (const i of order) {
    const x = xs[i] ?? 0;
    const y = ys[i] ?? 0;
    const left = x > xMax * 0.85;
    const clash = placed.some((p) => !p.below && p.left === left && Math.abs(p.x - x) < xMax * 0.08 && Math.abs(p.y - y) < yMax * 0.06);
    placed.push({ x, y, below: clash, left });
    out[i] = { ...out[i]!, ...(left ? { __labelLeft: true } : {}), ...(clash ? { __labelBelow: true } : {}) };
  }
  return out;
}
