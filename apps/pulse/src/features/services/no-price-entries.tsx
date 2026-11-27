'use client';
/**
 * The extra service entries with no price, every service in one list, with "Set the price" on each
 * row (round four, designer issue 3). It is where "Fix this first" on month close and "Things to
 * fix" on Home lead, and it lists exactly the entries they count: with a month, the entries dated
 * in that month; without one, the entries in every month that is still open.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { ScrollX } from '@/components/ui/scroll-x';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { formatDateLong } from '@/components/charts/scale';
import { formatHours, formatNumber } from '@/lib/format';
import { useVasEntries } from '@/lib/hooks/use-data';
import { endOfMonth } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { VasServiceDTO } from '@/lib/types';
import { useEntryTargets } from '@/features/costs/targets';
import { LoadError, Section, TableSkeleton } from '@/features/profit/profit-ui';
import { SetEntryPrice, WarehouseContractLink, WarehouseSourceLink } from '@/features/revenue/entry-price-fix';
import { useShell } from '@/features/shell/shell-context';
import { unitWord } from './services-model';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-10` from the address, or null. */
export function noPriceMonth(raw: string | null | undefined): string | null {
  return raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null;
}

export function NoPriceEntries({ month, services, onShowAll }: { readonly month: string | null; readonly services: readonly VasServiceDTO[]; readonly onShowAll: () => void }) {
  const shell = useShell();
  const canFix = shell.can('vas:manage');
  const from = month ? `${month}-01` : null;
  const to = from ? endOfMonth(from) : null;
  const entries = useVasEntries({ noPrice: true, from, to, openMonths: month === null, limit: 2000 });
  const targets = useEntryTargets(true, { clients: true, jobs: true });
  const serviceById = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const rows = entries.data ?? [];
  const where = month ? `in ${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` : 'in months that are still open';

  return (
    <Section
      title={`Entries with no price${entries.data ? `, ${rows.length}` : ''}`}
      hint={`Extra service entries ${where}. Each one earns nothing on paper until it has a price.`}
      bodyClassName="p-0"
      testId="services-no-price"
      action={
        <button type="button" onClick={onShowAll} className="rounded-sm text-sm font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="services-no-price-back">
          Show every service
        </button>
      }
    >
      {entries.isError ? (
        <div className="p-4">
          <LoadError what="the entries with no price" message={entries.error instanceof Error ? entries.error.message : undefined} onRetry={() => void entries.refetch()} compact />
        </div>
      ) : !entries.data || targets.loading ? (
        <TableSkeleton label="Loading the entries with no price" rows={4} />
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-fg-secondary" data-testid="services-no-price-empty">
          Every extra service entry {where} has a price. Nothing to fix here.
        </p>
      ) : (
        <>
          {!canFix || shell.seesMoney === false ? (
            <p className="border-b border-border-subtle px-4 py-2 text-sm text-fg-secondary">{shell.seesMoney ? 'Ask someone who manages extra services to set these prices.' : 'Prices are hidden for your role. Ask someone who manages extra services to set them.'}</p>
          ) : null}
          <ScrollX label="Entries with no price" scrollerClassName="max-h-[560px] overflow-y-auto">
            <Table scroll={false} className="min-w-[680px]" data-testid="services-no-price-table">
              <TableHead className="sticky top-0 z-[1]">
                <tr>
                  <TableHeaderCell>Day</TableHeaderCell>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell>Client and job</TableHeaderCell>
                  <TableHeaderCell numeric>How many</TableHeaderCell>
                  <TableHeaderCell numeric>Fix it</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {rows.map((entry) => {
                  const service = serviceById.get(entry.vasServiceId);
                  const jobNumber = targets.jobNumber(entry.jobId);
                  return (
                    <TableRow key={entry.id} data-testid="services-no-price-row">
                      <TableCell className="whitespace-nowrap">{formatDateLong(entry.workDate, 'day')}</TableCell>
                      <TableCell className="max-w-[220px]">
                        {service ? (
                          <Link href={routes.service(service.id)} className="block truncate rounded-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                            {service.name}
                          </Link>
                        ) : (
                          'A service'
                        )}
                        {entry.source === 'wms' ? (
                          <span className="mt-0.5 flex">
                            <WarehouseSourceLink entry={entry} testId={`no-price-source-${entry.id}`} />
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <span className="block truncate">{targets.clientLabel(entry.clientId) ?? 'Client'}</span>
                        {jobNumber ? (
                          <Link href={routes.jobTab(jobNumber, 'money-in')} className="rounded-sm text-xs text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                            {targets.jobLabel(entry.jobId)}
                          </Link>
                        ) : (
                          <span className="text-xs text-fg-muted">No job, billed to the client</span>
                        )}
                      </TableCell>
                      <TableCell numeric className="whitespace-nowrap">
                        {service?.billing === 'per_hour' ? formatHours(entry.hours, { maxDigits: 2 }) : `${formatNumber(entry.quantity, { maxDigits: 3 })} ${service?.unitLabel ?? ''}`.trim()}
                      </TableCell>
                      <TableCell numeric>
                        <span className="flex flex-col items-end gap-1">
                          <SetEntryPrice entry={entry} serviceName={service?.name ?? 'This service'} unitWord={unitWord(service?.unitLabel ?? 'unit')} canEdit={canFix} perHour={service?.billing === 'per_hour'} />
                          <WarehouseContractLink entry={entry} testId={`no-price-contract-${entry.id}`} />
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollX>
        </>
      )}
    </Section>
  );
}
