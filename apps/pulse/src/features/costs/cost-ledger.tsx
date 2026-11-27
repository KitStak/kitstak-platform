'use client';
/**
 * Other costs: freight, packaging, outside help and the like, on a job, on a client, or for the
 * whole company (rent, utilities, salaried staff: the shared pool your overhead per hour is
 * meant to cover). Mount it by path anywhere inside the app shell:
 *
 *   <CostLedger scope="job" jobId={job.id} today={today} />
 *   <CostLedger scope="client" clientId={client.id} today={today} />
 *   <CostLedger scope="company" today={today} from={monthStart} to={monthEnd} />
 *   <CostLedger scope="all" today={today} />
 *
 * Cells edit in place, rows can be added many at a time (paste works), and every change has Undo.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Receipt } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { Teach } from '@/components/pulse/teach';
import { How } from '@/features/calculator/how';
import { useShell } from '@/features/shell/shell-context';
import { COST_CATEGORIES, COST_CATEGORY_LABELS, type CostCategory, type CostScope } from '@/lib/constants';
import { formatMoney } from '@/lib/format';
import { useCosts } from '@/lib/hooks/use-data';
import { sumBy, centsToNumber } from '@/lib/money';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { CostEntryDTO } from '@/lib/types';
import { deleteCostAction, restoreCostAction, saveCostAction, type SaveCostActionInput } from '@/server/actions/entries';
import { saveCostsBulkAction } from '@/server/actions/money-ops';
import { BulkAddDialog, Ledger, bulkProblem, centsText, isDate, readMoney, refreshAfterEntry, useLedgerActions, useLedgerRows, type BulkCells, type BulkColumn, type BulkRowResult, type LedgerColumn } from './ledger-kit';
import { readTarget, useEntryTargets } from './targets';

const COMPANY_FIRST: readonly CostCategory[] = ['rent', 'utilities', 'salaried_staff', 'insurance', 'equipment', 'supplies', 'storage', 'other', 'freight', 'packaging', 'outside_service', 'rework'];

export interface CostLedgerProps {
  readonly scope: CostScope | 'all';
  readonly jobId?: string;
  readonly clientId?: string;
  readonly from?: string | null;
  readonly to?: string | null;
  /** Today in the site's time zone, the date new rows start with. */
  readonly today: string;
  readonly title?: string;
  readonly className?: string;
}

type RowInput = SaveCostActionInput;

