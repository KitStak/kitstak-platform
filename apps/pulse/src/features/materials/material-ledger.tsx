'use client';
/**
 * Material usage: the parts a job really used, with scrap and the cost of one part. Mount it by
 * path anywhere inside the app shell:
 *
 *   <MaterialLedger jobId={job.id} jobRef={job.number} today={today} />     one job, with the warehouse pull
 *   <MaterialLedger clientId={client.id} today={today} />                   every job of a client
 *   <MaterialLedger today={today} from={monthStart} to={monthEnd} />        every job
 *
 * Cells edit in place, rows can be added many at a time (paste works), every change has Undo,
 * and when the job is linked to a warehouse work order one click pulls the parts it used.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, PackageSearch, Plus } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Skeleton, toast } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { Teach } from '@/components/pulse/teach';
import { How } from '@/features/calculator/how';
import { keepOpenForToasts } from '@/features/calculator/toast-safe';
import { BulkAddDialog, Ledger, bulkProblem, isDate, readNumber, refreshAfterEntry, useLedgerActions, useLedgerRows, type BulkCells, type BulkColumn, type BulkRowResult, type LedgerColumn } from '@/features/costs/ledger-kit';
import { useEntryTargets } from '@/features/costs/targets';
import { useShell } from '@/features/shell/shell-context';
import { apiGet, apiPath } from '@/lib/api-client';
import { formatMoney, formatNumber, formatUnitPrice } from '@/lib/format';
import { useMaterialUsage } from '@/lib/hooks/use-data';
import { centsToNumber, sumBy } from '@/lib/money';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { MaterialUsageDTO } from '@/lib/types';
import { deleteMaterialUsageAction, restoreMaterialUsageAction, saveMaterialUsageAction, type SaveMaterialUsageActionInput } from '@/server/actions/entries';
import { pullWmsUsageAction, saveMaterialUsageBulkAction } from '@/server/actions/money-ops';
import type { WmsUsagePreviewDTO } from '@/server/domain/ledger';

export interface MaterialLedgerProps {
  /** Fix the ledger to one job. Leave it out to list every job (or every job of `clientId`). */
  readonly jobId?: string;
  /** The job's number or id, for the warehouse pull. Only used with `jobId`. */
  readonly jobRef?: string;
  readonly clientId?: string;
  readonly from?: string | null;
  readonly to?: string | null;
  /** Today in the site's time zone, the date new rows start with. */
  readonly today: string;
  readonly title?: string;
  readonly className?: string;
}

type RowInput = SaveMaterialUsageActionInput;
const BOUGHT_BY = [
  { value: 'default', label: "The job's setting" },
  { value: 'us', label: 'We bought them' },
  { value: 'client', label: 'The client sent them' },
] as const;
const qty = (value: string | null): string => formatNumber(value ?? '0', { maxDigits: 3 });

