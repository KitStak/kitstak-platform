'use client';
/**
 * The table of a built report: sortable columns, a sticky first column, a total row, status
 * pills, and rows that link to the job or client behind them. Sorting happens here, on the rows
 * the server sent, so the CSV download (same rows, server order) and the screen hold the same data.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { MarginPill } from '@/components/charts/stats';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/cn';
import { JOB_STATUS_LABELS, PULSE_STATUSES, type JobStatusValue, type PulseStatus } from '@/lib/constants';
import type { ReportCell, ReportCellKind, ReportColumnDTO, ReportDTO } from '@/lib/types';
import { reportCellText } from './report-format';

const NUMERIC: ReadonlySet<ReportCellKind> = new Set<ReportCellKind>(['money', 'percent', 'number', 'hours', 'pace']);

/**
 * The answer columns of a money report. On a wide report they stay pinned to the right edge from
 * 768 px while the rest scrolls under them, so Cost, Profit and Job margin are on screen without
 * scrolling. A phone gets one card per row instead, with these numbers first.
 */
const PINNED_KEYS: readonly string[] = ['cost', 'profit', 'margin'];
/** A report that goes down to the company number pins that answer instead. */
const COMPANY_KEYS: readonly string[] = ['company_profit', 'company_margin'];
const PIN_WIDTH = 116;

/** The keys of the answer columns this report has, in column order. */
function answerKeys(columns: readonly ReportColumnDTO[]): readonly string[] {
  const keys = columns.some((column) => COMPANY_KEYS.includes(column.key)) ? COMPANY_KEYS : PINNED_KEYS;
  return columns.filter((column) => keys.includes(column.key)).map((column) => column.key);
}

/** Classes and the right offset for a pinned column, or null for a column that scrolls. */
function pinOf(columns: readonly ReportColumnDTO[], key: string): { readonly className: string; readonly right: number } | null {
  const pinned = answerKeys(columns);
  const index = pinned.indexOf(key);
  // Pinning only pays off on a table wide enough to scroll.
  if (index < 0 || columns.length < 9) return null;
  return {
    // A hairline on the left edge of the pinned block, where the scrolling columns slide under it.
    className: cn('z-[1] w-[116px] max-w-[116px] min-w-[116px] md:sticky print:static', index === 0 && 'md:shadow-[-1px_0_0_var(--border-default)]'),
    right: (pinned.length - 1 - index) * PIN_WIDTH,
  };
}

/** The columns of a phone card after the name: revenue and the answer columns first, then the rest in report order. */
function cardColumns(columns: readonly ReportColumnDTO[]): { readonly column: ReportColumnDTO; readonly key: boolean }[] {
  const first = ['revenue', ...answerKeys(columns)];
  const rest = columns.slice(1);
  return [...first.flatMap((key) => rest.filter((column) => column.key === key)).map((column) => ({ column, key: true })), ...rest.filter((column) => !first.includes(column.key)).map((column) => ({ column, key: false }))];
}

const isBlank = (value: ReportCell): boolean => value === null || value === undefined || value === '';

function toneOf(column: ReportColumnDTO, value: ReportCell): string {
  if (typeof value !== 'number' || value === 0) return '';
  if (column.signed) return (value > 0) === (column.signed === 'up_good') ? 'text-success-text' : 'text-danger-text';
  if ((column.key === 'profit' || column.key === 'margin' || column.key === 'company_profit' || column.key === 'projected_profit') && value < 0) return 'text-danger-text';
  return '';
}

function CellBody({ column, value, hidden }: { readonly column: ReportColumnDTO; readonly value: ReportCell; readonly hidden: boolean }) {
  if (value === null || value === undefined || value === '') return hidden && column.money ? <span className="text-fg-muted">Hidden</span> : <span className="text-fg-muted"><span className="sr-only">Nothing</span>&nbsp;</span>;
  if (column.kind === 'status' && (PULSE_STATUSES as readonly string[]).includes(String(value))) return <MarginPill status={value as PulseStatus} size="sm" />;
  if (column.kind === 'job_status') return <span className="whitespace-nowrap">{JOB_STATUS_LABELS[value as JobStatusValue] ?? String(value)}</span>;
  return <>{reportCellText(value, column.kind)}</>;
}

