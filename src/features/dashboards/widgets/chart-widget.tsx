'use client';

/** Chart widget: bar, horizontal bar, stacked bar, line, area, pie and donut (recharts). */
import { useId, useState, type ReactElement } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { InsightPoint, InsightStack } from '@/server/services/contracts/dashboard-insights';
import { cssColor, seriesColor } from '../lib/colors';
import { formatCompact, formatExact, resolveFormat, type ValueFormat } from '../lib/format';
import { Legend, NoDataState, TooltipCard } from './shared';
import type { WidgetRenderProps } from './types';
import { useElementSize } from './use-element-size';

const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };
const ANIMATION_MS = 400;

interface TooltipPayload {
  readonly payload?: Record<string, unknown>;
}

function pointTooltip(format: ValueFormat, points: readonly InsightPoint[], colorFor: (point: InsightPoint, index: number) => ReturnType<typeof seriesColor>) {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return function PointTooltip({ active, payload }: { active?: boolean; payload?: readonly TooltipPayload[] }): ReactElement | null {
    const key = payload?.[0]?.payload?.key;
    const index = points.findIndex((point) => point.key === key);
    const point = points[index];
    if (!active || !point) return null;
    return (
      <TooltipCard
        title={point.label}
        rows={[
          { label: 'Value', value: formatExact(point.value, format), color: colorFor(point, index) },
          { label: 'Items', value: point.count.toLocaleString('en-US') },
          ...(total > 0 ? [{ label: 'Share', value: `${((point.value / total) * 100).toFixed(1)}%` }] : []),
        ]}
      />
    );
  };
}

/** Stacked bars: one row per segment (hovered one highlighted) and a neutral bold total. */
function stackedTooltip(
  format: ValueFormat,
  points: readonly InsightPoint[],
  stacks: readonly { stack: InsightStack; color: ReturnType<typeof seriesColor> }[],
  hovered: string | null,
) {
  return function StackedTooltip({ active, payload }: { active?: boolean; payload?: readonly TooltipPayload[] }): ReactElement | null {
    const key = payload?.[0]?.payload?.key;
    const point = points.find((entry) => entry.key === key);
    if (!active || !point) return null;
    const segments = stacks
      .map(({ stack, color }) => ({ stack, color, value: point.stack?.[stack.key] ?? 0 }))
      .filter((segment) => segment.value !== 0);
    return (
      <TooltipCard
        title={point.label}
        rows={[
          ...segments.map((segment) => ({
            label: segment.stack.label,
            value: formatExact(segment.value, format),
            color: segment.color,
            active: segment.stack.key === hovered,
          })),
          { label: `Total · ${point.count.toLocaleString('en-US')} items`, value: formatExact(point.value, format), total: true },
        ]}
      />
    );
  };
}

