"use client";

/**
 * One analytics chart card: recharts styled with KitStaks tokens, an accessible data
 * table behind every chart (toggle), CSV/XLSX export of the chart's rows and drilldowns
 * (click a bar/point/row, or "Open grid").
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChartColumn, Download, Table2 } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label, Legend, Line, LineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import type { AnalyticsChart, AnalyticsColumn, AnalyticsRow } from "@/server/repositories/analytics-types";
import { downloadChartCsv, downloadChartXlsx, formatCell } from "./analytics-export";

const AXIS = { fontSize: 11, fill: "var(--color-faint, #8A9099)" };
const GRID = "var(--color-border, #E4E7EB)";
/** Heatmap rows carry one drilldown per cell under `href:<column>`. */
export const HEAT_HREF_PREFIX = "href:";
const shortDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` : String(v));

function DataTable({ chart, plain = false }: { readonly chart: AnalyticsChart; readonly plain?: boolean }) {
  return (
    <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-[12.5px]">
        <caption className="sr-only">{chart.title} data</caption>
        <thead className="sticky top-0 bg-surface-sunken">
          <tr>{chart.columns.map((c) => <th key={c.key} scope="col" className={cn("px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary", c.kind && c.kind !== "text" && "text-right")}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {chart.rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {chart.columns.map((c, j) => {
                const text = formatCell(r[c.key], c);
                const href = !plain && j === 0 && chart.hrefKey ? r[chart.hrefKey] : null;
                return (
                  <td key={c.key} className={cn("px-3 py-1.5 tabular-nums", c.kind && c.kind !== "text" && "text-right")}>
                    {typeof href === "string" ? <Link href={href} className="font-medium text-primary hover:underline">{text}</Link> : text}
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
      <div className="grid min-w-[640px] gap-[3px]" style={{ gridTemplateColumns: `40px repeat(${xs.length}, minmax(0, 1fr))` }}>
        <span />
        {xs.map((x) => <span key={x} className="text-center text-[10px] text-faint">{Number(x) % 3 === 0 ? x : ""}</span>)}
        {chart.rows.map((r) => (
          <React.Fragment key={String(r[chart.xKey])}>
            <span className="self-center text-[11px] text-secondary">{String(r[chart.xKey])}</span>
            {xs.map((x) => {
              const v = Number(r[x] ?? 0);
              const href = r[`${HEAT_HREF_PREFIX}${x}`];
              const label = `${r[chart.xKey]} ${x}:00 — ${v} ${v === 1 ? "task" : "tasks"}`;
              const style = { backgroundColor: v === 0 ? "var(--color-surface-sunken, #F3F4F6)" : `rgba(46, 92, 230, ${0.12 + 0.88 * (v / max)})` };
              return v > 0 && typeof href === "string" ? (
                <Link key={x} href={href} title={`${label}. Open these tasks`} aria-label={`${label}. Open these tasks`} data-testid="heat-cell"
                  className="h-6 rounded-[3px] transition-[box-shadow,transform] hover:scale-[1.08] hover:shadow-[0_0_0_2px_var(--color-primary,#2E5CE6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" style={style} />
              ) : <span key={x} title={label} className="h-6 rounded-[3px]" style={style} />;
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-faint">Fewer<span className="h-2.5 w-24 rounded-full" style={{ background: "linear-gradient(90deg, rgba(46,92,230,.12), rgba(46,92,230,1))" }} />More</div>
    </div>
  );
}

function Sparkline({ values }: { readonly values: readonly number[] }) {
  const max = Math.max(1, ...values);
  const w = 120; const h = 28;
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible"><polyline points={pts} fill="none" stroke="#2E5CE6" strokeWidth={1.5} strokeLinejoin="round" /></svg>;
}

function Scorecards({ chart }: { readonly chart: AnalyticsChart }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {chart.rows.map((r) => {
        const href = chart.hrefKey ? r[chart.hrefKey] : null;
        const spark = String(r.spark ?? "").split(",").filter(Boolean).map(Number);
        const body = (
          <>
            <div className="flex items-center justify-between">
              <span className="truncate text-[14px] font-semibold text-foreground">{String(r.user)}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", Number(r.rank) === 1 ? "bg-[#EBAC00]/15 text-[#8A6400]" : "bg-primary/10 text-primary")}>#{String(r.rank)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-faint">
              <div><dt>Tasks</dt><dd className="text-[15px] font-semibold text-foreground tabular-nums">{formatCell(r.tasks, { key: "tasks", label: "", kind: "number" })}</dd></div>
              <div><dt>Tasks/h</dt><dd className="text-[15px] font-semibold text-foreground tabular-nums">{String(r.speed)}</dd></div>
              <div><dt>Avg min</dt><dd className="text-[15px] font-semibold text-foreground tabular-nums">{String(r.avgMinutes)}</dd></div>
            </dl>
            <div className="mt-2 flex items-end justify-between gap-2"><Sparkline values={spark} /><span className="text-[11px] text-faint">{String(r.activeDays)} active days</span></div>
          </>
        );
        return typeof href === "string" ? (
          <Link key={String(r.user)} href={href} className="rounded-lg border border-border p-3 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{body}</Link>
        ) : <div key={String(r.user)} className="rounded-lg border border-border p-3">{body}</div>;
      })}
    </div>
  );
}

function Chart({ chart, onDrill }: { readonly chart: AnalyticsChart; readonly onDrill: (row: AnalyticsRow) => void }) {
  const rows = chart.rows as Record<string, string | number | null>[];
  const tip = <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: GRID }} labelFormatter={shortDay} />;
  const legend = chart.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} /> : null;
  const clickable = Boolean(chart.hrefKey);
  const click = (d: unknown) => { const p = (d as { payload?: AnalyticsRow })?.payload ?? (d as AnalyticsRow); if (p) onDrill(p); };
  // Line/area charts: clicking anywhere in a day's column opens that day's records.
  const chartClick = clickable ? (state: unknown) => {
    const st = state as { activeIndex?: number | string | null; activeLabel?: unknown } | null;
    const idx = st?.activeIndex;
    const row = idx !== null && idx !== undefined && idx !== "" && Number.isFinite(Number(idx)) ? rows[Number(idx)] : rows.find((r) => r[chart.xKey] === st?.activeLabel);
    if (row) onDrill(row);
  } : undefined;
  const chartStyle = clickable ? { cursor: "pointer" } : undefined;
  const xAxis = <XAxis dataKey={chart.xKey} tick={AXIS} tickFormatter={shortDay} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={12} />;
  const yAxis = <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />;
  switch (chart.kind) {
    case "line":
      return (
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={chartClick} style={chartStyle}>
          <CartesianGrid stroke={GRID} vertical={false} />{xAxis}{yAxis}{tip}{legend}
          {chart.series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={i === chart.series.length - 1 && chart.series.length > 2 ? 2.5 : 1.75} strokeDasharray={s.key === "overall" || s.key === "onTimePct" ? "5 4" : undefined} dot={false} activeDot={clickable ? { r: 5, cursor: "pointer" } : undefined} connectNulls isAnimationActive={false} />)}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={chartClick} style={chartStyle}>
          <CartesianGrid stroke={GRID} vertical={false} />{xAxis}{yAxis}{tip}
          {chart.series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={1.75} isAnimationActive={false} />)}
        </AreaChart>
      );
    case "bar":
    case "stackedBar":
      return (
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />{xAxis}{yAxis}{tip}{legend}
          {chart.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={chart.kind === "stackedBar" ? "a" : undefined} maxBarSize={44}
              radius={chart.kind === "stackedBar" ? (i === chart.series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
              cursor={clickable ? "pointer" : undefined} onClick={clickable ? click : undefined} isAnimationActive={false} />
          ))}
        </BarChart>
      );
    case "donut":
      return (
        <PieChart>
          <Pie data={rows} dataKey={chart.series[0]?.key ?? "value"} nameKey={chart.xKey} innerRadius="55%" outerRadius="80%" paddingAngle={1} stroke="none" isAnimationActive={false}
            cursor={clickable ? "pointer" : undefined} onClick={clickable ? click : undefined}>
            {rows.map((_, i) => <Cell key={i} fill={["#2E5CE6", "#17874D", "#E0A500", "#621DB8", "#C2412A", "#0F8C7A", "#B07F00", "#50575C"][i % 8]} />)}
          </Pie>
          {tip}<Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} layout="vertical" align="right" verticalAlign="middle" />
        </PieChart>
      );
    case "scatter": {
      const med = chart.medians ?? { x: 0, y: 0 };
            return (
        <ScatterChart margin={{ top: 20, right: 24, left: 4, bottom: 16 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis type="number" dataKey={chart.xKey} name="Tasks completed" tick={AXIS} tickLine={false}><Label value="Volume (tasks completed)" position="insideBottom" offset={-8} style={{ fontSize: 11, fill: "#6B7280" }} /></XAxis>
          <YAxis type="number" dataKey={chart.yKey ?? "y"} name="Tasks per hour" tick={AXIS} tickLine={false} width={44}><Label value="Speed (tasks/h)" angle={-90} position="insideLeft" style={{ fontSize: 11, fill: "#6B7280" }} /></YAxis>
          <ZAxis range={[90, 90]} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v, n) => [String(v), String(n)]} labelFormatter={() => ""} />
          <ReferenceLine x={med.x} stroke="#8A9099" strokeDasharray="5 4"><Label value={`median ${Math.round(med.x)}`} position="top" style={{ fontSize: 10, fill: "#8A9099" }} /></ReferenceLine>
          <ReferenceLine y={med.y} stroke="#8A9099" strokeDasharray="5 4"><Label value={`median ${med.y}/h`} position="insideBottomLeft" style={{ fontSize: 10, fill: "#8A9099" }} /></ReferenceLine>
                    <Scatter data={rows} fill="#2E5CE6" cursor={clickable ? "pointer" : undefined} onClick={clickable ? click : undefined} isAnimationActive={false}
            shape={(props: unknown) => {
              const p = props as { cx?: number; cy?: number; payload?: AnalyticsRow };
              return <g><circle cx={p.cx} cy={p.cy} r={7} fill="#2E5CE6" fillOpacity={0.85} stroke="#fff" strokeWidth={2} /><text x={(p.cx ?? 0) + 10} y={(p.cy ?? 0) + 4} fontSize={11} fill="#1C2333">{String(p.payload?.user ?? "")}</text></g>;
            }} />
        </ScatterChart>
      );
    }
    default:
      return <></>;
  }
}

function QuadrantLabels({ labels }: { readonly labels: readonly [string, string, string, string] }) {
  const base = "pointer-events-none absolute rounded-md px-2 py-0.5 text-[11px] font-semibold";
  return (
    <>
      <span className={cn(base, "right-8 top-6 bg-[#D3F0E3] text-[#17874D]")}>{labels[0]}</span>
      <span className={cn(base, "left-[60px] top-6 bg-[#D0F3EE] text-[#0F8C7A]")}>{labels[1]}</span>
      <span className={cn(base, "bottom-[58px] right-8 bg-[rgba(235,172,0,.16)] text-[#B07F00]")}>{labels[2]}</span>
      <span className={cn(base, "bottom-[58px] left-[60px] bg-[#FBDBDE] text-[#B20B1C]")}>{labels[3]}</span>
    </>
  );
}

export function AnalyticsChartCard({ chart, fileStem }: { readonly chart: AnalyticsChart; readonly fileStem: string }) {
  const router = useRouter();
  const [showTable, setShowTable] = React.useState(false);
  const onDrill = (row: AnalyticsRow) => {
    const href = chart.hrefKey ? row[chart.hrefKey] : null;
    if (typeof href === "string") router.push(href);
  };
  const allZero = chart.rows.every((r) => chart.series.every((s) => !Number(r[s.key] ?? 0)));
  const empty = chart.rows.length === 0 || (chart.kind !== "heatmap" && chart.kind !== "scorecards" && chart.kind !== "scatter" && allZero);
  return (
    <section aria-labelledby={`chart-${chart.id}`} className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-xs", chart.wide && "lg:col-span-2")}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h2 id={`chart-${chart.id}`} className="text-[15px] font-semibold text-foreground">{chart.title}</h2>
          <p className="mt-0.5 text-[12px] text-faint">{chart.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {chart.rows.length > 0 ? (
            <Button size="icon-sm" variant="ghost" aria-pressed={showTable} aria-label={showTable ? "Show chart" : "Show data table"} title={showTable ? "Show chart" : "Show data table"} onClick={() => setShowTable((v) => !v)}>
              {showTable ? <ChartColumn className="h-4 w-4" aria-hidden /> : <Table2 className="h-4 w-4" aria-hidden />}
            </Button>
          ) : null}
          <Dropdown align="end" trigger={() => <span aria-label={`Export ${chart.title}`} title="Export data" className="grid h-7 w-7 place-items-center rounded-md text-secondary hover:bg-neutral-soft hover:text-body"><Download className="h-4 w-4" aria-hidden /></span>}>
            {(close) => (
              <>
                <DropdownItem onClick={() => { downloadChartCsv(chart, fileStem); close(); }}>Export as CSV</DropdownItem>
                <DropdownItem onClick={() => { void downloadChartXlsx(chart, fileStem); close(); }}>Export as Excel (.xlsx)</DropdownItem>
              </>
            )}
          </Dropdown>
          {chart.gridHref ? (
            <Link href={chart.gridHref} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" title={chart.gridLabel}>
              {chart.gridLabel ?? "Open grid"}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="flex-1 px-5 pb-5">
        {empty && chart.kind !== "scorecards" ? (
          <div className="grid h-[240px] place-items-center rounded-lg border border-dashed border-border text-center text-[12.5px] text-faint">No activity in this period. Widen the date range or pick another warehouse.</div>
        ) : chart.kind === "scorecards" && !showTable ? (chart.rows.length ? <Scorecards chart={chart} /> : <p className="py-10 text-center text-[12.5px] text-faint">No associate completed a task in this period.</p>)
          : showTable ? <DataTable chart={chart} />
          : chart.kind === "heatmap" ? <Heatmap chart={chart} />
          : (
            <figure className={cn("relative", chart.kind === "scatter" ? "h-[380px]" : "h-[280px]")} aria-label={`${chart.title} chart. Use the table button for the data.`}>
              <ResponsiveContainer width="100%" height="100%"><Chart chart={chart} onDrill={onDrill} /></ResponsiveContainer>
              {chart.kind === "scatter" && chart.quadrants ? <QuadrantLabels labels={chart.quadrants} /> : null}
            </figure>
          )}
        {/* Screen readers always get the table, even while the chart is shown. */}
        {!showTable ? <div className="sr-only"><DataTable chart={chart} plain /></div> : null}
      </div>
    </section>
  );
}

export type { AnalyticsColumn };
