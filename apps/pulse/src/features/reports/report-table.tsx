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

function toneOf(column: ReportColumnDTO, value: ReportCell): string {
  if (typeof value !== 'number' || value === 0) return '';
  if (column.signed) return (value > 0) === (column.signed === 'up_good') ? 'text-success-text' : 'text-danger-text';
  if ((column.key === 'profit' || column.key === 'margin' || column.key === 'company_profit' || column.key === 'projected_profit') && value < 0) return 'text-danger-text';
  return '';
}

function CellBody({ column, value, hidden }: { readonly column: ReportColumnDTO; readonly value: ReportCell; readonly hidden: boolean }) {
  if (value === null || value === undefined || value === '') return hidden && column.money ? <span className="text-fg-muted">Hidden</span> : <span className="text-fg-muted" aria-label="Nothing">&nbsp;</span>;
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
  return (
    <div data-testid="report-table">
      <div className="overflow-x-auto print:overflow-visible">
        <Table className="min-w-max">
          <TableHead>
            <tr>
              {report.columns.map((column, index) => {
                const numeric = NUMERIC.has(column.kind);
                const active = sort?.key === column.key;
                return (
                  <TableHeaderCell key={column.key} numeric={numeric} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('max-w-[220px] whitespace-normal', index === 0 && 'sticky left-0 z-[1] bg-panel')}>
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
                  return (
                    <TableCell key={column.key} numeric={numeric} className={cn(numeric ? 'whitespace-nowrap' : 'max-w-[320px]', toneOf(column, value), index === 0 && 'sticky left-0 z-[1] bg-panel font-medium')}>
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
                  return (
                    <TableCell key={column.key} numeric={NUMERIC.has(column.kind)} className={cn('whitespace-nowrap', toneOf(column, value), index === 0 && 'sticky left-0 z-[1] bg-sunken')}>
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
