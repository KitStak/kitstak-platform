'use client';

/**
 * One analytics chart card: recharts styled with KitStaks tokens, an accessible data
 * table behind every chart (toggle), CSV/XLSX export of the chart's rows and drilldowns
 * (click a bar/point/row, or "Open grid").
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, ChartColumn, Download, Table2 } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';
import type { AnalyticsChart, AnalyticsColumn, AnalyticsRow } from '@/server/repositories/analytics-types';
import { downloadChartCsv, downloadChartXlsx, formatCell } from './analytics-export';
import { isAboveCap, scatterLabelPlacement, scatterYCap, scatterYMax, scatterYTicks } from './scatter-scale';
import {
  axisTick,
  barCap,
  capTicks,
  clampRows,
  isDayAxis,
  realKey,
  seriesKind,
  shortCategory,
} from './chart-layout';

const AXIS = { fontSize: 11, fill: 'var(--color-faint, #8A9099)' };
const GRID = 'var(--color-border, #E4E7EB)';
/** Heatmap rows carry one drilldown per cell under `href:<column>`. */
export const HEAT_HREF_PREFIX = 'href:';
/** Quadrant colours: [top-right, top-left, bottom-right, bottom-left], then "Low sample". */
const QUADRANT_COLORS = ['var(--chart-2)', 'var(--chart-1)', 'var(--chart-3)', 'var(--chart-6)'] as const;
const LOW_SAMPLE_COLOR = 'var(--chart-5)';
const quadrantColor = (q: unknown, labels: readonly string[] | undefined): string => {
  const i = labels ? labels.indexOf(String(q)) : -1;
  return i >= 0 ? (QUADRANT_COLORS[i] as string) : LOW_SAMPLE_COLOR;
};
/** Series that must break (not bridge) across days without data, e.g. On-time % on a day with no shipments. */
const GAP_SERIES = new Set(['onTimePct']);
/**
 * Categorical donut palette: hues spaced around the wheel (blue, amber, green, purple,
 * orange, cyan, magenta, slate) so neighbouring slices never read as the same colour.
 */
