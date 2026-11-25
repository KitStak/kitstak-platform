'use client';

/**
 * Dashboard widgets (spec 08 §Dashboard), built on `@kitstak/ui/dashboard`
 * (docs/design/UI-CLEANUP.md). Unlike Logiwa every number drills down: the href comes from the
 * server, built from the same grid grammar the count used. Quantities are drawn in the WMS data
 * color (teal), never crimson; status tones appear only where a line that matters is crossed.
 */
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Moon, Sun } from 'lucide-react';
import { EmptyNote, Meter, type DashAction } from '@kitstak/ui/dashboard';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { shiftWindow } from '@/lib/shift';
import { cn } from '@/lib/utils';
import type {
  JobRow,
  LiveDashboard,
  Metric,
  Progress,
  RankRow,
  ShiftInfo,
  SnapshotGap,
} from '@/server/repositories/dashboard-live';
import { Panel, ROW_LINK, fmt, pctOf } from './panel';

export { Panel, PanelFreshnessContext, freshnessLabel, type PanelFreshness } from './panel';
export { UnfulfilledCard, donutArcs, type DonutArc } from './unfulfilled-card';

/** Inline number links inside a progress row. */
const PART_LINK =
  '-mx-1 rounded px-1 hover:bg-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/* ------------------------------------------------------------ progress today */

const SHIFT_SUMMARY_MAX = 4;

function useClock(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Aggregate day shift view: one compact row per selected warehouse (each in its own zone). */
function ShiftSummary({ shifts }: { readonly shifts: readonly ShiftInfo[] }) {
  const now = useClock();
  const windows = shifts.map((s) => ({
    s,
    w: shiftWindow({ now, timeZone: s.timeZone, start: s.start, end: s.end }),
  }));
  const during = windows.filter((x) => x.w.phase === 'during').length;
  const shown = windows.slice(0, SHIFT_SUMMARY_MAX);
  return (
    <div className="border-b border-border pb-3" data-testid="shift-summary">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-secondary">Day shift · {shifts.length} warehouses</span>
        <span className="tabular-nums text-secondary">{during} on shift</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {shown.map(({ s, w }) => (
          <li key={s.warehouseId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-2xs">
            <span className="truncate text-foreground" title={`${s.warehouseLabel} · ${s.timeZone.replace('_', ' ')}`}>
              {s.warehouseLabel}
            </span>
            <span className={cn('tabular-nums', w.phase === 'during' ? 'text-foreground' : 'text-faint')}>
              {w.phase === 'during' ? `${w.nowLabel} to ${s.end}` : w.statusLabel}
            </span>
            <Meter className="col-span-2" value={w.percent / 100} label={`${s.warehouseLabel} shift elapsed`} />
          </li>
        ))}
      </ul>
      {windows.length > shown.length ? (
        <p className="mt-1.5 text-2xs text-faint">
          +{windows.length - shown.length} more · select one warehouse for its full shift clock
        </p>
      ) : null}
    </div>
  );
}

function ShiftClock({ shift }: { readonly shift: ShiftInfo }) {
  const now = useClock();
  const w = shiftWindow({ now, timeZone: shift.timeZone, start: shift.start, end: shift.end });
  return (
    <div className="border-b border-border pb-3" data-testid="shift-clock">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-secondary">Day shift · {w.dateLabel}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {w.phase === 'during' ? (
            <>
              {w.nowLabel}
              <span className="font-normal text-faint"> to {shift.end}</span>
            </>
          ) : (
            <span className="text-secondary">{w.statusLabel}</span>
          )}
        </span>
      </div>
      <Meter className="mt-2" value={w.percent / 100} label="Shift elapsed" />
      <div className="mt-1.5 flex justify-between text-2xs text-faint">
        <span className="inline-flex items-center gap-1">
          <Sun className="h-3 w-3" aria-hidden />
          {shift.start}
        </span>
        <span className="truncate px-2">
          {shift.warehouseLabel} · {shift.timeZone.replace('_', ' ')}
        </span>
        <span className="inline-flex items-center gap-1">
          {shift.end}
          <Moon className="h-3 w-3" aria-hidden />
        </span>
      </div>
    </div>
  );
}

