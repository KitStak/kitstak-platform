'use client';

/**
 * Billing Report (`/billing/reports`): bills grid, bulk Approve / Cancel, row ⋯ View ·
 * Edit info · Change log · Delete (Draft only). Failed calculations show their error.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, CalendarClock, CheckCircle2, Eye, History, Pencil, Trash2, Upload } from 'lucide-react';
import { useApiQuery } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DataGrid,
  GridToolbar,
  LinkCell,
  useGrid,
  type BulkAction,
  type GridColumnDef,
  type RowAction,
} from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import {
  BILLING_REPORT_FIELDS,
  BILLING_REPORT_FILTER_PRESET,
  BILLING_REPORTS_GRID_KEY,
} from '@/lib/grid-defs/organization/billing-reports';
import type { AutoRunHistory, ReportRow } from '@/server/repositories/billing-reports';
import {
  EntityChangeLogDrawer,
  NO_PERMISSION,
  toastBulk,
  toFilterFields,
  useAction,
  useClientOptions,
  usePagePerms,
  useWarehouseOptions,
  type BulkResponse,
} from '@/components/facility/facility-shared';
import { withFilterPreset } from '@/components/organization/filter-preset';
import { permitted, permittedRowActions } from '@/components/organization/permitted';
import { BillInfoDialog, type BillInfoTarget } from './bill-info-dialog';
import { At, BillingPill, Day, FREQUENCY_LABELS, moneyGrid, useBillingDates } from './billing-shared';

const PERMS = ['view', 'delete', 'approve', 'cancel'] as const;

/**
 * Default columns fit 1440px without horizontal scroll or clipped text (critic R3): Calculation status
 * is its own pill column (Logiwa), the period is one unclipped "start – end" column, and Warehouse,
 * Period end, Created by and Billing frequency stay available in the column chooser.
 */
const failedPill = (r: ReportRow) => (
  <Tooltip content={r.errorMessage ?? 'Calculation failed'}>
    <span>
      <BillingPill status="Failed" />
    </span>
  </Tooltip>
);
const COLUMNS: GridColumnDef<ReportRow>[] = [
  {
    id: 'contractName',
    header: 'Name',
    size: 160,
    cell: ({ row }) => (
      <LinkCell href={`/billing/${row.original.contractId}`}>{row.original.contractName}</LinkCell>
    ),
  },
  {
    id: 'billNumber',
    header: 'Billing number',
    size: 148,
    meta: { alwaysVisible: true },
    cell: ({ row }) => (
      <LinkCell href={`/billing/reports/${row.original.id}`}>
        <span className="font-mono">{row.original.billNumber}</span>
      </LinkCell>
    ),
  },
  {
    id: 'calcStatus',
    header: 'Calc. status',
    size: 112,
    meta: { clip: false },
    cell: ({ row }) =>
      row.original.calcStatus === 'Failed' ? failedPill(row.original) : <BillingPill status="Successful" />,
  },
  { id: 'clientName', header: 'Client', size: 150, cell: ({ row }) => row.original.clientName },
  {
    id: 'warehouseCode',
    header: 'Warehouse',
    size: 104,
    meta: { defaultVisible: false },
    cell: ({ row }) => row.original.warehouseCode,
  },
  {
    id: 'calculatedAt',
    header: 'Calculation date',
    size: 164,
    cell: ({ row }) => <At value={row.original.calculatedAt} />,
  },
  {
    id: 'createdByName',
    header: 'Created by',
    size: 140,
    meta: { defaultVisible: false },
    cell: ({ row }) => row.original.createdByName ?? <span className="text-faint">Scheduler</span>,
  },
  {
    id: 'periodStart',
    header: 'Period',
    size: 204,
    meta: { clip: false },
    cell: ({ row }) => <PeriodCell start={row.original.periodStart} end={row.original.periodEnd} />,
  },
  {
    id: 'periodEnd',
    header: 'Period end',
    size: 116,
    meta: { defaultVisible: false },
    cell: ({ row }) => <Day value={row.original.periodEnd} />,
  },
  {
    id: 'frequency',
    header: 'Billing frequency',
    size: 140,
    enableSorting: false,
    meta: { defaultVisible: false },
    cell: ({ row }) => FREQUENCY_LABELS[row.original.frequency] ?? row.original.frequency,
  },
  {
    id: 'billStatus',
    header: 'Bill status',
    size: 116,
    meta: { clip: false },
    cell: ({ row }) =>
      row.original.calcStatus === 'Failed' ? (
        <span className="text-faint">None</span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <BillingPill status={row.original.billStatus} />
          {row.original.outdatedReason ? (
            <span title={row.original.outdatedReason}>
              <BillingPill status="Outdated" />
            </span>
          ) : null}
        </span>
      ),
  },
  {
    id: 'totalPrice',
    header: 'Price',
    size: 120,
    meta: { align: 'right' },
    cell: ({ row }) => (
      <div className="text-right font-semibold tabular-nums">
        {moneyGrid(row.original.totalPrice, row.original.currency)}
      </div>
    ),
  },
  {
    id: 'exportedToIntegration',
    header: 'Exported to integration',
    size: 176,
    meta: { clip: false },
    enableSorting: false,
    cell: ({ row }) =>
      row.original.exportedToIntegration ? (
        <span className="text-success">Yes</span>
      ) : (
        <span className="text-secondary">No</span>
      ),
  },
];

