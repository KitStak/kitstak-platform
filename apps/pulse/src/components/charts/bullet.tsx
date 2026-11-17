'use client';
/**
 * BulletChart: one number against its target on a thin track. The bar is the number, the dark
 * tick is the target, and the words on the right say how far along it is, so the reading never
 * rests on color.
 */
import { CHART_COLORS, resolveFormat, seriesColor, type ChartFormat } from './chart-format';
import { clamp } from './scale';
import { cn } from '@/components/ui/cn';

export interface BulletChartProps {
  /** What is measured: "Units this week". */
  readonly label: string;
  readonly value: number | null;
  readonly target: number;
  /** End of the track. Default: a little past the larger of value and target. */
  readonly max?: number;
  readonly format?: ChartFormat;
  /** `down` for costs and hours, where staying under the target is the goal. */
  readonly goodWhen?: 'up' | 'down';
  readonly targetLabel?: string;
  /** `sm` drops the label row for table cells. */
  readonly size?: 'sm' | 'md';
  readonly loading?: boolean;
  readonly className?: string;
}

export function bulletReading(value: number | null, target: number, goodWhen: 'up' | 'down' = 'up', targetLabel = 'Target'): { met: boolean; text: string } {
  if (value === null) return { met: false, text: 'No data yet' };
  if (target === 0) return { met: goodWhen === 'up' ? value >= 0 : value <= 0, text: 'No target set' };
  const percent = Math.round((value / target) * 100);
  const met = goodWhen === 'up' ? value >= target : value <= target;
  return { met, text: `${percent}% of ${targetLabel.toLowerCase()}` };
}

export function BulletChart({ label, value, target, max, format, goodWhen = 'up', targetLabel = 'Target', size = 'md', loading, className }: BulletChartProps) {
  const fmt = resolveFormat(format);
  const top = max ?? Math.max(target, value ?? 0, 1) * 1.15;
  const ratio = value === null ? 0 : clamp(value / top, 0, 1);
  const targetRatio = clamp(target / top, 0, 1);
  const reading = bulletReading(value, target, goodWhen, targetLabel);
  const color = value === null ? CHART_COLORS.neutral : reading.met ? CHART_COLORS.up : goodWhen === 'down' ? CHART_COLORS.down : seriesColor(0);
  const spoken = value === null ? `${label}: no data yet. ${targetLabel} ${fmt.value(target)}.` : `${label}: ${fmt.value(value)}, ${reading.text}. ${targetLabel} ${fmt.value(target)}.`;
  if (loading) {
    return (
      <div role="status" aria-busy="true" className={cn('flex flex-col gap-2', className)}>
        <span className="sr-only">{`Loading ${label}`}</span>
        {size === 'md' ? <span aria-hidden className="ks-skeleton block h-3 w-2/5 rounded-full" /> : null}
        <span aria-hidden className="ks-skeleton block h-2.5 w-full rounded-full" />
      </div>
    );
  }
  return (
    <div className={cn('pulse-chart min-w-0', className)} role="img" aria-label={spoken}>
      {size === 'md' ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs" aria-hidden>
          <span className="min-w-0 truncate text-fg-secondary">{label}</span>
          <span className="shrink-0 text-fg-muted">
            <strong className="font-semibold text-fg tabular-nums">{value === null ? 'No data' : fmt.value(value)}</strong>
            {value === null ? null : <span className="ml-1.5">{reading.text}</span>}
          </span>
        </div>
      ) : null}
      <div className="relative h-4" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full" style={{ background: CHART_COLORS.track }}>
          <div className="pc-grow h-full rounded-full" style={{ width: `${ratio * 100}%`, background: color, minWidth: value !== null && value > 0 ? 4 : 0 }} />
        </div>
        <div className="absolute top-0 h-4 w-[3px] -translate-x-1/2 rounded-full bg-fg ring-2 ring-panel" style={{ left: `${targetRatio * 100}%` }} />
      </div>
      {size === 'md' ? (
        <div className="relative mt-1 h-4 text-2xs text-fg-muted" aria-hidden>
          <span className="absolute whitespace-nowrap" style={targetRatio > 0.7 ? { right: `${(1 - targetRatio) * 100}%`, transform: 'translateX(1.5px)' } : { left: `${targetRatio * 100}%`, transform: 'translateX(-1.5px)' }}>
            {`${targetLabel} ${fmt.value(target)}`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