export function ChartWidget({ insight, settings, filtered, onConfigure }: WidgetRenderProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const gradient = useId().replace(/:/g, '');
  const [hoveredStack, setHoveredStack] = useState<string | null>(null);
  const aggregate = settings.valueColumnKey ? settings.aggregate : 'count';
  const format = resolveFormat(settings, insight.valueColumn, aggregate);
  const points = insight.series;
  const type = settings.chartType;
  const colorFor = (point: InsightPoint, index: number) => seriesColor(point.color, index, settings.colorOverrides, point.key);
  if (points.length === 0) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;
  const stacked = type === 'stacked_bar' && insight.stacks.length > 0;
  const legend = stacked
    ? insight.stacks.map((stack, index) => ({ key: stack.key, label: stack.label, color: seriesColor(stack.color, index, settings.colorOverrides, stack.key) }))
    : type === 'pie' || type === 'donut'
      ? points.map((point, index) => ({ key: point.key, label: point.label, color: colorFor(point, index), detail: formatCompact(point.value, format) }))
      : [];
  const data = points.map((point) => ({ key: point.key, label: point.label, value: point.value, ...(point.stack ?? {}) }));
  const tick = (value: number) => formatCompact(value, format);
  const { width, height } = size;
  const ready = width > 0 && height > 0;
  const showValues = settings.showValues;
  let chart: ReactElement | null = null;
  if (ready && (type === 'pie' || type === 'donut')) {
    const radius = Math.max(Math.min(width, height) / 2 - 8, 20);
    chart = (
      <PieChart width={width} height={height}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          outerRadius={radius}
          innerRadius={type === 'donut' ? radius * 0.62 : 0}
          paddingAngle={type === 'donut' && points.length > 1 ? 1.5 : 0}
          stroke="var(--surface-panel)"
          strokeWidth={2}
          animationDuration={ANIMATION_MS}
          isAnimationActive
        >
          {points.map((point, index) => (
            <Cell key={point.key} fill={cssColor(colorFor(point, index))} />
          ))}
        </Pie>
        <ChartTooltip content={pointTooltip(format, points, colorFor)} />
      </PieChart>
    );
  } else if (ready && (type === 'line' || type === 'area')) {
    const color = cssColor(seriesColor(settings.color, 0));
    const common = { width, height, data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
    const axes = [
      <CartesianGrid key="grid" vertical={false} stroke="var(--border-subtle)" />,
      <XAxis key="x" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border-default)' }} interval="preserveStartEnd" minTickGap={12} />,
      <YAxis key="y" tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={tick} />,
      <ChartTooltip key="tip" content={pointTooltip(format, points, colorFor)} cursor={{ stroke: 'var(--border-strong)' }} />,
    ];
    chart =
      type === 'line' ? (
        <LineChart {...common}>
          {axes}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} animationDuration={ANIMATION_MS} />
        </LineChart>
      ) : (
        <AreaChart {...common}>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {axes}
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill={`url(#${gradient})`} animationDuration={ANIMATION_MS} />
        </AreaChart>
      );
  } else if (ready) {
    const horizontal = type === 'horizontal_bar';
    chart = (
      <BarChart width={width} height={height} data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: showValues ? 18 : 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--border-subtle)" />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tick} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={Math.min(120, width * 0.3)} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border-default)' }} interval={0} angle={points.length > 6 && width < 520 ? -30 : 0} textAnchor={points.length > 6 && width < 520 ? 'end' : 'middle'} height={points.length > 6 && width < 520 ? 48 : 28} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={tick} />
          </>
        )}
        <ChartTooltip
          content={
            stacked
              ? stackedTooltip(
                  format,
                  points,
                  insight.stacks.map((stack, index) => ({ stack, color: seriesColor(stack.color, index, settings.colorOverrides, stack.key) })),
                  hoveredStack,
                )
              : pointTooltip(format, points, colorFor)
          }
          cursor={{ fill: 'var(--surface-hover)' }}
        />
        {stacked ? (
          insight.stacks.map((stack, index) => (
            <Bar
              key={stack.key}
              dataKey={stack.key}
              name={stack.label}
              stackId="stack"
              fill={cssColor(seriesColor(stack.color, index, settings.colorOverrides, stack.key))}
              fillOpacity={hoveredStack && hoveredStack !== stack.key ? 0.55 : 1}
              onMouseEnter={() => setHoveredStack(stack.key)}
              onMouseLeave={() => setHoveredStack(null)}
              animationDuration={ANIMATION_MS}
              maxBarSize={56}
              radius={index === insight.stacks.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
            />
          ))
        ) : (
          <Bar dataKey="value" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={56} animationDuration={ANIMATION_MS} label={showValues ? { position: horizontal ? 'right' : 'top', fill: 'var(--text-secondary)', fontSize: 12, formatter: (value: unknown) => (typeof value === 'number' ? tick(value) : '') } : undefined}>
            {points.map((point, index) => (
              <Cell key={point.key} fill={cssColor(colorFor(point, index))} />
            ))}
          </Bar>
        )}
      </BarChart>
    );
  }
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="chart-widget" data-chart-type={type}>
      <div ref={ref} className="relative min-h-0 flex-1" role="img" aria-label={`${type.replace('_', ' ')} chart, ${points.length} categories`}>
        {chart}
        {ready && type === 'donut' ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-heading text-xl font-medium tabular-nums text-fg">{formatCompact(total, format)}</span>
            <span className="text-xs text-fg-muted">Total</span>
          </div>
        ) : null}
      </div>
      {settings.showLegend && legend.length > 0 ? <Legend entries={legend} className="max-h-16 overflow-y-auto" /> : null}
    </div>
  );
}