function PeriodCell({ start, end }: { readonly start: string; readonly end: string }) {
  return <span className="tabular-nums">{useBillingDates().period(start, end)}</span>;
}

type Pending = {
  readonly kind: 'approve' | 'cancel' | 'delete' | 'export';
  readonly rows: readonly ReportRow[];
} | null;

/** Scheduler "Billing period calculation": hourly check, last run, and the bills each automatic run wrote. */
function AutoRunsDrawer({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
}) {
  const q = useApiQuery<AutoRunHistory>(
    ['billing-auto-runs'],
    open ? '/api/billing-reports/auto-runs' : null,
    { staleTime: 0 },
  );
  const dates = useBillingDates();
  const d = q.data?.data;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={35}
      title="Automatic calculation"
      description="Approved billing forms are calculated by the scheduler once each period closes."
    >
      {q.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !d ? (
        <EmptyState
          title="Couldn't load the job history"
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="flex flex-col gap-5 text-sm">
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-sunken/50 p-3">
            <div>
              <dt className="text-2xs font-semibold text-faint">Schedule</dt>
              <dd className="mt-0.5 text-foreground">Every hour</dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold text-faint">Next check</dt>
              <dd className="mt-0.5 tabular-nums text-foreground">
                {d.task ? dates.at(d.task.nextCheckAt) : 'Within the hour'}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold text-faint">Last run</dt>
              <dd className="mt-0.5 tabular-nums text-foreground">
                {d.task?.lastStartedAt ? dates.at(d.task.lastStartedAt) : 'Not run on this server yet'}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold text-faint">Last result</dt>
              <dd className="mt-0.5 text-foreground">{d.task?.lastMessage ?? 'None'}</dd>
            </div>
          </dl>
          <section aria-label="Job history">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Job history</h3>
            {d.runs.length === 0 ? (
              <p className="text-secondary">
                No automatic bills yet. Bills appear here after the first period closes.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="text-2xs font-semibold text-secondary">
                  <tr>
                    <th className="py-1.5">Run day</th>
                    <th className="py-1.5 text-right">Contracts</th>
                    <th className="py-1.5 text-right">Bills</th>
                    <th className="py-1.5 text-right">Failed</th>
                    <th className="py-1.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.runs.map((r) => (
                    <tr key={r.day}>
                      <td className="py-1.5 tabular-nums">{dates.day(r.day)}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.contracts}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.bills}</td>
                      <td
                        className={`py-1.5 text-right tabular-nums ${r.failed ? 'text-error' : 'text-faint'}`}
                      >
                        {r.failed || 'None'}
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">
                        {moneyGrid(r.total, 'USD')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

export function BillingReportsPage() {
  const router = useRouter();
  const perms = usePagePerms('settings.billing_report', PERMS);
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const fields = React.useMemo(
    () =>
      withFilterPreset(
        toFilterFields(BILLING_REPORT_FIELDS, { warehouseId: warehouses.short, clientId: clients }),
        BILLING_REPORT_FILTER_PRESET,
      ),
    [warehouses.short, clients],
  );
  const g = useGrid<ReportRow>({ gridKey: BILLING_REPORTS_GRID_KEY, path: '/api/billing-reports', fields });
  const [pending, setPending] = React.useState<Pending>(null);
  const [info, setInfo] = React.useState<BillInfoTarget | null>(null);
  const [log, setLog] = React.useState<ReportRow | null>(null);
  const [runs, setRuns] = React.useState(false);
  const action = useAction([['grid', BILLING_REPORTS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const bulkActions: readonly BulkAction[] = [
    {
      key: 'approve',
      label: 'Approve',
      icon: CheckCircle2,
      onSelect: (ids) => setPending({ kind: 'approve', rows: selected(ids) }),
      disabledReason: perms.approve ? null : NO_PERMISSION,
      eligibility: (ids) =>
        selected(ids).every((r) => r.billStatus !== 'Draft' || r.calcStatus === 'Failed')
          ? 'Only successful draft bills can be approved'
          : null,
    },
    {
      key: 'export',
      label: 'Export to accounting',
      icon: Upload,
      onSelect: (ids) => setPending({ kind: 'export', rows: selected(ids) }),
      disabledReason: perms.approve ? null : NO_PERMISSION,
      eligibility: (ids) =>
        selected(ids).every((r) => r.billStatus !== 'Approved' || r.exportedToIntegration)
          ? 'Only approved bills not yet exported can be pushed'
          : null,
    },
    {
      key: 'cancel',
      label: 'Cancel',
      icon: Ban,
      onSelect: (ids) => setPending({ kind: 'cancel', rows: selected(ids) }),
      disabledReason: perms.cancel ? null : NO_PERMISSION,
      eligibility: (ids) =>
        selected(ids).every((r) => r.billStatus === 'Canceled')
          ? 'Every selected bill is already canceled'
          : null,
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: (ids) => setPending({ kind: 'delete', rows: selected(ids) }),
      disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) =>
        selected(ids).every((r) => r.billStatus !== 'Draft') ? 'Only draft bills can be deleted' : null,
    },
  ];
  const rowActions = (row: ReportRow): readonly RowAction[] => [
    { key: 'view', label: 'View', icon: Eye, href: `/billing/reports/${row.id}` },
    {
      key: 'edit',
      label: 'Edit info',
      icon: Pencil,
      onSelect: () => setInfo(row),
      disabledReason: !perms.approve
        ? NO_PERMISSION
        : row.billStatus === 'Canceled'
          ? 'Canceled bills are final'
          : null,
    },
    { key: 'log', label: 'Change log', icon: History, onSelect: () => setLog(row) },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => setPending({ kind: 'delete', rows: [row] }),
      disabledReason: !perms.delete
        ? NO_PERMISSION
        : row.billStatus !== 'Draft'
          ? `${row.billStatus} bills can't be deleted`
          : null,
    },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const META = {
    approve: {
      title: 'Approve',
      verb: 'approved',
      path: '/api/billing-reports/approve',
      variant: 'info' as const,
      description: "Approved bills can't be deleted and lock their period's VAS operations.",
    },
    export: {
      title: 'Export to accounting',
      verb: 'exported',
      path: '/api/billing-reports/export-integration',
      variant: 'info' as const,
      description:
        'Pushes approved bills to the accounting integration and marks them Exported to integration. Draft, canceled and already-exported bills are skipped.',
    },
    cancel: {
      title: 'Cancel',
      verb: 'canceled',
      path: '/api/billing-reports/cancel',
      variant: 'attention' as const,
      description: 'Canceled bills are final; calculate the period again to replace them.',
    },
    delete: {
      title: 'Delete',
      verb: 'deleted',
      path: '/api/billing-reports/bulk-delete',
      variant: 'danger' as const,
      description: 'Only draft bills are deleted; approved and canceled bills are skipped.',
    },
  };
  const meta = pending ? META[pending.kind] : null;
  const count = pending?.rows.length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Billing Report"
        tabs="billing"
        helper="Every calculated bill with its period, status and total. Approve bills to lock them for invoicing."
        actions={
          <Button onClick={() => setRuns(true)}>
            <CalendarClock className="h-4 w-4" aria-hidden />
            Automatic calculation
          </Button>
        }
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search billing name or number"
        bulkActions={permitted(bulkActions)}
        bulkNoun="bill"
      />
      <DataGrid<ReportRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={permittedRowActions(rowActions)}
        onRowClick={(r) => router.push(`/billing/reports/${r.id}`)}
        emptyTitle={filtered ? 'No bills match these filters' : 'No bills yet'}
        emptyDescription={
          filtered
            ? 'Clear a filter or search for another number.'
            : 'Calculate a billing form in 3PL Billing to create the first bill.'
        }
      />
      <AutoRunsDrawer open={runs} onOpenChange={setRuns} />
      <BillInfoDialog bill={info} onOpenChange={(o) => !o && setInfo(null)} onSaved={() => g.refetch()} />
      <EntityChangeLogDrawer
        open={log !== null}
        onOpenChange={(o) => !o && setLog(null)}
        path={log ? `/api/billing-reports/${log.id}/change-log` : null}
        title={`Change log · ${log?.billNumber ?? ''}`}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        variant={meta?.variant ?? 'info'}
        title={`${meta?.title ?? ''} ${count === 1 ? `bill ${pending?.rows[0]?.billNumber}` : `${count} bills`}?`}
        description={meta?.description}
        confirmLabel="Yes"
        cancelLabel="No"
        records={{
          columns: [
            { key: 'n', label: 'Bill' },
            { key: 'c', label: 'Client' },
            { key: 's', label: 'Status' },
            { key: 't', label: 'Total' },
          ],
          rows: (pending?.rows ?? []).map((r) => ({
            n: r.billNumber,
            c: r.clientName,
            s: r.billStatus,
            t: moneyGrid(r.totalPrice, r.currency),
          })),
        }}
        onConfirm={async () => {
          if (!pending || !meta) return;
          const result = await action.run<BulkResponse>(meta.path, 'POST', {
            ids: pending.rows.map((r) => r.id),
          });
          if (result) {
            toastBulk(result, 'bill', meta.verb);
            g.clearSelection();
          }
          setPending(null);
        }}
      />
    </div>
  );
}
