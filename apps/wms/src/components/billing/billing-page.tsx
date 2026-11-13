'use client';

/**
 * 3PL Billing (`/billing`, Billing tabs): contracts grid, header Create Billing Form, bulk
 * Actions ▾ (Approve, Cancel Approval, Delete), Duplicate and Calculate, row ⋯ Show
 * details · Edit · Change log · Delete.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Calculator, CheckCircle2, Copy, Eye, History, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DisabledReason } from '@/components/ui/tooltip';
import {
  BILLING_FIELDS,
  BILLING_FILTER_PRESET,
  BILLING_GRID_KEY,
} from '@/lib/grid-defs/organization/billing';
import type { ContractRow } from '@/server/repositories/billing';
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
import { At, BillingPill, CalculateDialog, Day, FREQUENCY_LABELS } from './billing-shared';

const PERMS = ['view', 'create', 'edit', 'delete', 'change_log', 'calculate', 'copy'] as const;

const COLUMNS: GridColumnDef<ContractRow>[] = [
  {
    id: 'name',
    header: 'Billing name',
    size: 210,
    meta: { alwaysVisible: true },
    cell: ({ row }) => <LinkCell href={`/billing/${row.original.id}`}>{row.original.name}</LinkCell>,
  },
  {
    id: 'clientName',
    header: 'Client',
    size: 160,
    cell: ({ row }) => (
      <LinkCell href={`/clients/${row.original.clientId}`}>{row.original.clientName}</LinkCell>
    ),
  },
  {
    id: 'approvalStatus',
    header: 'Approval status',
    size: 128,
    cell: ({ row }) => <BillingPill status={row.original.approvalStatus} />,
  },
  {
    id: 'warehouseCode',
    header: 'Warehouse',
    size: 104,
    cell: ({ row }) => (
      <span className="block truncate whitespace-nowrap" title={row.original.warehouseCode}>
        {row.original.warehouseCode}
      </span>
    ),
  },
  {
    id: 'calcStartDate',
    header: 'Start date',
    size: 110,
    cell: ({ row }) => <Day value={row.original.calcStartDate} />,
  },
  {
    id: 'frequency',
    header: 'Period',
    size: 116,
    cell: ({ row }) => FREQUENCY_LABELS[row.original.frequency] ?? row.original.frequency,
  },
  {
    id: 'feeCount',
    header: 'Fees',
    size: 72,
    meta: { align: 'right' },
    cell: ({ row }) => <div className="text-right tabular-nums">{row.original.feeCount}</div>,
  },
  {
    id: 'lastCalculatedAt',
    header: 'Last calculation',
    size: 170,
    cell: ({ row }) => <At value={row.original.lastCalculatedAt} />,
  },
  {
    id: 'nextPeriodStart',
    header: 'Next period',
    size: 116,
    cell: ({ row }) => (row.original.nextPeriodStart ? <Day value={row.original.nextPeriodStart} /> : 'None'),
  },
  {
    id: 'reportCount',
    header: 'Bills',
    size: 72,
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.reportCount > 0 ? (
          <LinkCell href={`/billing/reports?f.contractName=eq:${encodeURIComponent(row.original.name)}`}>
            {row.original.reportCount}
          </LinkCell>
        ) : (
          <span className="text-faint">0</span>
        )}
      </div>
    ),
  },
  {
    id: 'createdByName',
    header: 'Created by',
    size: 150,
    meta: { defaultVisible: false },
    cell: ({ row }) => row.original.createdByName ?? <span className="text-faint">System</span>,
  },
  {
    id: 'createdAt',
    header: 'Create date',
    size: 160,
    meta: { defaultVisible: false },
    cell: ({ row }) => <At value={row.original.createdAt} />,
  },
];

type Pending = {
  readonly kind: 'approve' | 'cancel' | 'delete' | 'duplicate';
  readonly rows: readonly ContractRow[];
} | null;

export function BillingPage() {
  const router = useRouter();
  const perms = usePagePerms('settings.billing', PERMS);
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const fields = React.useMemo(
    () =>
      withFilterPreset(
        toFilterFields(BILLING_FIELDS, { warehouseId: warehouses.short, clientId: clients }),
        BILLING_FILTER_PRESET,
      ),
    [warehouses.short, clients],
  );
  const g = useGrid<ContractRow>({ gridKey: BILLING_GRID_KEY, path: '/api/billing', fields });
  const [pending, setPending] = React.useState<Pending>(null);
  const [calc, setCalc] = React.useState<readonly ContractRow[] | null>(null);
  const [log, setLog] = React.useState<ContractRow | null>(null);
  const action = useAction([['grid', BILLING_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const deleteBlock = (r: ContractRow) =>
    r.approvalStatus === 'Approved'
      ? "Approved contracts can't be deleted; cancel the approval first"
      : r.reportCount > 0
        ? "Contracts with bills can't be deleted"
        : null;

  // Duplicate + Calculate are the two inline toolbar buttons (Logiwa parity); Approve / Cancel approval / Delete sit in Actions.
  const bulkActions: readonly BulkAction[] = [
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      onSelect: (ids) => setPending({ kind: 'duplicate', rows: selected(ids) }),
      disabledReason: perms.copy ? null : NO_PERMISSION,
    },
    {
      key: 'calculate',
      label: 'Calculate',
      icon: Calculator,
      onSelect: (ids) => setCalc(selected(ids)),
      disabledReason: perms.calculate ? null : NO_PERMISSION,
      eligibility: (ids) =>
        selected(ids).every((r) => r.feeCount === 0) ? 'Add fees before calculating' : null,
    },
    {
      key: 'approve',
      label: 'Approve',
      icon: CheckCircle2,
      onSelect: (ids) => setPending({ kind: 'approve', rows: selected(ids) }),
      disabledReason: perms.edit ? null : NO_PERMISSION,
      eligibility: (ids) => {
        const rows = selected(ids);
        return rows.every((r) => r.approvalStatus === 'Approved')
          ? 'Already approved'
          : rows.every((r) => r.feeCount === 0)
            ? 'Add fees before approving'
            : null;
      },
    },
    {
      key: 'cancel',
      label: 'Cancel approval',
      icon: Ban,
      onSelect: (ids) => setPending({ kind: 'cancel', rows: selected(ids) }),
      disabledReason: perms.edit ? null : NO_PERMISSION,
      eligibility: (ids) =>
        selected(ids).every((r) => r.approvalStatus !== 'Approved')
          ? 'Only approved contracts can have their approval cancelled'
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
        selected(ids).every((r) => deleteBlock(r) !== null)
          ? "Approved contracts and contracts with bills can't be deleted"
          : null,
    },
  ];
  const rowActions = (row: ContractRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, href: `/billing/${row.id}` },
    {
      key: 'edit',
      label: 'Edit',
      icon: Pencil,
      href: `/billing/${row.id}?edit=1`,
      disabledReason: perms.edit ? null : NO_PERMISSION,
    },
    {
      key: 'calculate',
      label: 'Calculate',
      icon: Calculator,
      onSelect: () => setCalc([row]),
      disabledReason: !perms.calculate
        ? NO_PERMISSION
        : row.feeCount === 0
          ? 'Add fees before calculating'
          : null,
    },
    {
      key: 'log',
      label: 'Change log',
      icon: History,
      onSelect: () => setLog(row),
      disabledReason: perms.change_log || perms.view ? null : NO_PERMISSION,
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => setPending({ kind: 'delete', rows: [row] }),
      disabledReason: !perms.delete ? NO_PERMISSION : deleteBlock(row),
    },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const META = {
    approve: {
      title: 'Approve',
      verb: 'approved',
      path: '/api/billing/approve',
      variant: 'info' as const,
      description: 'Approved contracts are billed by the scheduler at each period end and their fees lock.',
    },
    cancel: {
      title: 'Cancel approval of',
      verb: 'set back to draft',
      path: '/api/billing/cancel-approval',
      variant: 'attention' as const,
      description:
        'The contracts go back to Draft: fees become editable and the scheduler stops billing them.',
    },
    delete: {
      title: 'Delete',
      verb: 'deleted',
      path: '/api/billing/bulk-delete',
      variant: 'danger' as const,
      description: 'Approved contracts and contracts with bills are skipped.',
    },
    duplicate: {
      title: 'Duplicate',
      verb: 'duplicated',
      path: '/api/billing/duplicate',
      variant: 'info' as const,
      description:
        "Each copy keeps every fee, tier and condition and starts as Draft. Only one contract per client and warehouse can be approved at a time, so approving a copy requires cancelling the original's approval first (otherwise the same activity would be billed twice).",
    },
  };
  const meta = pending ? META[pending.kind] : null;
  const count = pending?.rows.length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="3PL Billing"
        tabs="billing"
        helper="Billing forms define what each client pays for receiving, storage, pick and pack, shipping and value-added services."
        actions={
          <>
            {perms.create ? (
              <Button variant="primary" onClick={() => router.push('/billing/new')}>
                <Plus className="h-4 w-4" aria-hidden />
                Create billing form
              </Button>
            ) : null}
          </>
        }
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search billing name or client"
        bulkActions={permitted(bulkActions)}
        bulkNoun="billing form"
      />
      <DataGrid<ContractRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={permittedRowActions(rowActions)}
        onRowClick={(r) => router.push(`/billing/${r.id}`)}
        emptyTitle={filtered ? 'No billing forms match these filters' : 'No billing forms yet'}
        emptyDescription={
          filtered
            ? 'Clear a filter or search for another name.'
            : 'Create a billing form for a client, add its fees, then calculate bills.'
        }
        emptyAction={
          perms.create && !filtered ? (
            <Button variant="primary" onClick={() => router.push('/billing/new')}>
              <Plus className="h-4 w-4" />
              Create billing form
            </Button>
          ) : undefined
        }
      />
      <CalculateDialog
        open={calc !== null}
        onOpenChange={(o) => !o && setCalc(null)}
        contracts={calc ?? []}
        onDone={() => g.refetch()}
      />
      <EntityChangeLogDrawer
        open={log !== null}
        onOpenChange={(o) => !o && setLog(null)}
        path={log ? `/api/billing/${log.id}/change-log` : null}
        title={`Change log · ${log?.name ?? ''}`}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        variant={meta?.variant ?? 'info'}
        title={`${meta?.title ?? ''} ${count === 1 ? pending?.rows[0]?.name : `${count} billing forms`}?`}
        description={meta?.description}
        confirmLabel="Yes"
        cancelLabel="No"
        records={{
          columns: [
            { key: 'name', label: 'Billing form' },
            { key: 'client', label: 'Client' },
            { key: 'status', label: 'Approval' },
            { key: 'fees', label: 'Fees' },
          ],
          rows: (pending?.rows ?? []).map((r) => ({
            name: r.name,
            client: r.clientName,
            status: r.approvalStatus,
            fees: r.feeCount,
          })),
        }}
        onConfirm={async () => {
          if (!pending || !meta) return;
          const result = await action.run<BulkResponse>(meta.path, 'POST', {
            ids: pending.rows.map((r) => r.id),
          });
          if (result) {
            toastBulk(result, 'billing form', meta.verb);
            g.clearSelection();
          }
          setPending(null);
        }}
      />
    </div>
  );
}