/** The shared restrained chart palette (src/styles/tokens.css), used in order. */
export const DONUT_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;
const shortDay = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}`
    : String(v);

function DataTable({ chart, plain = false }: { readonly chart: AnalyticsChart; readonly plain?: boolean }) {
  return (
    <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <caption className="sr-only">{chart.title} data</caption>
        <thead className="sticky top-0 bg-surface-sunken">
          <tr>
            {chart.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-3 py-2 text-left text-2xs font-semibold text-secondary',
                  c.kind && c.kind !== 'text' && 'text-right',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {chart.columns.map((c, j) => {
                const text = formatCell(r[c.key], c);
                const href = !plain && j === 0 && chart.hrefKey ? r[chart.hrefKey] : null;
                return (
                  <td
                    key={c.key}
                    className={cn('px-3 py-1.5 tabular-nums', c.kind && c.kind !== 'text' && 'text-right')}
                  >
                    {typeof href === 'string' ? (
                      <Link href={href} className="font-medium text-primary hover:underline">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Heatmap({ chart }: { readonly chart: AnalyticsChart }) {
  const xs = chart.xCategories ?? [];
  const max = Math.max(1, ...chart.rows.flatMap((r) => xs.map((x) => Number(r[x] ?? 0))));
  return (
    <div className="overflow-x-auto" role="img" aria-label={`${chart.title} heatmap`}>
      <div
        className="grid min-w-[640px] gap-[3px]"
        style={{ gridTemplateColumns: `40px repeat(${xs.length}, minmax(0, 1fr))` }}
      >
        <span />
        {xs.map((x) => (
          <span key={x} className="text-center text-2xs text-faint">
            {Number(x) % 3 === 0 ? x : ''}
          </span>
        ))}
        {chart.rows.map((r) => (
          <React.Fragment key={String(r[chart.xKey])}>
            <span className="self-center text-2xs text-secondary">{String(r[chart.xKey])}</span>
            {xs.map((x) => {
              const v = Number(r[x] ?? 0);
              const href = r[`${HEAT_HREF_PREFIX}${x}`];
              const label = `${r[chart.xKey]} ${x}:00 — ${v} ${v === 1 ? 'task' : 'tasks'}`;
              const style = {
                backgroundColor:
                  v === 0
                    ? 'var(--color-surface-sunken, #F3F4F6)'
                    : `rgba(46, 92, 230, ${0.12 + 0.88 * (v / max)})`,
              };
              return v > 0 && typeof href === 'string' ? (
                <Link
                  key={x}
                  href={href}
                  title={`${label}. Open these tasks`}
                  aria-label={`${label}. Open these tasks`}
                  data-testid="heat-cell"
                  className="h-6 rounded-[3px] transition-[box-shadow,transform] hover:scale-[1.08] hover:shadow-[0_0_0_2px_var(--color-primary,#2E5CE6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  style={style}
                />
              ) : (
                <span key={x} title={label} className="h-6 rounded-[3px]" style={style} />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-2xs text-faint">
        Fewer
        <span
          className="h-2.5 w-24 rounded-full"
          style={{ background: 'linear-gradient(90deg, rgba(46,92,230,.12), rgba(46,92,230,1))' }}
        />
        More
      </div>
    </div>
  );
}

function Sparkline({ values }: { readonly values: readonly number[] }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 28;
  const pts = values
    .map((v, i) => `${(i / Math.max(values.length - 1, 1)) * w},${h - (v / max) * (h - 2) - 1}`)
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#2E5CE6" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** Parses "Picking:12,Packing:3". */
export function parseByType(v: unknown): { type: string; n: number }[] {
  return String(v ?? '')
    .split(',')
    .filter(Boolean)
    .map((x) => {
      const i = x.lastIndexOf(':');
      return { type: x.slice(0, i), n: Number(x.slice(i + 1)) || 0 };
    })
    .filter((x) => x.type);
}

function ScorecardBody({ r }: { readonly r: AnalyticsRow }) {
  const spark = String(r.spark ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="truncate text-base font-semibold text-foreground">{String(r.user)}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-2xs font-bold',
            Number(r.rank) === 1
              ? 'bg-[var(--label-orange-text)]/15 text-[#8A6400]'
              : 'bg-primary/10 text-primary',
          )}
        >
          #{String(r.rank)}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-2xs text-faint">
        <div>
          <dt>Tasks</dt>
          <dd className="text-base font-semibold text-foreground tabular-nums">
            {formatCell(r.tasks, { key: 'tasks', label: '', kind: 'number' })}
          </dd>
        </div>
        <div>
          <dt>Tasks/h</dt>
          <dd className="text-base font-semibold text-foreground tabular-nums">{String(r.speed)}</dd>
        </div>
        <div>
          <dt>Avg min</dt>
          <dd className="text-base font-semibold text-foreground tabular-nums">{String(r.avgMinutes)}</dd>
        </div>
      </dl>
      <div className="mt-2 flex items-end justify-between gap-2">
        <Sparkline values={spark} />
        <span className="text-2xs text-faint">{String(r.activeDays)} active days</span>
      </div>
    </>
  );
}

/** One associate's detail: KPIs, tasks per day and task-type mix, with a link to their tasks. */
function AssociateDetail({ r, count }: { readonly r: AnalyticsRow; readonly count: number }) {
  const spark = String(r.spark ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  const days = String(r.sparkDays ?? '')
    .split(',')
    .filter(Boolean);
  const daily = spark.map((n, i) => ({ day: days[i] ?? String(i + 1), tasks: n }));
  const mix = parseByType(r.byType);
  const mixTotal = mix.reduce((a, x) => a + x.n, 0);
  const href = typeof r.href === 'string' ? r.href : null;
  const stats: readonly (readonly [string, string])[] = [
    ['Tasks', formatCell(r.tasks, { key: 'tasks', label: '', kind: 'number' })],
    ['Units', formatCell(r.units, { key: 'units', label: '', kind: 'number' })],
    ['Tasks/h', String(r.speed)],
    ['Avg task (min)', String(r.avgMinutes)],
    ['Active days', String(r.activeDays)],
  ];
  return (
    <div className="rounded-lg border border-border p-4" data-testid="associate-detail">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {String(r.user)}{' '}
          <span className="ml-1 text-xs font-normal text-faint">
            Rank #{String(r.rank)} of {count}
          </span>
        </h3>
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open their tasks <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-2xs text-faint sm:grid-cols-5">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="text-md font-semibold text-foreground tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="mb-1 text-xs font-medium text-secondary">Tasks per day</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={AXIS}
                  tickFormatter={shortDay}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: GRID }}
                  labelFormatter={(l) => shortDay(l)}
                />
                <Bar
                  dataKey="tasks"
                  name="Tasks"
                  fill="var(--chart-1)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-secondary">Task mix</p>
          {mix.length === 0 ? (
            <p className="text-xs text-faint">No tasks in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {mix.map((m, i) => (
                <li key={m.type} className="text-xs">
                  <div className="flex justify-between">
                    <span className="text-foreground">{m.type}</span>
                    <span className="tabular-nums text-secondary">
                      {m.n} · {mixTotal ? Math.round((m.n / mixTotal) * 100) : 0}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${mixTotal ? (m.n / mixTotal) * 100 : 0}%`,
                        backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length],
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Scorecards({ chart }: { readonly chart: AnalyticsChart }) {
  const [picked, setPicked] = React.useState<string>('');
  const rows = chart.rows;
  const selected = rows.find((r) => String(r.user) === picked) ?? null;
  const pickerId = `associate-pick-${chart.id}`;
  if (rows.length === 1 && rows[0]) return <AssociateDetail r={rows[0]} count={Number(rows[0].rank) || 1} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={pickerId} className="text-xs font-medium text-secondary">
          Associate
        </label>
        <select
          id={pickerId}
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          data-testid="associate-picker"
          className="h-8 min-w-[200px] rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <option value="">All associates ({rows.length})</option>
          {rows.map((r) => (
            <option key={String(r.user)} value={String(r.user)}>
              #{String(r.rank)} {String(r.user)}
            </option>
          ))}
        </select>
        {selected ? (
          <Button size="sm" variant="ghost" onClick={() => setPicked('')}>
            Show all
          </Button>
        ) : null}
      </div>
      {selected ? (
        <AssociateDetail r={selected} count={rows.length} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((r) => {
            const href = chart.hrefKey ? r[chart.hrefKey] : null;
            return typeof href === 'string' ? (
              <Link
                key={String(r.user)}
                href={href}
                title={`Open ${String(r.user)}'s tasks`}
                data-testid="scorecard-link"
                className="rounded-lg border border-border p-3 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <ScorecardBody r={r} />
              </Link>
            ) : (
              <div key={String(r.user)} className="rounded-lg border border-border p-3">
                <ScorecardBody r={r} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chart({
  chart,
  onDrill,
}: {
  readonly chart: AnalyticsChart;
  readonly onDrill: (row: AnalyticsRow) => void;
}) {
  const isBar = chart.kind === 'bar' || chart.kind === 'stackedBar';
  const cap = isBar && chart.offScale ? barCap(chart) : null;
  const rows = isBar
    ? clampRows(
        chart.rows,
        chart.series.map((s) => s.key),
        cap,
      )
    : (chart.rows as Record<string, string | number | null>[]);
  const kind = seriesKind(chart);
  const dayAxis = isDayAxis(rows, chart.xKey);
  const fmtValue = (v: unknown, key: string): string => {
    if (v === null || v === undefined) return '—';
    const col = chart.columns.find((c) => c.key === key) ?? {
      key,
      label: '',
      kind: key === 'onTimePct' ? ('percent' as const) : undefined,
    };
    return formatCell(typeof v === 'number' ? v : Number.isFinite(Number(v)) ? Number(v) : v, col);
  };
  // A row may carry a per-series flag (`<flagKey>:<seriesKey>`, e.g. one area × shift bar) that
  // overrides the row flag, so the low-confidence rule hatches exactly the bucket it applies to.
  const flagged = (r: Readonly<Record<string, unknown>> | undefined, seriesKey?: string): string | null => {
    if (!chart.flagKey || !r) return null;
    const own = seriesKey !== undefined ? r[`${chart.flagKey}:${seriesKey}`] : undefined;
    const rowFlag = r[chart.flagKey];
    if (rowFlag !== undefined && rowFlag !== chart.flagNormal) return String(rowFlag);
    return own !== undefined && own !== chart.flagNormal ? String(own) : null;
  };
  const tip = (
    <Tooltip
      contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: GRID, maxWidth: 320, whiteSpace: 'normal' }}
      labelFormatter={(l) => (dayAxis ? shortDay(l) : String(l))}
      formatter={(v, n, item) => {
        const key = String((item as { dataKey?: unknown } | undefined)?.dataKey ?? '');
        const payload = (item as { payload?: Record<string, unknown> } | undefined)?.payload;
        if (GAP_SERIES.has(key) && (v === null || v === undefined)) return ['No shipments', String(n)];
        const real = payload?.[realKey(key)];
        const text = real !== undefined ? `${fmtValue(real, key)} (off scale)` : fmtValue(v, key);
        const flag = flagged(payload, key);
        return [flag ? `${text} · ${flag}` : text, String(n)];
      }}
    />
  );
  const legend =
    chart.series.length > 1 ? (
      <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
    ) : null;
  const clickable = Boolean(chart.hrefKey);
  const click = (d: unknown) => {
    const p = (d as { payload?: AnalyticsRow })?.payload ?? (d as AnalyticsRow);
    if (p) onDrill(p);
  };
  // Line/area charts: clicking anywhere in a day's column opens that day's records.
  const chartClick = clickable
    ? (state: unknown) => {
        const st = state as { activeIndex?: number | string | null; activeLabel?: unknown } | null;
        const idx = st?.activeIndex;
        const row =
          idx !== null && idx !== undefined && idx !== '' && Number.isFinite(Number(idx))
            ? rows[Number(idx)]
            : rows.find((r) => r[chart.xKey] === st?.activeLabel);
        if (row) onDrill(row);
      }
    : undefined;
  const chartStyle = clickable ? { cursor: 'pointer' } : undefined;
  // Day axes thin their labels; category axes (SKUs, clients, areas) show every label, shortened and tilted when crowded.
  const tilt = !dayAxis && rows.length > (chart.wide ? 12 : 6);
  const xAxis = dayAxis ? (
    <XAxis
      dataKey={chart.xKey}
      tick={AXIS}
      tickFormatter={shortDay}
      tickLine={false}
      axisLine={{ stroke: GRID }}
      interval="preserveStartEnd"
      minTickGap={12}
    />
  ) : (
    <XAxis
      dataKey={chart.xKey}
      tick={tilt ? { ...AXIS, textAnchor: 'end' } : AXIS}
      tickFormatter={(v) => shortCategory(v, tilt ? 12 : 18)}
      tickLine={false}
      axisLine={{ stroke: GRID }}
      interval={0}
      angle={tilt ? -35 : 0}
      height={tilt ? 76 : 30}
      dy={tilt ? 4 : 0}
    />
  );
  const yAxis = (
    <YAxis
      tick={AXIS}
      tickLine={false}
      axisLine={false}
      width={kind === 'money' ? 56 : 48}
      tickFormatter={(v) => axisTick(v, kind)}
      {...(cap !== null
        ? { domain: [0, cap] as [number, number], allowDataOverflow: true, ticks: capTicks(cap) }
        : {})}
    />
  );
  const hatchId = `hatch-${chart.id}`;
  switch (chart.kind) {
    case 'line': {
      // Sparse charts break every line (the trend included) on days without data; nothing is interpolated.
      const breaks = (key: string) => GAP_SERIES.has(key) || Boolean(chart.breakOnNull);
      // Percent series (On-time %) get their own right-hand 0–100 % axis so the counts keep theirs.
      const dual =
        chart.series.some((s) => s.axis === 'percent') && chart.series.some((s) => s.axis !== 'percent');
      const leftAxis = dual ? (
        <YAxis
          yAxisId="count"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={kind === 'money' ? 56 : 48}
          tickFormatter={(v) => axisTick(v, kind)}
          allowDecimals={false}
        />
      ) : (
        yAxis
      );
      return (
        <LineChart
          data={rows}
          margin={{ top: 8, right: dual ? 4 : 12, left: 0, bottom: 0 }}
          onClick={chartClick}
          style={chartStyle}
        >
          <CartesianGrid stroke={GRID} vertical={false} {...(dual ? { yAxisId: 'count' } : {})} />
          {xAxis}
          {leftAxis}
          {dual ? (
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v) => `${v}%`}
            />
          ) : null}
          {tip}
          {legend}
          {chart.series.map((s, i) => (
            <Line
              key={s.key}
              {...(dual ? { yAxisId: s.axis === 'percent' ? 'pct' : 'count' } : {})}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={i === chart.series.length - 1 && chart.series.length > 2 ? 2.5 : 1.75}
              strokeDasharray={s.key === 'overall' || s.key === 'onTimePct' ? '5 4' : undefined}
              dot={breaks(s.key) ? { r: 2.5, strokeDasharray: '0', fill: s.color } : false}
              activeDot={clickable ? { r: 5, cursor: 'pointer' } : undefined}
              connectNulls={!breaks(s.key)}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      );
    }
    case 'area':
      return (
        <AreaChart
          data={rows}
          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          onClick={chartClick}
          style={chartStyle}
        >
          <CartesianGrid stroke={GRID} vertical={false} />
          {xAxis}
          {yAxis}
          {tip}
          {chart.series.map((s) => (
            <Area
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.15}
              strokeWidth={1.75}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      );
    case 'bar':
    case 'stackedBar': {
      const perRowColor = Boolean(chart.colorKey && chart.series.length === 1);
      const anyFlag = rows.some((r) => flagged(r) || chart.series.some((s) => flagged(r, s.key)));
      if (chart.horizontal && !dayAxis) {
        // Categories on the Y axis: every label reads in full (up to 26 chars, full text in the tooltip).
        const longest = rows.reduce((m, r) => Math.max(m, String(r[chart.xKey] ?? '').length), 0);
        const catWidth = Math.min(Math.max(longest * 6.4 + 12, 72), 180);
        return (
          <BarChart
            layout="vertical"
            data={rows}
            margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
            onClick={chartClick}
            style={chartStyle}
            barCategoryGap="22%"
          >
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis
              type="number"
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => axisTick(v, kind)}
              allowDecimals={false}
              {...(cap !== null
                ? { domain: [0, cap] as [number, number], allowDataOverflow: true, ticks: capTicks(cap) }
                : {})}
            />
            <YAxis
              type="category"
              dataKey={chart.xKey}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              width={catWidth}
              interval={0}
              tickFormatter={(v) => shortCategory(v, 26)}
            />
            {tip}
            {legend}
            {chart.series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                stackId={chart.kind === 'stackedBar' ? 'a' : undefined}
                maxBarSize={22}
                radius={
                  chart.kind === 'stackedBar'
                    ? i === chart.series.length - 1
                      ? [0, 4, 4, 0]
                      : 0
                    : [0, 4, 4, 0]
                }
                cursor={clickable ? 'pointer' : undefined}
                isAnimationActive={false}
              >
                {perRowColor
                  ? rows.map((r, j) => <Cell key={j} fill={String(r[chart.colorKey as string] ?? s.color)} />)
                  : null}
              </Bar>
            ))}
          </BarChart>
        );
      }
      return (
        // Chart-level click (same activeIndex handler as the line charts): a Bar's own onClick is
        // dropped by recharts once per-row <Cell>s are rendered (per-type colours, hatching).
        <BarChart
          data={rows}
          margin={{ top: cap !== null ? 22 : 8, right: 12, left: tilt ? 28 : 0, bottom: 0 }}
          onClick={chartClick}
          style={chartStyle}
        >
          {anyFlag ? (
            <defs>
              <pattern
                id={hatchId}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="currentColor" fillOpacity={0.08} />
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke="currentColor"
                  strokeOpacity={0.45}
                  strokeWidth={2}
                />
              </pattern>
            </defs>
          ) : null}
          <CartesianGrid stroke={GRID} vertical={false} />
          {xAxis}
          {yAxis}
          {tip}
          {legend}
          {chart.series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={chart.kind === 'stackedBar' ? 'a' : undefined}
              maxBarSize={44}
              radius={
                chart.kind === 'stackedBar'
                  ? i === chart.series.length - 1
                    ? [4, 4, 0, 0]
                    : 0
                  : [4, 4, 0, 0]
              }
              cursor={clickable ? 'pointer' : undefined}
              isAnimationActive={false}
            >
              {perRowColor || anyFlag
                ? rows.map((r, j) => {
                    const base = perRowColor ? String(r[chart.colorKey as string] ?? s.color) : s.color;
                    const f = flagged(r, s.key);
                    return (
                      <Cell
                        key={j}
                        fill={f ? `url(#${hatchId})` : base}
                        stroke={f ? base : undefined}
                        strokeWidth={f ? 1.5 : 0}
                      />
                    );
                  })
                : null}
              {cap !== null ? (
                <LabelList
                  dataKey={realKey(s.key)}
                  position="top"
                  content={(p: unknown) => {
                    const lp = p as { x?: number; y?: number; width?: number; value?: unknown };
                    if (lp.value === undefined || lp.value === null || lp.value === '') return null;
                    return (
                      <text
                        x={(lp.x ?? 0) + (lp.width ?? 0) / 2}
                        y={(lp.y ?? 0) - 6}
                        textAnchor="middle"
                        fontSize={10.5}
                        fontWeight={600}
                        fill="currentColor"
                      >
                        ▲ {axisTick(lp.value, kind)} off scale
                      </text>
                    );
                  }}
                />
              ) : null}
            </Bar>
          ))}
        </BarChart>
      );
    }
    case 'donut': {
      const valueKey = chart.series[0]?.key ?? 'value';
      const total = rows.reduce((a, r) => a + (Number(r[valueKey]) || 0), 0);
      const pctOf = (v: unknown) => (total > 0 ? Math.round(((Number(v) || 0) / total) * 1000) / 10 : 0);
      const totalText = fmtValue(total, valueKey);
      return (
        <PieChart>
          <Pie
            data={rows}
            dataKey={valueKey}
            nameKey={chart.xKey}
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={1}
            stroke="none"
            isAnimationActive={false}
            cursor={clickable ? 'pointer' : undefined}
            onClick={clickable ? click : undefined}
            labelLine={false}
            label={(p: unknown) => {
              const lp = p as {
                cx?: number;
                cy?: number;
                midAngle?: number;
                innerRadius?: number;
                outerRadius?: number;
                percent?: number;
              };
              if (!lp.percent || lp.percent < 0.06) return null;
              const rad = Math.PI / 180;
              const rr = ((lp.innerRadius ?? 0) + (lp.outerRadius ?? 0)) / 2;
              const x = (lp.cx ?? 0) + rr * Math.cos(-(lp.midAngle ?? 0) * rad);
              const y = (lp.cy ?? 0) + rr * Math.sin(-(lp.midAngle ?? 0) * rad);
              return (
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={600}
                  fill="#fff"
                >
                  {Math.round(lp.percent * 100)}%
                </text>
              );
            }}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
            ))}
            <Label
              position="center"
              value="Total"
              dy={-11}
              fontSize={11}
              fill="var(--color-faint, #6B7280)"
            />
            <Label
              position="center"
              value={totalText}
              dy={9}
              fontSize={17}
              fontWeight={600}
              fill="var(--color-foreground, #1C2333)"
            />
          </Pie>
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: GRID }}
            formatter={(v, n) => [`${fmtValue(v, valueKey)} (${pctOf(v)}%)`, String(n)]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            iconType="circle"
            iconSize={8}
            layout="vertical"
            align="right"
            verticalAlign="middle"
            formatter={(value, entry) => {
              const v = (entry as { payload?: Record<string, unknown> } | undefined)?.payload?.[valueKey];
              return (
                <span className="text-secondary">
                  {String(value)} <span className="tabular-nums text-faint">{pctOf(v)}%</span>
                </span>
              );
            }}
          />
        </PieChart>
      );
    }
    case 'scatter': {
      const med = chart.medians ?? { x: 0, y: 0 };
      const yKey = chart.yKey ?? 'y';
      const { cap } = scatterYCap(
        rows.map((r) => Number(r[yKey] ?? 0)),
        med.y,
      );
      // Outliers are pinned to the cap (real value kept in `__real` for the label and tooltip).
      const capped =
        cap === null
          ? rows
          : rows.map((r) =>
              isAboveCap(Number(r[yKey] ?? 0), cap) ? { ...r, [yKey]: cap, __real: r[yKey] } : r,
            );
      // Label placement in data space: labels near the right edge point left, and a label that
      // would sit on a close neighbour's label drops below its dot.
      const plotted = scatterLabelPlacement(capped, chart.xKey, yKey);
      return (
        <ScatterChart margin={{ top: 24, right: 72, left: 4, bottom: 16 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis type="number" dataKey={chart.xKey} name="Tasks completed" tick={AXIS} tickLine={false}>
            <Label
              value="Volume (tasks completed)"
              position="insideBottom"
              offset={-8}
              style={{ fontSize: 11, fill: 'var(--color-faint, #6B7280)' }}
            />
          </XAxis>
          <YAxis
            type="number"
            dataKey={yKey}
            name="Tasks per hour"
            tick={AXIS}
            tickLine={false}
            width={44}
            domain={cap === null ? [0, scatterYMax(rows.map((r) => Number(r[yKey] ?? 0)))] : [0, cap]}
            {...(cap === null ? { ticks: scatterYTicks(rows.map((r) => Number(r[yKey] ?? 0))) } : {})}
            allowDataOverflow={cap !== null}
          >
            <Label
              value="Speed (tasks/h)"
              angle={-90}
              position="insideLeft"
              style={{ fontSize: 11, fill: 'var(--color-faint, #6B7280)' }}
            />
          </YAxis>
          <ZAxis range={[90, 90]} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            labelFormatter={() => ''}
            formatter={(v, n, item) => {
              const real = (item as { payload?: AnalyticsRow } | undefined)?.payload?.__real;
              return [
                String(n) === 'Tasks per hour' && real !== undefined ? String(real) : String(v),
                String(n),
              ];
            }}
          />
          <ReferenceLine x={med.x} stroke="var(--chart-axis)" strokeDasharray="5 4">
            <Label
              value={`median ${Math.round(med.x)}`}
              position="top"
              style={{ fontSize: 10, fill: '#6B7280' }}
            />
          </ReferenceLine>
          <ReferenceLine y={med.y} stroke="var(--chart-axis)" strokeDasharray="5 4">
            <Label value={`median ${med.y}/h`} position="right" style={{ fontSize: 10, fill: '#6B7280' }} />
          </ReferenceLine>
          <Scatter
            data={plotted}
            fill="var(--chart-1)"
            cursor={clickable ? 'pointer' : undefined}
            onClick={clickable ? click : undefined}
            isAnimationActive={false}
            shape={(props: unknown) => {
              const p = props as { cx?: number; cy?: number; payload?: AnalyticsRow };
              const real = p.payload?.__real;
              const cx = p.cx ?? 0;
              const cy = p.cy ?? 0;
              const name = String(p.payload?.user ?? '');
              const fill = quadrantColor(p.payload?.quadrant, chart.quadrants);
              return (
                <g>
                  {real !== undefined ? (
                    <path
                      d={`M ${cx} ${cy - 8} L ${cx + 7} ${cy + 5} L ${cx - 7} ${cy + 5} Z`}
                      fill={fill}
                      fillOpacity={0.9}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  ) : (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={7}
                      fill={fill}
                      fillOpacity={0.9}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  )}
                  <text
                    x={p.payload?.__labelLeft ? cx - 10 : cx + 10}
                    y={cy + (real !== undefined || p.payload?.__labelBelow ? 16 : -6)}
                    textAnchor={p.payload?.__labelLeft ? 'end' : 'start'}
                    fontSize={11}
                    fill="currentColor"
                    stroke="var(--color-surface, #fff)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    {real !== undefined ? `${name} · ${String(real)}/h (off scale)` : name}
                  </text>
                </g>
              );
            }}
          />
        </ScatterChart>
      );
    }
    default:
      return <></>;
  }
}

