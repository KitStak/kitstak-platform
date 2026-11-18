'use client';
/**
 * Money in: invoices, fees, adjustments and credits, for a job or for a client. Mount it by path
 * anywhere inside the app shell:
 *
 *   <RevenueLedger jobId={job.id} today={today} />
 *   <RevenueLedger clientId={client.id} today={today} />
 *   <RevenueLedger today={today} from={monthStart} to={monthEnd} />
 *
 * An invoice is a record of what you billed. It never counts as earned revenue, because earned
 * revenue comes from the work that was logged. Fees, adjustments and credits do change revenue.
 * Cells edit in place, rows can be added many at a time (paste works), and every change has Undo.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, Plus } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { Teach } from '@/components/pulse/teach';
import { How } from '@/features/calculator/how';
import { BulkAddDialog, Ledger, bulkProblem, centsText, isDate, readMoney, refreshAfterEntry, useLedgerActions, useLedgerRows, type BulkCells, type BulkColumn, type BulkRowResult, type LedgerColumn } from '@/features/costs/ledger-kit';
import { readTarget, useEntryTargets } from '@/features/costs/targets';
import { useShell } from '@/features/shell/shell-context';
import { REVENUE_KINDS, REVENUE_KIND_LABELS, type RevenueKind } from '@/lib/constants';
import { formatMoney } from '@/lib/format';
import { useRevenue } from '@/lib/hooks/use-data';
import { centsToNumber, sumBy } from '@/lib/money';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { RevenueEntryDTO } from '@/lib/types';
import { deleteRevenueAction, restoreRevenueAction, saveRevenueAction, type SaveRevenueActionInput } from '@/server/actions/entries';
import { saveRevenueBulkAction, type SaveRevenueBulkActionInput } from '@/server/actions/money-ops';

export interface RevenueLedgerProps {
  readonly jobId?: string;
  readonly clientId?: string;
  readonly from?: string | null;
  readonly to?: string | null;
  /** Today in the site's time zone, the date new rows start with. */
  readonly today: string;
  readonly title?: string;
  readonly className?: string;
}

type RowInput = SaveRevenueActionInput;
type BulkRow = SaveRevenueBulkActionInput['rows'][number];
const KIND_HELP: Readonly<Record<RevenueKind, string>> = { invoice: 'What you billed. A record only.', fee: 'Extra money earned, like a rush fee.', adjustment: 'A change to revenue, up or down.', credit: 'Money given back. It lowers revenue.' };
/** Kinds that change earned revenue. An invoice is only a record of what was billed. */
const EARNS = (row: RevenueEntryDTO): boolean => row.kind !== 'invoice';

