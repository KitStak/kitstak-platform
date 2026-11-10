"use client";

/**
 * Dashboard widgets (spec 08 §Dashboard). Unlike Logiwa every number drills down: the
 * href comes from the server, built from the same grid grammar the count used.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronRight, Globe2, Moon, Store, Sun, Truck, Users } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip } from "recharts";
import { InfoTip } from "@/components/ui/info-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { shiftWindow } from "@/lib/shift";
import { cn } from "@/lib/utils";
import type { JobRow, LiveDashboard, Metric, Progress, RankRow, ShiftInfo } from "@/server/repositories/dashboard-live";

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);
const pctOf = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

export function Panel({ title, info, description, action, children, className }: {
  readonly title: string; readonly info?: string; readonly description?: string; readonly action?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string;
}) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-xs", className)}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">{title}{info ? <InfoTip content={info} label={`About ${title}`} /> : null}</h2>
          {description ? <p className="mt-0.5 text-[12px] text-faint">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="flex-1 px-5 pb-4">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------ progress today */

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
          {w.phase === "during" ? <><span className="text-[#17874D]">{w.nowLabel}</span><span className="text-faint"> – {shift.end}</span></> : <span className="text-secondary">{w.statusLabel}</span>}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Shift elapsed" aria-valuenow={w.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${w.percent}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span className="inline-flex items-center gap-1"><Sun className="h-3 w-3 text-[#EBAC00]" aria-hidden />{shift.start}</span>
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
          <Link href={p.doneHref} className={link} title="Open the tasks completed today" data-testid="progress-tasks-done"><span className="font-semibold text-[#17874D]">{fmt(p.done)}</span> completed today</Link>
          <span aria-hidden> · </span>
          <Link href={p.openHref} className={link} title="Open the pending and started tasks" data-testid="progress-tasks-open"><span className="font-semibold text-foreground">{fmt(open)}</span> open</Link>
        </span>
        <span>of {fmt(p.total)}</span>
      </div>
    </div>
  );
}

function ProgressRow({ label, verb, p }: { readonly label: string; readonly verb: string; readonly p: Progress }) {
  if (p.doneHref && p.openHref) return <SplitProgressRow label={label} verb={verb} p={{ ...p, doneHref: p.doneHref, openHref: p.openHref }} />;
  const pct = pctOf(p.done, p.total);
  return (
    <Link href={p.href} className="group block rounded-lg px-1 py-1.5 -mx-1 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <span className="text-[12px] text-secondary"><span className="text-[15px] font-semibold text-foreground tabular-nums">{pct}%</span> {verb}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-[#17874D]" style={{ width: `${pct}%` }} /></div>
      <div className="mt-1 flex items-center justify-between text-[11.5px] tabular-nums text-faint">
        <span><span className="font-semibold text-[#17874D]">{fmt(p.done)}</span> – {fmt(p.total)}</span>
        <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
    </Link>
  );
}

