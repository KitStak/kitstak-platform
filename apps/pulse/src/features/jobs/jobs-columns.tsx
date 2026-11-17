'use client';
/**
 * The columns of the jobs list: what each one shows, how it sorts, and what it writes to the
 * CSV export. The table, the column chooser, the sort menu and the export all read this list.
 */
import type { ReactNode } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { PersonAvatar } from '@/components/pulse/person';
import { JOB_STATUS_LABELS, PULSE_STATUS_LABELS } from '@/lib/constants';
import { formatHours, formatMoney, formatMoneyPlain, formatPercentBp } from '@/lib/format';
import { shortDate } from '@/lib/profit/calendar';
import type { JobListItemDTO } from '@/lib/types';
import { cn } from '@/components/ui/cn';
import { riskRank, singularUnit } from './job-math';
import { Hidden, JobStatusBadge, RiskPill, UnitsProgress, toneClass } from './job-ui';

export type ColumnId = 'client' | 'type' | 'site' | 'owner' | 'status' | 'risk' | 'done' | 'hours' | 'margin' | 'projMargin' | 'projProfit' | 'trend' | 'due' | 'last';

export interface ColumnContext {
  readonly trends: ReadonlyMap<string, readonly number[]>;
  readonly peopleName: (id: string | null) => string;
  readonly seesMoney: boolean;
}

export interface JobColumn {
  readonly id: ColumnId;
  readonly label: string;
  /** Longer name for the chooser and the CSV header. */
  readonly longLabel?: string;
  readonly numeric?: boolean;
  /** Shows money: left out for readers who may not see it. */
  readonly money?: boolean;
  readonly defaultOn: boolean;
  readonly sort?: (job: JobListItemDTO) => number | string | null;
  readonly cell: (job: JobListItemDTO, ctx: ColumnContext) => ReactNode;
  readonly csv: (job: JobListItemDTO, ctx: ColumnContext) => readonly (string | number | null)[];
  readonly csvHeaders?: readonly string[];
  readonly className?: string;
}

const money = (cents: number | null): ReactNode => (cents === null ? <Hidden /> : formatMoney(cents, { cents: false }));

function marginTone(marginBp: number | null, targetBp: number | null): 'good' | 'bad' | 'neutral' {
  if (marginBp === null) return 'neutral';
  if (marginBp < 0) return 'bad';
  if (targetBp !== null && marginBp >= targetBp) return 'good';
  return 'neutral';
}