/** Quadrant key drawn above the plot (never over points or the median labels). */
function QuadrantLegend({ labels }: { readonly labels: readonly [string, string, string, string] }) {
  const arrows = ['↗', '↖', '↘', '↙'];
  const items = labels.map((l, i) => ({ label: `${arrows[i]} ${l}`, color: QUADRANT_COLORS[i] as string }));
  return (
    <ul
      className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-secondary"
      aria-label="Quadrant key"
    >
      {[...items, { label: 'Low sample (not ranked)', color: LOW_SAMPLE_COLOR }].map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
      <li className="text-faint" data-testid="quadrant-tie-rule">
        On a median line counts as the upper / right side (≥ median).
      </li>
    </ul>
  );
}

export function AnalyticsChartCard({
  chart,
  fileStem,
}: {
  readonly chart: AnalyticsChart;
  readonly fileStem: string;
}) {
  const router = useRouter();
  const [showTable, setShowTable] = React.useState(false);
  const onDrill = (row: AnalyticsRow) => {
    const href = chart.hrefKey ? row[chart.hrefKey] : null;
    if (typeof href === 'string') router.push(href);
  };
  const allZero = chart.rows.every((r) => chart.series.every((s) => !Number(r[s.key] ?? 0)));
  const empty =
    chart.rows.length === 0 ||
    (chart.kind !== 'heatmap' && chart.kind !== 'scorecards' && chart.kind !== 'scatter' && allZero);
  return (
    <section
      aria-labelledby={`chart-${chart.id}`}
      className={cn(
        'flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-xs',
        chart.wide && 'lg:col-span-2',
      )}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h2 id={`chart-${chart.id}`} className="text-base font-semibold text-foreground">
            {chart.title}
          </h2>
          <p className="mt-0.5 text-xs text-faint">{chart.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {chart.rows.length > 0 ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-pressed={showTable}
              aria-label={showTable ? 'Show chart' : 'Show data table'}
              title={showTable ? 'Show chart' : 'Show data table'}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? (
                <ChartColumn className="h-4 w-4" aria-hidden />
              ) : (
                <Table2 className="h-4 w-4" aria-hidden />
              )}
            </Button>
          ) : null}
          <Dropdown
            align="end"
            trigger={() => (
              <span
                aria-label={`Export ${chart.title}`}
                title="Export data"
                className="grid h-7 w-7 place-items-center rounded-md text-secondary hover:bg-neutral-soft hover:text-body"
              >
                <Download className="h-4 w-4" aria-hidden />
              </span>
            )}
          >
            {(close) => (
              <>
                <DropdownItem
                  onClick={() => {
                    downloadChartCsv(chart, fileStem);
                    close();
                  }}
                >
                  Export as CSV
                </DropdownItem>
                <DropdownItem
                  onClick={() => {
                    void downloadChartXlsx(chart, fileStem);
                    close();
                  }}
                >
                  Export as Excel (.xlsx)
                </DropdownItem>
              </>
            )}
          </Dropdown>
          {chart.gridHref ? (
            <Link
              href={chart.gridHref}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              title={chart.gridLabel}
            >
              {chart.gridLabel ?? 'Open grid'}
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="flex-1 px-5 pb-5">
        {empty && chart.kind !== 'scorecards' ? (
          <div className="grid h-[240px] place-items-center rounded-lg border border-dashed border-border text-center text-xs text-faint">
            No activity in this period. Widen the date range or pick another warehouse.
          </div>
        ) : chart.kind === 'scorecards' && !showTable ? (
          chart.rows.length ? (
            <Scorecards chart={chart} />
          ) : (
            <p className="py-10 text-center text-xs text-faint">
              No associate completed a task in this period.
            </p>
          )
        ) : showTable ? (
          <DataTable chart={chart} />
        ) : chart.kind === 'heatmap' ? (
          <Heatmap chart={chart} />
        ) : (
          <>
            {chart.kind === 'scatter' && chart.quadrants ? <QuadrantLegend labels={chart.quadrants} /> : null}
            <figure
              className={cn(
                'relative text-foreground',
                chart.kind === 'scatter' ? 'h-[380px]' : 'h-[280px]',
                chart.kind === 'donut' && chart.wide && 'mx-auto max-w-[640px]',
              )}
              aria-label={`${chart.title} chart. Use the table button for the data.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <Chart chart={chart} onDrill={onDrill} />
              </ResponsiveContainer>
            </figure>
          </>
        )}
        {/* Screen readers always get the table, even while the chart is shown. */}
        {!showTable ? (
          <div className="sr-only">
            <DataTable chart={chart} plain />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export type { AnalyticsColumn };
