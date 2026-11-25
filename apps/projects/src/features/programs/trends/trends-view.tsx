'use client';
/**
 * Trends layout of the Programs directory (docs/programs/SPEC.md 5.19): months as columns (the
 * last 12, scrolling), programs as rows grouped by customer with a subtotal row, a totals row per
 * unit label, a metric toggle and Export CSV. A cell opens that program's statement for the month.
 */
import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Download } from 'lucide-react';
import { Button, EmptyState, ToggleGroup, buttonVariants, cn } from '@/components/ui';
import { apiPath } from '@/lib/api-client';
import { useProgramTrends } from '@/lib/hooks/use-programs';
import type { IsoMonth, ProgramListItemDTO } from '@/lib/program-types';
import { ProgramIcon, programHref } from '@/features/programs/kit';
import { cellText, emptyCell, last12, monthLabel, trendsTable, type TrendsLine, type TrendsMetric } from './trends-model';

export interface TrendsViewProps {
  readonly programs: readonly ProgramListItemDTO[];
  readonly month: IsoMonth;
  readonly metric: TrendsMetric;
  readonly onMetricChange: (metric: TrendsMetric) => void;
}

/**
 * Column sizes. Month columns share the room between the frozen Program column and the frozen
 * 12 months column, so a whole number of months is always in view and none is cut in half.
 */
interface Layout {
  readonly left: number;
  readonly total: number;
  readonly month: number;
  /** Months in view at once. */
  readonly shown: number;
  /** The 12 months column stays on the right (wide screens). */
  readonly stickyTotal: boolean;
}

const MIN_MONTH = 104;

export function trendsLayout(width: number): Layout {
  const narrow = width < 640;
  const left = narrow ? 148 : 240;
  const total = 132;
  const stickyTotal = !narrow;
  const room = Math.max(MIN_MONTH, width - left - (stickyTotal ? total : 0));
  const shown = Math.max(1, Math.min(12, Math.floor(room / MIN_MONTH)));
  return { left, total, month: Math.floor(room / shown), shown, stickyTotal };
}

/** Frozen column edge: an opaque fill plus a soft shadow so scrolled cells pass under it. */
const FROZEN_LEFT = 'sticky left-0 z-10 shadow-[1px_0_0_var(--color-border-subtle),6px_0_8px_-6px_rgb(0_0_0/0.18)]';
const FROZEN_RIGHT = 'sticky right-0 z-10 shadow-[-1px_0_0_var(--color-border-subtle),-6px_0_8px_-6px_rgb(0_0_0/0.18)]';

/** Each kind of row paints its own opaque fill, so the frozen cells never show what is under them. */
function rowFill(kind: TrendsLine['kind']): string {
  return kind === 'program' ? 'bg-panel' : kind === 'subtotal' ? 'bg-sunken' : 'bg-muted';
}

function Cell({ line, index, metric, href, width }: { readonly line: TrendsLine; readonly index: number; readonly metric: TrendsMetric; readonly href: string | null; readonly width: number }) {
  const cell = line.cells[index]!;
  const text = cellText(cell, line.unit, metric);
  const empty = emptyCell(cell);
  const style: CSSProperties = { width, minWidth: width, maxWidth: width };
  // Empty months stay quiet: blank in program rows, a muted zero only in the totals.
  const body = empty ? (
    line.kind === 'total' ? <span className="text-xs text-fg-muted">{cellText(cell, line.unit, 'units').units}</span> : <span className="sr-only">Nothing</span>
  ) : (
    <span className="flex flex-col items-end leading-tight">
      {text.units ? <span className={cn(metric === 'both' ? 'text-xs text-fg-secondary' : 'text-sm text-fg')}>{text.units}</span> : null}
      {text.money ? <span className="text-sm font-medium text-fg">{text.money}</span> : null}
    </span>
  );
  const base = 'block w-full px-3 py-2 text-right whitespace-nowrap tabular-nums';
  if (href && !empty) {
    return (
      <td className="border-b border-border-subtle p-0" style={style}>
        <Link href={href} className={cn(base, 'rounded-sm outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus')} title={`Open the ${monthLabel(cell.month)} statement for ${line.name}`}>
          {body}
        </Link>
      </td>
    );
  }
  return (
    <td className="border-b border-border-subtle p-0" style={style}>
      <span className={base}>{body}</span>
    </td>
  );
}