export const JOB_COLUMNS: readonly JobColumn[] = [
  {
    id: 'client',
    label: 'Client',
    defaultOn: true,
    sort: (job) => job.clientName.toLowerCase(),
    cell: (job) => <span className="block max-w-[180px] truncate text-fg-secondary">{job.clientName}</span>,
    csv: (job) => [job.clientName],
  },
  {
    id: 'type',
    label: 'Job type',
    defaultOn: false,
    sort: (job) => job.jobTypeName.toLowerCase(),
    cell: (job) => <span className="block max-w-[150px] truncate text-fg-secondary">{job.jobTypeName}</span>,
    csv: (job) => [job.jobTypeName],
  },
  {
    id: 'site',
    label: 'Site',
    defaultOn: false,
    sort: (job) => job.siteName.toLowerCase(),
    cell: (job) => <span className="block max-w-[150px] truncate text-fg-secondary">{job.siteName}</span>,
    csv: (job) => [job.siteName],
  },
  {
    id: 'owner',
    label: 'Owner',
    defaultOn: false,
    sort: (job) => job.ownerId ?? 'zzz',
    cell: (job) => <PersonAvatar userId={job.ownerId} showName firstNameOnly />,
    csv: (job, ctx) => [ctx.peopleName(job.ownerId)],
  },
  {
    id: 'status',
    label: 'Stage',
    longLabel: 'Stage (planned, active, on hold, completed)',
    defaultOn: false,
    sort: (job) => job.status,
    cell: (job) => <JobStatusBadge status={job.status} />,
    csv: (job) => [JOB_STATUS_LABELS[job.status]],
    csvHeaders: ['Stage'],
  },
  {
    id: 'risk',
    label: 'Status and reason',
    defaultOn: true,
    sort: (job) => riskRank(job),
    className: 'min-w-[260px] max-w-[420px]',
    cell: (job) => (
      <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
        <RiskPill job={job} size="sm" />
        {job.stats.headline ? <span className="line-clamp-2 text-xs text-fg-secondary">{job.stats.headline}</span> : null}
      </div>
    ),
    csv: (job) => [job.stats.riskStatus ? PULSE_STATUS_LABELS[job.stats.riskStatus] : '', job.stats.headline],
    csvHeaders: ['Status', 'Reason'],
  },
  {
    id: 'done',
    label: 'Units done',
    longLabel: 'Units done of planned',
    defaultOn: true,
    sort: (job) => job.stats.pctCompleteBp ?? -1,
    cell: (job) => <UnitsProgress compact done={job.stats.unitsGood} planned={job.plannedUnits} pctBp={job.stats.pctCompleteBp} unit={singularUnit(job.unitLabel)} />,
    csv: (job) => [job.stats.unitsGood, job.plannedUnits],
    csvHeaders: ['Units done', 'Units planned'],
  },
  {
    id: 'hours',
    label: 'Labor hours',
    longLabel: 'Labor hours of plan',
    numeric: true,
    defaultOn: false,
    sort: (job) => Number(job.stats.hours),
    cell: (job) => (
      <span className="whitespace-nowrap">
        {formatHours(job.stats.hours, { maxDigits: 0 })}
        {job.planLaborHours ? <span className="text-fg-muted"> of {formatHours(job.planLaborHours, { maxDigits: 0 })}</span> : null}
      </span>
    ),
    csv: (job) => [job.stats.hours, job.planLaborHours],
    csvHeaders: ['Labor hours', 'Planned labor hours'],
  },
  {
    id: 'margin',
    label: 'Margin now',
    longLabel: 'Margin now and target',
    numeric: true,
    money: true,
    defaultOn: true,
    sort: (job) => job.stats.marginBp,
    cell: (job) =>
      job.stats.moneyHidden ? (
        <Hidden />
      ) : (
        <span className="flex flex-col items-end leading-tight whitespace-nowrap">
          <span className={cn('font-medium', toneClass(marginTone(job.stats.marginBp, job.stats.targetMarginBp)))}>{formatPercentBp(job.stats.marginBp, { empty: 'None yet' })}</span>
          {job.stats.targetMarginBp !== null ? <span className="text-2xs text-fg-muted">target {formatPercentBp(job.stats.targetMarginBp, { digits: 0 })}</span> : null}
        </span>
      ),
    csv: (job) => [job.stats.marginBp === null ? null : job.stats.marginBp / 100, job.stats.targetMarginBp === null ? null : job.stats.targetMarginBp / 100],
    csvHeaders: ['Margin now %', 'Target margin %'],
  },
  {
    id: 'projMargin',
    label: 'Margin at finish',
    longLabel: 'Projected margin at finish',
    numeric: true,
    money: true,
    defaultOn: false,
    sort: (job) => job.stats.projectedMarginBp,
    cell: (job) => (job.stats.moneyHidden ? <Hidden /> : <span className={toneClass(marginTone(job.stats.projectedMarginBp, job.stats.targetMarginBp))}>{formatPercentBp(job.stats.projectedMarginBp, { empty: 'No projection' })}</span>),
    csv: (job) => [job.stats.projectedMarginBp === null ? null : job.stats.projectedMarginBp / 100],
    csvHeaders: ['Projected margin %'],
  },
  {
    id: 'projProfit',
    label: 'Profit at finish',
    longLabel: 'Projected profit at finish',
    numeric: true,
    money: true,
    defaultOn: true,
    sort: (job) => job.stats.projectedProfitCents,
    cell: (job) =>
      job.stats.moneyHidden ? (
        <Hidden />
      ) : job.stats.projectedProfitCents === null ? (
        <span className="text-fg-muted">No projection</span>
      ) : (
        <span className={cn('font-medium', job.stats.projectedProfitCents < 0 ? 'text-danger-text' : 'text-fg')}>{money(job.stats.projectedProfitCents)}</span>
      ),
    csv: (job) => [job.stats.projectedProfitCents === null ? null : formatMoneyPlain(job.stats.projectedProfitCents), job.stats.profitCents === null ? null : formatMoneyPlain(job.stats.profitCents)],
    csvHeaders: ['Projected profit', 'Profit so far'],
  },
  {
    id: 'trend',
    label: 'Trend',
    longLabel: 'Trend, last 12 weeks',
    defaultOn: true,
    cell: (job, ctx) => {
      const values = ctx.trends.get(job.id);
      if (!values || values.every((value) => value === 0)) return <span className="text-xs text-fg-muted">No entries</span>;
      const last = values[values.length - 1] ?? 0;
      return <Sparkline values={[...values]} label={ctx.seesMoney ? `Profit by week for ${job.number}` : `Units by week for ${job.number}`} format={ctx.seesMoney ? 'money' : 'number'} tone={ctx.seesMoney && last < 0 ? 'bad' : 'accent'} width={84} height={24} />;
    },
    csv: () => [],
    csvHeaders: [],
  },
  {
    id: 'due',
    label: 'Due',
    defaultOn: true,
    sort: (job) => job.dueDate ?? '9999',
    cell: (job) => {
      if (!job.dueDate) return <span className="text-fg-muted">No date</span>;
      const late = job.stats.projectedFinishDate !== null && job.stats.projectedFinishDate > job.dueDate && job.status !== 'completed';
      return (
        <span className="flex flex-col leading-tight whitespace-nowrap">
          <span>{shortDate(job.dueDate)}</span>
          {late ? <span className="text-2xs text-danger-text">heading for {shortDate(job.stats.projectedFinishDate as string)}</span> : null}
        </span>
      );
    },
    csv: (job) => [job.dueDate, job.stats.projectedFinishDate],
    csvHeaders: ['Due', 'Projected finish'],
  },
  {
    id: 'last',
    label: 'Last entry',
    defaultOn: false,
    sort: (job) => job.stats.lastEntryDate ?? '0000',
    cell: (job) => (job.stats.lastEntryDate ? <span className="whitespace-nowrap text-fg-secondary">{shortDate(job.stats.lastEntryDate)}</span> : <span className="text-fg-muted">None yet</span>),
    csv: (job) => [job.stats.lastEntryDate],
  },
];