export function CostLedger({ scope, jobId, clientId, from, to, today, title, className }: CostLedgerProps) {
  const shell = useShell();
  const queryClient = useQueryClient();
  const canEdit = shell.can('cost:manage');
  const query = useCosts({ jobId: scope === 'job' ? jobId : undefined, clientId: scope === 'client' ? clientId : undefined, scope: scope === 'all' ? undefined : scope, from, to, limit: 2000 }, { enabled: shell.seesMoney });
  const overlay = useLedgerRows<CostEntryDTO>(query.data);
  const rows = overlay.rows;
  const showFor = scope === 'all';
  const targets = useEntryTargets(showFor);
  const [bulk, setBulk] = useState(false);
  const refresh = () => refreshAfterEntry(queryClient);

  const toInput = (row: CostEntryDTO): RowInput => ({ id: row.id, version: row.version, jobId: row.jobId, clientId: row.jobId ? null : row.clientId, siteId: row.scope === 'company' ? row.siteId : null, costDate: row.costDate, category: row.category, amountCents: row.amountCents ?? 0, vendor: row.vendor, reference: row.reference, note: row.note });
  const actions = useLedgerActions<CostEntryDTO, RowInput>({ overlay, save: saveCostAction, remove: deleteCostAction, restore: restoreCostAction, toInput, noun: 'cost', refresh });

  const forLabel = (row: CostEntryDTO): string => (row.scope === 'company' ? 'The whole company' : row.scope === 'client' ? `Client: ${targets.clientLabel(row.clientId) ?? ''}` : (targets.jobLabel(row.jobId) ?? 'A job'));
  const categories = scope === 'company' ? COMPANY_FIRST : COST_CATEGORIES;
  const columns = useMemo<LedgerColumn<CostEntryDTO>[]>(
    () => [
      { id: 'costDate', header: 'Date', render: (row) => shortDate(row.costDate), editor: (row) => ({ kind: 'date', value: row.costDate }) },
      ...(showFor
        ? [
            {
              id: 'for',
              header: 'For',
              render: (row: CostEntryDTO) =>
                row.scope === 'job' && targets.jobNumber(row.jobId) ? (
                  <Link href={routes.jobTab(targets.jobNumber(row.jobId) as string, 'materials')} className="text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                    {forLabel(row)}
                  </Link>
                ) : (
                  forLabel(row)
                ),
            } satisfies LedgerColumn<CostEntryDTO>,
          ]
        : []),
      { id: 'category', header: 'What for', primary: true, render: (row) => COST_CATEGORY_LABELS[row.category], editor: (row) => ({ kind: 'select', value: row.category, options: COST_CATEGORIES.map((value) => ({ value, label: COST_CATEGORY_LABELS[value] })) }) },
      { id: 'vendor', header: 'Paid to', render: (row) => row.vendor ?? <span className="text-fg-muted" data-empty-cell>Add</span>, editor: (row) => ({ kind: 'text', value: row.vendor ?? '', placeholder: 'Who was paid' }) },
      { id: 'reference', header: 'Reference', render: (row) => row.reference ?? <span className="text-fg-muted" data-empty-cell>Add</span>, editor: (row) => ({ kind: 'text', value: row.reference ?? '', placeholder: 'Bill or PO number' }) },
      { id: 'note', header: 'Note', render: (row) => row.note ?? <span className="text-fg-muted" data-empty-cell>Add</span>, editor: (row) => ({ kind: 'text', value: row.note ?? '' }), emptyWhen: (row) => !row.note },
      { id: 'amount', header: 'Amount', numeric: true, pin: true, render: (row) => <span className={row.amountCents !== null && row.amountCents < 0 ? 'text-success-text' : undefined}>{formatMoney(row.amountCents, { empty: 'Hidden' })}</span>, editor: (row) => (row.amountCents === null ? null : { kind: 'money', value: centsText(row.amountCents) }) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `forLabel` only reads `targets`
    [showFor, targets],
  );

  const onCommit = async (row: CostEntryDTO, columnId: string, value: string): Promise<string | null> => {
    const input = toInput(row);
    let next: CostEntryDTO = row;
    const text = value.trim();
    if (columnId === 'costDate') {
      if (!isDate(text)) return 'Pick a real date.';
      input.costDate = text;
      next = { ...row, costDate: text };
    } else if (columnId === 'category') {
      input.category = text as CostCategory;
      next = { ...row, category: text as CostCategory };
    } else if (columnId === 'amount') {
      const cents = readMoney(text, true);
      if (cents === null) return 'Type an amount in dollars, like 350 or 1,250.50.';
      if (cents === 0) return 'Type an amount that is not zero. Use a minus sign for a credit.';
      input.amountCents = cents;
      next = { ...row, amountCents: cents };
    } else if (columnId === 'vendor' || columnId === 'reference' || columnId === 'note') {
      input[columnId] = text || null;
      next = { ...row, [columnId]: text || null };
    }
    return actions.commit(row, next, input);
  };

  const bulkColumns = useMemo<BulkColumn[]>(
    () => [
      { id: 'costDate', label: 'Date', kind: 'date', required: true, initial: today, width: '150px' },
      ...(showFor ? [{ id: 'for', label: 'For', kind: 'select' as const, required: true, options: targets.options, initial: 'company', width: '220px' }] : []),
      { id: 'category', label: 'What for', kind: 'select', required: true, options: categories.map((value) => ({ value, label: COST_CATEGORY_LABELS[value] })), initial: categories[0], width: '160px' },
      { id: 'amount', label: 'Amount', kind: 'money', required: true, placeholder: '0.00', width: '120px' },
      { id: 'vendor', label: 'Paid to', kind: 'text', placeholder: 'Who was paid' },
      { id: 'reference', label: 'Reference', kind: 'text', placeholder: 'Bill number' },
    ],
    [showFor, targets.options, categories, today],
  );
  const toBulkInput = (cells: BulkCells): BulkRowResult<SaveCostActionInput> => {
    const errors: Record<string, string> = {};
    if (!isDate(cells.costDate ?? '')) errors.costDate = 'Pick a date.';
    const cents = readMoney(cells.amount ?? '', true);
    if (cents === null || cents === 0) errors.amount = 'Type an amount, like 350. Use a minus sign for a credit.';
    if (!(COST_CATEGORIES as readonly string[]).includes(cells.category ?? '')) errors.category = 'Pick what the cost was for.';
    const target = showFor ? readTarget(cells.for ?? '') : { jobId: scope === 'job' ? (jobId ?? null) : null, clientId: scope === 'client' ? (clientId ?? null) : null };
    if (!target) errors.for = 'Pick a job, a client or the whole company.';
    if (Object.keys(errors).length > 0 || !target || cents === null) return { errors };
    return { input: { ...target, costDate: cells.costDate as string, category: cells.category as CostCategory, amountCents: cents, vendor: cells.vendor?.trim() || null, reference: cells.reference?.trim() || null } };
  };

  const total = sumBy(rows, (row) => row.amountCents);
  const heading = title ?? (scope === 'company' ? 'Company costs' : scope === 'all' ? 'Other costs' : 'Other costs');
  const empty =
    scope === 'company' ? (
      <Teach
        size="sm"
        icon={Building2}
        title="No company costs yet"
        why="Company costs are the bills that belong to no single job: rent, utilities, equipment, salaried staff, insurance. Pulse adds them up as your real overhead and checks them against the overhead per hour in your labor rates, so you know if your rates really cover the building."
        points={['One row per bill is enough', 'They count in company profit, never in a job', 'A vendor credit goes in with a minus sign']}
        actions={canEdit ? <Button onClick={() => setBulk(true)} leadingIcon={<Plus aria-hidden />}>Add company costs</Button> : null}
        footnote={canEdit ? undefined : 'Ask a manager to add company costs.'}
        testId="cost-empty"
      />
    ) : (
      <Teach
        size="sm"
        icon={Receipt}
        title={scope === 'job' ? 'No other costs on this job yet' : scope === 'client' ? 'No costs for this client yet' : 'No other costs yet'}
        why={
          scope === 'client'
            ? 'A client cost is something you pay to serve this client that belongs to no single job, like storage or a shared pallet run. It counts in the profit of the client, not of a job.'
            : 'Other costs are what a job costs besides labor and material: freight, pallets, packaging, outside help. Leave them out and the job looks better than it is.'
        }
        actions={canEdit ? <Button onClick={() => setBulk(true)} leadingIcon={<Plus aria-hidden />}>Add costs</Button> : null}
        footnote={canEdit ? undefined : 'Ask a manager to add costs.'}
        testId="cost-empty"
      />
    );

  if (!shell.seesMoney) {
    return (
      <Panel title={heading} className={className}>
        <p className="text-sm text-fg-secondary" data-testid="cost-hidden">Costs are money, and money is hidden for your role. Ask an admin of your workspace if you need to see or add costs.</p>
      </Panel>
    );
  }
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {heading}
          {rows.length > 0 ? (
            <span className="flex items-center gap-1 text-sm font-normal text-fg-secondary tabular-nums" data-testid="cost-total">
              {formatMoney(centsToNumber(total))}
              <How
                title={`${heading} in this list`}
                formula="Every row in the list added up. A credit (a minus amount) takes away from the total."
                lines={[
                  ...COST_CATEGORIES.filter((category) => rows.some((row) => row.category === category)).map((category, index) => ({ label: COST_CATEGORY_LABELS[category], value: formatMoney(centsToNumber(sumBy(rows.filter((row) => row.category === category), (row) => row.amountCents))), op: index === 0 ? ('start' as const) : ('plus' as const) })),
                  { label: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`, value: formatMoney(centsToNumber(total)), op: 'total' },
                ]}
              />
            </span>
          ) : null}
        </span>
      }
      action={
        canEdit && rows.length > 0 ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setBulk(true)} data-testid="cost-add">
            Add costs
          </Button>
        ) : null
      }
      className={className}
      bodyClassName="p-0"
    >
      {scope === 'company' && rows.length > 0 ? <p className="border-b border-border-subtle px-4 py-2.5 text-xs text-fg-muted">These bills belong to no single job. They count in company profit as your real overhead.</p> : null}
      <Ledger<CostEntryDTO>
        exportName={`costs-${today}`}
        testId="cost-ledger"
        caption={heading}
        columns={columns}
        rows={rows}
        loading={query.isLoading || (showFor && targets.loading)}
        error={query.isError ? (query.error instanceof Error ? query.error.message : 'Please try again.') : null}
        onRetry={() => void query.refetch()}
        empty={empty}
        canEdit={canEdit}
        rowName={(row) => `the ${COST_CATEGORY_LABELS[row.category].toLowerCase()} cost of ${shortDate(row.costDate)}`}
        onCommit={onCommit}
        onDelete={(picked) => void actions.removeRows(picked)}
        rowBadges={(row) => (row.source !== 'manual' ? <Badge tone="neutral">{row.source === 'csv' ? 'Imported' : row.source === 'wms' ? 'Warehouse' : 'Synced'}</Badge> : null)}
      />
      <BulkAddDialog<SaveCostActionInput>
        open={bulk}
        onOpenChange={setBulk}
        testId="cost-bulk"
        title={scope === 'company' ? 'Add company costs' : 'Add costs'}
        description={scope === 'company' ? 'One row per bill: rent, utilities, equipment, salaried staff, insurance.' : 'One row per cost. Type them, or paste rows from a spreadsheet.'}
        columns={bulkColumns}
        noun="cost"
        toInput={toBulkInput}
        onSubmit={async (inputs) => {
          try {
            const result = await saveCostsBulkAction({ rows: [...inputs] });
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