/** Label, headline percent and the meter shared by every progress row. */
function ProgressHead({ label, verb, pct }: { readonly label: string; readonly verb: string; readonly pct: number }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-secondary">
          <span className="text-base font-semibold tabular-nums text-foreground">{pct}%</span> {verb.toLowerCase()}
        </span>
      </div>
      <Meter className="mt-1" value={pct / 100} label={`${label}: ${pct}% ${verb.toLowerCase()}`} />
    </>
  );
}

/** Tasks: no single grid filter can express "open OR completed today", so each half links to exactly its count. */
function SplitProgressRow({
  label,
  verb,
  p,
}: {
  readonly label: string;
  readonly verb: string;
  readonly p: Progress & { doneHref: string; openHref: string };
}) {
  const pct = pctOf(p.done, p.total);
  const open = Math.max(p.total - p.done, 0);
  return (
    <div className="py-1.5" data-testid="progress-tasks">
      <ProgressHead label={label} verb={verb} pct={pct} />
      <div className="mt-1 flex items-center justify-between gap-2 text-2xs tabular-nums text-faint">
        <span>
          <Link href={p.doneHref} className={PART_LINK} title="Open the tasks completed today" data-testid="progress-tasks-done">
            <span className="font-semibold text-foreground">{fmt(p.done)}</span> completed today
          </Link>
          <span aria-hidden> · </span>
          <Link href={p.openHref} className={PART_LINK} title="Open the pending and started tasks" data-testid="progress-tasks-open">
            <span className="font-semibold text-foreground">{fmt(open)}</span> open
          </Link>
        </span>
        <span>of {fmt(p.total)}</span>
      </div>
    </div>
  );
}

