'use client';
/**
 * Lightweight, theme-aware SVG charts for Dashboards and the project Overview. No chart library:
 * colors come from tokens (`--chart-*`, `--label-*`, `--chart-grid`, `--chart-axis`), so light
 * and dark mode just work. Every chart is keyboard reachable (arrow keys move between points),
 * announces values through tooltips/labels, and ships a screen-reader table with the raw data.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Tooltip, cn } from '@/components/ui';
import { niceMax } from '@/lib/report-math';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Width of an element, kept in sync with a ResizeObserver (0 until mounted). */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Roving keyboard index for a group of chart points. */
function useRoving(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    if (count === 0) return;
    const current = active ?? count - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? Math.min(count - 1, current + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? Math.max(0, current - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : event.key === 'Escape'
                ? null
                : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };
  return { active, setActive, onKeyDown };
}

export function ChartLegend({ items, className }: { readonly items: readonly { label: string; color: string; dashed?: boolean; value?: ReactNode }[]; readonly className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary', className)}>
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          {item.dashed ? (
            <span aria-hidden className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: item.color }} />
          ) : (
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: item.color }} />
          )}
          {item.label}
          {item.value !== undefined ? <strong className="font-semibold text-fg tabular-nums">{item.value}</strong> : null}
        </li>
      ))}
    </ul>
  );
}

// --- Progress ring ------------------------------------------------------------------------

