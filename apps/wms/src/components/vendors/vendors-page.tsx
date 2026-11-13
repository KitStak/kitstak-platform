'use client';

/**
 * Vendors list — one component mounted at `/receiving/vendors` (tab group "receiving")
 * and `/organization/vendors` (tab group "organization"). Display name opens the
 * read-only Show details drawer; row menu: Show details / Edit / Change log / Deactivate
 * (blocked with open POs) / Activate / Delete (disabled with a reason while POs are open).
 */
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, CheckCircle2, Eye, History, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { DataGrid, GridToolbar, useGrid, type BulkAction, type RowAction } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { ChangeLogDrawer } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { apiRequest } from '@/lib/api-client';
import { subdivisionName } from '@/lib/countries';
import { VENDOR_GRID_FIELDS, VENDORS_GRID_KEY } from '@/lib/grid-defs/receiving/vendors';
import {
  bulkToast,
  errorMessage,
  postBulk,
  useFilterFields,
  useInvalidateReceiving,
  type VendorRow,
  useCan,
} from '@/components/receiving/receiving-shared';
import { VendorDetailsDrawer } from './vendor-details-drawer';
import { VendorDrawer } from './vendor-drawer';

/** One line, like the Clients / Customers / Retailers helpers, so the Organization header and tab strip keep the same height. */
export const VENDOR_HELPER = "Companies that supply your clients' products, used on purchase orders.";
export const OPEN_PO_DELETE_REASON =
  'This vendor has open purchase orders. Complete or cancel them before deleting.';
export const OPEN_PO_DEACTIVATE_REASON =
  'This vendor has open purchase orders. Complete or cancel them before deactivating.';

const dash = <span className="text-faint">None</span>;

function buildColumns(openVendor: (row: VendorRow) => void): ColumnDef<VendorRow, unknown>[] {
  return [
    {
      id: 'displayName',
      accessorKey: 'displayName',
      header: 'Display name',
      size: 220,
      minSize: 160,
      meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openVendor(row.original);
          }}
          className="truncate rounded text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {row.original.displayName}
        </button>
      ),
    },
    {
      id: 'vendorName',
      accessorKey: 'vendorName',
      header: 'Vendor name',
      size: 240,
      cell: ({ getValue }) => <span className="truncate">{String(getValue())}</span>,
    },
    {
      id: 'clientName',
      accessorKey: 'clientName',
      header: 'Client',
      size: 180,
      cell: ({ getValue }) => <span className="truncate">{String(getValue() ?? '')}</span>,
    },
    {
      id: 'location',
      header: 'Ships from',
      size: 180,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.city || row.original.state ? (
          <span className="truncate">
            {[
              row.original.city,
              row.original.state ? subdivisionName('US', row.original.state) || row.original.state : null,
            ]
              .filter(Boolean)
              .join(', ')}
          </span>
        ) : (
          dash
        ),
    },
    {
      id: 'openPoCount',
      accessorKey: 'openPoCount',
      header: 'Open POs',
      size: 110,
      meta: {
        align: 'right',
        headerClassName: 'flex-row',
        headerTip: 'Pending or Started purchase orders for this vendor.',
      },
      cell: ({ getValue }) => (
        <span
          className={
            (getValue() as number) > 0
              ? 'font-semibold tabular-nums text-foreground'
              : 'tabular-nums text-faint'
          }
        >
          {String(getValue())}
        </span>
      ),
    },
    {
      // Same Status vocabulary as the Clients, Customers and Retailers tabs.
      id: 'isActive',
      accessorKey: 'isActive',
      header: 'Status',
      size: 110,
      meta: { clip: false },
      cell: ({ getValue }) => <StatusPill status={getValue() ? 'Active' : 'Inactive'} domain="active" />,
    },
  ];
}

