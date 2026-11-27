'use client';
/**
 * Sparkline: a tiny trend with no axes. The line is quiet and the newest point is the accent, so
 * the eye lands on "where are we now". It is one image for screen readers, with a sentence that
 * gives the start, the end, the low and the high.
 */
import { resolveFormat, seriesColor, type ChartFormat } from './chart-format';
import { useChartWidth } from './frame';
import { areaPath, linePath, linearScale } from './scale';
import { cn } from '@/components/ui/cn';

export interface SparklineProps {
  readonly values: readonly (number | null)[];
  /** What the line is: "Profit, last 12 weeks". */
  readonly label: string;
  /** Lets the spoken summary say real numbers. */
  readonly format?: ChartFormat;
  readonly width?: number;
  readonly height?: number;
  /** Stretch to the parent width (ignores `width`). */
  readonly fluid?: boolean;
  /** Color of the newest point and wash. `good` and `bad` are for trends with a clear better side. */
  readonly tone?: 'accent' | 'good' | 'bad' | 'neutral';
  readonly area?: boolean;
  readonly className?: string;
}

const TONE: Record<NonNullable<SparklineProps['tone']>, string> = {
  accent: seriesColor(0),
  good: 'var(--pulse-chart-up)',
  bad: 'var(--pulse-chart-down)',
  neutral: 'var(--pulse-chart-neutral)',
};

export function sparklineSummary(values: readonly (number | null)[], label: string, format?: ChartFormat): string {
  const real = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (real.length === 0) return `${label}: no data yet`;
  const fmt = format ? resolveFormat(format) : null;
  const first = real[0]!;
  const last = real[real.length - 1]!;
  if (real.length === 1) return fmt ? `${label}: one point, ${fmt.value(first)}` : `${label}: one point`;
  const direction = last > first ? 'up' : last < first ? 'down' : 'flat';
  if (!fmt) return `${label}: trending ${direction} over ${real.length} points`;
  return `${label}: ${direction === 'flat' ? 'flat' : `trending ${direction}`}, from ${fmt.value(first)} to ${fmt.value(last)}. Low ${fmt.value(Math.min(...real))}, high ${fmt.value(Math.max(...real))}.`;
}

export function Sparkline({ values, label, format, width = 96, height = 28, fluid, tone = 'accent', area = true, className }: SparklineProps) {
  const [ref, measured] = useChartWidth<HTMLSpanElement>(fluid ? undefined : width);
  const w = fluid ? measured : width;
  const pad = 4;
  const real = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const min = real.length ? Math.min(...real) : 0;
  const max = real.length ? Math.max(...real) : 1;
  const y = linearScale(min, max, height - pad, pad);
  const count = values.length;
  const xs = values.map((_, index) => (count === 1 ? w / 2 : pad + ((w - pad * 2) * index) / (count - 1)));
  const ys = values.map((value) => (value === null || value === undefined || !Number.isFinite(value) ? null : y(value)));
  let last = -1;
  ys.forEach((value, index) => {
    if (value !== null) last = index;
  });
  const color = TONE[tone];
  const crossesZero = min < 0 && max > 0;
  return (
    <span ref={ref} role="img" aria-label={sparklineSummary(values, label, format)} className={cn('pulse-chart inline-block shrink-0 align-middle', fluid && 'block w-full', className)} style={{ height, width: fluid ? undefined : width }}>
      {w > 0 ? (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden className="block overflow-visible">
          {real.length === 0 ? (
            <line x1={pad} x2={w - pad} y1={height / 2} y2={height / 2} stroke="var(--pulse-chart-grid)" strokeWidth={2} strokeLinecap="round" strokeDasharray="1 5" />
          ) : (
            <>
              {crossesZero ? <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="var(--pulse-chart-axis)" strokeWidth={1} shapeRendering="crispEdges" /> : null}
              {area && real.length > 1 ? <path d={areaPath(xs, ys, crossesZero ? y(0) : height - 1)} fill={color} fillOpacity={0.1} /> : null}
              <path d={linePath(xs, ys)} fill="none" stroke={tone === 'neutral' ? color : 'var(--pulse-chart-neutral)'} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
              {last >= 0 ? <circle cx={xs[last]} cy={ys[last] ?? 0} r={3} fill={color} stroke="var(--surface-panel)" strokeWidth={1.5} /> : null}
            </>
          )}
        </svg>
      ) : null}
    </span>
  );
}