export function MaterialLedger({ jobId, jobRef, clientId, from, to, today, title = 'Parts used', className }: MaterialLedgerProps) {
  const shell = useShell();
  const queryClient = useQueryClient();
  const canEdit = shell.can('material:log');
  const query = useMaterialUsage({ jobId, clientId: jobId ? undefined : clientId, from, to, limit: 2000 });
  const overlay = useLedgerRows<MaterialUsageDTO>(query.data);
  const rows = overlay.rows;
  const showJob = !jobId;
  const targets = useEntryTargets(showJob, { jobs: true, clientId: clientId ?? null });
  const [bulk, setBulk] = useState(false);
  const [pull, setPull] = useState(false);
  const refresh = () => refreshAfterEntry(queryClient);
  const wms = useQuery({ queryKey: ['streams', 'wms-usage', jobRef ?? ''], queryFn: () => apiGet<WmsUsagePreviewDTO>(apiPath('materials/wms-preview', { job: jobRef })), enabled: Boolean(jobId && jobRef && shell.integrations.wms), staleTime: 30_000 });

  const toInput = (row: MaterialUsageDTO): RowInput => ({ id: row.id, version: row.version, jobId: row.jobId, usageDate: row.usageDate, itemId: row.itemId, itemSku: row.itemSku, itemName: row.itemName, quantityUsed: row.quantityUsed, quantityScrapped: row.quantityScrapped, unitCost: row.unitCost, uom: row.uom, lot: row.lot, suppliedBy: row.suppliedBy, note: row.note });
  const actions = useLedgerActions<MaterialUsageDTO, RowInput>({ overlay, save: saveMaterialUsageAction, remove: deleteMaterialUsageAction, restore: restoreMaterialUsageAction, toInput, noun: 'usage row', refresh });

  const columns = useMemo<LedgerColumn<MaterialUsageDTO>[]>(
    () => [
      { id: 'usageDate', header: 'Date', render: (row) => shortDate(row.usageDate), editor: (row) => ({ kind: 'date', value: row.usageDate }) },
      ...(showJob
        ? [
            {
              id: 'job',
              header: 'Job',
              render: (row: MaterialUsageDTO) =>
                targets.jobNumber(row.jobId) ? (
                  <Link href={routes.jobTab(targets.jobNumber(row.jobId) as string, 'materials')} className="text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                    {targets.jobLabel(row.jobId)}
                  </Link>
                ) : (
                  (targets.jobLabel(row.jobId) ?? 'A job')
                ),
            } satisfies LedgerColumn<MaterialUsageDTO>,
          ]
        : []),
      { id: 'itemName', header: 'Part', primary: true, render: (row) => row.itemName ?? row.itemSku ?? <span className="text-fg-muted">Add a name</span>, editor: (row) => ({ kind: 'text', value: row.itemName ?? '', placeholder: 'Name of the part' }) },
      // The list of every job is wide already, so the SKU column shows only on a single job.
      ...(showJob ? [] : [{ id: 'itemSku', header: 'SKU', render: (row: MaterialUsageDTO) => row.itemSku ?? <span className="text-fg-muted">None</span> } satisfies LedgerColumn<MaterialUsageDTO>]),
      { id: 'quantityUsed', header: 'Used', numeric: true, render: (row) => qty(row.quantityUsed), editor: (row) => ({ kind: 'number', value: String(Number(row.quantityUsed)) }) },
      { id: 'quantityScrapped', header: 'Scrapped', numeric: true, render: (row) => (Number(row.quantityScrapped) > 0 ? qty(row.quantityScrapped) : <span className="text-fg-muted">0</span>), editor: (row) => ({ kind: 'number', value: String(Number(row.quantityScrapped)) }) },
      ...(shell.seesMoney
        ? ([
            { id: 'unitCost', header: 'Cost of one', numeric: true, render: (row) => (row.unitCost === null ? 'Hidden' : formatUnitPrice(row.unitCost)), editor: (row) => (row.unitCost === null ? null : { kind: 'number', value: String(Number(row.unitCost)) }) },
            { id: 'suppliedBy', header: 'Who bought them', render: (row) => (row.resolvedSuppliedBy === 'client' ? 'Client' : 'Us') + (row.suppliedBy === null ? ' (job setting)' : ''), editor: (row) => ({ kind: 'select', value: row.suppliedBy ?? 'default', options: BOUGHT_BY }) },
            {
              id: 'cost',
              header: 'Cost',
              numeric: true,
              render: (row) => (
                <span className="inline-flex items-center justify-end gap-0.5">
                  {formatMoney(row.costCents, { empty: 'Hidden' })}
                  {row.costCents !== null ? (
                    <How
                      title={`Cost of ${row.itemName ?? row.itemSku ?? 'this part'}`}
                      formula={row.resolvedSuppliedBy === 'client' ? 'The client sent these parts, so they cost the job nothing.' : 'Parts used plus parts scrapped, times the cost of one part.'}
                      lines={
                        row.resolvedSuppliedBy === 'client'
                          ? [{ label: 'Parts from the client', value: formatMoney(0), op: 'total' }]
                          : [
                              { label: 'Parts used', value: qty(row.quantityUsed), op: 'start' },
                              { label: 'parts scrapped', value: qty(row.quantityScrapped), op: 'plus' },
                              { label: 'cost of one part', value: formatUnitPrice(row.unitCost), op: 'times' },
                              { label: 'cost on the job', value: formatMoney(row.costCents), op: 'total' },
                              ...(row.scrapCents !== null && row.scrapCents > 0 ? [{ label: 'Of that, lost to scrap', value: formatMoney(row.scrapCents), op: 'note' as const }] : []),
                            ]
                      }
                      warnings={row.resolvedSuppliedBy !== 'client' && Number(row.unitCost ?? 0) === 0 ? ['This part has no cost yet, so it adds nothing to the job.'] : []}
                      className="size-5"
                    />
                  ) : null}
                </span>
              ),
            },
          ] satisfies LedgerColumn<MaterialUsageDTO>[])
        : []),
    ],
    [showJob, targets, shell.seesMoney],
  );

  const onCommit = async (row: MaterialUsageDTO, columnId: string, value: string): Promise<string | null> => {
    const input = toInput(row);
    let next: MaterialUsageDTO = row;
    const text = value.trim();
    if (columnId === 'usageDate') {
      if (!isDate(text)) return 'Pick a real date.';
      input.usageDate = text;
      next = { ...row, usageDate: text };
    } else if (columnId === 'itemName') {
      if (!text && !row.itemSku) return 'Give the part a name.';
      input.itemName = text || null;
      next = { ...row, itemName: text || null };
    } else if (columnId === 'quantityUsed' || columnId === 'quantityScrapped') {
      const amount = readNumber(text, 3);
      if (amount === null) return 'Type a number, like 250.';
      if (columnId === 'quantityUsed' && Number(amount) <= 0 && Number(row.quantityScrapped) <= 0) return 'Type how many were used. It must be more than zero.';
      input[columnId] = amount;
      next = { ...row, [columnId]: amount };
    } else if (columnId === 'unitCost') {
      const amount = readNumber(text.replace(/[$,]/g, ''), 4);
      if (amount === null) return 'Type the cost of one part, like 0.42.';
      input.unitCost = amount;
      next = { ...row, unitCost: amount };
    } else if (columnId === 'suppliedBy') {
      const picked = text === 'us' || text === 'client' ? text : null;
      input.suppliedBy = picked;
      next = { ...row, suppliedBy: picked };
    }
    return actions.commit(row, next, input);
  };

  const bulkColumns = useMemo<BulkColumn[]>(
    () => [
      { id: 'usageDate', label: 'Date', kind: 'date', required: true, initial: today, width: '150px' },
      ...(showJob ? [{ id: 'job', label: 'Job', kind: 'select' as const, required: true, options: targets.options, width: '220px' }] : []),
      { id: 'itemName', label: 'Part', kind: 'text', required: true, placeholder: 'Name of the part', width: '200px' },
      { id: 'itemSku', label: 'SKU', kind: 'text', placeholder: 'If it has one', width: '130px' },
      { id: 'quantityUsed', label: 'Used', kind: 'number', required: true, placeholder: '0', width: '100px' },
      { id: 'quantityScrapped', label: 'Scrapped', kind: 'number', placeholder: '0', width: '100px' },
      ...(shell.seesMoney ? [{ id: 'unitCost', label: 'Cost of one', kind: 'number' as const, placeholder: '0.00', width: '110px' }] : []),
    ],
    [showJob, targets.options, today, shell.seesMoney],
  );
  const toBulkInput = (cells: BulkCells): BulkRowResult<Omit<SaveMaterialUsageActionInput, 'id' | 'version'>> => {
    const errors: Record<string, string> = {};
    if (!isDate(cells.usageDate ?? '')) errors.usageDate = 'Pick a date.';
    const job = showJob ? ((cells.job ?? '').startsWith('job:') ? (cells.job as string).slice(4) : null) : (jobId ?? null);
    if (!job) errors.job = 'Pick the job.';
    if (!(cells.itemName ?? '').trim() && !(cells.itemSku ?? '').trim()) errors.itemName = 'Name the part.';
    const used = readNumber(cells.quantityUsed ?? '', 3);
    if (used === null || Number(used) <= 0) errors.quantityUsed = 'Type how many, like 250.';
    const scrappedText = (cells.quantityScrapped ?? '').trim();
    const scrapped = scrappedText ? readNumber(scrappedText, 3) : '0';
    if (scrapped === null) errors.quantityScrapped = 'Type a number.';
    const costText = (cells.unitCost ?? '').replace(/[$,]/g, '').trim();
    const cost = costText ? readNumber(costText, 4) : null;
    if (costText && cost === null) errors.unitCost = 'Type a cost, like 0.42.';
    if (Object.keys(errors).length > 0 || !job || used === null || scrapped === null) return { errors };
    return { input: { jobId: job, usageDate: cells.usageDate as string, itemName: (cells.itemName ?? '').trim() || null, itemSku: (cells.itemSku ?? '').trim() || null, quantityUsed: used, quantityScrapped: scrapped, unitCost: cost } };
  };

  const total = sumBy(rows, (row) => row.costCents);
  const scrap = sumBy(rows, (row) => row.scrapCents);
  const preview = wms.data;
  const canPull = canEdit && Boolean(preview?.available);

  const doPull = async (): Promise<string | null> => {
    if (!jobRef) return null;
    try {
      const result = await pullWmsUsageAction({ job: jobRef });
      if (!result.ok) return result.error.message;
      const added = result.data.added;
      setPull(false);
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['streams', 'wms-usage', jobRef] })]);
      if (added.length === 0) toast.success('Already up to date', 'The warehouse has used nothing new since the last pull.');
      else
        toast.undo(`${added.length} ${added.length === 1 ? 'row' : 'rows'} pulled from the warehouse`, {
          onUndo: async () => {
            for (const row of added) {
              const undone = await deleteMaterialUsageAction({ id: row.id });
              if (!undone.ok) throw new Error(undone.error.message);
            }
            await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['streams', 'wms-usage', jobRef] })]);
          },
        });
      return null;
    } catch {
      return 'Check your connection and try again.';
    }
  };

  const pullButton = canPull ? (
    <Button size="sm" variant="secondary" leadingIcon={<PackageSearch aria-hidden />} onClick={() => setPull(true)} data-testid="usage-pull">
      Pull from the warehouse
      {preview && preview.rowsToAdd > 0 ? <Badge tone="primary" size="sm">{preview.rowsToAdd} new</Badge> : null}
    </Button>
  ) : null;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {title}
          {rows.length > 0 && shell.seesMoney ? (
            <span className="flex items-center gap-1 text-sm font-normal text-fg-secondary tabular-nums" data-testid="usage-total">
              {formatMoney(centsToNumber(total))}
              <How
                title={`${title} in this list`}
                formula="The cost of every row in the list added up. Parts the client sent cost nothing."
                lines={[
                  { label: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`, value: formatMoney(centsToNumber(total)), op: 'total' },
                  { label: 'Of that, lost to scrap', value: formatMoney(centsToNumber(scrap)), op: 'note' },
                ]}
                warnings={rows.some((row) => row.resolvedSuppliedBy !== 'client' && Number(row.unitCost ?? 0) === 0) ? ['Some parts have no cost yet, so the total is low.'] : []}
              />
            </span>
          ) : null}
        </span>
      }
      action={
        rows.length > 0 ? (
          <span className="flex items-center gap-2">
            {pullButton}
            {canEdit ? (
              <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setBulk(true)} data-testid="usage-add">
                Add parts used
              </Button>
            ) : null}
          </span>
        ) : null
      }
      className={className}
      bodyClassName="p-0"
    >
      <Ledger<MaterialUsageDTO>
        testId="usage-ledger"
        caption={title}
        columns={columns}
        rows={rows}
        loading={query.isLoading || (showJob && targets.loading)}
        error={query.isError ? (query.error instanceof Error ? query.error.message : 'Please try again.') : null}
        onRetry={() => void query.refetch()}
        empty={
          <Teach
            size="sm"
            icon={Boxes}
            title={jobId ? 'No parts logged on this job yet' : 'No parts logged yet'}
            why="Parts used is what a job really took off the shelf: boxes, inserts, labels, the product itself when you buy it. Log them and Pulse costs the job from what was used, scrap included, not from a guess per unit."
            points={['One row per part and day is enough', 'Scrap counts as cost, and shows on its own', 'Parts the client sends cost the job nothing']}
            actions={
              <>
                {canEdit ? (
                  <Button onClick={() => setBulk(true)} leadingIcon={<Plus aria-hidden />} data-testid="usage-add-empty">
                    Add parts used
                  </Button>
                ) : null}
                {pullButton}
              </>
            }
            footnote={canEdit ? undefined : 'Ask a supervisor or manager to log the parts used.'}
            testId="usage-empty"
          />
        }
        canEdit={canEdit}
        rowName={(row) => `${row.itemName ?? row.itemSku ?? 'the part'} used on ${shortDate(row.usageDate)}`}
        onCommit={onCommit}
        onDelete={(picked) => void actions.removeRows(picked)}
        rowBadges={(row) => (row.source !== 'manual' ? <Badge size="sm" tone="neutral">{row.source === 'csv' ? 'Imported' : row.source === 'wms' ? 'Warehouse' : 'Synced'}</Badge> : null)}
      />
      <BulkAddDialog<Omit<SaveMaterialUsageActionInput, 'id' | 'version'>>
        open={bulk}
        onOpenChange={setBulk}
        testId="usage-bulk"
        title="Add parts used"
        description="One row per part. Type them, or paste rows from a spreadsheet."
        columns={bulkColumns}
        noun="row"
        toInput={toBulkInput}
        onSubmit={async (inputs) => {
          try {
            const result = await saveMaterialUsageBulkAction({ rows: [...inputs] });
            if (!result.ok) return bulkProblem(result.error);
            actions.added(result.data);
            return null;
          } catch {
            return { message: 'Check your connection and try again.' };
          }
        }}
      />
      {pull && preview ? <PullDialog preview={preview} loading={wms.isFetching} onCancel={() => setPull(false)} onConfirm={doPull} /> : null}
    </Panel>
  );
}

function PullDialog({ preview, loading, onCancel, onConfirm }: { readonly preview: WmsUsagePreviewDTO; readonly loading: boolean; readonly onCancel: () => void; readonly onConfirm: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onCancel() : undefined)}>
      <DialogContent size="lg" data-testid="usage-pull-dialog" onInteractOutside={keepOpenForToasts}>
        <DialogHeader title="Pull parts used from the warehouse" description={`Work order ${preview.workOrderCode ?? ''} counts the parts it used. Pulse adds only what is new since the last pull, so nothing is counted twice.`} />
        <DialogBody className="flex flex-col gap-3">
          {loading ? (
            <Skeleton height={120} rounded="lg" />
          ) : preview.lines.length === 0 ? (
            <p className="text-sm text-fg-secondary">The work order has no parts on it yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border-subtle">
              <table className="w-full border-collapse text-left text-sm tabular-nums">
                <caption className="sr-only">Parts on the work order</caption>
                <thead>
                  <tr className="border-b border-border-default text-xs text-fg-muted">
                    <th scope="col" className="px-3 py-2 font-medium">Part</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Used in the warehouse</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Already in Pulse</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">To add</th>
                    {preview.moneyHidden ? null : <th scope="col" className="px-3 py-2 text-right font-medium">Cost to add</th>}
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line) => (
                    <tr key={line.componentId} className="border-b border-border-subtle last:border-b-0">
                      <th scope="row" className="px-3 py-1.5 font-normal">
                        <span className="block text-fg">{line.name}</span>
                        <span className="block text-xs text-fg-muted">{line.sku}</span>
                      </th>
                      <td className="px-3 py-1.5 text-right">{qty(line.consumed)}</td>
                      <td className="px-3 py-1.5 text-right">{qty(line.inPulse)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{qty(line.toAdd)}</td>
                      {preview.moneyHidden ? null : <td className="px-3 py-1.5 text-right">{formatMoney(line.addCents, { empty: 'No cost' })}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm text-fg-secondary" data-testid="usage-pull-summary">
            {preview.rowsToAdd === 0 ? 'Pulse is up to date with the warehouse. There is nothing to add.' : `${preview.rowsToAdd} ${preview.rowsToAdd === 1 ? 'row' : 'rows'} will be added, dated today${preview.addCents !== null ? `, worth ${formatMoney(preview.addCents)}` : ''}.`}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {preview.rowsToAdd === 0 ? 'Close' : 'Not now'}
          </Button>
          {preview.rowsToAdd > 0 ? (
            <Button
              loading={busy}
              data-testid="usage-pull-confirm"
              onClick={async () => {
                setBusy(true);
                setError(null);
                const problem = await onConfirm();
                setBusy(false);
                if (problem) setError(problem);
              }}
            >
              Add {preview.rowsToAdd} {preview.rowsToAdd === 1 ? 'row' : 'rows'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
