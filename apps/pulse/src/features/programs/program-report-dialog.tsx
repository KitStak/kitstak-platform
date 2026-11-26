'use client';
/**
 * "Print report": the monthly program report (spec 7.4) in a dialog. Pick Internal or For the
 * customer, look it over, then Print, PDF or CSV. The preview, the page to print, the PDF and the
 * CSV all come from the same built report, so they can never disagree.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Download, FileText, Lock, Printer } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { apiGet, apiPath } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { LoadError } from '@/features/profit/profit-ui';
import { PROGRAM_REPORT_VERSION_HINTS, PROGRAM_REPORT_VERSION_LABELS, PROGRAM_REPORT_VERSIONS, type ProgramReportDTO, type ProgramReportTable, type ProgramReportVersion } from './program-report';
import { cellText, summaryColumns, summaryText } from './program-report-format';
import { monthLabel } from './program-format';
import { SectionSkeleton } from './program-ui';

export interface ProgramReportTarget {
  readonly key: string;
  readonly name: string;
  readonly month: string;
}

export function ProgramReportDialog({ target, onClose, seesMoney }: { readonly target: ProgramReportTarget | null; readonly onClose: () => void; readonly seesMoney: boolean }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {target ? <ReportBody key={`${target.key}-${target.month}`} target={target} seesMoney={seesMoney} /> : null}
    </Dialog>
  );
}

function ReportBody({ target, seesMoney }: { readonly target: ProgramReportTarget; readonly seesMoney: boolean }) {
  // A reader without money rights gets the units only copy, which is the customer shape.
  const [version, setVersion] = useState<ProgramReportVersion>(seesMoney ? 'internal' : 'customer');
  const query = useQuery({
    queryKey: [...qk.programsRoot(), 'report', target.key.toUpperCase(), target.month, version],
    queryFn: () => apiGet<ProgramReportDTO>(apiPath(`programs/${encodeURIComponent(target.key)}/report`, { month: target.month, version })),
    staleTime: 30_000,
  });
  const report = query.data;
  const file = (format: 'csv' | 'pdf' | 'html', extra: Record<string, string | number> = {}) => apiPath(`programs/${encodeURIComponent(target.key)}/report`, { month: target.month, version, format, ...extra });
  const secondary = cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'no-underline');
  return (
    <DialogContent size="xl" data-testid="program-report-dialog">
      <DialogHeader title="Monthly program report" description={`${target.key}, ${target.name}, ${monthLabel(target.month)}`} icon={<FileText aria-hidden className="size-5 text-icon" />} />
      <DialogBody className="flex flex-col gap-4 pb-4">
        {seesMoney ? (
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup label="Report version" value={version} onValueChange={setVersion} options={PROGRAM_REPORT_VERSIONS.map((value) => ({ value, label: PROGRAM_REPORT_VERSION_LABELS[value] }))} />
            <p className="flex items-center gap-1.5 text-sm text-fg-secondary" data-testid="report-version-hint">
              {version === 'customer' ? <Lock aria-hidden className="size-3.5 text-icon" /> : null}
              {PROGRAM_REPORT_VERSION_HINTS[version]}
            </p>
          </div>
        ) : (
          <p className="text-sm text-fg-secondary">Your role does not show money, so this copy has kits and hours only.</p>
        )}
        {query.isError && !report ? (
          <LoadError what="the report" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} compact />
        ) : !report ? (
          <div className="rounded-xl border border-border-subtle bg-panel">
            <SectionSkeleton label="Building the report" rows={8} />
          </div>
        ) : (
          <article className={cn('flex flex-col gap-4 rounded-xl border border-border-subtle bg-panel p-5 shadow-xs transition-opacity', query.isFetching && 'opacity-70')} aria-label="Report preview" data-testid="program-report-preview">
            <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border-strong pb-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-fg">{report.title}</h3>
                <p className="text-sm text-fg-secondary">{report.subtitle}</p>
              </div>
              <p className="text-right text-xs text-fg-muted">
                {report.versionLabel}
                {report.cardLabel ? `, ${report.cardLabel}` : ''}
              </p>
            </header>
            <p className={cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium', report.final ? 'bg-sunken text-fg' : 'bg-warning-subtle text-warning-text')} data-testid="report-status">
              {report.final ? null : <CircleAlert aria-hidden className="size-4 shrink-0" />}
              {report.statusNote}
            </p>
            <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-4', summaryColumns(report.summary.length) === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4')} data-testid="report-totals">
              {report.summary.map((item) => (
                <div key={item.key} className="min-w-0">
                  <dt className="text-xs font-medium text-fg-secondary">{item.label}</dt>
                  <dd className={cn('mt-0.5 truncate text-lg font-semibold tabular-nums', typeof item.value === 'number' && item.value < 0 && item.kind === 'money' ? 'text-danger-text' : 'text-fg')}>{summaryText(item)}</dd>
                  {item.note ? <dd className="text-xs text-fg-muted">{item.note}</dd> : null}
                </div>
              ))}
            </dl>
            {report.tables.map((table) => (
              <section key={table.id} className="flex flex-col gap-2" data-testid={`report-table-${table.id}`}>
                <h4 className="text-sm font-semibold text-fg">{table.title}</h4>
                <div className="overflow-hidden rounded-lg border border-border-subtle">
                  <PreviewTable table={table} />
                </div>
              </section>
            ))}
            {report.notes.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h4 className="text-sm font-semibold text-fg">Notes</h4>
                <ul className="list-disc pl-5 text-sm text-fg-secondary">
                  {report.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>
        )}
      </DialogBody>
      <DialogFooter className="flex-wrap">
        <p className="mr-auto text-xs text-fg-muted">The totals match the program page to the cent.</p>
        <a href={file('html', { print: 1 })} target="_blank" rel="noreferrer" className={secondary} data-testid="report-print">
          <Printer aria-hidden className="size-4" />
          Print
        </a>
        <a href={file('pdf')} download className={secondary} data-testid="report-pdf">
          <FileText aria-hidden className="size-4" />
          PDF
        </a>
        <a href={file('csv')} download className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'no-underline')} data-testid="report-csv">
          <Download aria-hidden className="size-4" />
          CSV
        </a>
      </DialogFooter>
    </DialogContent>
  );
}

const NUMERIC = new Set(['money', 'percent', 'number', 'hours', 'pace']);

/** One table of the report, cell for cell as it prints. */
function PreviewTable({ table }: { readonly table: ProgramReportTable }) {
  const tone = (kind: string, value: unknown) => (kind === 'money' && typeof value === 'number' && value < 0 ? 'text-danger-text' : '');
  return (
    <Table aria-label={table.title} className="min-w-max">
      <TableHead>
        <tr>
          {table.columns.map((column, index) => (
            <TableHeaderCell key={column.key} numeric={NUMERIC.has(column.kind)} className={cn(index === 0 && 'pl-3', index === table.columns.length - 1 && 'pr-3')}>
              {column.label}
            </TableHeaderCell>
          ))}
        </tr>
      </TableHead>
      <TableBody>
        {table.rows.map((row) => (
          <TableRow key={row.id}>
            {table.columns.map((column, index) => {
              const value = row.cells[column.key] ?? null;
              return (
                <TableCell key={column.key} numeric={NUMERIC.has(column.kind)} className={cn('whitespace-nowrap', index === 0 && 'pl-3 font-medium', tone(column.kind, value))}>
                  {cellText(value, column.kind)}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
      {table.total ? (
        <tfoot>
          <tr className="h-10 border-t-2 border-border-strong bg-sunken font-semibold">
            {table.columns.map((column, index) => (
              <TableCell key={column.key} numeric={NUMERIC.has(column.kind)} className={cn('whitespace-nowrap', index === 0 && 'pl-3')}>
                {cellText(table.total?.[column.key] ?? null, column.kind)}
              </TableCell>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </Table>
  );
}
