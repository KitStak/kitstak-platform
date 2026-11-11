"use client";

/**
 * Dashboard widgets (spec 08 §Dashboard). Unlike Logiwa every number drills down: the
 * href comes from the server, built from the same grid grammar the count used.
 */
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Globe2, Moon, Store, Sun, Truck, Users } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { shiftWindow } from "@/lib/shift";
import { cn } from "@/lib/utils";
import type { JobRow, LiveDashboard, Metric, Progress, RankRow, ShiftInfo, SnapshotGap } from "@/server/repositories/dashboard-live";

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);
const pctOf = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

/** When the data behind every card was computed, and whether a refresh is in flight. */
export interface PanelFreshness {
  /** Server compute time of the payload (ISO). */
  readonly asOf: string | null;
  readonly refreshing: boolean;
  /** Auto refresh interval; data older than twice this reads as stale. */
  readonly intervalMs: number;
  /** Client clock, re-read every 30 s so the age stays current between refreshes. */
  readonly now: number | null;
}

export const PanelFreshnessContext = React.createContext<PanelFreshness | null>(null);

/** "Updated 2:41 PM" / "Updated 2:41 PM · 4 min ago (stale)"; null before mount. */
export function freshnessLabel(f: Pick<PanelFreshness, "asOf" | "intervalMs" | "now">): { readonly text: string; readonly stale: boolean } | null {
  if (!f.asOf || f.now === null) return null;
  const at = Date.parse(f.asOf);
  if (!Number.isFinite(at)) return null;
  const time = new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const ageMin = Math.max(0, Math.floor((f.now - at) / 60_000));
  const stale = f.now - at > 2 * f.intervalMs;
  return { text: stale ? `Updated ${time} · ${ageMin} min ago` : `Updated ${time}`, stale };
}

function PanelStamp() {
  const f = React.useContext(PanelFreshnessContext);
  if (!f) return null;
  const label = freshnessLabel(f);
  if (!label && !f.refreshing) return null;
  return (
    <p data-testid="panel-updated" data-stale={label?.stale ? "true" : undefined} className={cn("mt-0.5 flex items-center gap-1 text-[11px] tabular-nums", label?.stale ? "text-warning" : "text-faint")}>
      {f.refreshing ? <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> : null}
      {f.refreshing ? "Refreshing…" : label?.text}
    </p>
  );
}

export function Panel({ title, info, description, action, children, className }: {
  readonly title: string; readonly info?: string; readonly description?: string; readonly action?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string;
}) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-xs", className)}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">{title}{info ? <InfoTip content={info} label={`About ${title}`} /> : null}</h2>
          {description ? <p className="mt-0.5 text-[12px] text-faint">{description}</p> : null}
          <PanelStamp />
        </div>
        {action}
      </header>
      <div className="flex-1 px-5 pb-4">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------ progress today */

const SHIFT_SUMMARY_MAX = 4;