function Row({ line, months, metric, program, layout }: { readonly line: TrendsLine; readonly months: readonly IsoMonth[]; readonly metric: TrendsMetric; readonly program?: ProgramListItemDTO; readonly layout: Layout }) {
  const strong = line.kind !== 'program';
  const open = program && !program.moneyHidden ? programHref(program.key) : null;
  const fill = rowFill(line.kind);
  return (
    <tr className={cn(fill, line.kind === 'total' && 'font-semibold')} data-testid={`trends-row-${line.kind}`}>
      <th scope="row" style={{ width: layout.left, minWidth: layout.left, maxWidth: layout.left }} className={cn(FROZEN_LEFT, fill, 'border-b border-border-subtle px-3 py-2 text-left font-normal')}>
        <span className="flex min-w-0 items-center gap-2">
          {program ? <ProgramIcon icon={program.icon} color={program.color} size={18} /> : null}
          {/* The name keeps its room; the key gives way first and hides on phones. */}
          <span className={cn('min-w-0 shrink truncate', strong ? 'font-semibold text-fg' : 'text-fg')} title={line.key ? `${line.name} (${line.key})` : line.name}>{line.name}</span>
          {line.key ? <span className="min-w-0 shrink-[4] truncate font-key text-xs text-fg-muted max-sm:hidden">{line.key}</span> : null}
        </span>
      </th>
      {months.map((month, index) => (
        <Cell key={month} line={line} index={index} metric={metric} width={layout.month} href={open ? `${open}?statement=${month}` : null} />
      ))}
      <td style={{ width: layout.total, minWidth: layout.total }} className={cn(fill, layout.stickyTotal ? FROZEN_RIGHT : 'border-l', 'border-b border-border-subtle px-3 py-2 text-right whitespace-nowrap tabular-nums')}>
        <span className="flex flex-col items-end leading-tight">
          {metric !== 'revenue' || line.totalCents === null ? <span className={cn(metric === 'both' && line.totalCents !== null ? 'text-xs text-fg-secondary' : 'text-sm font-medium text-fg')}>{cellText({ month: '', units: line.totalUnits, revenueCents: null }, line.unit, 'units').units}</span> : null}
          {metric !== 'units' && line.totalCents !== null ? <span className="text-sm font-semibold text-fg">{cellText({ month: '', units: '0', revenueCents: line.totalCents }, line.unit, 'revenue').money}</span> : null}
        </span>
      </td>
    </tr>
  );
}