export function ReportTable({ report, pageSize = 100 }: { readonly report: Pick<ReportDTO, 'columns' | 'rows' | 'total' | 'moneyHidden'>; readonly pageSize?: number }) {
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [shown, setShown] = useState(pageSize);
  const rows = useMemo(() => {
    if (!sort) return report.rows;
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...report.rows].sort((a, b) => {
      const left = a.cells[sort.key] ?? null;
      const right = b.cells[sort.key] ?? null;
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign;
      return String(left).localeCompare(String(right)) * sign;
    });
  }, [report.rows, sort]);
  const visible = rows.slice(0, shown);
  const cycle = (key: string, numeric: boolean) =>
    setSort((current) => (current?.key !== key ? { key, direction: numeric ? 'desc' : 'asc' } : current.direction === (numeric ? 'desc' : 'asc') ? { key, direction: numeric ? 'asc' : 'desc' } : null));
  const cards = cardColumns(report.columns);
  const nameColumn = report.columns[0];
  /** The label and value pairs of one card. A blank cell is left out, unless it is money this reader cannot see. */
  const pairs = (cells: Readonly<Record<string, ReportCell>>, strong: boolean) =>
    cards
      .filter(({ column }) => !isBlank(cells[column.key] ?? null) || (report.moneyHidden && column.money))
      .map(({ column, key }) => {
        const value = cells[column.key] ?? null;
        return (
          <div key={column.key} className="min-w-0">
            <dt className="text-xs font-normal text-fg-muted">{column.label}</dt>
            <dd className={cn('text-fg', (key || strong) && 'font-medium', toneOf(column, value))}>
              <CellBody column={column} value={value} hidden={report.moneyHidden} />
            </dd>
          </div>
        );
      });
  return (
    <div data-testid="report-table">
      {/* Phones: one card per row with label and value, so no number starts off screen. Print always uses the table. */}
      <ul className="flex flex-col divide-y divide-border-subtle md:hidden print:hidden" aria-label="Report rows" data-testid="report-cards">
        {nameColumn
          ? visible.map((row) => {
              const name = <CellBody column={nameColumn} value={row.cells[nameColumn.key] ?? null} hidden={report.moneyHidden} />;
              return (
                <li key={row.id} className="flex flex-col gap-2 px-4 py-3" data-testid="report-card">
                  <div className="text-sm font-medium text-fg">
                    {row.href ? (
                      <Link href={row.href} className="rounded-sm text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm tabular-nums">{pairs(row.cells, false)}</dl>
                </li>
              );
            })
          : null}
        {report.total && nameColumn ? (
          <li className="flex flex-col gap-2 bg-sunken px-4 py-3" data-testid="report-card-total">
            <div className="text-sm font-semibold text-fg">{isBlank(report.total[nameColumn.key] ?? null) ? 'Total' : reportCellText(report.total[nameColumn.key] ?? null, nameColumn.kind)}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm tabular-nums">{pairs(report.total, true)}</dl>
          </li>
        ) : null}
      </ul>
      <div className="hidden md:block print:block">
        <Table className="min-w-max" aria-label="Report rows">
          <TableHead>
            <tr>
              {report.columns.map((column, index) => {
                const numeric = NUMERIC.has(column.kind);
                const active = sort?.key === column.key;
                const pin = pinOf(report.columns, column.key);
                return (
                  <TableHeaderCell key={column.key} numeric={numeric} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} style={pin ? { right: pin.right } : undefined} className={cn('max-w-[220px] whitespace-normal', index === 0 && 'sticky left-0 z-[1] bg-panel max-lg:max-w-[168px]', pin && 'bg-panel', pin?.className)}>
                    <button
                      type="button"
                      onClick={() => cycle(column.key, numeric)}
                      className={cn('inline-flex items-center gap-1 rounded-sm text-left hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus print:pointer-events-none', numeric && 'flex-row-reverse text-right', active && 'text-fg')}
                      aria-label={`Sort by ${column.label}`}
                    >
                      <span>{column.label}</span>
                      {active ? sort.direction === 'asc' ? <ArrowUp aria-hidden className="size-3 shrink-0" /> : <ArrowDown aria-hidden className="size-3 shrink-0" /> : <ArrowUpDown aria-hidden className="size-3 shrink-0 opacity-40 print:hidden" />}
                    </button>
                  </TableHeaderCell>
                );
              })}
            </tr>
          </TableHead>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                {report.columns.map((column, index) => {
                  const value = row.cells[column.key] ?? null;
                  const numeric = NUMERIC.has(column.kind);
                  const body = <CellBody column={column} value={value} hidden={report.moneyHidden} />;
                  const pin = pinOf(report.columns, column.key);
                  return (
                    <TableCell key={column.key} numeric={numeric} style={pin ? { right: pin.right } : undefined} className={cn(numeric ? 'whitespace-nowrap' : 'max-w-[320px]', toneOf(column, value), index === 0 && 'sticky left-0 z-[1] bg-panel font-medium max-lg:max-w-[168px]', pin && 'bg-panel font-medium', pin?.className)}>
                      {index === 0 && row.href ? (
                        <Link href={row.href} className="rounded-sm text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
          {report.total ? (
            <tfoot>
              <tr className="h-10 border-t-2 border-border-strong bg-sunken font-semibold">
                {report.columns.map((column, index) => {
                  const value = report.total?.[column.key] ?? null;
                  const pin = pinOf(report.columns, column.key);
                  return (
                    <TableCell key={column.key} numeric={NUMERIC.has(column.kind)} style={pin ? { right: pin.right } : undefined} className={cn('whitespace-nowrap', toneOf(column, value), index === 0 && 'sticky left-0 z-[1] bg-sunken', pin && 'bg-sunken', pin?.className)}>
                      {index === 0 && (value === null || value === '') ? 'Total' : value === null || value === '' ? '' : reportCellText(value, column.kind)}
                    </TableCell>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </Table>
      </div>
      {rows.length > shown ? (
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 text-sm text-fg-secondary print:hidden">
          <span>
            Showing {visible.length} of {rows.length} rows
          </span>
          <button type="button" onClick={() => setShown((count) => count + pageSize * 2)} className="rounded-md font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="report-more">
            Show more rows
          </button>
        </div>
      ) : null}
    </div>
  );
}
