'use client';

/** Forecast widget: won, weighted and remaining pipeline per close month, with totals. */
import type { ReactElement } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import type { InsightForecastBucket } from '@/server/services/contracts/dashboard-insights';
import { Tooltip } from '@/components/ui';
import { cssColor } from '../lib/colors';
import { formatCompact, formatExact, resolveFormat, type ValueFormat } from '../lib/format';
import { NoDataState, TooltipCard } from './shared';
import type { WidgetRenderProps } from './types';
import { useElementSize } from './use-element-size';

const SERIES = [
  { key: 'won', label: 'Won', color: 'green' },
  { key: 'weighted', label: 'Weighted forecast', color: 'blue' },
  { key: 'upside', label: 'Upside (unweighted)', color: 'blue-light' },
] as const;
/** One set of names for the stat row (which doubles as the legend), bars and tooltip. */
const NAME = { won: SERIES[0].label, weighted: SERIES[1].label, upside: SERIES[2].label } as const;

function ForecastTooltip(format: ValueFormat, buckets: readonly InsightForecastBucket[]) {
  return function Tip({ active, payload }: { active?: boolean; payload?: readonly { payload?: { key?: string } }[] }): ReactElement | null {
    const bucket = buckets.find((entry) => entry.key === payload?.[0]?.payload?.key);
    if (!active || !bucket) return null;
    return (
      <TooltipCard
        title={bucket.label}
        rows={[
          { label: NAME.won, value: formatExact(bucket.won, format), color: 'green' },
          { label: NAME.weighted, value: formatExact(bucket.weighted, format), color: 'blue' },
          { label: NAME.upside, value: formatExact(Math.max(bucket.pipeline - bucket.weighted, 0), format), color: 'blue-light' },
          { label: 'Open pipeline (total)', value: formatExact(bucket.pipeline, format) },
          { label: 'Deals', value: bucket.count.toLocaleString('en-US') },
        ]}
      />
    );
  };
}

function Stat({
  label,
  value,
  color,
  hint,
  qualifier,
}: {
  readonly label: string;
  readonly value: string;
  readonly color: string;
  readonly hint?: string;
  /** Always-visible scope note under the value (e.g. the close-month window). */
  readonly qualifier?: string;
}) {
  const caption = (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted" tabIndex={hint ? 0 : undefined}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col">
      {hint ? <Tooltip content={hint}>{caption}</Tooltip> : caption}
      <span className="text-lg font-medium tabular-nums text-fg">{value}</span>
      {qualifier ? <span className="truncate text-2xs text-fg-muted">{qualifier}</span> : null}
    </div>
  );
}

export function ForecastWidget({ insight, settings, filtered, onConfigure }: WidgetRenderProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const buckets = insight.forecast;
  const format = resolveFormat({ ...settings, format: 'currency' }, insight.valueColumn, 'sum');
  const hasData = buckets.some((bucket) => bucket.count > 0);
  if (!hasData) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;
  const totals = buckets.reduce(
    (sum, bucket) => ({ won: sum.won + bucket.won, weighted: sum.weighted + bucket.weighted, pipeline: sum.pipeline + bucket.pipeline }),
    { won: 0, weighted: 0, pipeline: 0 },
  );
  const data = buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    won: bucket.won,
    weighted: bucket.weighted,
    upside: Math.max(bucket.pipeline - bucket.weighted, 0),
  }));
  const tick = (value: number) => formatCompact(value, format);
  // Name the close-month window so this never reads as a contradiction of an all-time KPI.
  const months = buckets.filter((bucket) => bucket.key !== 'overdue');
  const first = months[0]?.label;
  const lastMonth = months[months.length - 1]?.label;
  const closeWindow = first && lastMonth ? `closing ${first}–${lastMonth}` : undefined;
  const wonHint = closeWindow
    ? `Deals marked won with a close date from ${first} to ${lastMonth}. A closed-won KPI without a date filter counts every close date.`
    : undefined;
  const upside = Math.max(totals.pipeline - totals.weighted, 0);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="forecast-widget">
      <div className="grid grid-cols-3 gap-3">
        <Stat label={NAME.won} hint={wonHint} qualifier={closeWindow} value={formatCompact(totals.won, format)} color={cssColor('green')} />
        <Stat label={NAME.weighted} qualifier={closeWindow ? 'value × probability' : undefined} value={formatCompact(totals.weighted, format)} color={cssColor('blue')} />
        <Stat
          label={NAME.upside}
          hint={`Open pipeline ${formatExact(totals.pipeline, format)} minus the weighted forecast`}
          qualifier={`of ${formatCompact(totals.pipeline, format)} open`}
          value={formatCompact(upside, format)}
          color={cssColor('blue-light')}
        />
      </div>
      <div ref={ref} className="min-h-0 flex-1" role="img" aria-label={`Forecast by month: weighted ${formatExact(totals.weighted, format)}`}>
        {size.width > 0 && size.height > 0 ? (
          <BarChart width={size.width} height={size.height} data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--border-default)' }} interval={0} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={52} tickFormatter={tick} />
            <ChartTooltip content={ForecastTooltip(format, buckets)} cursor={{ fill: 'var(--surface-hover)' }} />
            {SERIES.map((series, index) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                stackId="forecast"
                fill={cssColor(series.color)}
                maxBarSize={48}
                animationDuration={400}
                radius={index === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        ) : null}
      </div>
    </div>
  );
}