export function RevenueLedger({ jobId, clientId, from, to, today, title = 'Invoices, fees and credits', className }: RevenueLedgerProps) {
  const shell = useShell();
  const queryClient = useQueryClient();
  const canEdit = shell.can('revenue:manage');
  const query = useRevenue({ jobId, clientId: jobId ? undefined : clientId, from, to, limit: 2000 }, { enabled: shell.seesMoney });
  const overlay = useLedgerRows<RevenueEntryDTO>(query.data);
  const rows = overlay.rows;
  const showFor = !jobId;
  const targets = useEntryTargets(showFor, { clients: true, jobs: true, clientId: clientId ?? null });
  const [bulk, setBulk] = useState(false);
  const refresh = () => refreshAfterEntry(queryClient);

  const toInput = (row: RevenueEntryDTO): RowInput => ({ id: row.id, version: row.version, jobId: row.jobId, clientId: row.jobId ? null : row.clientId, revenueDate: row.revenueDate, kind: row.kind === 'fixed_true_up' ? 'adjustment' : row.kind, description: row.description, amountCents: row.amountCents ?? 0, invoiceNumber: row.invoiceNumber, note: row.note });
  const actions = useLedgerActions<RevenueEntryDTO, RowInput>({ overlay, save: saveRevenueAction, remove: deleteRevenueAction, restore: restoreRevenueAction, toInput, noun: 'row', refresh });
  const editable = (row: RevenueEntryDTO): boolean => row.kind !== 'fixed_true_up';

  const columns = useMemo<LedgerColumn<RevenueEntryDTO>[]>(
    () => [
      { id: 'revenueDate', header: 'Date', render: (row) => shortDate(row.revenueDate), editor: (row) => (editable(row) ? { kind: 'date', value: row.revenueDate } : null) },
      ...(showFor
        ? [
            {
              id: 'for',
              header: 'For',
              render: (row: RevenueEntryDTO) =>
                row.jobId && targets.jobNumber(row.jobId) ? (
                  <Link href={routes.jobTab(targets.jobNumber(row.jobId) as string, 'money-in')} className="text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                    {targets.jobLabel(row.jobId)}
                  </Link>
                ) : (
                  `Client: ${targets.clientLabel(row.clientId) ?? ''}`
                ),
            } satisfies LedgerColumn<RevenueEntryDTO>,
          ]
        : []),
      { id: 'kind', header: 'Kind', primary: true, render: (row) => REVENUE_KIND_LABELS[row.kind], editor: (row) => (editable(row) ? { kind: 'select', value: row.kind, options: REVENUE_KINDS.map((value) => ({ value, label: REVENUE_KIND_LABELS[value] })) } : null) },
      { id: 'description', header: 'What for', render: (row) => row.description ?? (editable(row) ? <span className="text-fg-muted">Add</span> : 'Written by Pulse'), editor: (row) => (editable(row) ? { kind: 'text', value: row.description ?? '', placeholder: 'What it was for' } : null) },
      { id: 'invoiceNumber', header: 'Invoice number', render: (row) => row.invoiceNumber ?? (editable(row) ? <span className="text-fg-muted">Add</span> : ''), editor: (row) => (editable(row) ? { kind: 'text', value: row.invoiceNumber ?? '', placeholder: 'INV 1042' } : null) },
      { id: 'amount', header: 'Amount', numeric: true, render: (row) => <span className={row.amountCents !== null && row.amountCents < 0 ? 'text-danger-text' : undefined}>{formatMoney(row.amountCents, { empty: 'Hidden' })}</span>, editor: (row) => (editable(row) && row.amountCents !== null ? { kind: 'money', value: centsText(Math.abs(row.amountCents)) } : null) },
    ],
    [showFor, targets],
  );

  const onCommit = async (row: RevenueEntryDTO, columnId: string, value: string): Promise<string | null> => {
    const input = toInput(row);
    let next: RevenueEntryDTO = row;
    const text = value.trim();
    if (columnId === 'revenueDate') {
      if (!isDate(text)) return 'Pick a real date.';
      input.revenueDate = text;
      next = { ...row, revenueDate: text };
    } else if (columnId === 'kind') {
      const kind = text as RevenueKind;
      input.kind = kind;
      // A credit is always money given back, so its amount is kept under zero.
      const amount = row.amountCents === null ? null : kind === 'credit' ? -Math.abs(row.amountCents) : row.kind === 'credit' ? Math.abs(row.amountCents) : row.amountCents;
      input.amountCents = amount ?? 0;
      next = { ...row, kind, amountCents: amount };
    } else if (columnId === 'amount') {
      const cents = readMoney(text, row.kind === 'adjustment');
      if (cents === null) return row.kind === 'adjustment' ? 'Type an amount in dollars, like 350. Use a minus sign to lower revenue.' : 'Type an amount in dollars, like 350 or 1,250.50.';
      if (cents === 0) return 'Type an amount that is not zero.';
      const signed = row.kind === 'credit' ? -Math.abs(cents) : cents;
      input.amountCents = signed;
      next = { ...row, amountCents: signed };
    } else if (columnId === 'description' || columnId === 'invoiceNumber') {
      input[columnId] = text || null;
      next = { ...row, [columnId]: text || null };
    }
    return actions.commit(row, next, input);
  };

  const bulkColumns = useMemo<BulkColumn[]>(
    () => [
      { id: 'revenueDate', label: 'Date', kind: 'date', required: true, initial: today, width: '150px' },
      ...(showFor ? [{ id: 'for', label: 'For', kind: 'select' as const, required: true, options: targets.options, width: '220px' }] : []),
      { id: 'kind', label: 'Kind', kind: 'select', required: true, options: REVENUE_KINDS.map((value) => ({ value, label: REVENUE_KIND_LABELS[value] })), initial: 'invoice', width: '140px' },
      { id: 'amount', label: 'Amount', kind: 'money', required: true, placeholder: '0.00', width: '120px' },
      { id: 'invoiceNumber', label: 'Invoice number', kind: 'text', placeholder: 'INV 1042', width: '140px' },
      { id: 'description', label: 'What for', kind: 'text', placeholder: 'What it was for' },
    ],
    [showFor, targets.options, today],
  );
  const toBulkInput = (cells: BulkCells): BulkRowResult<BulkRow> => {
    const errors: Record<string, string> = {};
    if (!isDate(cells.revenueDate ?? '')) errors.revenueDate = 'Pick a date.';
    const kind = (REVENUE_KINDS as readonly string[]).includes(cells.kind ?? '') ? (cells.kind as RevenueKind) : null;
    if (!kind) errors.kind = 'Pick a kind.';
    const cents = readMoney(cells.amount ?? '', kind === 'adjustment');
    if (cents === null || cents === 0) errors.amount = 'Type an amount, like 350.';
    const target = showFor ? readTarget(cells.for ?? '') : { jobId: jobId ?? null, clientId: null };
    if (!target || (!target.jobId && !target.clientId)) errors.for = 'Pick a job or a client.';
    if (Object.keys(errors).length > 0 || !target || !kind || cents === null) return { errors };
    return { input: { ...target, revenueDate: cells.revenueDate as string, kind, amountCents: cents, invoiceNumber: cells.invoiceNumber?.trim() || null, description: cells.description?.trim() || null } };
  };

  const billed = sumBy(rows.filter((row) => row.kind === 'invoice'), (row) => row.amountCents);
  const earns = sumBy(rows.filter(EARNS), (row) => row.amountCents);

  if (!shell.seesMoney) {
    return (
      <Panel title={title} className={className}>
        <p className="text-sm text-fg-secondary" data-testid="revenue-hidden">Invoices and fees are money, and money is hidden for your role. Ask an admin of your workspace if you need to see them.</p>
      </Panel>
    );
  }
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {title}
          {rows.length > 0 ? (
            <span className="flex items-center gap-1 text-sm font-normal text-fg-secondary tabular-nums" data-testid="revenue-total">
              {formatMoney(centsToNumber(billed))} billed
              <How
                title="What these rows add up to"
                formula="Invoices are added up as billed. They are a record and never count as earned revenue, which comes from the work log. Fees, adjustments and credits are added to earned revenue."
                lines={[
                  { label: 'Invoices (billed, not revenue)', value: formatMoney(centsToNumber(billed)), op: 'start' },
                  { label: 'Fees, adjustments and credits (change revenue)', value: formatMoney(centsToNumber(earns)), op: 'note' },
                ]}
              />
            </span>
          ) : null}
        </span>
      }
      action={
        canEdit && rows.length > 0 ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setBulk(true)} data-testid="revenue-add">
            Add rows
          </Button>
        ) : null
      }
      className={className}
      bodyClassName="p-0"
    >
      {rows.length > 0 ? <p className="border-b border-border-subtle px-4 py-2.5 text-xs text-fg-muted">An invoice records what you billed. Earned revenue comes from the work log, so an invoice never changes profit. Fees, adjustments and credits do.</p> : null}
      <Ledger<RevenueEntryDTO>
        testId="revenue-ledger"
        caption={title}
        columns={columns}
        rows={rows}
        loading={query.isLoading || (showFor && targets.loading)}
        error={query.isError ? (query.error instanceof Error ? query.error.message : 'Please try again.') : null}
        onRetry={() => void query.refetch()}
        empty={
          <Teach
            size="sm"
            icon={BadgeDollarSign}
            title="No invoices, fees or credits yet"
            why="Pulse works out earned revenue from the work log: units done times the price. Add an invoice here to track what you have billed against what you earned, a fee for extra money like a rush charge, or a credit when you give money back."
            points={Object.entries(KIND_HELP).map(([kind, help]) => `${REVENUE_KIND_LABELS[kind as RevenueKind]}: ${help}`)}
            actions={canEdit ? <Button onClick={() => setBulk(true)} leadingIcon={<Plus aria-hidden />} data-testid="revenue-add-empty">Add rows</Button> : null}
            footnote={canEdit ? undefined : 'Ask a manager to add invoices and fees.'}
            testId="revenue-empty"
          />
        }
        canEdit={canEdit}
        rowName={(row) => `the ${REVENUE_KIND_LABELS[row.kind].toLowerCase()} of ${shortDate(row.revenueDate)}`}
        onCommit={onCommit}
        onDelete={(picked) => void actions.removeRows(picked.filter(editable))}
        rowBadges={(row) => (row.kind === 'fixed_true_up' ? <Badge size="sm" tone="neutral">By Pulse</Badge> : row.source !== 'manual' ? <Badge size="sm" tone="neutral">{row.source === 'csv' ? 'Imported' : 'Synced'}</Badge> : null)}
      />
      <BulkAddDialog<BulkRow>
        open={bulk}
        onOpenChange={setBulk}
        testId="revenue-bulk"
        title="Add invoices, fees or credits"
        description="One row each. Type them, or paste rows from a spreadsheet. A credit is saved as money given back."
        columns={bulkColumns}
        noun="row"
        toInput={toBulkInput}
        onSubmit={async (inputs) => {
          try {
            const result = await saveRevenueBulkAction({ rows: [...inputs] });
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
