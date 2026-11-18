'use client';
/**
 * Extra service entries: relabeling, rework, inserts, kitting extras and the like, with how many
 * were done, the price of one and the labor they took. Mount it by path anywhere inside the app
 * shell:
 *
 *   <ServiceLedger jobId={job.id} today={today} />
 *   <ServiceLedger clientId={client.id} today={today} />
 *   <ServiceLedger serviceId={service.id} today={today} />
 *
 * Cells edit in place, rows can be added many at a time (paste works), and every change has Undo.
 * An entry pulled from the warehouse says so and links back to its record. Its date, service and
 * count belong to the warehouse and cannot be typed over here. The price and the labor hours can.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Sparkles } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { How } from '@/features/calculator/how';
import { BulkAddDialog, Ledger, bulkProblem, isDate, readNumber, refreshAfterEntry, useLedgerActions, useLedgerRows, type BulkCells, type BulkColumn, type BulkRowResult, type LedgerColumn } from '@/features/costs/ledger-kit';
import { readTarget, useEntryTargets } from '@/features/costs/targets';
import { useShell } from '@/features/shell/shell-context';
import { formatHours, formatMoney, formatNumber, formatUnitPrice } from '@/lib/format';
import { useVasEntries, useVasServices } from '@/lib/hooks/use-data';
import { centsToNumber, sumBy } from '@/lib/money';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { VasEntryDTO } from '@/lib/types';
import { deleteVasEntryAction, restoreVasEntryAction, saveVasEntryAction, type SaveVasEntryActionInput } from '@/server/actions/entries';
import { saveVasEntriesBulkAction, type SaveVasEntriesBulkActionInput } from '@/server/actions/money-ops';

export interface ServiceLedgerProps {
  readonly jobId?: string;
  readonly clientId?: string;
  /** Show the entries of one extra service only. */
  readonly serviceId?: string;
  readonly from?: string | null;
  readonly to?: string | null;
  /** Today in the site's time zone, the date new rows start with. */
  readonly today: string;
  readonly title?: string;
  readonly className?: string;
}

type RowInput = SaveVasEntryActionInput;
type BulkRow = SaveVasEntriesBulkActionInput['rows'][number];
const qty = (value: string | null): string => formatNumber(value ?? '0', { maxDigits: 3 });
/** The warehouse owns these facts of a pulled entry. */
const fromWarehouse = (row: VasEntryDTO): boolean => row.source === 'wms';