/** Meter + one exact drilldown per part: every linked number equals the Total of the grid it opens. */
function PartsProgressRow({
  label,
  verb,
  p,
  hint,
  testId,
}: {
  readonly label: string;
  readonly verb: string;
  readonly p: Progress & { parts: NonNullable<Progress['parts']> };
  readonly hint?: string;
  readonly testId?: string;
}) {
  const pct = pctOf(p.done, p.total);
  return (
    <div className="py-1.5" data-testid={testId} title={hint}>
      <ProgressHead label={label} verb={verb} pct={pct} />
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-2xs tabular-nums text-faint">
        <span className="flex flex-wrap items-baseline gap-x-1">
          {p.parts.map((part, i) => (
            <React.Fragment key={part.label}>
              {i > 0 ? <span aria-hidden>·</span> : null}
              {part.href ? (
                <Link
                  href={part.href}
                  className={PART_LINK}
                  title={part.title}
                  data-testid={testId ? `${testId}-part` : undefined}
                  data-count={part.count}
                >
                  <span className="font-semibold text-foreground">{fmt(part.count)}</span> {part.label}
                </Link>
              ) : (
                <span title={part.title} data-testid={testId ? `${testId}-part` : undefined} data-count={part.count}>
                  <span className="font-semibold text-secondary">{fmt(part.count)}</span> {part.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </span>
        <span>
          {fmt(p.done)} of {fmt(p.total)}
          {p.unit ? ` ${p.unit}` : ''}
        </span>
      </div>
    </div>
  );
}

function ProgressRow({
  label,
  verb,
  p,
  hint,
  testId,
}: {
  readonly label: string;
  readonly verb: string;
  readonly p: Progress;
  readonly hint?: string;
  readonly testId?: string;
}) {
  if (p.parts?.length)
    return <PartsProgressRow label={label} verb={verb} p={{ ...p, parts: p.parts }} hint={hint} testId={testId} />;
  if (p.doneHref && p.openHref)
    return <SplitProgressRow label={label} verb={verb} p={{ ...p, doneHref: p.doneHref, openHref: p.openHref }} />;
  const pct = pctOf(p.done, p.total);
  return (
    <Link href={p.href} title={hint} className={cn('-mx-1 block px-1 py-1.5', ROW_LINK)} data-testid={testId}>
      <ProgressHead label={label} verb={verb} pct={pct} />
      <div className="mt-1 text-2xs tabular-nums text-faint">
        <span className="font-semibold text-foreground">{fmt(p.done)}</span> of {fmt(p.total)}
      </div>
    </Link>
  );
}

export function ProgressTodayCard({ data }: { readonly data: LiveDashboard }) {
  return (
    <Panel title="Progress for today" description="Work created today and earlier that is still in play">
      {data.shift ? (
        <ShiftClock shift={data.shift} />
      ) : (data.shifts?.length ?? 0) > 0 ? (
        <ShiftSummary shifts={data.shifts} />
      ) : (
        <p className="border-b border-border pb-3 text-xs text-secondary">
          No warehouse in your selection has a day shift set.{' '}
          <Link href="/settings/warehouses" className="font-medium text-foreground underline underline-offset-2">
            Set shift hours
          </Link>
        </p>
      )}
      <div className="mt-2 space-y-0.5">
        <ProgressRow label="Tasks" verb="Completed" p={data.progress.tasks} testId="progress-tasks" />
        <ProgressRow
          label="Order lines"
          verb="Packed"
          p={data.progress.lines}
          testId="progress-lines"
          hint="Lines of the backlog orders plus the orders shipped today, split into packed, picked but not packed, and not picked yet."
        />
        <ProgressRow
          label="Orders due today"
          verb="Packed or shipped"
          p={data.progress.ordersToday}
          testId="progress-due"
          hint="Orders due to ship today or earlier that are still open, plus the orders already shipped today. The three parts add up to the total, and each number opens exactly those orders."
        />
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- breakdown */

/** Server labels are grid terms ("Already Shipped Today"); the card shows them in sentence case. */
const BREAKDOWN_LABELS: Readonly<Record<string, string>> = {
  'Cancelled Today': 'Cancelled today',
  'Already Shipped Today': 'Already shipped today',
  'Orders to be Shipped Today': 'To ship today',
  'Orders to be Shipped Tomorrow': 'To ship tomorrow',
};

function BreakdownItem({ m }: { readonly m: Metric }) {
  const label = BREAKDOWN_LABELS[m.label] ?? m.label;
  return (
    <li>
      <Link
        href={m.href}
        className={cn('group -mx-2 flex items-center justify-between px-2 py-1.5', ROW_LINK)}
        aria-label={`${label}: ${m.count} orders`}
      >
        <span className="text-sm text-secondary group-hover:text-foreground">{label}</span>
        <span
          className={cn(
            'text-md font-semibold tabular-nums group-hover:underline',
            m.count === 0 ? 'text-faint' : 'text-foreground',
          )}
        >
          {fmt(m.count)}
        </span>
      </Link>
    </li>
  );
}

export function StatusBreakdownCard({ data }: { readonly data: LiveDashboard }) {
  return (
    <Panel
      title="Order breakdown by status"
      description="Every value opens the matching orders"
      footer={
        data.backlogTotal ? (
          <p className="flex flex-wrap items-baseline justify-between gap-2" data-testid="breakdown-total">
            <span>
              The backlog statuses add up to the backlog total, the same orders the Channels, Clients and Order by
              country cards rank.
            </span>
            <Link
              href={data.backlogTotal.href}
              className="shrink-0 font-medium text-secondary hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Backlog orders{' '}
              <span className="font-semibold tabular-nums text-foreground">{fmt(data.backlogTotal.count)}</span>
            </Link>
          </p>
        ) : undefined
      }
    >
      {/* Wide screens: Logiwa's 4 grouped columns. Narrower: one continuous list in 1-2 columns, so groups of different length leave no holes. */}
      <div className="hidden gap-x-6 gap-y-2 xl:grid xl:grid-cols-4" data-testid="breakdown-columns">
        {data.breakdown.map((col, i) => (
          <ul key={i} className={cn('space-y-0.5', i > 0 && 'border-l border-border pl-6')}>
            {col.map((m) => (
              <BreakdownItem key={m.label} m={m} />
            ))}
          </ul>
        ))}
      </div>
      <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 xl:hidden" data-testid="breakdown-list">
        {data.breakdown.flat().map((m) => (
          <BreakdownItem key={m.label} m={m} />
        ))}
      </ul>
    </Panel>
  );
}

/* --------------------------------------------------------------------- ranks */

/** Rank numbers for ranked rows only: "Others" and the muted empty bucket are never numbered. */
export function rankNumbers(rows: readonly Pick<RankRow, 'name' | 'muted'>[]): (number | null)[] {
  let n = 0;
  return rows.map((r) => (r.muted || r.name === 'Others' ? null : (n += 1)));
}

export interface RankMode {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly rows: readonly RankRow[];
  readonly empty: string;
  /** The next step when this mode has no rows. */
  readonly emptyAction?: DashAction;
}

/** Where a backlog rank card sends you when the selection has no backlog orders. */
const BACKLOG_EMPTY_ACTION: DashAction = { label: 'All orders', href: '/orders' };

export function RankCard({
  title,
  description,
  rows,
  modes,
}: {
  readonly title: string;
  readonly description?: string;
  readonly rows: readonly RankRow[];
  readonly modes?: readonly RankMode[];
}) {
  const [modeKey, setModeKey] = React.useState(modes?.[0]?.key ?? '');
  const mode = modes?.find((m) => m.key === modeKey);
  const shown = mode?.rows ?? rows;
  const numbers = rankNumbers(shown);
  const ranked = shown.filter((r) => !r.muted);
  const muted = shown.filter((r) => r.muted);
  return (
    <Panel title={title} description={mode?.description ?? description}>
      {modes && modes.length > 1 ? (
        <div className="mb-2">
          <SegmentedControl<string>
            size="sm"
            ariaLabel={`${title}: rank by`}
            value={modeKey}
            onChange={setModeKey}
            options={modes.map((m) => ({ value: m.key, label: m.label }))}
          />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyNote action={mode?.emptyAction ?? BACKLOG_EMPTY_ACTION}>
          {mode?.empty ?? 'No backlog orders in this selection.'}
        </EmptyNote>
      ) : (
        <>
          {ranked.length === 0 ? <p className="py-3 text-center text-xs text-faint">No ranked values yet.</p> : null}
          <ol className="space-y-0.5">
            {ranked.map((r) => (
              <RankItem key={r.name} r={r} n={numbers[shown.indexOf(r)] ?? null} />
            ))}
          </ol>
          {muted.map((r) => (
            <div key={r.name} className="mt-2 border-t border-border pt-2" data-testid="rank-unassigned">
              {r.href ? (
                <Link
                  href={r.href}
                  className={cn('-mx-2 flex items-baseline justify-between gap-2 px-2 py-1 text-xs text-faint hover:text-secondary', ROW_LINK)}
                >
                  <span className="truncate italic">{r.name}</span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-semibold text-secondary">{fmt(r.count)}</span> · {r.pct}%
                  </span>
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
      <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-faint">{n ?? ''}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{r.name}</span>
          <span className="text-sm font-semibold tabular-nums">{fmt(r.count)}</span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <Meter className="flex-1" value={r.pct / 100} label={`${r.name}: ${r.pct}% of the orders on this card`} />
          <span className="w-12 text-right text-2xs tabular-nums text-faint" title={`${r.pct}% of all orders counted on this card`}>
            {r.pct}%
          </span>
        </span>
      </span>
    </>
  );
  return (
    <li>
      {r.href ? (
        <Link href={r.href} className={cn('-mx-2 flex items-center gap-2 px-2 py-1.5', ROW_LINK)}>
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-2 py-1.5" title="Remaining entries combined">
          {body}
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------------- jobs */

type JobTab = 'priority' | 'status' | 'type';

/** What each tab counts (the Status tab also holds today's completed jobs). */
const JOB_TAB_SCOPE: Readonly<Record<JobTab, string>> = {
  priority: 'Open jobs (Pending and Started)',
  status: 'Open jobs plus jobs completed today',
  type: 'Open jobs (Pending and Started)',
};

export function JobsCard({ data }: { readonly data: LiveDashboard }) {
  const [tab, setTab] = React.useState<JobTab>('priority');
  const rows: readonly JobRow[] = data.jobs[tab];
  return (
    <Panel
      title="Jobs"
      aside={
        <SegmentedControl<JobTab>
          size="sm"
          ariaLabel="Group jobs by"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'priority', label: 'Priority' },
            { value: 'status', label: 'Status' },
            { value: 'type', label: 'Type' },
          ]}
        />
      }
    >
      <p className="mb-1.5 flex items-baseline justify-between gap-2 text-2xs text-faint" data-testid="jobs-scope">
        <span>{JOB_TAB_SCOPE[tab]}</span>
        <span className="tabular-nums">{fmt(rows.reduce((a, r) => a + r.jobQty, 0))} jobs</span>
      </p>
      {rows.length === 0 ? (
        <EmptyNote action={{ label: 'All jobs', href: '/jobs' }}>
          {tab === 'status'
            ? 'No open jobs and none completed today in this selection.'
            : 'No open jobs in this selection.'}
        </EmptyNote>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-2xs text-faint">
              <th className="py-1.5 font-semibold">Name</th>
              <th className="py-1.5 text-right font-semibold">Product qty</th>
              <th className="py-1.5 text-right font-semibold">Order qty</th>
              <th className="py-1.5 pl-4 font-semibold">Share of jobs</th>
              <th className="py-1.5 text-right font-semibold">Job qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border hover:bg-hover">
                <td className="py-2">
                  <Link
                    href={r.href}
                    className={cn(
                      'hover:underline',
                      r.muted ? 'italic text-secondary' : 'font-medium text-foreground',
                    )}
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="py-2 text-right tabular-nums">{fmt(r.productQty)}</td>
                <td className="py-2 text-right tabular-nums">{fmt(r.orderQty)}</td>
                <td className="py-2 pl-4">
                  <span className="flex items-center gap-2">
                    <Meter className="w-24" value={r.pct / 100} label={`${r.name}: ${r.pct}% of jobs`} />
                    <span className="tabular-nums text-secondary">{r.pct}%</span>
                  </span>
                </td>
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
  const label = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  if (days.length === 0) return '';
  if (days.length >= 4)
    return `${label(days[0] ?? '')} to ${label(days[days.length - 1] ?? '')} (${days.length} nights)`;
  const parts = days.map(label);
  return parts.length === 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Alert for missed nightly inventory snapshots in the selected warehouses (last 7 nights),
 * so a gap in the daily audit trail is visible the morning after, not weeks later.
 */
export function SnapshotGapAlert({ gaps }: { readonly gaps: readonly SnapshotGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="snapshot-gap-alert"
      className="flex items-start gap-2.5 rounded-lg border border-warning/35 bg-warning-soft/60 px-3.5 py-2.5 text-sm leading-5"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">Nightly inventory snapshot missed</p>
        <ul className="mt-0.5 text-secondary">
          {gaps.map((g) => (
            <li key={g.warehouseId}>
              <span className="font-medium text-foreground">{g.warehouse}:</span> no snapshot for{' '}
              {describeNights(g.missingDays)}. The scheduler was not running at 00:02 warehouse time; an admin
              can rebuild those nights from the inventory ledger on the report.{' '}
              <Link href={g.href} className="font-medium text-foreground underline underline-offset-2">
                Open inventory snapshot
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