export function ProgressTodayCard({ data }: { readonly data: LiveDashboard }) {
  return (
    <Panel title="Progress for Today" info="Shows the progress of the tasks, order lines, and orders that have been created today and prior to this day.">
      {data.shift ? <ShiftClock shift={data.shift} /> : (
        <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-[12.5px] text-secondary">Select just one warehouse to see Day Shift data.</p>
      )}
      <div className="mt-3 space-y-1">
        <ProgressRow label="Tasks" verb="Completed" p={data.progress.tasks} />
        <ProgressRow label="Order Lines" verb="Packed" p={data.progress.lines} />
        <ProgressRow label="Orders to be Shipped Today" verb="Packed" p={data.progress.ordersToday} />
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- unfulfilled */

const SERIES = [
  { key: "open", label: "Open", color: "#E0A500" },
  { key: "inProgress", label: "In Progress", color: "#2E5CE6" },
] as const;

export function UnfulfilledCard({ data }: { readonly data: LiveDashboard }) {
  const [hidden, setHidden] = React.useState<readonly string[]>([]);
  const u = data.unfulfilled;
  const slices = SERIES.filter((s) => !hidden.includes(s.key)).map((s) => ({ ...s, value: u[s.key].count }));
  const centerTotal = slices.reduce((a, s) => a + s.value, 0);
  const rows: { m: Metric; color?: string }[] = [{ m: u.total }, { m: u.open, color: SERIES[0].color }, { m: u.inProgress, color: SERIES[1].color }];
  return (
    <Panel title="Unfulfilled Orders" info="Total number of orders with no action taken, regardless of a specific time interval.">
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <div className="relative h-[180px] w-[180px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices.length && centerTotal ? slices : [{ key: "empty", label: "None", value: 1, color: "#E3E6E8" }]} dataKey="value" nameKey="label" innerRadius={60} outerRadius={84} paddingAngle={slices.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
                {(slices.length && centerTotal ? slices : [{ color: "#E3E6E8" }]).map((s, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
              {centerTotal ? <ChartTooltip formatter={(v) => fmt(Number(v))} /> : null}
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div><div className="text-[11px] text-faint">Total Order</div><div className="text-[22px] font-semibold tabular-nums">{fmt(centerTotal)}</div></div>
          </div>
        </div>
        <div className="w-full min-w-0">
          <div className="mb-2 flex gap-2" role="group" aria-label="Toggle series">
            {SERIES.map((s) => {
              const off = hidden.includes(s.key);
              return (
                <button key={s.key} type="button" aria-pressed={!off} onClick={() => setHidden((h) => (off ? h.filter((x) => x !== s.key) : [...h, s.key]))}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30", off ? "border-border text-faint line-through" : "border-border-strong/50 text-foreground")}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: off ? "#C9CDD2" : s.color }} />{s.label}
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
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- breakdown */

export function StatusBreakdownCard({ data }: { readonly data: LiveDashboard }) {
  return (
    <Panel title="Order Breakdown by Status" info="Shows the number of orders according to their current status. Every value opens the matching orders.">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
        {data.breakdown.map((col, i) => (
          <ul key={i} className={cn("space-y-0.5", i > 0 && "xl:border-l xl:border-border xl:pl-6")}>
            {col.map((m) => (
              <li key={m.label}>
                <Link href={m.href} className="group flex items-center justify-between rounded-md px-2 py-1.5 -mx-2 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" aria-label={`${m.label}: ${m.count} orders`}>
                  <span className="text-[13px] text-secondary group-hover:text-foreground">{m.label}</span>
                  <span className={cn("text-[16px] font-semibold tabular-nums", m.count === 0 ? "text-faint" : "text-foreground group-hover:text-primary")}>{fmt(m.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------------- ranks */

const RANK_ICONS = { store: Store, users: Users, truck: Truck, globe: Globe2 } as const;

export function RankCard({ title, description, icon, rows }: { readonly title: string; readonly description: string; readonly icon: keyof typeof RANK_ICONS; readonly rows: readonly RankRow[] }) {
  const Icon = RANK_ICONS[icon];
  return (
    <Panel title={title} description={description} action={<span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden /></span>}>
      {rows.length === 0 ? <p className="py-6 text-center text-[12.5px] text-faint">No unfulfilled orders in this selection.</p> : (
        <ol className="space-y-1">
          {rows.map((r, i) => {
            const body = (
              <>
                <span className="w-4 shrink-0 text-[12px] font-semibold text-faint tabular-nums">{r.name === "Others" ? "" : i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{r.name}</span>
                    <span className="text-[13px] font-semibold tabular-nums">{fmt(r.count)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${r.pct}%` }} /></span>
                    <span className="w-12 text-right text-[11px] text-faint tabular-nums" title={`${r.pct}% of all unfulfilled orders`}>{r.pct}%</span>
                  </span>
                </span>
              </>
            );
            return (
              <li key={r.name}>
                {r.href ? (
                  <Link href={r.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{body}</Link>
                ) : <div className="flex items-center gap-2 px-0 py-1.5" title="Remaining entries combined">{body}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------------- jobs */

type JobTab = "priority" | "status" | "type";

export function JobsCard({ data }: { readonly data: LiveDashboard }) {
  const [tab, setTab] = React.useState<JobTab>("priority");
  const rows: readonly JobRow[] = data.jobs[tab];
  return (
    <Panel
      title="Jobs"
      description="You can manage and review the details of the jobs with the tabs on the right."
      action={<SegmentedControl<JobTab> size="sm" ariaLabel="Group jobs by" value={tab} onChange={setTab} options={[{ value: "priority", label: "Priority" }, { value: "status", label: "Status" }, { value: "type", label: "Type" }]} />}
    >
      {rows.length === 0 ? <p className="py-6 text-center text-[12.5px] text-faint">No open jobs in this selection.</p> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-faint">
              <th className="py-1.5 font-semibold">Name</th><th className="py-1.5 text-right font-semibold">Product Qty</th><th className="py-1.5 text-right font-semibold">Order Qty</th><th className="py-1.5 pl-4 font-semibold">Percentage</th><th className="py-1.5 text-right font-semibold">Job Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border hover:bg-primary/5">
                <td className="py-2"><Link href={r.href} className="font-medium text-primary hover:underline">{r.name}</Link></td>
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
