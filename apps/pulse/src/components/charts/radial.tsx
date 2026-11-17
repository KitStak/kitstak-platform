'use client';
/**
 * Round charts: DonutChart (share of a whole, six slices at most), ProgressRing (how far along)
 * and Gauge (a number against its target, for example margin against target margin).
 */
import type { ReactNode } from 'react';
import { CHART_COLORS, resolveFormat, seriesColor, type ChartFormat } from './chart-format';
import { ChartFrame, ChartLive, ChartTooltip, KEY_HINT, LegendSwatch, SvgLabels, tooltipText, useRoving, type ChartBaseProps, type TooltipModel } from './frame';
import { arcPath, arcStroke, clamp } from './scale';
import { cn } from '@/components/ui/cn';

// --- Donut --------------------------------------------------------------------------------

export interface DonutSlice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}

export interface DonutChartProps extends ChartBaseProps {
  readonly slices: readonly DonutSlice[];
  readonly format?: ChartFormat;
  /** Small text under the total in the middle: "total cost". */
  readonly centerLabel?: string;
  /** Most slices to draw. Smaller ones fold into "Other". Default 6. */
  readonly maxSlices?: number;
  readonly size?: number;
  readonly thickness?: number;
}

function share(value: number, total: number): string {
  if (total <= 0) return '0%';
  const percent = (value / total) * 100;
  return percent > 0 && percent < 1 ? 'under 1%' : `${Math.round(percent)}%`;
}

export function DonutChart({ slices, format, centerLabel = 'total', maxSlices = 6, size = 168, thickness = 20, ...base }: DonutChartProps) {
  const fmt = resolveFormat(format);
  const positive = slices.filter((slice) => slice.value > 0);
  const dropped = slices.length - positive.length;
  const colored = positive.map((slice, index) => ({ ...slice, color: slice.color ?? seriesColor(index) }));
  const sorted = [...colored];
  const head = sorted.length > maxSlices ? sorted.slice(0, maxSlices - 1) : sorted;
  const tail = sorted.slice(head.length);
  const rows = tail.length ? [...head, { id: 'other', label: `Other (${tail.length})`, value: tail.reduce((sum, slice) => sum + slice.value, 0), color: CHART_COLORS.neutral }] : head;
  const total = rows.reduce((sum, slice) => sum + slice.value, 0);
  const roving = useRoving(rows.length, { start: 'first' });
  const active = roving.active;

  const cx = size / 2;
  const outer = size / 2 - 2;
  const inner = outer - thickness;
  let angle = -Math.PI / 2;
  const arcs = rows.map((slice) => {
    const sweep = total > 0 ? (slice.value / total) * Math.PI * 2 : 0;
    const start = angle;
    angle += sweep;
    return { slice, start, end: angle, mid: start + sweep / 2 };
  });
  const activeArc = active !== null ? arcs[active] : undefined;
  const tooltip: TooltipModel | null = activeArc
    ? {
        x: cx + Math.cos(activeArc.mid) * (outer - thickness / 2),
        y: cx + Math.sin(activeArc.mid) * (outer - thickness / 2),
        title: activeArc.slice.label,
        rows: [
          { id: 'value', label: 'Amount', value: fmt.value(activeArc.slice.value), color: activeArc.slice.color, shape: 'box' },
          { id: 'share', label: 'Share of total', value: share(activeArc.slice.value, total), muted: true },
        ],
      }
    : null;

  return (
    <ChartFrame
      {...base}
      empty={rows.length === 0 || total <= 0}
      hideLegend
      defaultHeight={size}
      table={{ columns: ['', 'Amount', 'Share'], rows: [...rows.map((slice) => [slice.label, fmt.value(slice.value), share(slice.value, total)]), ['Total', fmt.value(total), '100%']] }}
    >
      {({ titleId, descId }) => (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              role="group"
              aria-roledescription="chart"
              aria-labelledby={`${titleId}-svg`}
              aria-describedby={`${descId}-svg`}
              tabIndex={0}
              onKeyDown={roving.onKeyDown}
              onFocus={roving.onFocus}
              onBlur={roving.onBlur}
              onPointerLeave={() => roving.hover(null)}
              className="block overflow-visible"
            >
              <SvgLabels titleId={titleId} descId={descId} title={base.title} description={base.description} hint={KEY_HINT} />
              {arcs.map(({ slice, start, end }, index) => (
                <path
                  key={slice.id}
                  className="pc-mark"
                  d={arcPath(cx, cx, active === index ? outer + 2 : outer, inner, start, end)}
                  fill={slice.color}
                  stroke="var(--surface-panel)"
                  strokeWidth={rows.length > 1 ? 2 : 0}
                  strokeLinejoin="round"
                  opacity={active === null || active === index ? 1 : 0.45}
                  onPointerEnter={() => roving.hover(index)}
                  onPointerDown={() => roving.hover(index)}
                />
              ))}
              {activeArc && roving.byKeyboard ? <path d={arcPath(cx, cx, outer + 4, inner - 2, activeArc.start, activeArc.end)} fill="none" stroke="var(--focus-ring)" strokeWidth={1.5} pointerEvents="none" /> : null}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <span className="text-lg leading-tight font-semibold text-fg">{fmt.axis(activeArc ? activeArc.slice.value : total)}</span>
              <span className="mt-0.5 line-clamp-2 text-2xs text-fg-muted">{activeArc ? activeArc.slice.label : centerLabel}</span>
            </div>
            <ChartTooltip model={tooltip} boxWidth={size} />
            <ChartLive text={roving.byKeyboard ? tooltipText(tooltip) : ''} />
          </div>
          <ul className="flex min-w-[9rem] flex-1 flex-col gap-1.5 text-xs">
            {rows.map((slice, index) => (
              <li key={slice.id} className={cn('pc-mark flex items-center gap-2', active !== null && active !== index && 'opacity-60')} onPointerEnter={() => roving.hover(index)} onPointerLeave={() => roving.hover(null)}>
                <LegendSwatch color={slice.color} />
                <span className="min-w-0 flex-1 truncate text-fg-secondary">{slice.label}</span>
                <span className="font-medium text-fg tabular-nums">{fmt.value(slice.value)}</span>
                <span className="w-14 text-right text-fg-muted tabular-nums">{share(slice.value, total)}</span>
              </li>
            ))}
            {dropped > 0 ? <li className="text-2xs text-fg-muted">{dropped === 1 ? '1 item at or under zero is left out.' : `${dropped} items at or under zero are left out.`}</li> : null}
          </ul>
        </div>
      )}
    </ChartFrame>
  );
}