export const DEFAULT_COLUMNS: readonly ColumnId[] = JOB_COLUMNS.filter((column) => column.defaultOn).map((column) => column.id);

export type SortKey = 'worst' | 'number' | 'name' | ColumnId;

export const SORT_OPTIONS: readonly { readonly value: SortKey; readonly label: string }[] = [
  { value: 'worst', label: 'Worst first' },
  { value: 'projProfit', label: 'Profit at finish' },
  { value: 'margin', label: 'Margin now' },
  { value: 'due', label: 'Due date' },
  { value: 'done', label: 'Share done' },
  { value: 'last', label: 'Last entry' },
  { value: 'client', label: 'Client name' },
  { value: 'name', label: 'Job name' },
  { value: 'number', label: 'Job number' },
];

function compare(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}

/** Sorts a copy. "Worst first" is status, then the lowest projected profit, then the due date. */
export function sortJobs(jobs: readonly JobListItemDTO[], key: SortKey, dir: 'asc' | 'desc'): JobListItemDTO[] {
  const list = [...jobs];
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'worst') {
    return list.sort((a, b) => sign * (riskRank(a) - riskRank(b) || compare(a.stats.projectedProfitCents, b.stats.projectedProfitCents) || compare(a.dueDate, b.dueDate) || compare(a.number, b.number)));
  }
  const pick = key === 'number' ? (job: JobListItemDTO) => job.number : key === 'name' ? (job: JobListItemDTO) => job.name.toLowerCase() : (JOB_COLUMNS.find((column) => column.id === key)?.sort ?? ((job: JobListItemDTO) => job.number));
  return list.sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    // Blank values stay at the bottom whichever way the sort runs.
    if (left === null || right === null) return compare(left, right) || compare(a.number, b.number);
    return sign * compare(left, right) || compare(a.number, b.number);
  });
}

/** The header row and the rows of the CSV export for the columns on screen. */
export function jobsCsv(jobs: readonly JobListItemDTO[], columns: readonly ColumnId[], ctx: ColumnContext): { headers: string[]; rows: (string | number | null)[][] } {
  const shown = JOB_COLUMNS.filter((column) => columns.includes(column.id) && (ctx.seesMoney || !column.money));
  const headers = ['Job number', 'Job name', ...shown.flatMap((column) => column.csvHeaders ?? [column.label])];
  const rows = jobs.map((job) => [job.number, job.name, ...shown.flatMap((column) => [...column.csv(job, ctx)])]);
  return { headers, rows };
}