/** Aggregate Day Shift view: one compact row per selected warehouse (each in its own zone). */
function ShiftSummary({ shifts }: { readonly shifts: readonly ShiftInfo[] }) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const windows = shifts.map((s) => ({ s, w: shiftWindow({ now, timeZone: s.timeZone, start: s.start, end: s.end }) }));
  const during = windows.filter((x) => x.w.phase === "during").length;
  const shown = windows.slice(0, SHIFT_SUMMARY_MAX);
  return (
    <div className="rounded-lg bg-surface-sunken/60 px-3.5 py-3" data-testid="shift-summary">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-secondary">Day shift · {shifts.length} warehouses</span>
        <span className="text-[12px] font-semibold tabular-nums text-secondary">{during} on shift</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {shown.map(({ s, w }) => (
          <li key={s.warehouseId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[11.5px]">
            <span className="truncate text-foreground" title={`${s.warehouseLabel} · ${s.timeZone.replace("_", " ")}`}>{s.warehouseLabel}</span>
            <span className={cn("tabular-nums", w.phase === "during" ? "font-semibold text-success" : "text-faint")}>{w.phase === "during" ? `${w.nowLabel} – ${s.end}` : w.statusLabel}</span>
            <div className="col-span-2 h-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-label={`${s.warehouseLabel} shift elapsed`} aria-valuenow={w.percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${w.percent}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {windows.length > shown.length ? <p className="mt-1.5 text-[11px] text-faint">+{windows.length - shown.length} more · select one warehouse for its full shift clock</p> : null}
    </div>
  );
}

function ShiftClock({ shift }: { readonly shift: ShiftInfo }) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const w = shiftWindow({ now, timeZone: shift.timeZone, start: shift.start, end: shift.end });
  return (
    <div className="rounded-lg bg-surface-sunken/60 px-3.5 py-3" data-testid="shift-clock">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-secondary">Day shift · {w.dateLabel}</span>
        <span className="text-[13px] font-semibold tabular-nums">
          {w.phase === "during" ? <><span className="text-success">{w.nowLabel}</span><span className="text-faint"> – {shift.end}</span></> : <span className="text-secondary">{w.statusLabel}</span>}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Shift elapsed" aria-valuenow={w.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${w.percent}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span className="inline-flex items-center gap-1"><Sun className="h-3 w-3 text-warning" aria-hidden />{shift.start}</span>
        <span className="truncate px-2">{shift.warehouseLabel} · {shift.timeZone.replace("_", " ")}</span>
        <span className="inline-flex items-center gap-1">{shift.end}<Moon className="h-3 w-3 text-primary" aria-hidden /></span>
      </div>
    </div>
  );
}

/** Tasks: no single grid filter can express "open OR completed today", so each half links to exactly its count. */
function SplitProgressRow({ label, verb, p }: { readonly label: string; readonly verb: string; readonly p: Progress & { doneHref: string; openHref: string } }) {
  const pct = pctOf(p.done, p.total);
  const open = Math.max(p.total - p.done, 0);
  const link = "rounded px-1 -mx-1 hover:bg-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
  return (
    <div className="rounded-lg px-1 py-1.5 -mx-1" data-testid="progress-tasks">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <span className="text-[12px] text-secondary"><span className="text-[15px] font-semibold text-foreground tabular-nums">{pct}%</span> {verb}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-[#17874D]" style={{ width: `${pct}%` }} /></div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] tabular-nums text-faint">
        <span>
          <Link href={p.doneHref} className={link} title="Open the tasks completed today" data-testid="progress-tasks-done"><span className="font-semibold text-success">{fmt(p.done)}</span> completed today</Link>
          <span aria-hidden> · </span>
          <Link href={p.openHref} className={link} title="Open the pending and started tasks" data-testid="progress-tasks-open"><span className="font-semibold text-foreground">{fmt(open)}</span> open</Link>
        </span>
        <span>of {fmt(p.total)}</span>
      </div>
    </div>
  );
}

/** Bar + one exact drilldown per part: every linked number equals the Total of the grid it opens. */
function PartsProgressRow({ label, verb, p, hint, testId }: { readonly label: string; readonly verb: string; readonly p: Progress & { parts: NonNullable<Progress["parts"]> }; readonly hint?: string; readonly testId?: string }) {
  const pct = pctOf(p.done, p.total);
  const link = "rounded px-1 -mx-1 hover:bg-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
  return (
    <div className="rounded-lg px-1 py-1.5 -mx-1" data-testid={testId} title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <span className="text-[12px] text-secondary"><span className="text-[15px] font-semibold text-foreground tabular-nums">{pct}%</span> {verb}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-[#17874D]" style={{ width: `${pct}%` }} /></div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11.5px] tabular-nums text-faint">
        <span className="flex flex-wrap items-baseline gap-x-1">
          {p.parts.map((part, i) => (
            <React.Fragment key={part.label}>
              {i > 0 ? <span aria-hidden>·</span> : null}
              {part.href ? (
                <Link href={part.href} className={link} title={part.title} data-testid={testId ? `${testId}-part` : undefined} data-count={part.count}>
                  <span className={cn("font-semibold", part.tone === "done" ? "text-success" : "text-foreground")}>{fmt(part.count)}</span> {part.label}
                </Link>
              ) : (
                <span title={part.title} data-testid={testId ? `${testId}-part` : undefined} data-count={part.count}>
                  <span className={cn("font-semibold", part.tone === "done" ? "text-success" : "text-secondary")}>{fmt(part.count)}</span> {part.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </span>
        <span>{fmt(p.done)} of {fmt(p.total)}{p.unit ? ` ${p.unit}` : ""}</span>
      </div>
    </div>
  );
}

function ProgressRow({ label, verb, p, hint, testId }: { readonly label: string; readonly verb: string; readonly p: Progress; readonly hint?: string; readonly testId?: string }) {
  if (p.parts?.length) return <PartsProgressRow label={label} verb={verb} p={{ ...p, parts: p.parts }} hint={hint} testId={testId} />;
  if (p.doneHref && p.openHref) return <SplitProgressRow label={label} verb={verb} p={{ ...p, doneHref: p.doneHref, openHref: p.openHref }} />;
  const pct = pctOf(p.done, p.total);
  return (
    <Link href={p.href} title={hint} className="group block rounded-lg px-1 py-1.5 -mx-1 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <span className="text-[12px] text-secondary"><span className="text-[15px] font-semibold text-foreground tabular-nums">{pct}%</span> {verb}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-[#17874D]" style={{ width: `${pct}%` }} /></div>
      <div className="mt-1 flex items-center justify-between text-[11.5px] tabular-nums text-faint">
        <span><span className="font-semibold text-success">{fmt(p.done)}</span> – {fmt(p.total)}</span>
        <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
    </Link>
  );
}

export function ProgressTodayCard({ data }: { readonly data: LiveDashboard }) {
  return (
    <Panel title="Progress for Today" info="Shows the progress of the tasks, order lines, and orders that have been created today and prior to this day.">
      {data.shift ? <ShiftClock shift={data.shift} /> : (data.shifts?.length ?? 0) > 0 ? <ShiftSummary shifts={data.shifts} /> : (
        <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-[12.5px] text-secondary">No warehouse in your selection has a day shift set.</p>
      )}
      <div className="mt-3 space-y-1">
        <ProgressRow label="Tasks" verb="Completed" p={data.progress.tasks} testId="progress-tasks" />
        <ProgressRow label="Order Lines" verb="Packed" p={data.progress.lines} testId="progress-lines"
          hint="Lines of the backlog orders plus the orders shipped today, split into packed, picked but not packed, and not picked yet." />
        <ProgressRow label="Orders Due Today" verb="Packed or shipped" p={data.progress.ordersToday} testId="progress-due"
          hint="Orders due to ship today or earlier that are still open, plus the orders already shipped today. The three parts add up to the total, and each number opens exactly those orders." />
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- unfulfilled */

const SERIES = [
  { key: "open", label: "Open", color: "var(--chart-3)" },
  { key: "inProgress", label: "In Progress", color: "var(--chart-1)" },
] as const;

/** Unfulfilled backlog by order age: one bar per bucket (they add up to the total), each a drilldown. */
function UnfulfilledAge({ buckets }: { readonly buckets: readonly Metric[] }) {
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const oldest = buckets[buckets.length - 1];
  return (
    <section aria-label="Unfulfilled orders by order age" className="mt-4 border-t border-border pt-3" data-testid="unfulfilled-age">
      <h3 className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
        By order age
        {oldest && oldest.count > 0 ? <span className="normal-case tracking-normal text-danger">{fmt(oldest.count)} waiting 7+ days</span> : null}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {buckets.map((b, i) => (
          <li key={b.label}>
            <Link href={b.href} className="group grid grid-cols-[96px_1fr_44px] items-center gap-2 rounded-md px-1 py-0.5 -mx-1 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" aria-label={`${b.label}: ${b.count} orders`}>
              <span className="text-[12.5px] text-secondary group-hover:text-foreground">{b.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                <span className="block h-full rounded-full" style={{ width: `${b.count > 0 ? Math.max((b.count / max) * 100, 3) : 0}%`, backgroundColor: AGE_COLORS[i] ?? AGE_COLORS[AGE_COLORS.length - 1] }} />
              </span>
              <span className={cn("text-right text-[13px] font-semibold tabular-nums", b.count === 0 ? "text-faint" : "text-foreground group-hover:text-primary")}>{fmt(b.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Fresh → stale: green, blue, amber, red. */
const AGE_COLORS = ["var(--chart-2)", "var(--chart-1)", "var(--chart-3)", "var(--chart-6)"] as const;

export interface DonutArc {
  readonly key: string;
  readonly length: number;
  readonly offset: number;
}

/**
 * Static donut geometry (stroke-dasharray arcs on one circle): no client measurement, so the
 * ring paints in the server HTML before hydration. A 1-slice ring has no gap; with several
 * slices each gets `gap` px of spacing (never more than half its own length).
 */
export function donutArcs(values: readonly { readonly key: string; readonly value: number }[], circumference: number, gap = 3): DonutArc[] {
  const total = values.reduce((a, v) => a + Math.max(0, v.value), 0);
  if (total <= 0) return [];
  const visible = values.filter((v) => v.value > 0);
  let start = 0;
  return visible.map((v) => {
    const full = (v.value / total) * circumference;
    const g = visible.length > 1 ? Math.min(gap, full / 2) : 0;
    const arc = { key: v.key, length: Math.max(full - g, 0), offset: -start };
    start += full;
    return arc;
  });
}

const DONUT_SIZE = 180;
const DONUT_STROKE = 24;
const DONUT_R = (DONUT_SIZE - DONUT_STROKE) / 2 - 2;
const DONUT_C = 2 * Math.PI * DONUT_R;

function UnfulfilledDonut({ slices, total, onToggle }: { readonly slices: readonly { key: string; label: string; color: string; value: number }[]; readonly total: number; readonly onToggle: (key: string) => void }) {
  const [hover, setHover] = React.useState<string | null>(null);
  const arcs = donutArcs(slices, DONUT_C);
  const active = slices.find((s) => s.key === hover);
  return (
    <div className="relative h-[180px] w-[180px] shrink-0" data-testid="unfulfilled-donut">
      <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} width={DONUT_SIZE} height={DONUT_SIZE} role="img" aria-label={`Unfulfilled orders: ${slices.map((s) => `${s.label} ${fmt(s.value)}`).join(", ") || "none"}`}>
        <circle cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_R} fill="none" stroke="var(--border, #E3E6E8)" strokeWidth={DONUT_STROKE} />
        <g transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}>
          {arcs.map((a) => {
            const s = slices.find((x) => x.key === a.key);
            if (!s) return null;
            return (
              <circle
                key={a.key}
                cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_R} fill="none"
                stroke={s.color} strokeWidth={hover === a.key ? DONUT_STROKE + 4 : DONUT_STROKE}
                strokeDasharray={`${a.length} ${DONUT_C}`} strokeDashoffset={a.offset}
                className="cursor-pointer transition-[stroke-width,opacity] duration-150"
                opacity={hover && hover !== a.key ? 0.45 : 1}
                onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)} onClick={() => onToggle(a.key)}
                data-slice={a.key}
              >
                <title>{`${s.label}: ${fmt(s.value)} orders (${pctOf(s.value, total)}%)`}</title>
              </circle>
            );
          })}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-live="polite">
        {active ? (
          <div><div className="text-[11px] text-faint">{active.label}</div><div className="text-[22px] font-semibold tabular-nums">{fmt(active.value)}</div><div className="text-[11px] tabular-nums text-faint">{pctOf(active.value, total)}%</div></div>
        ) : (
          <div><div className="text-[11px] text-faint">Total Order</div><div className="text-[22px] font-semibold tabular-nums">{fmt(total)}</div></div>
        )}
      </div>
    </div>
  );
}

export function UnfulfilledCard({ data }: { readonly data: LiveDashboard }) {
  const [hidden, setHidden] = React.useState<readonly string[]>([]);
  const u = data.unfulfilled;
  const slices = SERIES.filter((s) => !hidden.includes(s.key)).map((s) => ({ ...s, value: u[s.key].count }));
  const centerTotal = slices.reduce((a, s) => a + s.value, 0);
  const rows: { m: Metric; color?: string }[] = [{ m: u.total }, { m: u.open, color: SERIES[0].color }, { m: u.inProgress, color: SERIES[1].color }];
  const toggle = (key: string) => setHidden((h) => (h.includes(key) ? h.filter((x) => x !== key) : [...h, key]));
  return (
    <Panel title="Unfulfilled Orders" info="Total number of orders with no action taken, regardless of a specific time interval.">
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <UnfulfilledDonut slices={slices} total={centerTotal} onToggle={toggle} />
        <div className="w-full min-w-0">
          <div className="mb-2 flex gap-2" role="group" aria-label="Toggle series">
            {SERIES.map((s) => {
              const off = hidden.includes(s.key);
              return (
                <button key={s.key} type="button" aria-pressed={!off} onClick={() => toggle(s.key)}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30", off ? "border-border text-faint line-through" : "border-border-strong/50 text-foreground")}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: off ? "var(--border-strong)" : s.color }} />{s.label}
                </button>
              );
            })}
          </div>
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-[0.05em] text-faint"><th className="py-1 font-semibold" /><th className="py-1 text-right font-semibold">Total Order</th><th className="py-1 text-right font-semibold">Total Pack Qty</th></tr></thead>
            <tbody>
              {rows.map(({ m, color }) => (
                <tr key={m.label} className="border-t border-border">
                  <td className="py-1.5"><span className="inline-flex items-center gap-1.5 font-medium">{color ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> : null}{m.label}</span></td>
                  <td className="py-1.5 text-right tabular-nums"><Link className="font-semibold text-primary hover:underline" href={m.href}>{fmt(m.count)}</Link></td>
                  <td className="py-1.5 text-right tabular-nums text-secondary">{fmt(m.packQty ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <UnfulfilledAge buckets={data.unfulfilledAge ?? []} />
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- breakdown */

function BreakdownItem({ m }: { readonly m: Metric }) {
  return (
    <li>
      <Link href={m.href} className="group flex items-center justify-between rounded-md px-2 py-1.5 -mx-2 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" aria-label={`${m.label}: ${m.count} orders`}>
        <span className="text-[13px] text-secondary group-hover:text-foreground">{m.label}</span>
        <span className={cn("text-[16px] font-semibold tabular-nums", m.count === 0 ? "text-faint" : "text-foreground group-hover:text-primary")}>{fmt(m.count)}</span>
      </Link>
    </li>
  );
}

export function StatusBreakdownCard({ data }: { readonly data: LiveDashboard }) {
  return (
    <Panel title="Order Breakdown by Status" info="Shows the number of orders according to their current status. Every value opens the matching orders.">
      {/* Wide screens: Logiwa's 4 grouped columns. Narrower: one continuous list in 1-2 columns, so groups of different length leave no holes. */}
      <div className="hidden gap-x-6 gap-y-2 xl:grid xl:grid-cols-4" data-testid="breakdown-columns">
        {data.breakdown.map((col, i) => (
          <ul key={i} className={cn("space-y-0.5", i > 0 && "border-l border-border pl-6")}>
            {col.map((m) => <BreakdownItem key={m.label} m={m} />)}
          </ul>
        ))}
      </div>
      <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 xl:hidden" data-testid="breakdown-list">
        {data.breakdown.flat().map((m) => <BreakdownItem key={m.label} m={m} />)}
      </ul>
      {data.backlogTotal ? (
        <p className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-2.5 text-[12px] text-faint" data-testid="breakdown-total">
          <span>The backlog status lines add up to the backlog total, the same orders the Channels, Clients and Order By Country cards rank.</span>
          <Link href={data.backlogTotal.href} className="shrink-0 rounded px-1 -mx-1 font-medium text-secondary hover:bg-primary/5 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            Backlog orders <span className="font-semibold tabular-nums text-foreground">{fmt(data.backlogTotal.count)}</span>
          </Link>
        </p>
      ) : null}
    </Panel>
  );
}

/* --------------------------------------------------------------------- ranks */

const RANK_ICONS = { store: Store, users: Users, truck: Truck, globe: Globe2 } as const;

/** Rank numbers for ranked rows only: "Others" and the muted empty bucket are never numbered. */
export function rankNumbers(rows: readonly Pick<RankRow, "name" | "muted">[]): (number | null)[] {
  let n = 0;
  return rows.map((r) => (r.muted || r.name === "Others" ? null : (n += 1)));
}

export interface RankMode {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly rows: readonly RankRow[];
  readonly empty: string;
}

export function RankCard({ title, description, icon, rows, modes }: { readonly title: string; readonly description: string; readonly icon: keyof typeof RANK_ICONS; readonly rows: readonly RankRow[]; readonly modes?: readonly RankMode[] }) {
  const Icon = RANK_ICONS[icon];
  const [modeKey, setModeKey] = React.useState(modes?.[0]?.key ?? "");
  const mode = modes?.find((m) => m.key === modeKey);
  const shown = mode?.rows ?? rows;
  const numbers = rankNumbers(shown);
  const ranked = shown.filter((r) => !r.muted);
  const muted = shown.filter((r) => r.muted);
  return (
    <Panel
      title={title}
      description={mode?.description ?? description}
      action={<span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden /></span>}
    >
      {modes && modes.length > 1 ? (
        <div className="mb-2">
          <SegmentedControl<string> size="sm" ariaLabel={`${title}: rank by`} value={modeKey} onChange={setModeKey} options={modes.map((m) => ({ value: m.key, label: m.label }))} />
        </div>
      ) : null}
      {shown.length === 0 ? <p className="py-6 text-center text-[12.5px] text-faint">{mode?.empty ?? "No backlog orders in this selection."}</p> : (
        <>
          {ranked.length === 0 ? <p className="py-3 text-center text-[12.5px] text-faint">No ranked values yet.</p> : null}
          <ol className="space-y-1">
            {ranked.map((r) => <RankItem key={r.name} r={r} n={numbers[shown.indexOf(r)] ?? null} />)}
          </ol>
          {muted.map((r) => (
            <div key={r.name} className="mt-2 border-t border-border pt-2" data-testid="rank-unassigned">
              {r.href ? (
                <Link href={r.href} className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1 -mx-2 text-[12px] text-faint hover:bg-primary/5 hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                  <span className="truncate italic">{r.name}</span>
                  <span className="shrink-0 tabular-nums"><span className="font-semibold text-secondary">{fmt(r.count)}</span> · {r.pct}%</span>
                </Link>
              ) : null}
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}

function RankItem({ r, n }: { readonly r: RankRow; readonly n: number | null }) {
  const body = (
    <>
      <span className="w-4 shrink-0 text-[12px] font-semibold text-faint tabular-nums">{n ?? ""}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{r.name}</span>
          <span className="text-[13px] font-semibold tabular-nums">{fmt(r.count)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${r.pct}%` }} /></span>
          <span className="w-12 text-right text-[11px] text-faint tabular-nums" title={`${r.pct}% of all orders counted on this card`}>{r.pct}%</span>
        </span>
      </span>
    </>
  );
  return (
    <li>
      {r.href ? (
        <Link href={r.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{body}</Link>
      ) : <div className="flex items-center gap-2 px-0 py-1.5" title="Remaining entries combined">{body}</div>}
    </li>
  );
}

/* ---------------------------------------------------------------------- jobs */

type JobTab = "priority" | "status" | "type";

/** What each tab counts (the Status tab also holds today's completed jobs). */
const JOB_TAB_SCOPE: Readonly<Record<JobTab, string>> = {
  priority: "Open jobs (Pending and Started)",
  status: "Open jobs plus jobs completed today",
  type: "Open jobs (Pending and Started)",
};

export function JobsCard({ data }: { readonly data: LiveDashboard }) {
  const [tab, setTab] = React.useState<JobTab>("priority");
  const rows: readonly JobRow[] = data.jobs[tab];
  return (
    <Panel
      title="Jobs"
      description="You can manage and review the details of the jobs with the tabs on the right."
      action={<SegmentedControl<JobTab> size="sm" ariaLabel="Group jobs by" value={tab} onChange={setTab} options={[{ value: "priority", label: "Priority" }, { value: "status", label: "Status" }, { value: "type", label: "Type" }]} />}
    >
      <p className="mb-1.5 flex items-baseline justify-between gap-2 text-[11.5px] text-faint" data-testid="jobs-scope">
        <span>{JOB_TAB_SCOPE[tab]}</span>
        <span className="tabular-nums">{fmt(rows.reduce((a, r) => a + r.jobQty, 0))} jobs</span>
      </p>
      {rows.length === 0 ? <p className="py-6 text-center text-[12.5px] text-faint">{tab === "status" ? "No open jobs and none completed today in this selection." : "No open jobs in this selection."}</p> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-faint">
              <th className="py-1.5 font-semibold">Name</th><th className="py-1.5 text-right font-semibold">Product Qty</th><th className="py-1.5 text-right font-semibold">Order Qty</th><th className="py-1.5 pl-4 font-semibold">Percentage</th><th className="py-1.5 text-right font-semibold">Job Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border hover:bg-primary/5">
                <td className="py-2"><Link href={r.href} className={r.muted ? "italic text-secondary hover:underline" : "font-medium text-primary hover:underline"}>{r.name}</Link></td>
                <td className="py-2 text-right tabular-nums">{fmt(r.productQty)}</td>
                <td className="py-2 text-right tabular-nums">{fmt(r.orderQty)}</td>
                <td className="py-2 pl-4"><span className="flex items-center gap-2"><span className="h-1.5 w-24 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-primary" style={{ width: `${r.pct}%` }} /></span><span className="tabular-nums text-secondary">{r.pct}%</span></span></td>
                <td className="py-2 text-right font-semibold tabular-nums">{fmt(r.jobQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ snapshot gaps */

/** "Nov 6, Nov 7 and Nov 8" (runs of 4+ collapse to a range). */
export function describeNights(days: readonly string[]): string {
  const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (days.length === 0) return "";
  if (days.length >= 4) return `${label(days[0] ?? "")} – ${label(days[days.length - 1] ?? "")} (${days.length} nights)`;
  const parts = days.map(label);
  return parts.length === 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Alert for missed nightly inventory snapshots in the selected warehouses (last 7 nights),
 * so a gap in the daily audit trail is visible the morning after, not weeks later.
 */
export function SnapshotGapAlert({ gaps }: { readonly gaps: readonly SnapshotGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <div role="alert" data-testid="snapshot-gap-alert" className="flex items-start gap-2.5 rounded-lg border border-warning/35 bg-warning-soft/60 px-3.5 py-2.5 text-[13px] leading-5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">Nightly inventory snapshot missed</p>
        <ul className="mt-0.5 text-secondary">
          {gaps.map((g) => (
            <li key={g.warehouseId}>
              <span className="font-medium text-foreground">{g.warehouse}:</span> no snapshot for {describeNights(g.missingDays)}. The scheduler was not running at 00:02 warehouse time; an admin can rebuild those nights from the inventory ledger on the report.{" "}
              <Link href={g.href} className="font-medium text-primary hover:underline">Open Inventory Snapshot</Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