// --- Progress ring ------------------------------------------------------------------------

export interface ProgressRingProps {
  /** Progress from 0 to `max`. */
  readonly value: number;
  readonly max?: number;
  /** What is progressing: "Units done". */
  readonly label: string;
  readonly size?: number;
  readonly strokeWidth?: number;
  /** `auto` turns the good color at 100%. */
  readonly tone?: 'auto' | 'accent' | 'good' | 'watch' | 'bad';
  /** Replace the percent in the middle. */
  readonly children?: ReactNode;
  readonly hideValue?: boolean;
  readonly className?: string;
}

const RING_TONE = { accent: seriesColor(0), good: 'var(--pulse-chart-up)', watch: 'var(--warning-accent)', bad: 'var(--pulse-chart-down)' } as const;

export function ProgressRing({ value, max = 100, label, size = 56, strokeWidth, tone = 'auto', children, hideValue, className }: ProgressRingProps) {
  const ratio = max > 0 && Number.isFinite(value) ? clamp(value / max, 0, 1) : 0;
  const percent = Math.round(ratio * 100);
  const stroke = strokeWidth ?? Math.max(4, Math.round(size / 11));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = tone === 'auto' ? (ratio >= 1 ? RING_TONE.good : RING_TONE.accent) : RING_TONE[tone];
  const over = max > 0 && value > max;
  return (
    <span className={cn('pulse-chart relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} role="img" aria-label={`${label}: ${percent}%${over ? ', past the goal' : ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={CHART_COLORS.track} strokeWidth={stroke} />
        {ratio > 0 ? (
          <circle className="pc-grow" cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} />
        ) : null}
      </svg>
      {hideValue ? null : <span className={cn('absolute font-semibold text-fg', size >= 96 ? 'text-lg' : size >= 56 ? 'text-sm' : 'text-2xs')}>{children ?? `${percent}%`}</span>}
    </span>
  );
}

// --- Gauge --------------------------------------------------------------------------------

export interface GaugeProps {
  /** What is measured: "Margin this month". */
  readonly title: string;
  readonly value: number | null;
  readonly target: number;
  /** Below this the fill turns the loss color (for margin: the margin floor). Default 0. */
  readonly floor?: number;
  readonly min?: number;
  readonly max?: number;
  readonly format?: ChartFormat;
  readonly targetLabel?: string;
  readonly size?: number;
  /** Under the value: a MarginPill, a DeltaBadge or one short line. */
  readonly footer?: ReactNode;
  readonly loading?: boolean;
  readonly className?: string;
}

/** A half ring from `min` to `max` with a tick at the target. The words under it carry the verdict. */
export function Gauge({ title, value, target, floor = 0, min = 0, max, format = 'percent', targetLabel = 'Target', size = 200, footer, loading, className }: GaugeProps) {
  const fmt = resolveFormat(format);
  const top = max ?? Math.max(target * 1.5, value ?? 0, min + 1);
  const span = top - min || 1;
  const stroke = Math.max(10, Math.round(size / 14));
  const radius = size / 2 - stroke / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const height = size / 2 + 34;
  const ratio = value === null ? 0 : clamp((value - min) / span, 0, 1);
  const targetRatio = clamp((target - min) / span, 0, 1);
  const angle = (part: number): number => Math.PI + part * Math.PI;
  const color = value === null ? CHART_COLORS.neutral : value < floor ? CHART_COLORS.down : value >= target ? CHART_COLORS.up : 'var(--warning-accent)';
  const targetAngle = angle(targetRatio);
  const tick = (r: number): [number, number] => [cx + Math.cos(targetAngle) * r, cy + Math.sin(targetAngle) * r];
  const [tx0, ty0] = tick(radius - stroke / 2 - 3);
  const [tx1, ty1] = tick(radius + stroke / 2 + 3);
  const [lx, ly] = tick(radius + stroke / 2 + 14);
  const verdict = value === null ? 'No data yet' : value >= target ? 'at or over target' : value < floor ? 'under the floor' : 'under target';
  const spoken = value === null ? `${title}: no data yet. ${targetLabel} ${fmt.value(target)}.` : `${title}: ${fmt.value(value)}, ${verdict}. ${targetLabel} ${fmt.value(target)}.`;
  if (loading) {
    return (
      <div role="status" aria-busy="true" className={cn('flex flex-col items-center gap-2', className)} style={{ width: size }}>
        <span className="sr-only">{`Loading ${title}`}</span>
        <span aria-hidden className="ks-skeleton block w-full rounded-t-full" style={{ height: size / 2 }} />
        <span aria-hidden className="ks-skeleton block h-4 w-24 rounded-full" />
      </div>
    );
  }
  return (
    <div className={cn('pulse-chart inline-flex max-w-full flex-col items-center', className)} style={{ width: size }}>
      <div className="relative" style={{ width: size, height }} role="img" aria-label={spoken}>
        <svg width={size} height={height} viewBox={`0 -24 ${size} ${height}`} aria-hidden className="block overflow-visible">
          <path d={arcStroke(cx, cy, radius, Math.PI, Math.PI * 2)} fill="none" stroke={CHART_COLORS.track} strokeWidth={stroke} strokeLinecap="round" />
          {value !== null && ratio > 0 ? <path className="pc-mark" d={arcStroke(cx, cy, radius, Math.PI, angle(ratio))} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" /> : null}
          <line x1={tx0} y1={ty0} x2={tx1} y2={ty1} stroke="var(--text-primary)" strokeWidth={2.5} strokeLinecap="round" />
          <text x={clamp(lx, 30, size - 30)} y={ly} dy="0.1em" textAnchor="middle" fontSize={11} fontWeight={500} fill="var(--text-secondary)">
            {`${targetLabel} ${fmt.axis(target)}`}
          </text>
          <text x={stroke / 2 + 2} y={cy + 16} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
            {fmt.axis(min)}
          </text>
          <text x={size - stroke / 2 - 2} y={cy + 16} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
            {fmt.axis(top)}
          </text>
        </svg>
        <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center" style={{ top: 24 + size / 2 - 44 }}>
          <span className="text-2xl leading-none font-semibold text-fg">{value === null ? 'No data' : fmt.value(value)}</span>
          <span className="mt-1.5 max-w-[80%] truncate text-xs text-fg-muted">{title}</span>
        </div>
      </div>
      {footer ? <div className="mt-1 flex justify-center">{footer}</div> : null}
    </div>
  );
}
