'use client';
/**
 * The views of the Profit explorer: the table, the ranking or trend chart, contribution (margin
 * before shared costs), Pareto, the two way pivot and cost to serve. Each one draws the rows the
 * explorer hands it; none of them fetches the main rows or does money math of its own.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { ChevronRight, ExternalLink, TriangleAlert } from 'lucide-react';
import { BarChart, ComboChart, ParetoChart } from '@/components/charts/cartesian';
import { Sparkline } from '@/components/charts/sparkline';
import { MarginPill } from '@/components/charts/stats';
import { ExplainNumber } from '@/components/pulse/explain';
import { Select } from '@/components/ui/select';
import { PINNED_CELL_SURFACE, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/cn';
import { PROFIT_GROUPS, type ProfitGroup } from '@/lib/constants';
import { formatMoney, formatMoneyDelta, formatPercentBp, formatPointsDelta } from '@/lib/format';
import { useProfitPivot, useReport, type ProfitParams, type ReportParams } from '@/lib/hooks/use-data';
import { centsToNumber } from '@/lib/money';
import { routes } from '@/lib/routes';
import type { ProfitRowDTO } from '@/lib/types';
import { ReportChart } from '@/features/reports/report-chart';
import { ReportTable } from '@/features/reports/report-table';
import {
  PIVOT_MEASURES,
  PIVOT_MEASURE_KIND,
  PIVOT_MEASURE_LABELS,
  VIEW_LABELS,
  VIEW_NOUN,
  contribution,
  drillTarget,
  formatValue,
  isTimeGroup,
  paretoView,
  NO_COST_YET,
  NOT_KNOWN,
  noCostTotalNote,
  noCostWords,
  pivotNoCost,
  pivotNoCostWords,
  rowNoCost,
  pivotValue,
  rowLabel,
  rowScope,
  type Compared,
  type PivotMeasure,
  type ProfitColumn,
  type SortState,
} from './profit-model';
import { LoadError, SortHeader, TableSkeleton } from './profit-ui';

/** Table percents keep one decimal place so a column lines up ("38.0%" next to "45.3%"). */
const FIXED = { fixed: true } as const;

type Patch = Readonly<Record<string, string | null>>;

function toneFor(column: Pick<ProfitColumn, 'id'>, value: number | null): string {
  if (value === null) return '';
  if ((column.id === 'profit' || column.id === 'margin' || column.id === 'margin_before') && value < 0) return 'text-danger-text';
  return '';
}

function pageHref(by: ProfitGroup, row: ProfitRowDTO): { href: string; label: string } | null {
  if (row.key === 'none') return null;
  if (by === 'job') return { href: routes.job(row.label), label: `Open the job page of ${row.label}` };
  if (by === 'client') return { href: routes.client(row.key), label: `Open the client page of ${row.label}` };
  if (by === 'service') return { href: routes.service(row.key), label: `Open the service page of ${row.label}` };
  return null;
}

const NONE_HINT: Readonly<Record<string, string>> = {
  job: 'Revenue and costs put on a client with no job. There is nothing below this row.',
  service: 'Everything that is not an extra service: the main work of each job.',
  client: 'Rows with no client.',
  type: 'Rows with no job type.',
  site: 'Rows with no site.',
};

/* ------------------------------------------------------------------ table */

export interface TableViewProps {
  readonly by: ProfitGroup;
  readonly rows: readonly ProfitRowDTO[];
  readonly total: ProfitRowDTO;
  readonly columns: readonly ProfitColumn[];
  readonly compared: ReadonlyMap<string, Compared>;
  readonly totalCompared: Compared | null;
  readonly compareLabel: string;
  readonly sort: SortState;
  readonly onSort: (sort: SortState) => void;
  readonly onDrill: (patch: Patch) => void;
  readonly scope: ProfitParams;
  readonly range: { readonly from: string; readonly to: string };
  readonly seesMoney: boolean;
}