/** Where a row came from, when it was not typed in: a link back to the warehouse record when there is one. */
function SourceMark({ row }: { readonly row: VasEntryDTO }) {
  if (row.source === 'manual') return null;
  if (row.source !== 'wms') return <Badge size="sm" tone="neutral">{row.source === 'csv' ? 'Imported' : 'Synced'}</Badge>;
  if (!row.sourceUrl) return <Badge size="sm" tone="neutral">From the warehouse</Badge>;
  return (
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noreferrer"
      title="The warehouse keeps the date, the service and the count of this entry. Opens the warehouse in a new tab."
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium whitespace-nowrap text-fg-secondary hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      data-testid={`service-source-${row.id}`}
    >
      From the warehouse
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function ServiceLedger({ jobId, clientId, serviceId, from, to, today, title = 'Extra services done', className }: ServiceLedgerProps) {
  const shell = useShell();
  const queryClient = useQueryClient();
  const canEdit = shell.can('vas:manage');
  const query = useVasEntries({ jobId, clientId: jobId ? undefined : clientId, serviceId, from, to, limit: 2000 });
  const services = useVasServices({ includeInactive: true });
  const overlay = useLedgerRows<VasEntryDTO>(query.data);
  const rows = overlay.rows;
  const showFor = !jobId;
  const targets = useEntryTargets(showFor, { clients: true, jobs: true, clientId: clientId ?? null });
  const [bulk, setBulk] = useState(false);
  const refresh = () => refreshAfterEntry(queryClient);
  const serviceById = useMemo(() => new Map((services.data ?? []).map((service) => [service.id, service])), [services.data]);
  const serviceOptions = useMemo(() => (services.data ?? []).filter((service) => service.active).map((service) => ({ value: service.id, label: service.name })), [services.data]);

  const toInput = (row: VasEntryDTO): RowInput => ({ id: row.id, version: row.version, vasServiceId: row.vasServiceId, jobId: row.jobId, clientId: row.jobId ? null : row.clientId, workDate: row.workDate, quantity: row.quantity, unitPrice: row.unitPrice, laborClassId: row.laborClassId, headcount: row.headcount, hours: row.hours, overtimeHours: row.overtimeHours, materialCents: row.materialCents, note: row.note });
  const actions = useLedgerActions<VasEntryDTO, RowInput>({ overlay, save: saveVasEntryAction, remove: deleteVasEntryAction, restore: restoreVasEntryAction, toInput, noun: 'entry', nouns: 'entries', refresh });

  const columns = useMemo<LedgerColumn<VasEntryDTO>[]>(
    () => [
      { id: 'workDate', header: 'Date', render: (row) => shortDate(row.workDate), editor: (row) => (fromWarehouse(row) ? null : { kind: 'date', value: row.workDate }) },
      ...(showFor
        ? [
            {
              id: 'for',
              header: 'For',
              render: (row: VasEntryDTO) =>
                row.jobId && targets.jobNumber(row.jobId) ? (
                  <Link href={routes.jobTab(targets.jobNumber(row.jobId) as string, 'money-in')} className="text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                    {targets.jobLabel(row.jobId)}
                  </Link>
                ) : (
                  `Client: ${targets.clientLabel(row.clientId) ?? ''}`
                ),
            } satisfies LedgerColumn<VasEntryDTO>,
          ]
        : []),
      ...(serviceId ? [] : [{ id: 'service', header: 'Service', primary: true, render: (row: VasEntryDTO) => serviceById.get(row.vasServiceId)?.name ?? 'A service', editor: (row: VasEntryDTO) => (fromWarehouse(row) ? null : { kind: 'select' as const, value: row.vasServiceId, options: (services.data ?? []).filter((service) => service.active || service.id === row.vasServiceId).map((service) => ({ value: service.id, label: service.name })) }) } satisfies LedgerColumn<VasEntryDTO>]),
      { id: 'quantity', header: 'How many', numeric: true, primary: Boolean(serviceId), render: (row) => `${qty(row.quantity)} ${serviceById.get(row.vasServiceId)?.unitLabel ?? ''}`.trim(), editor: (row) => (fromWarehouse(row) ? null : { kind: 'number', value: String(Number(row.quantity)) }) },
      { id: 'hours', header: 'Labor hours', numeric: true, render: (row) => (Number(row.hours) > 0 ? formatHours(row.hours) : <span className="text-fg-muted" data-empty-cell>None</span>), editor: (row) => ({ kind: 'number', value: String(Number(row.hours)) }) },
      ...(shell.seesMoney
        ? ([
            { id: 'unitPrice', header: 'Price of one', numeric: true, render: (row) => (row.noPrice ? <Badge size="sm" tone="warning">No price yet</Badge> : formatUnitPrice(row.unitPrice, { empty: 'Hidden' })), editor: (row) => (row.moneyHidden ? null : { kind: 'number', value: row.unitPrice === null ? '' : String(Number(row.unitPrice)), placeholder: '0.00' }) },
            {
              id: 'amount',
              header: 'Earned',
              numeric: true,
              render: (row) => (
                <span className="inline-flex items-center justify-end gap-0.5">
                  {row.noPrice ? formatMoney(0) : formatMoney(row.amountCents, { empty: 'Hidden' })}
                  {row.amountCents !== null || row.noPrice ? (
                    <How
                      title={`${serviceById.get(row.vasServiceId)?.name ?? 'Extra service'} on ${shortDate(row.workDate)}`}
                      formula={serviceById.get(row.vasServiceId)?.billing === 'per_hour' ? 'Labor hours times the price of one hour.' : serviceById.get(row.vasServiceId)?.billing === 'flat' ? 'A flat price for the entry, whatever the count.' : 'How many were done times the price of one.'}
                      lines={[
                        { label: serviceById.get(row.vasServiceId)?.billing === 'per_hour' ? 'Labor hours' : 'How many', value: serviceById.get(row.vasServiceId)?.billing === 'per_hour' ? formatHours(row.hours) : qty(row.quantity), op: 'start' },
                        { label: 'price of one', value: row.noPrice ? 'No price yet' : formatUnitPrice(row.unitPrice), op: 'times' },
                        { label: 'earned', value: formatMoney(row.amountCents ?? 0), op: 'total' },
                        ...(row.laborCostCents !== null ? [{ label: 'Labor cost of the hours', value: formatMoney(row.laborCostCents), op: 'note' as const }] : []),
                        ...(row.materialCents !== null && row.materialCents > 0 ? [{ label: 'Material used', value: formatMoney(row.materialCents), op: 'note' as const }] : []),
                      ]}
                      warnings={[...(row.noPrice ? ['This entry has no price, so the work earned nothing on paper.'] : []), ...(row.needsRate ? ['The hours have no labor rate, so their cost is missing.'] : [])]}
                      className="size-5"
                    />
                  ) : null}
                </span>
              ),
            },
          ] satisfies LedgerColumn<VasEntryDTO>[])
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `services.data` feeds `serviceById`
    [showFor, targets, serviceById, serviceId, shell.seesMoney],
  );

  const onCommit = async (row: VasEntryDTO, columnId: string, value: string): Promise<string | null> => {
    const input = toInput(row);
    let next: VasEntryDTO = row;
    const text = value.trim();
    if (columnId === 'workDate') {
      if (!isDate(text)) return 'Pick a real date.';
      input.workDate = text;
      next = { ...row, workDate: text };
    } else if (columnId === 'service') {
      input.vasServiceId = text;
      next = { ...row, vasServiceId: text };
    } else if (columnId === 'quantity') {
      const amount = readNumber(text, 3);
      if (amount === null || Number(amount) <= 0) return 'Type how many were done, like 120.';
      input.quantity = amount;
      next = { ...row, quantity: amount };
    } else if (columnId === 'hours') {
      const amount = readNumber(text || '0', 2);
      if (amount === null || Number(amount) > 24 * 200) return 'Type the labor hours, like 6.5.';
      if (Number(amount) < Number(row.overtimeHours)) input.overtimeHours = amount;
      input.hours = amount;
      next = { ...row, hours: amount };
    } else if (columnId === 'unitPrice') {
      const cleaned = text.replace(/[$,]/g, '');
      const amount = cleaned === '' ? null : readNumber(cleaned, 4);
      if (cleaned !== '' && amount === null) return 'Type the price of one, like 0.35.';
      input.unitPrice = amount;
      next = { ...row, unitPrice: amount, noPrice: amount === null };
    }
    return actions.commit(row, next, input);
  };

  const bulkColumns = useMemo<BulkColumn[]>(
    () => [
      { id: 'workDate', label: 'Date', kind: 'date', required: true, initial: today, width: '150px' },
      ...(showFor ? [{ id: 'for', label: 'For', kind: 'select' as const, required: true, options: targets.options, width: '220px' }] : []),
      ...(serviceId ? [] : [{ id: 'service', label: 'Service', kind: 'select' as const, required: true, options: serviceOptions, initial: serviceOptions[0]?.value, width: '180px' }]),
      { id: 'quantity', label: 'How many', kind: 'number', required: true, placeholder: '0', width: '110px' },
      { id: 'hours', label: 'Labor hours', kind: 'number', placeholder: '0', width: '110px' },
      ...(shell.seesMoney ? [{ id: 'unitPrice', label: 'Price of one', kind: 'number' as const, placeholder: 'Usual price', width: '120px' }] : []),
    ],
    [showFor, targets.options, serviceOptions, serviceId, today, shell.seesMoney],
  );
  const toBulkInput = (cells: BulkCells): BulkRowResult<BulkRow> => {
    const errors: Record<string, string> = {};
    if (!isDate(cells.workDate ?? '')) errors.workDate = 'Pick a date.';
    const service = serviceId ?? cells.service ?? '';
    if (!serviceById.has(service)) errors.service = 'Pick a service.';
    const quantity = readNumber(cells.quantity ?? '', 3);
    if (quantity === null || Number(quantity) <= 0) errors.quantity = 'Type how many, like 120.';
    const hoursText = (cells.hours ?? '').trim();
    const hours = hoursText ? readNumber(hoursText, 2) : '0';
    if (hours === null) errors.hours = 'Type hours, like 6.5.';
    const priceText = (cells.unitPrice ?? '').replace(/[$,]/g, '').trim();
    const typedPrice = priceText ? readNumber(priceText, 4) : null;
    if (priceText && typedPrice === null) errors.unitPrice = 'Type a price, like 0.35.';
    const target = showFor ? readTarget(cells.for ?? '') : { jobId: jobId ?? null, clientId: jobId ? null : (clientId ?? null) };
    if (!target || (!target.jobId && !target.clientId)) errors.for = 'Pick a job or a client.';
    if (Object.keys(errors).length > 0 || !target || quantity === null || hours === null) return { errors };
    // An empty price takes the usual price of the service. No usual price means "no price yet".
    const price = typedPrice ?? serviceById.get(service)?.defaultPrice ?? null;
    return { input: { ...target, vasServiceId: service, workDate: cells.workDate as string, quantity, hours, unitPrice: price } };
  };

  const earned = sumBy(rows, (row) => row.amountCents);
  const noPrice = rows.filter((row) => row.noPrice).length;
  const noServices = services.isSuccess && serviceOptions.length === 0;

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {title}
          {rows.length > 0 && shell.seesMoney ? (
            <span className="flex items-center gap-1 text-sm font-normal text-fg-secondary tabular-nums" data-testid="service-total">
              {formatMoney(centsToNumber(earned))} earned
              <How
                title={`${title} in this list`}
                formula="What every entry earned, added up. An entry with no price earns nothing until you give it one."
                lines={[{ label: `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`, value: formatMoney(centsToNumber(earned)), op: 'total' }]}
                warnings={noPrice > 0 ? [`${noPrice} ${noPrice === 1 ? 'entry has' : 'entries have'} no price yet.`] : []}
              />
            </span>
          ) : null}
          {noPrice > 0 ? <Badge tone="warning" size="sm">{noPrice} with no price</Badge> : null}
        </span>
      }
      action={
        canEdit && rows.length > 0 && !noServices ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setBulk(true)} data-testid="service-add">
            Add entries
          </Button>
        ) : null
      }
      className={className}
      bodyClassName="p-0"
    >
      <Ledger<VasEntryDTO>
        exportName={`extra-services-done-${today}`}
        testId="service-ledger"
        caption={title}
        columns={columns}
        rows={rows}
        loading={query.isLoading || services.isLoading || (showFor && targets.loading)}
        error={query.isError ? (query.error instanceof Error ? query.error.message : 'Please try again.') : null}
        onRetry={() => void query.refetch()}
        empty={
          <Teach
            size="sm"
            icon={Sparkles}
            title="No extra services logged yet"
            why="Extra services are the paid work around a job: relabeling, rework, inserts, special packing. Log how many were done and the labor they took, and Pulse shows what each service earns and costs, so you know which ones are worth selling."
            points={['How many, the price of one, and the labor hours', 'An entry with no price is flagged until you set one', 'Each service gets its own profit and margin']}
            actions={
              noServices ? (
                <ButtonLink href={routes.services()}>Set up extra services</ButtonLink>
              ) : canEdit ? (
                <Button onClick={() => setBulk(true)} leadingIcon={<Plus aria-hidden />} data-testid="service-add-empty">
                  Add entries
                </Button>
              ) : null
            }
            footnote={noServices ? 'You need at least one extra service in your list before you can log one.' : canEdit ? undefined : 'Ask a manager to log extra services.'}
            testId="service-empty"
          />
        }
        canEdit={canEdit}
        rowName={(row) => `${serviceById.get(row.vasServiceId)?.name ?? 'the service'} on ${shortDate(row.workDate)}`}
        onCommit={onCommit}
        onDelete={(picked) => void actions.removeRows(picked)}
        rowBadges={(row) => <SourceMark row={row} />}
      />
      <BulkAddDialog<BulkRow>
        open={bulk}
        onOpenChange={setBulk}
        testId="service-bulk"
        title="Add extra service entries"
        description="One row per service and day. Leave the price empty to use the usual price of the service."
        columns={bulkColumns}
        noun="entry"
        nouns="entries"
        toInput={toBulkInput}
        onSubmit={async (inputs) => {
          try {
            const result = await saveVasEntriesBulkAction({ rows: [...inputs] });
            if (!result.ok) return bulkProblem(result.error);
            actions.added(result.data);
            return null;
          } catch {
            return { message: 'Check your connection and try again.' };
          }
        }}
      />
    </Panel>
  );
}