export function ProgressRing({
  percent,
  size = 44,
  strokeWidth = 4,
  tone = 'primary',
  label,
  className,
  showLabel = true,
}: {
  readonly percent: number;
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly tone?: 'primary' | 'success' | 'warning' | 'danger';
  readonly label: string;
  readonly className?: string;
  readonly showLabel?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = clamped === 100 ? 'var(--success)' : tone === 'primary' ? 'var(--primary)' : `var(--${tone})`;
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} role="img" aria-label={`${label}: ${clamped}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-sunken)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset,stroke] duration-[var(--duration-slower)] ease-out motion-reduce:transition-none"
        />
      </svg>
      {showLabel ? <span className={cn('absolute font-semibold text-fg tabular-nums', size >= 56 ? 'text-sm' : 'text-2xs')}>{clamped}%</span> : null}
    </span>
  );
}

// --- Donut --------------------------------------------------------------------------------

export interface DonutSlice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

export function DonutChart({
  slices,
  title,
  centerLabel = 'tasks',
  size = 168,
  thickness = 22,
}: {
  readonly slices: readonly DonutSlice[];
  readonly title: string;
  readonly centerLabel?: string;
  readonly size?: number;
  readonly thickness?: number;
}) {
  const visible = slices.filter((slice) => slice.value > 0);
  const total = visible.reduce((sum, slice) => sum + slice.value, 0);
  const [hover, setHover] = useState<string | null>(null);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = visible.length > 1 ? 2 : 0;
  const lengths = visible.map((slice) => (slice.value / Math.max(1, total)) * circumference);
  const arcs = visible.map((slice, index) => ({
    ...slice,
    dash: Math.max(0, (lengths[index] ?? 0) - gap),
    offset: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }));
  const focused = hover ? visible.find((slice) => slice.id === hover) : null;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}: ${visible.map((s) => `${s.label} ${s.value}`).join(', ') || 'no tasks'}`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-sunken)" strokeWidth={thickness} />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {arcs.map((arc) => (
              <circle
                key={arc.id}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={hover === arc.id ? thickness + 4 : thickness}
                strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
                strokeDashoffset={-arc.offset}
                opacity={hover && hover !== arc.id ? 0.35 : 1}
                className="transition-[opacity,stroke-width] duration-[var(--duration-fast)] motion-reduce:transition-none"
                onMouseEnter={() => setHover(arc.id)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden>
          <span className="text-2xl font-semibold text-fg tabular-nums">{focused ? focused.value : total}</span>
          <span className="max-w-[60%] truncate text-xs text-fg-muted">{focused ? focused.label : centerLabel}</span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-0.5">
        {slices.map((slice) => {
          const percent = total ? Math.round((slice.value / total) * 100) : 0;
          return (
            <li key={slice.id}>
              <button
                type="button"
                onMouseEnter={() => setHover(slice.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(slice.id)}
                onBlur={() => setHover(null)}
                aria-label={`${slice.label}: ${slice.value} (${percent}%)`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none transition-colors duration-[var(--duration-fast)]',
                  'hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
                  hover === slice.id && 'bg-hover',
                )}
              >
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} />
                <span className="min-w-0 flex-1 truncate text-fg-secondary">{slice.label}</span>
                <span className="font-medium text-fg tabular-nums">{slice.value}</span>
                <span className="w-9 text-right text-xs text-fg-muted tabular-nums">{percent}%</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Line chart ---------------------------------------------------------------------------

export interface LineSeries {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: readonly (number | null)[];
  readonly dashed?: boolean;
  /** Fill the area under the line (first filled series looks best). */
  readonly area?: boolean;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

export function LineChart({
  series,
  labels,
  formatLabel,
  height = 220,
  markerIndex,
  markerLabel = 'Today',
  title,
  valueSuffix = '',
}: {
  readonly series: readonly LineSeries[];
  /** One label per point (dates). */
  readonly labels: readonly string[];
  readonly formatLabel: (label: string) => string;
  readonly height?: number;
  /** Vertical marker (e.g. today). */
  readonly markerIndex?: number | null;
  readonly markerLabel?: string;
  readonly title: string;
  readonly valueSuffix?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const gradientId = useId().replace(/:/g, '');
  const count = labels.length;
  const roving = useRoving(count);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (count <= 1 ? innerW / 2 : (index / (count - 1)) * innerW);
  const y = (value: number) => PAD.top + innerH - (value / max) * innerH;
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const xTicks = useMemo(() => {
    if (count === 0) return [];
    const target = Math.max(2, Math.min(7, Math.floor(innerW / 90)));
    const step = Math.max(1, Math.round((count - 1) / (target - 1)));
    const list: number[] = [];
    for (let i = 0; i < count; i += step) list.push(i);
    if (list[list.length - 1] !== count - 1) {
      if (count - 1 - (list[list.length - 1] ?? 0) < step / 2) list.pop();
      list.push(count - 1);
    }
    return list;
  }, [count, innerW]);

  const path = (values: readonly (number | null)[]) => {
    let d = '';
    let pen = false;
    values.forEach((value, index) => {
      if (value === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const areaPath = (values: readonly (number | null)[]) => {
    const points = values.map((value, index) => (value === null ? null : ([x(index), y(value)] as const))).filter((p): p is readonly [number, number] => p !== null);
    if (points.length < 2) return '';
    const first = points[0] as readonly [number, number];
    const last = points[points.length - 1] as readonly [number, number];
    return `M${first[0]},${PAD.top + innerH}${points.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('')}L${last[0]},${PAD.top + innerH}Z`;
  };

  const active = roving.active;
  const tooltipLeft = active === null ? 0 : x(active);

  return (
    <div className="flex flex-col gap-3">
      <ChartLegend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
      <div
        ref={ref}
        className="relative w-full rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use the arrow keys to read each day.`}
        onKeyDown={roving.onKeyDown}
        onBlur={() => roving.setActive(null)}
        onMouseLeave={() => roving.setActive(null)}
        onMouseMove={(event) => {
          if (count === 0 || innerW <= 0) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left - PAD.left) / innerW;
          roving.setActive(Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1)))));
        }}
      >
        {width > 0 ? (
          <svg width={width} height={height} aria-hidden className="block overflow-visible">
            <defs>
              <linearGradient id={`area-${gradientId}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={series.find((s) => s.area)?.color ?? 'transparent'} stopOpacity="0.22" />
                <stop offset="100%" stopColor={series.find((s) => s.area)?.color ?? 'transparent'} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((tick, index) => (
              <g key={tick}>
                <line x1={PAD.left} x2={PAD.left + innerW} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" strokeDasharray={index === 0 ? undefined : '3 4'} />
                <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--chart-axis)" className="tabular-nums">
                  {Number.isInteger(tick) ? tick : tick.toFixed(1)}
                </text>
              </g>
            ))}
            {xTicks.map((index) => (
              <text key={index} x={x(index)} y={height - 6} textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--chart-axis)">
                {formatLabel(labels[index] ?? '')}
              </text>
            ))}
            {markerIndex !== null && markerIndex !== undefined && markerIndex >= 0 && markerIndex < count ? (
              <g>
                <line x1={x(markerIndex)} x2={x(markerIndex)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="2 3" />
                <text x={x(markerIndex)} y={PAD.top - 2} textAnchor={markerIndex > count * 0.85 ? 'end' : 'middle'} fontSize="10" fontWeight="600" fill="var(--primary-text)">
                  {markerLabel}
                </text>
              </g>
            ) : null}
            {series.map((s) =>
              s.area ? <path key={`${s.id}-area`} d={areaPath(s.values)} fill={`url(#area-${gradientId})`} /> : null,
            )}
            {series.map((s) => (
              <path
                key={s.id}
                d={path(s.values)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.dashed ? 1.75 : 2.25}
                strokeDasharray={s.dashed ? '5 5' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {active !== null ? (
              <g>
                <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--border-strong)" strokeWidth="1" />
                {series.map((s) => {
                  const value = s.values[active];
                  return value === null || value === undefined ? null : (
                    <circle key={s.id} cx={x(active)} cy={y(value)} r="4" fill="var(--surface-raised)" stroke={s.color} strokeWidth="2" />
                  );
                })}
              </g>
            ) : null}
          </svg>
        ) : null}
        {active !== null && width > 0 ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-[var(--z-raised)] min-w-36 rounded-md border border-border-subtle bg-raised px-2.5 py-2 text-xs shadow-popover"
            style={tooltipLeft > width / 2 ? { right: width - tooltipLeft + 10 } : { left: tooltipLeft + 10 }}
          >
            <p className="mb-1 font-semibold text-fg">{formatLabel(labels[active] ?? '')}</p>
            {series.map((s) => {
              const value = s.values[active];
              return (
                <p key={s.id} className="flex items-center gap-2 text-fg-secondary">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-medium text-fg tabular-nums">{value === null || value === undefined ? 'No data' : `${value}${valueSuffix}`}</span>
                </p>
              );
            })}
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((s) => (
              <th key={s.id} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, index) => (
            <tr key={label}>
              <th scope="row">{formatLabel(label)}</th>
              {series.map((s) => (
                <td key={s.id}>{s.values[index] ?? 'not yet'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Column chart -------------------------------------------------------------------------

export interface ColumnDatum {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
  /** Tooltip / screen reader text. */
  readonly description: string;
  readonly highlight?: boolean;
}

export function ColumnChart({
  data,
  color = 'var(--chart-1)',
  height = 168,
  title,
  formatValue = (value) => String(value),
  reference,
}: {
  readonly data: readonly ColumnDatum[];
  readonly color?: string;
  readonly height?: number;
  readonly title: string;
  readonly formatValue?: (value: number) => string;
  /** Dashed horizontal reference line (e.g. average). */
  readonly reference?: { readonly value: number; readonly label: string } | null;
}) {
  const max = niceMax(Math.max(0, reference?.value ?? 0, ...data.map((d) => d.value ?? 0)));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(data.length - 1);
  const scale = (value: number) => Math.round((value / max) * height);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = data.length - 1;
    const next =
      event.key === 'ArrowRight' ? Math.min(last, index + 1) : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <div className="relative w-7 text-right text-2xs text-fg-muted tabular-nums" style={{ height: height + 18 }} aria-hidden>
        {[0, 0.5, 1].map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: 18 + height - height * t }}>
            {formatValue(Math.round(max * t * 10) / 10)}
          </span>
        ))}
      </div>
      <div className="relative min-w-0">
        <div className="pointer-events-none absolute inset-x-0" style={{ top: 18, height }} aria-hidden>
          {[0, 0.5, 1].map((t) => (
            <span key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-border-default' : 'border-dashed border-border-subtle')} style={{ bottom: height * t }} />
          ))}
          {reference && reference.value > 0 ? (
            <span className="absolute inset-x-0 border-t-2 border-dashed" style={{ bottom: scale(reference.value), borderColor: 'var(--chart-3)' }}>
              <span className="absolute -top-4 right-0 rounded-sm bg-panel px-1 text-2xs font-medium" style={{ color: 'var(--chart-3)' }}>
                {reference.label}
              </span>
            </span>
          ) : null}
        </div>
        <div role="group" aria-label={`${title}. Use the arrow keys to move between bars.`} className="relative flex items-end gap-1.5 sm:gap-2.5">
          {data.map((datum, index) => (
            <Tooltip key={datum.id} side="top" content={datum.description}>
              <button
                ref={(node) => {
                  refs.current[index] = node;
                }}
                type="button"
                tabIndex={index === active ? 0 : -1}
                aria-label={datum.description}
                onFocus={() => setActive(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="relative flex w-full max-w-11 flex-col items-center justify-end" style={{ height: height + 18 }}>
                  <span className="mb-1 text-2xs font-semibold text-fg-secondary tabular-nums">{datum.value ? formatValue(datum.value) : ''}</span>
                  <span
                    className="w-full rounded-t-[4px] transition-[height,filter] duration-[var(--duration-slow)] ease-out group-hover:brightness-110 motion-reduce:transition-none"
                    style={{ height: datum.value ? Math.max(2, scale(datum.value)) : 0, background: color, opacity: datum.highlight === false ? 0.55 : 1 }}
                  />
                </span>
                <span className={cn('max-w-full truncate text-2xs', datum.highlight ? 'font-semibold text-fg' : 'text-fg-muted')}>{datum.label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.id}>
              <th scope="row">{datum.label}</th>
              <td>{datum.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Horizontal stacked bars --------------------------------------------------------------

export interface StackedRow {
  readonly id: string;
  readonly label: ReactNode;
  /** Plain text for screen readers. */
  readonly text: string;
  readonly segments: readonly { readonly label: string; readonly value: number; readonly color: string }[];
  readonly trailing?: ReactNode;
}

export function StackedBars({ rows, title, emptyText }: { readonly rows: readonly StackedRow[]; readonly title: string; readonly emptyText: string }) {
  const max = Math.max(1, ...rows.map((row) => row.segments.reduce((sum, s) => sum + s.value, 0)));
  if (rows.length === 0) return <p className="rounded-md bg-sunken px-4 py-6 text-center text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ul className="flex flex-col gap-2.5" aria-label={title}>
      {rows.map((row) => {
        const total = row.segments.reduce((sum, s) => sum + s.value, 0);
        const description = `${row.text}: ${row.segments.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ')}`;
        return (
          <li key={row.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,11rem)_1fr_auto]">
            <div className="min-w-0">{row.label}</div>
            <Tooltip content={description}>
              <div className="flex h-3 min-w-0 overflow-hidden rounded-full bg-sunken" role="img" aria-label={description} tabIndex={0}>
                {row.segments.map((segment) =>
                  segment.value > 0 ? (
                    <span
                      key={segment.label}
                      className="h-full transition-[width] duration-[var(--duration-slow)] ease-out first:rounded-l-full last:rounded-r-full motion-reduce:transition-none"
                      style={{ width: `${(segment.value / max) * 100}%`, background: segment.color }}
                    />
                  ) : null,
                )}
              </div>
            </Tooltip>
            <div className="min-w-8 text-right text-xs text-fg-muted tabular-nums">{row.trailing ?? total}</div>
          </li>
        );
      })}
    </ul>
  );
}
