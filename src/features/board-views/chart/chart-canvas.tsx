'use client';
/** recharts rendering of a ChartData model (all chart types share one tooltip & palette). */
import type { ReactElement } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LabelColor } from '@/components/ui';
import type { ChartPoint, ChartSeries } from '../lib/chart';
import type { ChartType } from '../lib/config';

export const cssColor = (color: LabelColor) => `var(--label-${color})`;

const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };
const ANIMATION_MS = 400;

export interface ChartCanvasProps {
  readonly type: ChartType;
  readonly points: readonly ChartPoint[];
  readonly stacks: readonly ChartSeries[];
  readonly width: number;
  readonly height: number;
  readonly total: number;
  readonly showValues: boolean;
  readonly goal: number | null;
  readonly format: (value: number) => string;
  readonly reducedMotion: boolean;
  readonly onSelect: (pointKey: string, stackKey?: string) => void;
}

interface TooltipPayload {
  readonly payload?: { key: string; label: string; value: number; color?: LabelColor };
  readonly name?: string;
  readonly value?: number;
  readonly dataKey?: string;
  readonly color?: string;
}

function ChartTip({
  active,
  payload,
  total,
  format,
  stacks,
  percent,
}: {
  readonly active?: boolean;
  readonly payload?: readonly TooltipPayload[];
  readonly total: number;
  readonly format: (value: number) => string;
  readonly stacks: readonly ChartSeries[];
  readonly percent?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const entries = stacks.length
    ? payload.filter((entry) => typeof entry.value === 'number' && entry.value > 0).map((entry) => {
        const series = stacks.find((stack) => stack.key === entry.dataKey);
        return { key: String(entry.dataKey), label: series?.label ?? String(entry.name), color: series?.color ?? 'gray', value: entry.value ?? 0 };
      })
    : [{ key: point.key, label: point.label, color: point.color ?? 'blue', value: point.value }];
  return (
    <div className="min-w-40 rounded-lg border border-border-subtle bg-raised px-3 py-2 text-sm text-fg shadow-popover" data-testid="chart-tooltip">
      {stacks.length ? <p className="mb-1 font-semibold">{point.label}</p> : null}
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-xs" style={{ background: cssColor(entry.color) }} />
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            <span className="font-semibold tabular-nums">{percent ? `${Math.round(entry.value)}%` : format(entry.value)}</span>
            {!percent && total > 0 ? <span className="w-10 text-right text-xs text-fg-muted tabular-nums">{Math.round((entry.value / total) * 100)}%</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-fg-muted">Click to see the items</p>
    </div>
  );
}

export function ChartCanvas({ type, points, stacks, width, height, total, showValues, goal, format, reducedMotion, onSelect }: ChartCanvasProps): ReactElement | null {
  if (width <= 0 || height <= 0) return null;
  const animate = !reducedMotion;
  const data = points.map((point) => ({ ...point, ...point.stacks }));
  const tip = (percent?: boolean) => <ChartTooltip content={<ChartTip total={total} format={format} stacks={stacks} percent={percent} />} cursor={{ fill: 'var(--surface-hover)', stroke: 'var(--border-strong)' }} />;
  const stacked = type.startsWith('stacked') && stacks.length > 0;
  const percent = type === 'stacked_column_percent';

  if (type === 'pie' || type === 'donut') {
    const radius = Math.max(Math.min(width, height) / 2 - 12, 24);
    return (
      <PieChart width={width} height={height}>
        <Pie
          data={data.filter((point) => point.value > 0)}
          dataKey="value"
          nameKey="label"
          outerRadius={radius}
          innerRadius={type === 'donut' ? radius * 0.62 : 0}
          paddingAngle={type === 'donut' ? 1.2 : 0}
          stroke="var(--surface-panel)"
          strokeWidth={2}
          isAnimationActive={animate}
          animationDuration={ANIMATION_MS}
          onClick={pick(onSelect)}
          className="cursor-pointer outline-none"
          label={showValues && type === 'pie' ? ({ value }: { value?: number }) => format(Number(value ?? 0)) : false}
          labelLine={false}
        >
          {data.filter((point) => point.value > 0).map((point) => (
            <Cell key={point.key} fill={cssColor(point.color)} />
          ))}
        </Pie>
        {tip()}
      </PieChart>
    );
  }

  const horizontal = type === 'bar' || type === 'stacked_bar';
  const crowded = points.length > 0 && width / points.length < 72;
  const grid = <CartesianGrid key="grid" vertical={horizontal} horizontal={!horizontal} stroke="var(--border-subtle)" />;
  const categoryAxis = horizontal ? (
    <YAxis key="cat" type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border-default)' }} width={Math.min(160, Math.max(64, width * 0.22))} interval={0} />
  ) : (
    // Every category keeps its label: rotate + truncate when they would collide.
    <XAxis
      key="cat"
      dataKey="label"
      tick={crowded ? { ...AXIS_TICK, fontSize: 11 } : AXIS_TICK}
      tickLine={false}
      axisLine={{ stroke: 'var(--border-default)' }}
      interval={0}
      angle={crowded ? -35 : 0}
      textAnchor={crowded ? 'end' : 'middle'}
      height={crowded ? 64 : 30}
      tickFormatter={(value: unknown) => truncateLabel(String(value), crowded ? 12 : 18)}
    />
  );
  const valueAxis = horizontal ? (
    <XAxis key="val" type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(value: number) => (percent ? `${value}%` : format(value))} domain={percent ? [0, 100] : undefined} />
  ) : (
    <YAxis key="val" tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => (percent ? `${value}%` : format(value))} domain={percent ? [0, 100] : undefined} />
  );
  const goalLine =
    goal !== null && !percent ? (
      horizontal ? (
        <ReferenceLine key="goal" x={goal} stroke="var(--danger)" strokeDasharray="5 4" label={{ value: `Goal ${format(goal)}`, fill: 'var(--danger-text)', fontSize: 11, position: 'top' }} />
      ) : (
        <ReferenceLine key="goal" y={goal} stroke="var(--danger)" strokeDasharray="5 4" label={{ value: `Goal ${format(goal)}`, fill: 'var(--danger-text)', fontSize: 11, position: 'insideTopRight' }} />
      )
    ) : null;
  const margin = { top: 20, right: 16, bottom: 4, left: 4 };

  if (type === 'line' || type === 'smooth_line' || type === 'area' || type === 'stacked_area') {
    const curve = type === 'smooth_line' || type === 'area' || type === 'stacked_area' ? 'monotone' : 'linear';
    const series = stacks.length ? stacks : [{ key: 'value', label: 'Value', color: points[0]?.color ?? 'blue' } as ChartSeries];
    const single = stacks.length === 0;
    const color = (entry: ChartSeries) => cssColor(single ? 'blue' : entry.color);
    if (type === 'area' || type === 'stacked_area') {
      return (
        <AreaChart width={width} height={height} data={data} margin={margin} onClick={(state) => state?.activeLabel !== undefined && selectByLabel(points, state.activeLabel, onSelect)}>
          {grid}
          {categoryAxis}
          {valueAxis}
          {tip()}
          {goalLine}
          {series.map((entry) => (
            <Area key={entry.key} type={curve} dataKey={entry.key} name={entry.label} stackId={type === 'stacked_area' ? 'stack' : undefined} stroke={color(entry)} fill={color(entry)} fillOpacity={0.22} strokeWidth={2.25} isAnimationActive={animate} animationDuration={ANIMATION_MS} className="cursor-pointer">
              {showValues && single ? <LabelList dataKey={entry.key} position="top" formatter={(value: unknown) => format(Number(value))} fill="var(--text-secondary)" fontSize={11} /> : null}
            </Area>
          ))}
        </AreaChart>
      );
    }
    return (
      <LineChart width={width} height={height} data={data} margin={margin} onClick={(state) => state?.activeLabel !== undefined && selectByLabel(points, state.activeLabel, onSelect)}>
        {grid}
        {categoryAxis}
        {valueAxis}
        {tip()}
        {goalLine}
        {series.map((entry) => (
          <Line key={entry.key} type={curve} dataKey={entry.key} name={entry.label} stroke={color(entry)} strokeWidth={2.5} dot={{ r: 3.5, fill: color(entry), strokeWidth: 0 }} activeDot={{ r: 5.5 }} isAnimationActive={animate} animationDuration={ANIMATION_MS} className="cursor-pointer">
            {showValues && single ? <LabelList dataKey={entry.key} position="top" formatter={(value: unknown) => format(Number(value))} fill="var(--text-secondary)" fontSize={11} /> : null}
          </Line>
        ))}
      </LineChart>
    );
  }

  const percentData = percent
    ? data.map((row) => {
        const sum = stacks.reduce((acc, series) => acc + (Number((row as Record<string, unknown>)[series.key]) || 0), 0);
        const next: Record<string, unknown> = { ...row };
        for (const series of stacks) next[series.key] = sum ? ((Number(row[series.key as keyof typeof row]) || 0) / sum) * 100 : 0;
        return next;
      })
    : data;
  const radius = (last: boolean): [number, number, number, number] => (last ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : [0, 0, 0, 0]);
  return (
    <BarChart width={width} height={height} data={percentData} layout={horizontal ? 'vertical' : 'horizontal'} margin={margin} barCategoryGap="22%">
      {grid}
      {categoryAxis}
      {valueAxis}
      {tip(percent)}
      {goalLine}
      {stacked
        ? stacks.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              stackId="stack"
              fill={cssColor(series.color)}
              radius={radius(index === stacks.length - 1)}
              maxBarSize={64}
              isAnimationActive={animate}
              animationDuration={ANIMATION_MS}
              onClick={pick(onSelect, series.key)}
              className="cursor-pointer"
            />
          ))
        : (
            <Bar dataKey="value" name="Value" radius={radius(true)} maxBarSize={64} isAnimationActive={animate} animationDuration={ANIMATION_MS} onClick={pick(onSelect)} className="cursor-pointer">
              {points.map((point) => (
                <Cell key={point.key} fill={cssColor(point.color)} />
              ))}
              {showValues ? <LabelList dataKey="value" position={horizontal ? 'right' : 'top'} formatter={(value: unknown) => format(Number(value))} fill="var(--text-secondary)" fontSize={11} /> : null}
            </Bar>
          )}
    </BarChart>
  );
}

function truncateLabel(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function selectByLabel(points: readonly ChartPoint[], label: unknown, onSelect: (key: string) => void) {
  const point = points.find((entry) => entry.label === label);
  if (point) onSelect(point.key);
}

/** recharts click payloads differ per chart; read the point key from either shape. */
function pick(onSelect: (key: string, stack?: string) => void, stack?: string): never {
  return ((data: unknown) => {
    const record = (data ?? {}) as { key?: unknown; payload?: { key?: unknown } };
    const key = typeof record.payload?.key === 'string' ? record.payload.key : typeof record.key === 'string' ? record.key : null;
    if (key) onSelect(key, stack);
  }) as never;
}