export function VendorsPage({ tabs }: { readonly tabs: 'receiving' | 'organization' }) {
  const invalidate = useInvalidateReceiving();
  const fields = useFilterFields(VENDOR_GRID_FIELDS);
  const g = useGrid<VendorRow>({ gridKey: VENDORS_GRID_KEY, path: '/api/vendors', fields });
  const can = {
    create: useCan('settings.vendors.create').allowed,
    edit: useCan('settings.vendors.edit').allowed,
    del: useCan('settings.vendors.delete').allowed,
    log: useCan('settings.vendors.change_log').allowed,
  };
  const [drawer, setDrawer] = React.useState<{ id: string | null } | null>(null);
  const [logFor, setLogFor] = React.useState<VendorRow | null>(null);
  const [details, setDetails] = React.useState<string | null>(null);
  const [toggle, setToggle] = React.useState<VendorRow | null>(null);
  const [bulk, setBulk] = React.useState<{
    kind: 'activate' | 'deactivate' | 'delete';
    ids: readonly string[];
  } | null>(null);
  const [seen, setSeen] = React.useState<ReadonlyMap<string, VendorRow>>(new Map());
  React.useEffect(() => {
    setSeen((prev) =>
      g.rows.some((r) => prev.get(r.id) !== r)
        ? new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)])
        : prev,
    );
  }, [g.rows]);
  const rowOf = (id: string) => g.rows.find((r) => r.id === id) ?? seen.get(id);
  const labelOf = (id: string) => rowOf(id)?.displayName ?? 'Vendor';
  const columns = React.useMemo(() => buildColumns((row) => setDetails(row.id)), []);

  const setActive = async (row: VendorRow) => {
    try {
      await apiRequest(`/api/vendors/${row.id}/active`, {
        method: 'POST',
        body: { active: !row.isActive, version: row.version },
      });
      toast.success('Success', `${row.displayName} ${row.isActive ? 'deactivated' : 'activated'}.`);
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      await invalidate();
    }
  };

  const rowActions = (row: VendorRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, onSelect: () => setDetails(row.id) },
    ...(can.edit
      ? [{ key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setDrawer({ id: row.id }) }]
      : []),
    ...(can.log ? [{ key: 'log', label: 'Change log', icon: History, onSelect: () => setLogFor(row) }] : []),
    ...(can.edit
      ? [
          row.isActive
            ? {
                key: 'deactivate',
                label: 'Deactivate',
                icon: Ban,
                destructive: true,
                disabledReason: row.openPoCount > 0 ? OPEN_PO_DEACTIVATE_REASON : null,
                onSelect: () => setToggle(row),
              }
            : { key: 'activate', label: 'Activate', icon: CheckCircle2, onSelect: () => setToggle(row) },
        ]
      : []),
    ...(can.edit || can.del
      ? [
          {
            key: 'delete',
            label: 'Delete',
            icon: Trash2,
            destructive: true,
            disabledReason: !can.del
              ? "You don't have permission to delete vendors"
              : row.openPoCount > 0
                ? OPEN_PO_DELETE_REASON
                : null,
            onSelect: () => setBulk({ kind: 'delete' as const, ids: [row.id] }),
          },
        ]
      : []),
  ];

  const runBulkAction = async (kind: 'activate' | 'deactivate' | 'delete', ids: readonly string[]) => {
    try {
      const result =
        kind === 'delete'
          ? await postBulk('/api/vendors/bulk/delete', ids)
          : (
              await apiRequest<Awaited<ReturnType<typeof postBulk>>>('/api/vendors/bulk/active', {
                method: 'POST',
                body: { ids, active: kind === 'activate' },
              })
            ).data;
      bulkToast(result, labelOf, { done: kind === 'delete' ? 'deleted' : `${kind}d`, noun: 'vendor' });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      g.clearSelection();
      void invalidate();
    }
  };

  const bulkActions: readonly BulkAction[] = can.edit
    ? [
        {
          key: 'activate',
          label: 'Activate',
          icon: CheckCircle2,
          onSelect: (ids) => setBulk({ kind: 'activate', ids }),
          eligibility: (ids) =>
            ids.every((id) => rowOf(id)?.isActive) ? 'The selected vendors are already active' : null,
        },
        {
          key: 'deactivate',
          label: 'Deactivate',
          icon: Ban,
          onSelect: (ids) => setBulk({ kind: 'deactivate', ids }),
          eligibility: (ids) =>
            ids.some((id) => (rowOf(id)?.openPoCount ?? 0) > 0)
              ? 'Some selected vendors have open purchase orders'
              : ids.every((id) => rowOf(id) && !rowOf(id)?.isActive)
                ? 'The selected vendors are already inactive'
                : null,
        },
        {
          key: 'delete',
          label: 'Delete',
          icon: Trash2,
          destructive: true,
          onSelect: (ids) => setBulk({ kind: 'delete', ids }),
          disabledReason: can.del ? null : "You don't have permission to delete vendors",
          eligibility: (ids) =>
            ids.some((id) => (rowOf(id)?.openPoCount ?? 0) > 0)
              ? "Vendors with open purchase orders can't be deleted"
              : null,
        },
      ]
    : [];

  const createButton = can.create ? (
    <Button variant="primary" onClick={() => setDrawer({ id: null })}>
      <Plus className="h-3.5 w-3.5" aria-hidden />
      Create vendor
    </Button>
  ) : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      {/* Always pass an element: permissions resolve on the client, and a null here makes SSR drop the actions slot (hydration mismatch). */}
      <PageHeader title="Vendors" tabs={tabs} helper={VENDOR_HELPER} actions={<>{createButton}</>} />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search by vendor or display name"
        bulkNoun="vendor"
        bulkActions={bulkActions}
        selectedIds={g.selectedIds}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<VendorRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          selectable={can.edit}
          onRowClick={(row) => setDetails(row.id)}
          emptyTitle="No vendors match this view"
          emptyDescription="Clear the filters, or add the companies that supply your clients."
          emptyAction={createButton}
        />
      </div>
      <VendorDetailsDrawer
        vendorId={details}
        onOpenChange={(open) => !open && setDetails(null)}
        onEdit={
          can.edit
            ? (id) => {
                setDetails(null);
                setDrawer({ id });
              }
            : undefined
        }
      />
      <VendorDrawer
        open={drawer !== null}
        onOpenChange={(open) => !open && setDrawer(null)}
        vendorId={drawer?.id ?? null}
      />
      {logFor ? (
        <ChangeLogDrawer
          open
          onOpenChange={(open) => !open && setLogFor(null)}
          entityType="vendor"
          entityId={logFor.id}
          entityCode={logFor.displayName}
        />
      ) : null}
      <ConfirmDialog
        open={toggle !== null}
        onOpenChange={(open) => !open && setToggle(null)}
        variant={toggle?.isActive ? 'danger' : 'info'}
        icon={toggle?.isActive ? Ban : Truck}
        title={
          toggle?.isActive
            ? `Deactivate ${toggle?.displayName ?? 'vendor'}?`
            : `Activate ${toggle?.displayName ?? 'vendor'}?`
        }
        description={
          toggle?.isActive
            ? "Inactive vendors can't be chosen on new purchase orders. Existing orders keep them."
            : 'The vendor can be chosen on purchase orders again.'
        }
        records={
          toggle
            ? {
                columns: [
                  { key: 'name', label: 'Display name' },
                  { key: 'client', label: 'Client' },
                  { key: 'open', label: 'Open POs' },
                ],
                rows: [
                  { name: toggle.displayName, client: toggle.clientName, open: String(toggle.openPoCount) },
                ],
              }
            : undefined
        }
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => (toggle ? setActive(toggle) : undefined)}
      />
      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(open) => !open && setBulk(null)}
        variant={bulk?.kind === 'activate' ? 'info' : 'danger'}
        icon={bulk?.kind === 'delete' ? Trash2 : bulk?.kind === 'activate' ? CheckCircle2 : Ban}
        title={
          bulk
            ? `${bulk.kind === 'delete' ? 'Delete' : bulk.kind === 'activate' ? 'Activate' : 'Deactivate'} ${bulk.ids.length} vendor${bulk.ids.length === 1 ? '' : 's'}?`
            : ''
        }
        description={
          bulk?.kind === 'delete'
            ? "Vendors already used on a purchase order are skipped; deactivate those instead. This can't be undone."
            : bulk?.kind === 'deactivate'
              ? "Inactive vendors can't be chosen on new purchase orders."
              : 'The vendors can be chosen on purchase orders again.'
        }
        records={
          bulk
            ? {
                columns: [
                  { key: 'name', label: 'Display name' },
                  { key: 'client', label: 'Client' },
                  { key: 'open', label: 'Open POs' },
                ],
                rows: bulk.ids.map((id) => ({
                  name: labelOf(id),
                  client: rowOf(id)?.clientName ?? '',
                  open: String(rowOf(id)?.openPoCount ?? 0),
                })),
              }
            : undefined
        }
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => (bulk ? runBulkAction(bulk.kind, bulk.ids) : undefined)}
      />
    </div>
  );
}
