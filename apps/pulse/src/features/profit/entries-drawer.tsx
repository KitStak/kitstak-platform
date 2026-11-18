'use client';
/**
 * The last stop of every drill down: the rows behind a number. Each row says what it is (labor,
 * material, revenue), which job it sits on and where it was typed, and links to the job. The
 * sums at the top add up to the number that was clicked.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { formatDateLong } from '@/components/charts/scale';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { cn } from '@/components/ui/cn';
import type { FactKind } from '@/lib/constants';
import { formatHours, formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import { useProfitEntries, type ProfitParams } from '@/lib/hooks/use-data';
import { sumFacts } from '@/lib/profit/summary';
import { centsToNumber } from '@/lib/money';
import { routes } from '@/lib/routes';
import { downloadCsv } from './csv-download';
import { ENTRY_FILTERS, ENTRY_FILTER_KINDS, ENTRY_FILTER_LABELS, FACT_KIND_LABELS, type EntryFilter } from './profit-model';
import { LoadError, TableSkeleton } from './profit-ui';

const COST_KINDS: ReadonlySet<string> = new Set(['labor', 'material', 'other', 'shared']);

export function EntriesDrawer({ open, onClose, filter, onFilter, scope, title, fileName }: { readonly open: boolean; readonly onClose: () => void; readonly filter: EntryFilter; readonly onFilter: (filter: EntryFilter) => void; readonly scope: ProfitParams; readonly title: string; readonly fileName: string }) {
  const query = useProfitEntries({ ...scope, kinds: ENTRY_FILTER_KINDS[filter] as readonly FactKind[], limit: 1000 }, { enabled: open });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const sums = useMemo(() => {
    const priced = rows.filter((row) => row.amountCents !== null).map((row) => ({ kind: row.kind, amountCents: row.amountCents as number }));
    if (priced.length === 0) return null;
    const totals = sumFacts(priced);
    const cost = totals.laborCents + totals.materialCents + totals.otherCents + totals.sharedCents;
    return { revenue: centsToNumber(totals.revenueCents), cost: centsToNumber(cost), profit: centsToNumber(totals.revenueCents - cost) };
  }, [rows]);
  const exportRows = () =>
    downloadCsv(
      fileName,
      ['Day', 'Job', 'Job name', 'Client', 'What', 'Typed in', 'Extra service', 'Note', 'Units', 'Labor hours', 'Amount'],
      rows.map((row) => [row.workDate, row.jobNumber ?? '', row.jobName ?? '', row.clientName ?? '', FACT_KIND_LABELS[row.kind] ?? row.kind, row.sourceLabel, row.serviceName ?? '', row.note ?? '', Number(row.unitsGood) || '', Number(row.hours) || '', row.amountCents === null ? '' : formatMoneyPlain(COST_KINDS.has(row.kind) ? -row.amountCents : row.amountCents)]),
    );
  return (
    <Drawer open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DrawerContent
        width={860}
        title="Entries behind this number"
        description={title}
        data-testid="entries-drawer"
        actions={
          <Button variant="secondary" size="sm" leadingIcon={<Download aria-hidden />} onClick={exportRows} disabled={rows.length === 0} data-testid="entries-export">
            Export
          </Button>
        }
      >
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div className="max-w-full overflow-x-auto">
            <ToggleGroup label="Which entries to show" size="sm" value={filter} onValueChange={onFilter} options={ENTRY_FILTERS.map((value) => ({ value, label: ENTRY_FILTER_LABELS[value] }))} />
          </div>
          {sums ? (
            <dl className="grid grid-cols-3 gap-3 rounded-lg border border-border-subtle bg-sunken p-3 text-sm tabular-nums" data-testid="entries-sums">
              <div>
                <dt className="text-xs text-fg-muted">Revenue</dt>
                <dd className="font-semibold text-fg">{formatMoney(sums.revenue)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Cost</dt>
                <dd className="font-semibold text-fg">{formatMoney(sums.cost)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Profit</dt>
                <dd className={cn('font-semibold', sums.profit < 0 ? 'text-danger-text' : 'text-fg')}>{formatMoney(sums.profit)}</dd>
              </div>
            </dl>
          ) : null}
          {query.isError ? (
            <LoadError what="the entries" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} compact />
          ) : !query.data ? (
            <TableSkeleton label="Loading the entries" />
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-default px-4 py-8 text-center text-sm text-fg-secondary" data-testid="entries-empty">
              No entries of this kind for these days. Pick Everything to see all of them.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border-subtle">
                <Table className="min-w-[640px]">
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Day</TableHeaderCell>
                      <TableHeaderCell>Job</TableHeaderCell>
                      <TableHeaderCell>What</TableHeaderCell>
                      <TableHeaderCell>Note</TableHeaderCell>
                      <TableHeaderCell numeric>Units</TableHeaderCell>
                      <TableHeaderCell numeric>Hours</TableHeaderCell>
                      <TableHeaderCell numeric>Amount</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {rows.map((row, index) => {
                      const cost = COST_KINDS.has(row.kind);
                      return (
                        <TableRow key={`${row.sourceTable}-${row.sourceId}-${row.kind}-${index}`}>
                          <TableCell className="whitespace-nowrap">{formatDateLong(row.workDate, 'day').replace(/, \d{4}$/, '')}</TableCell>
                          <TableCell className="max-w-[180px]">
                            {row.jobNumber ? (
                              <Link href={routes.jobTab(row.jobNumber, row.kind === 'material' ? 'materials' : row.kind.startsWith('revenue') ? 'money-in' : 'work')} className="inline-flex items-center gap-1 rounded-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                                {row.jobNumber}
                                <ExternalLink aria-hidden className="size-3 text-icon" />
                              </Link>
                            ) : (
                              <span className="text-fg-secondary">{row.clientName ?? 'Client level'}</span>
                            )}
                            {row.jobName ? <span className="block truncate text-xs text-fg-muted">{row.jobName}</span> : null}
                          </TableCell>
                          <TableCell>
                            <span className="block whitespace-nowrap">{FACT_KIND_LABELS[row.kind] ?? row.kind}</span>
                            <span className="block text-xs whitespace-nowrap text-fg-muted">{row.serviceName ?? row.sourceLabel}</span>
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate text-fg-secondary" title={row.note ?? undefined}>
                            {row.note}
                          </TableCell>
                          <TableCell numeric>{Number(row.unitsGood) > 0 ? formatNumber(row.unitsGood, { maxDigits: 0 }) : ''}</TableCell>
                          <TableCell numeric>{Number(row.hours) > 0 ? formatHours(row.hours, { maxDigits: 1 }) : ''}</TableCell>
                          <TableCell numeric className={cn('whitespace-nowrap', cost ? 'text-fg-secondary' : 'text-fg')}>
                            {row.amountCents === null ? <span className="text-fg-muted">Hidden</span> : formatMoney(cost ? -row.amountCents : row.amountCents)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-fg-muted">
                {rows.length} {rows.length === 1 ? 'entry' : 'entries'}. Costs show with a minus sign. {query.data.truncated ? 'Only the newest 1,000 are shown. Narrow the dates to see the rest.' : ''}
              </p>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