function RowName({ by, row, onDrill, range }: { readonly by: ProfitGroup; readonly row: ProfitRowDTO; readonly onDrill: (patch: Patch) => void; readonly range: { from: string; to: string } }) {
  const drill = drillTarget(by, row, range);
  const name = rowLabel(by, row);
  const page = pageHref(by, row);
  const sub = by === 'job' ? row.sublabel : null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">
        {drill ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDrill(drill.patch);
            }}
            aria-label={drill.words}
            data-testid="drill"
            className="group/drill inline-flex max-w-full items-center gap-1 rounded-sm text-left font-medium text-fg hover:text-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="truncate">{name}</span>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-icon transition-transform group-hover/drill:translate-x-0.5" />
          </button>
        ) : (
          <Tooltip content={NONE_HINT[by] ?? 'There is nothing below this row.'}>
            <span tabIndex={0} className="inline-block max-w-full truncate rounded-sm font-medium text-fg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {name}
            </span>
          </Tooltip>
        )}
        {sub ? <span className="block truncate text-xs font-normal text-fg-muted">{sub}</span> : null}
      </div>
      {by === 'job' && row.riskStatus ? <MarginPill status={row.riskStatus} size="sm" className="hidden lg:inline-flex" /> : null}
      {row.laborMissing ? (
        <Tooltip content="Some labor is missing here, so profit is not complete yet.">
          <span tabIndex={0} role="img" aria-label="Some labor is missing here, so profit is not complete yet." className="inline-flex rounded-sm text-warning-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <TriangleAlert aria-hidden className="size-3.5" />
          </span>
        </Tooltip>
      ) : null}
      {page ? (
        <Link href={page.href} aria-label={page.label} title={page.label} onClick={(event) => event.stopPropagation()} className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
          <ExternalLink aria-hidden className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

/** An extra service row with revenue and no cost logged: its margin, cost and profit read in words. */
const noCostYet = rowNoCost;

/**
 * Shown in place of a margin that would read 100%, or a cost and a profit that would read $0.00 and
 * the revenue, only because no cost is logged.
 */
function NoCostYet({ words = NO_COST_YET }: { readonly words?: string | null }) {
  return (
    <Tooltip content="No labor hours or parts are logged for this work, so Pulse does not know what it cost.">
      <span tabIndex={0} className="rounded-sm font-normal text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="profit-no-cost">
        {words ?? NO_COST_YET}
      </span>
    </Tooltip>
  );
}

function ChangeCells({ compared }: { readonly compared: Compared | null | undefined }) {
  const profit = compared?.profitDelta ?? null;
  const margin = compared?.marginDelta ?? null;
  const tone = (value: number | null): string => (value === null || value === 0 ? 'text-fg-muted' : value > 0 ? 'text-success-text' : 'text-danger-text');
  return (
    <>
      <TableCell numeric className={cn('whitespace-nowrap', tone(profit))}>
        {profit === null ? '' : formatMoneyDelta(profit, { cents: false })}
      </TableCell>
      <TableCell numeric className={cn('whitespace-nowrap', tone(margin))}>
        {margin === null ? '' : formatPointsDelta(margin)}
      </TableCell>
    </>
  );
}

/**
 * The last two columns of a fixed table (Profit, then Job margin), pinned to the right edge from
 * 768 px. `PIN_EDGE` draws the hairline where the scrolling columns slide under the pinned block.
 */
const PIN_EDGE = 'md:shadow-[-1px_0_0_var(--border-default)]';
const PIN_LAST = 'right-0 z-[1] w-[104px] max-w-[104px] min-w-[104px] md:sticky print:static';
const PIN_SECOND = cn('right-[104px] z-[1] w-[116px] max-w-[116px] min-w-[116px] md:sticky print:static', PIN_EDGE);

/** The columns that answer the page. They stay on screen on a tablet while the other columns scroll. */
const PINNED_COLUMNS: readonly string[] = ['profit', 'margin'];

export function TableView({ by, rows, total, columns, compared, totalCompared, compareLabel, sort, onSort, onDrill, scope, range, seesMoney }: TableViewProps) {
  const comparing = compareLabel !== '';
  const showTrend = !isTimeGroup(by) && rows.some((row) => (row.trend?.length ?? 0) > 1);
  const nameLabel = VIEW_LABELS[by].replace(/s$/, '');
  const noCostNote = total.costMissing ? null : noCostTotalNote(rows, VIEW_NOUN[by], `${VIEW_NOUN[by]}s`);
  // The answer columns stay pinned to the right edge from 768 px while the rest scrolls under them
  // (the same pattern as a built report), so Profit and Job margin are on screen without scrolling.
  const pinned = columns.length + (comparing ? 2 : 0) + (showTrend ? 1 : 0) >= 7 ? columns.filter((column) => PINNED_COLUMNS.includes(column.id)) : [];
  const pin = (id: string, surface: string, head = false): { readonly className: string; readonly style: { readonly right: number } } | null => {
    const index = pinned.findIndex((column) => column.id === id);
    if (index < 0) return null;
    // A hairline on the left edge of the pinned block, where the scrolling columns slide under it. A header cell keeps the line under the header row.
    const edge = index === 0;
    const line = head ? (edge ? 'md:shadow-[-1px_0_0_var(--border-default),inset_0_-1px_0_var(--border-default)]' : 'md:shadow-[inset_0_-1px_0_var(--border-default)]') : edge ? 'md:shadow-[-1px_0_0_var(--border-default)]' : '';
    return {
      className: cn('z-[1] w-[116px] max-w-[116px] min-w-[116px] md:sticky print:static', surface, line),
      style: { right: (pinned.length - 1 - index) * 116 },
    };
  };
  return (
    <>
      {/* Phones: one card per row, the same rows in the same order. */}
      <ul className="flex flex-col divide-y divide-border-subtle md:hidden" data-testid="profit-cards">
        {rows.map((row) => {
          const drill = drillTarget(by, row, range);
          return (
            <li key={row.key} className="flex flex-col gap-2 px-4 py-3">
              <RowName by={by} row={row} onDrill={onDrill} range={range} />
              <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm tabular-nums">
                {(seesMoney ? ['revenue', 'profit', 'margin'] : ['units', 'hours', 'uph']).map((id) => {
                  const column = columns.find((item) => item.id === id);
                  if (!column) return null;
                  const value = column.get(row);
                  return (
                    <div key={id} className="min-w-[4.5rem]">
                      <dt className="text-xs text-fg-muted">{column.label}</dt>
                      <dd className={cn('font-medium text-fg', toneFor(column, value))}>{noCostYet(row, column.id) ? <NoCostYet words={noCostWords(row, column.id)} /> : formatValue(value, column.kind) || 'None'}</dd>
                    </div>
                  );
                })}
              </dl>
              {drill ? null : <p className="text-xs text-fg-muted">{NONE_HINT[by]}</p>}
            </li>
          );
        })}
        <li className="flex items-center justify-between gap-3 bg-sunken px-4 py-3 text-sm font-semibold tabular-nums">
          <span>Total</span>
          <span>{seesMoney ? (total.costMissing ? 'Profit not known' : `${formatMoney(total.profitCents)} profit`) : `${formatValue(Number(total.unitsGood), 'number')} units`}</span>
        </li>
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <Table className="min-w-max" data-testid="profit-table">
          <TableHead>
            <tr>
              <TableHeaderCell className="sticky left-0 z-[2] min-w-[240px] bg-panel" aria-sort={sort.column === 'name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <SortHeader id="name" label={nameLabel} sort={sort} onSort={onSort} />
              </TableHeaderCell>
              {columns.map((column) => {
                const pinnedHere = pin(column.id, 'bg-panel', true);
                return (
                  <TableHeaderCell key={column.id} numeric style={pinnedHere?.style} className={pinnedHere?.className} aria-sort={sort.column === column.id ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <SortHeader id={column.id} label={column.label} sort={sort} onSort={onSort} numeric title={column.help} />
                  </TableHeaderCell>
                );
              })}
              {comparing ? (
                <>
                  <TableHeaderCell numeric>
                    <SortHeader id="profit_change" label="Profit change" sort={sort} onSort={onSort} numeric title={`Profit now less profit ${compareLabel.replace(/^vs /, 'in ')}.`} />
                  </TableHeaderCell>
                  <TableHeaderCell numeric>
                    <SortHeader id="margin_change" label="Margin change" sort={sort} onSort={onSort} numeric title={`Margin now less margin ${compareLabel.replace(/^vs /, 'in ')}, in points.`} />
                  </TableHeaderCell>
                </>
              ) : null}
              {showTrend ? <TableHeaderCell>{seesMoney ? 'Profit trend' : 'Units trend'}</TableHeaderCell> : null}
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const drill = drillTarget(by, row, range);
              const extra = rowScope(by, row.key, range);
              return (
                <TableRow key={row.key} data-testid="profit-row" className={cn('group', drill && 'cursor-pointer')} onClick={drill ? () => onDrill(drill.patch) : undefined}>
                  <TableCell className="sticky left-0 z-[1] max-w-[340px] bg-panel group-hover:bg-hover">
                    <RowName by={by} row={row} onDrill={onDrill} range={range} />
                  </TableCell>
                  {columns.map((column) => {
                    const value = column.get(row);
                    const pinnedHere = pin(column.id, PINNED_CELL_SURFACE);
                    return (
                      <TableCell key={column.id} numeric style={pinnedHere?.style} className={cn('whitespace-nowrap', toneFor(column, value), pinnedHere?.className)}>
                        <span className="inline-flex items-center justify-end gap-0.5">
                          {column.id === 'profit' && extra && seesMoney ? <ExplainNumber metric="profit" scope={{ ...scope, ...extra }} label={`How we got the profit of ${rowLabel(by, row)}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" /> : null}
                          {noCostYet(row, column.id) ? <NoCostYet words={noCostWords(row, column.id)} /> : column.id === 'margin' && value !== null && by !== 'job' ? formatPercentBp(value, FIXED) : formatValue(value, column.kind)}
                        </span>
                      </TableCell>
                    );
                  })}
                  {comparing ? <ChangeCells compared={compared.get(row.key)} /> : null}
                  {showTrend ? <TableCell>{row.trend && row.trend.length > 1 && !(seesMoney && row.costMissing) ? <Sparkline values={[...row.trend]} label={`${rowLabel(by, row)} ${seesMoney ? 'profit' : 'units'} over the period`} format={seesMoney ? 'money' : 'number'} width={88} height={24} tone={seesMoney && (row.profitCents ?? 0) < 0 ? 'bad' : 'accent'} /> : null}</TableCell> : null}
                </TableRow>
              );
            })}
          </TableBody>
          <tfoot>
            <tr className="h-10 border-t-2 border-border-strong bg-sunken font-semibold" data-testid="profit-total">
              <TableCell className="sticky left-0 z-[1] bg-sunken">
                Total, {rows.length} {rows.length === 1 ? VIEW_NOUN[by] : `${VIEW_NOUN[by]}s`}
              </TableCell>
              {columns.map((column) => {
                const value = column.get(total);
                const pinnedHere = pin(column.id, 'bg-sunken');
                return (
                  <TableCell key={column.id} numeric style={pinnedHere?.style} className={cn('whitespace-nowrap', toneFor(column, value), pinnedHere?.className)}>
                    {noCostYet(total, column.id) ? <NoCostYet words={noCostWords(total, column.id)} /> : formatValue(value, column.kind)}
                  </TableCell>
                );
              })}
              {comparing ? <ChangeCells compared={totalCompared} /> : null}
              {showTrend ? <TableCell /> : null}
            </tr>
          </tfoot>
        </Table>
      </div>
      {seesMoney && noCostNote ? (
        <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-muted" data-testid="profit-no-cost-total">
          {noCostNote}
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ chart */

export const CHART_MEASURES = ['profit', 'margin', 'revenue'] as const;
export type ChartMeasure = (typeof CHART_MEASURES)[number];
const CHART_MEASURE_LABELS: Readonly<Record<ChartMeasure, string>> = { profit: 'Profit', margin: 'Margin', revenue: 'Revenue' };

export function ChartView({ by, rows, measure, order, onMeasure, onOrder, targetMarginBp, refreshing, seesMoney }: { readonly by: ProfitGroup; readonly rows: readonly ProfitRowDTO[]; readonly measure: ChartMeasure; readonly order: 'best' | 'worst'; readonly onMeasure: (measure: ChartMeasure) => void; readonly onOrder: (order: 'best' | 'worst') => void; readonly targetMarginBp: number; readonly refreshing: boolean; readonly seesMoney: boolean }) {
  const time = isTimeGroup(by);
  const timeRows = useMemo(() => [...rows].sort((a, b) => a.key.localeCompare(b.key)), [rows]);
  if (time) {
    const dates = timeRows.map((row) => row.key);
    if (!seesMoney) return <BarChart title={`Units by ${VIEW_NOUN[by]}`} description="Good units finished in each period." dates={dates} bucket={by as 'day' | 'week' | 'month'} series={[{ id: 'units', label: 'Units', values: timeRows.map((row) => Number(row.unitsGood)) }]} format="number" height={320} refreshing={refreshing} tableToggle hideLegend />;
    return (
      <ComboChart
        title={`Revenue, cost and margin by ${VIEW_NOUN[by]}`}
        description="Bars show revenue and cost. The line on top is the job margin, with your target margin."
        dates={dates}
        bucket={by as 'day' | 'week' | 'month'}
        bars={[
          { id: 'revenue', label: 'Revenue', values: timeRows.map((row) => row.revenueCents) },
          { id: 'cost', label: 'Cost', values: timeRows.map((row) => (row.costMissing ? null : row.costCents)), gapText: timeRows.map((row) => (row.costMissing ? NOT_KNOWN : null)) },
        ]}
        lines={[{ id: 'margin', label: 'Job margin', values: timeRows.map((row) => row.marginBp), gapText: timeRows.map((row) => (row.costMissing ? NO_COST_YET : null)) }]}
        barFormat="money"
        lineFormat="percent"
        lineTarget={{ value: targetMarginBp, label: 'Target margin' }}
        height={360}
        refreshing={refreshing}
        tableToggle
      />
    );
  }
  // With no known cost, profit is not known: the bar is left out, never drawn as the revenue.
  const pick = (row: ProfitRowDTO): number | null => (!seesMoney ? Number(row.unitsGood) : measure === 'profit' ? (row.costMissing ? null : row.profitCents) : measure === 'margin' ? row.marginBp : row.revenueCents);
  // A job with numbers that are not complete yet (no hours, no rate, no plan) never ranks as a best job (SPEC 4.14).
  const ranked = rows.filter((row) => pick(row) !== null && !(order === 'best' && by === 'job' && row.laborMissing)).sort((a, b) => ((pick(b) as number) - (pick(a) as number)) * (order === 'best' ? 1 : -1));
  const shown = ranked.slice(0, 12);
  const label = seesMoney ? CHART_MEASURE_LABELS[measure] : 'Units';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {seesMoney ? <ToggleGroup label="What to rank by" size="sm" value={measure} onValueChange={onMeasure} options={CHART_MEASURES.map((value) => ({ value, label: CHART_MEASURE_LABELS[value] }))} /> : null}
        <ToggleGroup
          label="Which end of the list"
          size="sm"
          value={order}
          onValueChange={onOrder}
          options={[
            { value: 'best', label: 'Best first' },
            { value: 'worst', label: 'Worst first' },
          ]}
        />
        {ranked.length > shown.length ? (
          <span className="text-xs text-fg-muted">
            Showing the top {shown.length} of {ranked.length}. The table has them all.
          </span>
        ) : null}
        {rows.length > ranked.length ? (
          <span className="text-xs text-fg-muted" data-testid="chart-left-out">
            {rows.length - ranked.length} {rows.length - ranked.length === 1 ? VIEW_NOUN[by] : `${VIEW_NOUN[by]}s`} left out because {rows.length - ranked.length === 1 ? 'its' : 'their'} numbers are not complete yet.
          </span>
        ) : null}
      </div>
      <BarChart
        title={`${label} by ${VIEW_NOUN[by]}, ${order === 'best' ? 'best' : 'worst'} first`}
        description={measure === 'margin' && seesMoney ? 'Job margin: profit as a share of revenue. Bars to the left lost money.' : 'Longer bars are bigger. Bars to the left are below zero.'}
        orientation="horizontal"
        labels={shown.map((row) => rowLabel(by, row))}
        series={[{ id: measure, label, values: shown.map((row) => pick(row)) }]}
        format={!seesMoney ? 'number' : measure === 'margin' ? 'percent' : 'money'}
        signColors
        height={Math.max(220, shown.length * 32 + 60)}
        refreshing={refreshing}
        target={measure === 'margin' && seesMoney ? { value: targetMarginBp, label: 'Target margin' } : undefined}
        tableToggle
        hideLegend
      />
    </div>
  );
}

/* ------------------------------------------------------------------ contribution */

export function ContributionView({ by, rows, total, onDrill, range, refreshing }: { readonly by: ProfitGroup; readonly rows: readonly ProfitRowDTO[]; readonly total: ProfitRowDTO; readonly onDrill: (patch: Patch) => void; readonly range: { from: string; to: string }; readonly refreshing: boolean }) {
  const time = isTimeGroup(by);
  const charted = useMemo(() => (time ? [...rows].sort((a, b) => a.key.localeCompare(b.key)) : [...rows].sort((a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0)).slice(0, 10)), [rows, time]);
  const totalParts = contribution(total);
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-fg-secondary">
        Contribution is what the work made before shared costs: revenue less labor, material and other costs. A job can sit under target after all costs and still help pay for time not on a job.
      </p>
      <div className="px-0">
        <BarChart
          title={`Where each dollar of revenue went, by ${VIEW_NOUN[by]}`}
          description="Each bar is revenue split into labor, material, other costs, time not on a job and profit. A profit piece below the line is a loss."
          mode="stacked"
          {...(time ? { dates: charted.map((row) => row.key), bucket: by as 'day' | 'week' | 'month' } : { labels: charted.map((row) => rowLabel(by, row)) })}
          series={[
            { id: 'labor', label: 'Labor', values: charted.map((row) => row.laborCents) },
            { id: 'material', label: 'Material', values: charted.map((row) => row.materialCents) },
            { id: 'other', label: 'Other costs', values: charted.map((row) => row.otherCents) },
            { id: 'shared', label: 'Time not on a job', values: charted.map((row) => row.sharedCents) },
            { id: 'profit', label: 'Profit', values: charted.map((row) => row.profitCents) },
          ]}
          format="money"
          height={320}
          refreshing={refreshing}
          tableToggle
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <Table className="min-w-[760px]" data-testid="contribution-table">
          <TableHead>
            <tr>
              <TableHeaderCell className="sticky left-0 z-[1] bg-panel">{VIEW_LABELS[by].replace(/s$/, '')}</TableHeaderCell>
              <TableHeaderCell numeric>Revenue</TableHeaderCell>
              <TableHeaderCell numeric title="Labor, material and other costs.">
                Direct costs
              </TableHeaderCell>
              <TableHeaderCell numeric>Contribution</TableHeaderCell>
              <TableHeaderCell numeric title="Contribution as a share of revenue.">
                Contribution %
              </TableHeaderCell>
              <TableHeaderCell numeric>Time not on a job</TableHeaderCell>
              <TableHeaderCell numeric className={cn(PIN_SECOND, 'bg-panel')}>
                Profit
              </TableHeaderCell>
              <TableHeaderCell numeric className={cn(PIN_LAST, 'bg-panel')}>
                Job margin
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const parts = contribution(row);
              const drill = drillTarget(by, row, range);
              return (
                <TableRow key={row.key} className={cn('group', drill && 'cursor-pointer')} onClick={drill ? () => onDrill(drill.patch) : undefined}>
                  <TableCell className="sticky left-0 z-[1] max-w-[300px] bg-panel group-hover:bg-hover">
                    <RowName by={by} row={row} onDrill={onDrill} range={range} />
                  </TableCell>
                  <TableCell numeric>{formatMoney(row.revenueCents)}</TableCell>
                  <TableCell numeric>{parts ? formatMoney(parts.directCents) : ''}</TableCell>
                  <TableCell numeric className={cn('font-medium', parts && parts.contributionCents < 0 && 'text-danger-text')}>
                    {row.costMissing ? <NoCostYet words={NOT_KNOWN} /> : parts ? formatMoney(parts.contributionCents) : ''}
                  </TableCell>
                  <TableCell numeric className={cn((row.marginBeforeSharedBp ?? 0) < 0 && 'text-danger-text')}>
                    {row.costMissing ? <NoCostYet /> : formatPercentBp(row.marginBeforeSharedBp, FIXED)}
                  </TableCell>
                  <TableCell numeric>{formatMoney(row.sharedCents)}</TableCell>
                  <TableCell numeric className={cn(PIN_SECOND, PINNED_CELL_SURFACE, (row.profitCents ?? 0) < 0 && 'text-danger-text')}>
                    {row.costMissing ? <NoCostYet words={NOT_KNOWN} /> : formatMoney(row.profitCents)}
                  </TableCell>
                  <TableCell numeric className={cn(PIN_LAST, PINNED_CELL_SURFACE, (row.marginBp ?? 0) < 0 && 'text-danger-text')}>
                    {row.costMissing ? <NoCostYet /> : formatPercentBp(row.marginBp, FIXED)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <tfoot>
            <tr className="h-10 border-t-2 border-border-strong bg-sunken font-semibold">
              <TableCell className="sticky left-0 z-[1] bg-sunken">Total</TableCell>
              <TableCell numeric>{formatMoney(total.revenueCents)}</TableCell>
              <TableCell numeric>{totalParts ? formatMoney(totalParts.directCents) : ''}</TableCell>
              <TableCell numeric>{totalParts ? formatMoney(totalParts.contributionCents) : ''}</TableCell>
              <TableCell numeric>{formatPercentBp(total.marginBeforeSharedBp, FIXED)}</TableCell>
              <TableCell numeric>{formatMoney(total.sharedCents)}</TableCell>
              <TableCell numeric className={cn(PIN_SECOND, 'bg-sunken')}>
                {total.costMissing ? <NoCostYet words={NOT_KNOWN} /> : formatMoney(total.profitCents)}
              </TableCell>
              <TableCell numeric className={cn(PIN_LAST, 'bg-sunken')}>
                {total.costMissing ? <NoCostYet /> : formatPercentBp(total.marginBp, FIXED)}
              </TableCell>
            </tr>
          </tfoot>
        </Table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pareto */

export function ParetoView({ by, rows, onDrill, range, refreshing }: { readonly by: ProfitGroup; readonly rows: readonly ProfitRowDTO[]; readonly onDrill: (patch: Patch) => void; readonly range: { from: string; to: string }; readonly refreshing: boolean }) {
  const view = useMemo(() => paretoView(rows), [rows]);
  const noun = VIEW_NOUN[by];
  const count = view.ranked.length;
  const makers = view.ranked.filter((item) => item.profitCents > BigInt(0));
  const plural = (n: number): string => (n === 1 ? noun : `${noun}s`);
  const lostNote = view.losing > 0 ? ` ${view.losing} ${plural(view.losing)} lost money and gave back ${formatMoney(view.gaveBackCents)}.` : '';
  const sentence =
    view.toEighty === null
      ? `Together these ${noun}s made no profit in this period, so there is no share to rank.`
      : `${view.toEighty} of ${count} ${plural(count)} ${view.toEighty === 1 ? 'makes' : 'make'} 80% of the ${formatMoney(view.madeCents)} that ${makers.length === 1 ? `1 ${noun}` : `${makers.length} ${noun}s`} made.${lostNote}`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-md font-medium text-fg" data-testid="pareto-sentence">
        {sentence}
      </p>
      <ParetoChart
        title={`Profit by ${noun}, biggest first`}
        description={`Bars are profit. The line is the running share of the ${formatMoney(view.madeCents)} made, the same base as the table. Only ${noun}s that made money are drawn. "Other" adds up the rest of them.`}
        items={makers.map((item) => ({ id: item.item.key, label: rowLabel(by, item.item), value: centsToNumber(item.profitCents) }))}
        format="money"
        valueLabel="Profit"
        maxItems={10}
        height={320}
        refreshing={refreshing}
        tableToggle
        emptyTitle="Nothing made a profit in this period"
        emptyHint="Pick a longer period, or look at the table to see where the money went."
      />
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <Table className="min-w-[680px]" data-testid="pareto-table">
          <TableHead>
            <tr>
              <TableHeaderCell numeric className="w-12">
                Rank
              </TableHeaderCell>
              <TableHeaderCell>{VIEW_LABELS[by].replace(/s$/, '')}</TableHeaderCell>
              <TableHeaderCell numeric>Profit</TableHeaderCell>
              <TableHeaderCell numeric>Share of profit</TableHeaderCell>
              <TableHeaderCell numeric>Running share</TableHeaderCell>
              <TableHeaderCell numeric>Share of revenue</TableHeaderCell>
              <TableHeaderCell numeric className={cn(PIN_LAST, PIN_EDGE, 'bg-panel')}>
                Margin
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {view.ranked.map((item) => {
              const drill = drillTarget(by, item.item, range);
              const losing = item.profitCents < BigInt(0);
              return (
                <TableRow key={item.item.key} className={cn('group', drill && 'cursor-pointer')} onClick={drill ? () => onDrill(drill.patch) : undefined}>
                  <TableCell numeric className="text-fg-muted">
                    {item.rank}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <RowName by={by} row={item.item} onDrill={onDrill} range={range} />
                  </TableCell>
                  <TableCell numeric className={cn(losing && 'text-danger-text')}>
                    {formatMoney(item.profitCents)}
                  </TableCell>
                  <TableCell numeric className={cn(losing && 'text-danger-text')}>
                    {formatPercentBp(item.profitShareBp, FIXED)}
                  </TableCell>
                  <TableCell numeric>{formatPercentBp(item.cumulativeProfitShareBp, FIXED)}</TableCell>
                  <TableCell numeric>{formatPercentBp(item.revenueShareBp, FIXED)}</TableCell>
                  <TableCell numeric className={cn(PIN_LAST, PIN_EDGE, PINNED_CELL_SURFACE, losing && 'text-danger-text')}>
                    {formatPercentBp(item.marginBp, FIXED)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pivot */

const MAX_PIVOT_COLS = 31;

export function PivotView({ by, colBy, measure, onColBy, onMeasure, scope, seesMoney }: { readonly by: ProfitGroup; readonly colBy: ProfitGroup; readonly measure: PivotMeasure; readonly onColBy: (by: ProfitGroup) => void; readonly onMeasure: (measure: PivotMeasure) => void; readonly scope: ProfitParams; readonly seesMoney: boolean }) {
  const query = useProfitPivot(by, colBy, scope);
  const pivot = query.data ?? null;
  const kind = PIVOT_MEASURE_KIND[measure];
  const measures = seesMoney ? PIVOT_MEASURES : (['units', 'hours'] as const);
  const tone = (value: number | null): string => ((measure === 'profit' || measure === 'margin') && value !== null && value < 0 ? 'text-danger-text' : '');
  const cols = pivot ? pivot.cols.slice(0, MAX_PIVOT_COLS) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-fg-secondary">{VIEW_LABELS[by]} down the side, and across the top:</span>
        <div className="w-[170px]">
          <Select aria-label="Group across the top by" value={colBy} onValueChange={(value) => onColBy(value as ProfitGroup)} options={PROFIT_GROUPS.filter((group) => group !== by).map((group) => ({ value: group, label: VIEW_LABELS[group] }))} />
        </div>
        <span className="text-sm text-fg-secondary">showing</span>
        <div className="w-[150px]">
          <Select aria-label="Number to show" value={measure} onValueChange={(value) => onMeasure(value as PivotMeasure)} options={measures.map((value) => ({ value, label: PIVOT_MEASURE_LABELS[value] }))} />
        </div>
      </div>
      {query.isError ? (
        <LoadError what="the pivot" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} compact />
      ) : !pivot ? (
        <TableSkeleton label="Loading the pivot" />
      ) : pivot.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-default px-4 py-8 text-center text-sm text-fg-secondary">Nothing to show for this period and these filters.</p>
      ) : (
        <>
          <div className={cn('overflow-x-auto rounded-lg border border-border-subtle', query.isFetching && 'opacity-70')}>
            <Table className="min-w-max" data-testid="pivot-table">
              <TableHead>
                <tr>
                  <TableHeaderCell className="sticky left-0 z-[2] min-w-[200px] bg-panel">{VIEW_LABELS[by].replace(/s$/, '')}</TableHeaderCell>
                  {cols.map((col) => (
                    <TableHeaderCell key={col.key} numeric>
                      {isTimeGroup(colBy) ? rowLabel(colBy, col).replace(/^Week of /, 'Wk ').replace(/, \d{4}$/, '') : col.label}
                    </TableHeaderCell>
                  ))}
                  <TableHeaderCell numeric className="bg-sunken">
                    Total
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {pivot.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="sticky left-0 z-[1] max-w-[260px] truncate bg-panel font-medium">{rowLabel(by, row)}</TableCell>
                    {cols.map((col) => {
                      const cell = pivot.cells[row.key]?.[col.key];
                      const value = pivotValue(cell, measure);
                      return (
                        <TableCell key={col.key} numeric className={cn('whitespace-nowrap', tone(value))}>
                          {pivotNoCost(cell, measure) ? <NoCostYet words={pivotNoCostWords(cell, measure)} /> : value === null ? <span className="sr-only">No activity</span> : formatValue(value, kind)}
                        </TableCell>
                      );
                    })}
                    <TableCell numeric className={cn('bg-sunken font-semibold whitespace-nowrap', tone(pivotValue(pivot.rowTotals[row.key], measure)))}>
                      {pivotNoCost(pivot.rowTotals[row.key], measure) ? <NoCostYet words={pivotNoCostWords(pivot.rowTotals[row.key], measure)} /> : formatValue(pivotValue(pivot.rowTotals[row.key], measure), kind)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <tr className="h-10 border-t-2 border-border-strong bg-sunken font-semibold">
                  <TableCell className="sticky left-0 z-[1] bg-sunken">Total</TableCell>
                  {cols.map((col) => (
                    <TableCell key={col.key} numeric className={cn('whitespace-nowrap', tone(pivotValue(pivot.colTotals[col.key], measure)))}>
                      {pivotNoCost(pivot.colTotals[col.key], measure) ? <NoCostYet words={pivotNoCostWords(pivot.colTotals[col.key], measure)} /> : formatValue(pivotValue(pivot.colTotals[col.key], measure), kind)}
                    </TableCell>
                  ))}
                  <TableCell numeric className={cn('whitespace-nowrap', tone(pivotValue(pivot.total, measure)))} data-testid="pivot-total">
                    {pivotNoCost(pivot.total, measure) ? <NoCostYet words={pivotNoCostWords(pivot.total, measure)} /> : formatValue(pivotValue(pivot.total, measure), kind)}
                  </TableCell>
                </tr>
              </tfoot>
            </Table>
          </div>
          <p className="text-xs text-fg-muted">
            A blank cell had no activity. Every row and column adds up to the Total, which matches the table view.
            {pivot.cols.length > MAX_PIVOT_COLS ? ` Showing the first ${MAX_PIVOT_COLS} of ${pivot.cols.length} columns. The export has them all.` : ''}
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ cost to serve */

export function ServeView({ params }: { readonly params: ReportParams }) {
  const query = useReport('cost-to-serve', params);
  const report = query.data;
  if (query.isError) return <LoadError what="cost to serve" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} compact />;
  if (!report) return <TableSkeleton label="Loading cost to serve" />;
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-fg-secondary">Cost to serve is every cost of a client’s jobs, plus costs put on the client with no job. Per unit and per job show which clients are expensive to keep.</p>
      {report.chart ? <ReportChart chart={report.chart} refreshing={query.isFetching} /> : null}
      <div className="rounded-lg border border-border-subtle">
        <ReportTable report={report} />
      </div>
    </div>
  );
}
