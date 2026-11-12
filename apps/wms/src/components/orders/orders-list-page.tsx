'use client';

/**
 * Shipment Orders list (Order Backlog `/orders`, Shipped & Canceled `/orders/shipped`):
 * shared grid (Equal / Starts With search, 67 typed filters, chips, saved views, column
 * chooser, density, page sizes, async Excel export) + the Logiwa bulk menus.
 */
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  Edit3,
  Eye,
  FileSpreadsheet,
  History,
  MoreHorizontal,
  PackagePlus,
  Plus,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoTip } from '@/components/ui/info-tip';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import {
  DataGrid,
  DateCell,
  GridToolbar,
  useGrid,
  useRowNav,
  type FilterFieldDef,
  type RowAction,
} from '@/components/grid';
import { OrderStatusPill } from './order-status-pill';
import { ChangeLogDrawer } from '@/components/shared';
import { PageHeader } from '@/components/layout/page-header';
import { orderCrumbs } from './order-crumbs';
import { usePermissionSet } from '@/lib/permissions-client';
import {
  filterFieldsForView,
  ORDER_PERMISSIONS,
  SHIPMENT_ORDERS_GRID_KEY,
  SHIPPED_ORDERS_GRID_KEY,
  type OrderFilterField,
  type OrderView,
} from '@/lib/grid-defs/orders/shipment-orders';
import { exportColumnsForView } from './orders-export-columns';
import { buildOrderColumns } from './orders-columns';
import {
  bulkToast,
  errorMessage,
  runBulk,
  useInvalidateOrders,
  useOrderOptions,
  type OrderFormOptions,
  type OrderRow,
} from './orders-client';
import { eligibility } from './bulk/order-eligibility';
import { CHECKING_PERMISSIONS } from './use-order-permissions';
import { OrderBulkMenus } from './bulk/order-bulk-menus';

const COPY: Readonly<
  Record<OrderView, { readonly title: string; readonly helper: string; readonly gridKey: string }>
> = {
  backlog: {
    title: 'Shipment Orders',
    helper: 'Every open order across channels — allocate, pick, pack and ship from one place.',
    gridKey: SHIPMENT_ORDERS_GRID_KEY,
  },
  shipped: {
    title: 'Shipped & Canceled Orders',
    helper: 'Orders that left the building or were cancelled. Create RMAs and return labels here.',
    gridKey: SHIPPED_ORDERS_GRID_KEY,
  },
};

/** Builds client filter defs: dynamic enums get their options from the option lists. */
export function resolveFilterFields(
  fields: readonly OrderFilterField[],
  options: OrderFormOptions | undefined,
): readonly FilterFieldDef[] {
  return fields.map((f): FilterFieldDef => {
    let dyn: readonly { value: string; label: string }[] | undefined;
    if (f.dynamic === 'client') dyn = options?.clients;
    else if (f.dynamic === 'warehouse') dyn = options?.warehouses;
    else if (f.dynamic === 'tag') dyn = options?.tags;
    else if (f.dynamic === 'retailer') dyn = options?.retailers;
    else if (f.dynamic === 'carrier') dyn = options?.carrierCodes;
    else if (f.dynamic === 'orderType')
      dyn = options?.orderTypes.map((o) => ({ value: o.label, label: o.label }));
    return {
      field: f.field,
      label: f.label,
      type: f.type,
      ...(f.dynamic
        ? { options: (dyn ?? []).map((o) => ({ value: o.value, label: o.label })) }
        : f.options
          ? { options: f.options }
          : {}),
      ...(f.decimals !== undefined ? { decimals: f.decimals } : {}),
      ...(f.allowEmpty ? { allowEmpty: true } : {}),
      ...(f.group ? { group: f.group } : {}),
      ...(f.description ? { description: f.description } : {}),
    };
  });
}

function ImportMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]">
        <DropdownMenuItem
          icon={FileSpreadsheet}
          href="/imports/shipment-orders"
          description="Create orders from an Excel file"
        >
          Bulk import shipment orders
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={FileSpreadsheet}
          href="/imports/shipment-orders-update"
          description="Update existing orders by order code"
        >
          Bulk update shipment orders
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={ScanLine}
          href="/imports/so-serials"
          description="Attach serial numbers to order lines"
        >
          Import serial numbers
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Header controls while /api/me loads: present and disabled, so the header never jumps. */
function PendingHeaderActions({ view }: { readonly view: OrderView }) {
  if (view === 'shipped') {
    return (
      <DisabledReason reason={CHECKING_PERMISSIONS}>
        <Button variant="secondary" disabled>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Bulk update return info
        </Button>
      </DisabledReason>
    );
  }
  return (
    <>
      <DisabledReason reason={CHECKING_PERMISSIONS}>
        <Button variant="secondary" disabled>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </Button>
      </DisabledReason>
      <DisabledReason reason={CHECKING_PERMISSIONS}>
        <Button variant="primary" disabled>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create shipment order
        </Button>
      </DisabledReason>
    </>
  );
}

function HeaderActions({
  view,
  ready,
  canCreate,
  canImport,
  canEdit,
  selected,
  onReturnInfo,
}: {
  readonly view: OrderView;
  readonly ready: boolean;
  readonly canCreate: boolean;
  readonly canImport: boolean;
  readonly canEdit: boolean;
  readonly selected: readonly OrderRow[];
  readonly onReturnInfo: () => void;
}) {
  if (!ready) return <PendingHeaderActions view={view} />;
  if (view === 'shipped') {
    // Read-only roles never see a control they can't use (the drawer lives with the bulk menus).
    if (!canEdit) return null;
    const reason = eligibility.returnInfo(selected);
    return (
      <span className="flex items-center gap-1.5">
        <DisabledReason reason={reason}>
          <Button variant="secondary" disabled={Boolean(reason)} onClick={onReturnInfo}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Bulk update return info
          </Button>
        </DisabledReason>
        <InfoTip content="Set the return carrier, shipping option, cost and tracking numbers for the selected orders in one step." />
        {reason ? (
          <span className="text-xs text-faint">
            {selected.length === 0
              ? 'Select shipped orders to enable'
              : 'Cancelled orders have no return info'}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <>
      {/* Desktop / tablet: Import menu + primary CTA. */}
      <span className="hidden items-center gap-2 sm:flex">
        {canImport ? <ImportMenu /> : null}
        {canCreate ? (
          <Link href="/orders/new" className={buttonVariants({ variant: 'primary' })}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create shipment order
          </Link>
        ) : null}
      </span>
      {/* Phones: one compact primary + an overflow menu, stacked under the title. */}
      <span className="flex items-center gap-2 sm:hidden" data-testid="orders-mobile-actions">
        {canCreate ? (
          <Link href="/orders/new" className={buttonVariants({ variant: 'primary' })}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New order
          </Link>
        ) : null}
        {canImport ? <MobileOverflowMenu /> : null}
      </span>
    </>
  );
}

function MobileOverflowMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="More order actions">
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuItem
          icon={FileSpreadsheet}
          href="/imports/shipment-orders"
          description="Create orders from an Excel file"
        >
          Bulk import shipment orders
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={FileSpreadsheet}
          href="/imports/shipment-orders-update"
          description="Update existing orders by order code"
        >
          Bulk update shipment orders
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={ScanLine}
          href="/imports/so-serials"
          description="Attach serial numbers to order lines"
        >
          Import serial numbers
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shipped tab default: "Actual shipment date: last 7 days" when the URL carries no grid state. */
function useShippedDefault(view: OrderView, g: ReturnType<typeof useGrid<OrderRow>>): void {
  const params = useSearchParams();
  const applied = React.useRef(false);
  React.useEffect(() => {
    if (applied.current || view !== 'shipped' || g.views.isLoading) return;
    applied.current = true;
    const hasGridState = [...params.keys()].some((k) => k === 'q' || k === 'sort' || k.startsWith('f.'));
    if (!hasGridState && !g.views.views.some((v) => v.isDefault)) {
      g.grid.setQuery({
        filters: [{ field: 'shippedAt', op: 'date', date: { kind: 'fixed', preset: 'last7d' } }],
      });
    }
  }, [view, g.views.isLoading, g.views.views, g.grid, params]);
}

/** Phone card (below `md`): order #, client, status chip and order date. */
function OrderMobileCard({ row }: { readonly row: OrderRow }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{row.code}</span>
        <OrderStatusPill status={row.status} size="sm" />
      </span>
      <span className="truncate text-xs text-body">{String(row.clientName ?? '—')}</span>
      <span className="text-xs text-faint">
        <DateCell value={row.orderDate as string | null | undefined} />
      </span>
    </span>
  );
}

export function OrdersListPage({ view }: { readonly view: OrderView }) {
  const rowNav = useRowNav();
  const copy = COPY[view];
  const { permissions, isLoading: permissionsLoading } = usePermissionSet();
  const options = useOrderOptions();
  const fields = React.useMemo(
    () => resolveFilterFields(filterFieldsForView(view), options.data?.data),
    [view, options.data],
  );
  const extraQuery = React.useMemo(() => ({ view }), [view]);
  const g = useGrid<OrderRow>({ gridKey: copy.gridKey, path: '/api/orders', fields, extraQuery });
  useShippedDefault(view, g);
  const columns = React.useMemo(() => buildOrderColumns(view), [view]);
  const [changeLog, setChangeLog] = React.useState<OrderRow | null>(null);
  const [deleteRow, setDeleteRow] = React.useState<OrderRow | null>(null);
  const [returnInfoOpen, setReturnInfoOpen] = React.useState(false);

  // Selection survives paging: remember every row seen so bulk menus know their facts.
  const seen = React.useRef(new Map<string, OrderRow>());
  for (const r of g.rows) seen.current.set(r.id, r);
  const selectedRows = g.selectedIds
    .map((id) => seen.current.get(id))
    .filter((r): r is OrderRow => Boolean(r));

  const invalidateOrders = useInvalidateOrders();
  // Refetch the grid now and invalidate counts/detail caches so status chips and pills update at once.
  const refresh = () => {
    g.clearSelection();
    g.refetch();
    void invalidateOrders();
  };

  const rowActions = (row: OrderRow): readonly RowAction[] => {
    const href = `/orders/${encodeURIComponent(row.code)}`;
    const deleteReason = permissionsLoading
      ? CHECKING_PERMISSIONS
      : !permissions.has(ORDER_PERMISSIONS.delete)
        ? "You don't have permission to delete orders"
        : row.status !== 'Open'
          ? `Only Open orders can be deleted; this order is ${row.status}.`
          : row.jobId
            ? 'This order is in a job. Remove it from the job first.'
            : null;
    return [
      { key: 'details', label: 'Show details', icon: Eye, href },
      {
        key: 'edit',
        label: 'Edit',
        icon: Edit3,
        href: `${href}?tab=edit&step=details`,
        disabledReason: permissionsLoading
          ? CHECKING_PERMISSIONS
          : permissions.has(ORDER_PERMISSIONS.edit)
            ? null
            : "You don't have permission to edit orders",
      },
      { key: 'log', label: 'Change log', icon: History, onSelect: () => setChangeLog(row) },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        destructive: true,
        disabledReason: deleteReason,
        onSelect: () => setDeleteRow(row),
      },
    ];
  };

  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  // While permissions load the bulk menus render disabled ("Checking permissions…") instead of being absent.
  const canMutate =
    permissionsLoading ||
    [...permissions].some((p) => p.startsWith('fulfillment.shipment_orders.') && !p.endsWith('.view'));

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title={copy.title}
        breadcrumbs={orderCrumbs(copy.title)}
        // The helper sentence is hidden on phones so the grid keeps its rows.
        helper={<span className="hidden sm:inline">{copy.helper}</span>}
        tabs="orders"
        actions={
          <HeaderActions
            view={view}
            ready={!permissionsLoading}
            canCreate={permissions.has(ORDER_PERMISSIONS.create)}
            canImport={permissions.has(ORDER_PERMISSIONS.import)}
            canEdit={permissions.has(ORDER_PERMISSIONS.edit)}
            selected={selectedRows}
            onReturnInfo={() => setReturnInfoOpen(true)}
          />
        }
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Order code, store order #, customer, tracking"
        onRefresh={refresh}
        trailing={
          canMutate ? (
            <span className={selectedRows.length === 0 ? 'hidden sm:contents' : 'contents'}>
              <OrderBulkMenus
                view={view}
                rows={selectedRows}
                onChanged={refresh}
                returnInfoOpen={returnInfoOpen}
                onReturnInfoOpenChange={setReturnInfoOpen}
              />
            </span>
          ) : null
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<OrderRow>
          {...g.gridProps}
          queryString={`${g.gridProps.queryString}${g.gridProps.queryString ? '&' : ''}view=${view}`}
          exportColumns={exportColumnsForView(view)}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => rowNav.navigate(row.id, `/orders/${encodeURIComponent(row.code)}`)}
          pendingRowId={rowNav.pendingRowId}
          renderMobileCard={(row) => <OrderMobileCard row={row} />}
          emptyTitle={
            hasState
              ? 'Could not find any shipment order'
              : view === 'shipped'
                ? 'No shipped or canceled orders yet'
                : 'No shipment orders yet'
          }
          emptyDescription={hasState ? 'Try changing the filters or search term.' : undefined}
          emptyAction={
            hasState || view === 'shipped' ? undefined : (
              <EmptyState
                compact
                title=""
                cards={[
                  {
                    title: 'No products?',
                    description: 'Create products before creating a shipment order.',
                    icon: PackagePlus,
                    href: '/products',
                  },
                  {
                    title: 'Create shipment orders here',
                    description: 'Start the six-step order wizard.',
                    icon: Plus,
                    href: '/orders/new',
                  },
                ]}
              />
            )
          }
        />
      </div>
      {changeLog ? (
        <ChangeLogDrawer
          open
          onOpenChange={(o) => (o ? undefined : setChangeLog(null))}
          entityType="shipment_order"
          entityId={changeLog.id}
          entityCode={changeLog.code}
        />
      ) : null}
      <ConfirmDialog
        open={deleteRow !== null}
        onOpenChange={(o) => (o ? undefined : setDeleteRow(null))}
        variant="danger"
        title="Are you sure you want to delete your order?"
        description="The order leaves every list; its change log keeps a Delete entry."
        records={
          deleteRow
            ? {
                columns: [
                  { key: 'code', label: 'Order code' },
                  { key: 'date', label: 'Order date' },
                  { key: 'status', label: 'Status' },
                ],
                rows: [
                  {
                    code: deleteRow.code,
                    date: new Date(String(deleteRow.orderDate)).toLocaleString(),
                    status: deleteRow.status,
                  },
                ],
              }
            : undefined
        }
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={async () => {
          if (!deleteRow) return;
          try {
            const result = await runBulk('delete', { ids: [deleteRow.id] });
            bulkToast(result, 'deleted', new Map([[deleteRow.id, deleteRow.code]]));
            refresh();
          } catch (error) {
            toast.error('Delete failed', errorMessage(error));
          }
        }}
      />
      <span className="sr-only" aria-live="polite">
        {g.isFetching ? 'Loading orders' : `${g.total} orders`}
      </span>
    </div>
  );
}