export function TrendsView({ programs, month, metric, onMetricChange }: TrendsViewProps) {
  const range = last12(month);
  const trends = useProgramTrends(range.from, range.to, 'program');
  const info = useMemo(() => new Map(programs.map((program) => [program.id, { customer: program.customer, unit: program.unit }])), [programs]);
  const byId = useMemo(() => new Map(programs.map((program) => [program.id, program])), [programs]);
  const visible = useMemo(() => new Set(programs.map((program) => program.id)), [programs]);
  const table = useMemo(() => (trends.data ? trendsTable({ ...trends.data, rows: trends.data.rows.filter((row) => visible.has(row.id)) }, info) : null), [trends.data, info, visible]);
  const moneyHidden = programs.some((program) => program.moneyHidden);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const layout = useMemo(() => trendsLayout(width), [width]);
  useEffect(() => {
    const node = scroller.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? node.clientWidth)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [table]);
  useLayoutEffect(() => {
    // Open on the latest months, lined up on a month edge so no month is cut in half.
    const node = scroller.current;
    if (node && table) node.scrollLeft = Math.max(0, (table.months.length - layout.shown) * layout.month);
  }, [table, layout]);
  const csvHref = apiPath('programs/trends', { from: range.from, to: range.to, group: 'program', format: 'csv' });

  return (
    <div className="flex flex-col gap-3" data-testid="programs-trends">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary">
          {monthLabel(range.from)} to {monthLabel(range.to)} · grouped by customer{moneyHidden ? ' · units only' : ''}
        </p>
        <div className="flex items-center gap-2">
          {moneyHidden ? null : (
            <ToggleGroup
              label="Show"
              size="sm"
              value={metric}
              onValueChange={onMetricChange}
              options={[
                { value: 'units', label: 'Units' },
                { value: 'revenue', label: 'Revenue' },
                { value: 'both', label: 'Both' },
              ]}
            />
          )}
          <a href={csvHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })} download data-testid="trends-csv">
            <Download aria-hidden className="size-4" />
            Export CSV
          </a>
        </div>
      </div>
      {trends.isError ? (
        <EmptyState size="sm" illustration="error" title="Trends did not load" description={trends.error.message} actions={<Button variant="secondary" onClick={() => void trends.refetch()}>Try again</Button>} />
      ) : !table ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" aria-busy>
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="ks-skeleton h-9 rounded-sm" />)}
        </div>
      ) : table.groups.length === 0 ? (
        <EmptyState size="sm" illustration="search" title="No programs to show" description="Change the filters to see trends for more programs." />
      ) : (
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain rounded-xl border border-border-subtle bg-panel shadow-xs" data-testid="trends-scroller">
          <table className="table-fixed border-separate border-spacing-0 text-sm" data-testid="trends-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: layout.left, minWidth: layout.left }} className={cn(FROZEN_LEFT, 'h-9 border-b border-border-subtle bg-sunken px-3 text-left text-xs font-medium text-fg-muted')}>Program</th>
                {table.months.map((entry) => (
                  <th key={entry} scope="col" style={{ width: layout.month, minWidth: layout.month }} className={cn('h-9 border-b border-border-subtle bg-sunken px-3 text-right text-xs font-medium whitespace-nowrap', entry === month ? 'text-fg' : 'text-fg-muted')}>
                    {monthLabel(entry, entry.slice(0, 4) === month.slice(0, 4))}
                  </th>
                ))}
                <th scope="col" style={{ width: layout.total, minWidth: layout.total }} className={cn(layout.stickyTotal ? FROZEN_RIGHT : 'border-l', 'h-9 border-b border-border-subtle bg-sunken px-3 text-right text-xs font-medium whitespace-nowrap text-fg-muted')}>12 months</th>
              </tr>
            </thead>
            <tbody>
              {table.groups.map((group) => (
                <GroupRows key={group.id} group={group} months={table.months} metric={metric} byId={byId} layout={layout} />
              ))}
              {table.totals.map((line) => <Row key={line.id} line={line} months={table.months} metric={metric} layout={layout} />)}
            </tbody>
          </table>
        </div>
      )}
      {moneyHidden ? <p className="text-xs text-fg-muted">Money is hidden for your role.</p> : <p className="text-xs text-fg-muted">Pick a month to open that program&apos;s statement.</p>}
    </div>
  );
}

function GroupRows({ group, months, metric, byId, layout }: { readonly group: ReturnType<typeof trendsTable>['groups'][number]; readonly months: readonly IsoMonth[]; readonly metric: TrendsMetric; readonly byId: ReadonlyMap<string, ProgramListItemDTO>; readonly layout: Layout }) {
  return (
    <>
      <tr className="bg-panel">
        <th scope="rowgroup" style={{ width: layout.left, minWidth: layout.left }} className={cn(FROZEN_LEFT, 'border-b border-border-subtle bg-panel px-3 pt-3 pb-1.5 text-left text-xs font-semibold tracking-wide text-fg-muted uppercase')}>
          <span className="block truncate" title={group.name}>{group.name}</span>
        </th>
        <td colSpan={months.length} className="border-b border-border-subtle bg-panel" />
        <td className={cn(layout.stickyTotal ? FROZEN_RIGHT : 'border-l', 'border-b border-border-subtle bg-panel')} />
      </tr>
      {group.programs.map((line) => <Row key={line.id} line={line} months={months} metric={metric} program={byId.get(line.id)} layout={layout} />)}
      {group.subtotal ? <Row line={group.subtotal} months={months} metric={metric} layout={layout} /> : null}
    </>
  );
}
