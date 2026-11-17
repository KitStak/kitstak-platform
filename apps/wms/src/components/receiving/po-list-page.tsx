'use client';

/**
 * Purchase Orders list (`/receiving`). Shared grid (search mode, filters, chips, saved
 * views, column chooser, density, page sizes, async xlsx export) plus the Logiwa bulk
 * actions: Tag, Label ▾, Cancel Order, Receive PO, Delete ▾. Every destructive bulk
 * action runs through ConfirmDialog with a mini table; results come back per id.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  ChevronDown,
  Eye,
  FileText,
  History,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  Tag as TagIcon,
  Trash2,
  Upload,
} from 'lucide-react';
import { DataGrid, GridToolbar, useGrid, type RowAction } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { ChangeLogDrawer, TagPopover } from '@/components/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { useFormat } from '@/lib/format';
import { PO_GRID_FIELDS, PURCHASE_ORDERS_GRID_KEY } from '@/lib/grid-defs/receiving/purchase-orders';
import { buildPoColumns } from './po-columns';
import {
  cancelCopy,
  cancelReason,
  deleteReason,
  partialActionReason,
  partitionPos,
  receiveAllReason,
  removeSerialsReason,
  skippedSummary,
  type SkippedPo,
} from './po-action-rules';

export {
  cancelCopy,
  cancelReason,
  deleteReason,
  partialActionReason,
  partitionPos,
  receiveAllReason,
  receiveReason,
  removeSerialsReason,
  SERIAL_PREADVICE_REASON,
  skippedSummary,
} from './po-action-rules';
import { PoLabelPrintModal } from './po-label-print-modal';
import {
  bulkToast,
  errorMessage,
  Nowrap,
  openFile,
  postBulk,
  useFilterFields,
  useInvalidateReceiving,
  type BulkResult,
  type PoRow,
  useCan,
  ReceivingReportLinks,
  slowLoadError,
  useSlowLoad,
} from './receiving-shared';

const P = 'inventory.purchase_orders.';
/** `skipped`: selected rows the action can't run on (Cancel / Receive PO act on the eligible ones). */
type Dialog = {
  kind: 'cancel' | 'receive' | 'delete' | 'remove-serials';
  rows: readonly PoRow[];
  skipped?: readonly SkippedPo[];
  selectedCount?: number;
} | null;

type Qc = ReturnType<typeof useQueryClient>;
/** `useGrid` keys are ["grid", gridKey, path, query]. */
const isPoGridKey = (key: readonly unknown[]): boolean =>
  key[0] === 'grid' && key[2] === '/api/purchase-orders';

/** Replaces cached purchase-order grid rows with fresh rows from a mutation response. */
export function patchPoRows(qc: Qc, rows: readonly PoRow[]): void {
  if (rows.length === 0) return;
  const byId = new Map(rows.map((r) => [r.id, r]));
  qc.setQueriesData<{ data?: unknown }>({ predicate: (q) => isPoGridKey(q.queryKey) }, (old) => {
    if (!old || !Array.isArray(old.data)) return old;
    let hit = false;
    const data = (old.data as PoRow[]).map((r) => {
      const fresh = r ? byId.get(r.id) : undefined;
      if (!fresh) return r;
      hit = true;
      return fresh;
    });
    return hit ? { ...old, data } : old;
  });
}

/** Drops deleted purchase orders from every cached grid page. */
export function removePoRows(qc: Qc, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  qc.setQueriesData<{ data?: unknown; meta?: { total?: number } }>(
    { predicate: (q) => isPoGridKey(q.queryKey) },
    (old) => {
      if (!old || !Array.isArray(old.data)) return old;
      const data = (old.data as PoRow[]).filter((r) => !gone.has(r?.id));
      if (data.length === old.data.length) return old;
      const removed = old.data.length - data.length;
      return {
        ...old,
        data,
        ...(old.meta && typeof old.meta.total === 'number'
          ? { meta: { ...old.meta, total: Math.max(0, old.meta.total - removed) } }
          : {}),
      };
    },
  );
}

function HeaderActions({
  canCreate,
  canImport,
  canImportSerials,
  loading,
}: {
  readonly canCreate: boolean;
  readonly canImport: boolean;
  readonly canImportSerials: boolean;
  readonly loading: boolean;
}) {
  // While permissions resolve, reserve the buttons (disabled) so the header never shifts.
  if (loading) {
    return (
      <>
        <Button variant="secondary" disabled aria-busy>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button variant="primary" disabled aria-busy>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create purchase order
        </Button>
      </>
    );
  }
  return (
    <>
      {canImport || canImportSerials ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Import
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItem
              href="/receiving/import"
              icon={FileText}
              disabledReason={canImport ? null : "You don't have permission to import purchase orders"}
              description="Template, manual, upload and import history"
            >
              Purchase orders
            </DropdownMenuItem>
            <DropdownMenuItem
              href="/receiving/import?type=po-serials"
              icon={FileText}
              disabledReason={canImportSerials ? null : "You don't have permission to import serial numbers"}
              description="Serial numbers per PO line"
            >
              Serial numbers
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canCreate ? (
        <Link href="/receiving/new" className={buttonVariants({ variant: 'primary' })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create purchase order
        </Link>
      ) : null}
    </>
  );
}

export function PoListPage() {
  const router = useRouter();
  const fmt = useFormat();
  const invalidate = useInvalidateReceiving();
  const qc = useQueryClient();
  const fields = useFilterFields(PO_GRID_FIELDS, {
    customFieldEntity: 'purchase_order',
    tagScope: 'purchase_order',
  });
  const g = useGrid<PoRow>({ gridKey: PURCHASE_ORDERS_GRID_KEY, path: '/api/purchase-orders', fields });
  const slow = useSlowLoad(g.isLoading);
  const columns = React.useMemo(() => buildPoColumns(), []);
  const permsLoading = useCan(`${P}create`).isLoading;
  const can = {
    create: useCan(`${P}create`).allowed,
    edit: useCan(`${P}edit`).allowed,
    del: useCan(`${P}delete`).allowed,
    cancel: useCan(`${P}cancel_order`).allowed,
    receive: useCan(`${P}receive_po`).allowed,
    tag: useCan(`${P}tag`).allowed,
    productLabel: useCan(`${P}product_label`).allowed,
    poLabel: useCan(`${P}purchase_order_label`).allowed,
    log: useCan(`${P}change_log`).allowed,
    imp: useCan(`${P}import_file`).allowed,
    impSerials: useCan(`${P}import_serial_numbers`).allowed,
    removeSerials: useCan(`${P}remove_serial_number`).allowed,
  };

  // Remember every row seen so selections across pages keep their status for guards.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, PoRow>>(new Map());
  React.useEffect(() => {
    // g.rows may be a fresh array every render (empty fallback), so only commit real changes.
    setSeen((prev) =>
      g.rows.some((r) => prev.get(r.id) !== r)
        ? new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)])
        : prev,
    );
  }, [g.rows]);
  const selected = g.selectedIds
    .map((id) => g.rows.find((r) => r.id === id) ?? seen.get(id))
    .filter((r): r is PoRow => Boolean(r));
  const codeOf = (id: string) =>
    seen.get(id)?.code ?? g.rows.find((r) => r.id === id)?.code ?? 'selected order';

  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [labelIds, setLabelIds] = React.useState<readonly string[] | null>(null);
  const [logFor, setLogFor] = React.useState<PoRow | null>(null);

  // Refetch in the background: confirm dialogs close as soon as the mutation resolves.
  const finish = () => {
    g.clearSelection();
    void invalidate();
  };

  const runBulk = async (
    kind: 'cancel' | 'receive' | 'delete' | 'remove-serials',
    rows: readonly PoRow[],
    skipped: readonly SkippedPo[] = [],
  ) => {
    if (rows.length === 0) return;
    try {
      const result = await postBulk(
        `/api/purchase-orders/bulk/${kind}`,
        rows.map((r) => r.id),
      );
      // Patch the visible rows from the response at once, so the grid never shows (or offers
      // actions on) a stale status while the background refetch runs.
      if (kind === 'delete') removePoRows(qc, result.succeeded);
      else patchPoRows(qc, (result as BulkResult & { rows?: readonly PoRow[] }).rows ?? []);
      setSeen((prev) => {
        const next = new Map(prev);
        for (const r of (result as BulkResult & { rows?: readonly PoRow[] }).rows ?? []) next.set(r.id, r);
        if (kind === 'delete') for (const id of result.succeeded) next.delete(id);
        return next;
      });
      const verbs = {
        cancel: {
          done: 'cancelled',
          noun: 'order',
          successMessage: rows.length === 1 ? 'You have successfully cancelled an order.' : undefined,
        },
        receive: {
          done: 'received',
          noun: 'order',
          successMessage: 'You have successfully received orders.',
        },
        delete: { done: 'deleted', noun: 'purchase order' },
        'remove-serials': {
          done: 'cleared of pre-advised serials',
          noun: 'purchase order',
          successMessage: `Removed ${((result as BulkResult & { removed?: number }).removed ?? 0).toLocaleString()} pre-advised serial number${(result as BulkResult & { removed?: number }).removed === 1 ? '' : 's'}.`,
        },
      }[kind];
      bulkToast(result, codeOf, verbs);
      const skippedText = skippedSummary(skipped, rows.length + skipped.length);
      if (skippedText)
        toast.show({ variant: 'info', title: 'Skipped', message: skippedText, duration: 9000 });
      const short = (result as BulkResult & { shortClosed?: readonly string[] }).shortClosed ?? [];
      if (kind === 'cancel' && short.length > 0) {
        toast.info(
          'Open balance cancelled',
          `${short.map(codeOf).join(', ')} had received stock: the open balance was cancelled, received stock kept, and the order${short.length === 1 ? ' is' : 's are'} Completed.`,
        );
      }
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      finish();
    }
  };

  const rowActions = (row: PoRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, href: `/receiving/${row.id}` },
    ...(can.edit
      ? [{ key: 'edit', label: 'Edit', icon: Pencil, href: `/receiving/${row.id}?step=details` }]
      : []),
    ...(can.log ? [{ key: 'log', label: 'Change log', icon: History, onSelect: () => setLogFor(row) }] : []),
    ...(can.del
      ? [
          {
            key: 'delete',
            label: 'Delete',
            icon: Trash2,
            destructive: true,
            disabledReason: deleteReason([row]),
            onSelect: () => setDialog({ kind: 'delete', rows: [row] }),
          },
        ]
      : []),
  ];

  const none = permsLoading
    ? 'Loading permissions'
    : selected.length === 0
      ? 'Select at least one purchase order'
      : null;
  // Cancel order and Receive PO act on the eligible rows of a mixed selection (Logiwa parity);
  // the skipped rows and their reasons are listed in the confirm and in the result toast.
  const reasonCancel = none ?? partialActionReason(selected, cancelReason);
  const reasonReceive = none ?? partialActionReason(selected, receiveAllReason);
  const openPartial = (kind: 'cancel' | 'receive') => {
    const { eligible, skipped } = partitionPos(selected, kind === 'cancel' ? cancelReason : receiveAllReason);
    setDialog({ kind, rows: eligible, skipped, selectedCount: selected.length });
  };
  const skippedNote =
    dialog?.skipped && dialog.skipped.length > 0
      ? ` ${skippedSummary(dialog.skipped, dialog.selectedCount ?? dialog.rows.length + dialog.skipped.length)}`
      : '';
  const reasonDelete = none ?? deleteReason(selected);
  const reasonRemoveSerials =
    none ??
    (can.removeSerials
      ? removeSerialsReason(selected)
      : "You don't have permission to remove serial numbers");
  const serialRows = selected.filter((r) => (r.preAdvisedSerials ?? 0) > 0);
  const targets = [
    ...new Set((dialog?.rows ?? []).map((r) => r.receivingLocationCode ?? 'the default receiving location')),
  ];

  const trailing = (
    <div className="flex items-center gap-2">
      {can.tag || permsLoading ? (
        <TagPopover
          entityType="purchase_order"
          scope="purchase_order"
          ids={g.selectedIds}
          appliedTagIds={selected.length === 1 ? selected[0]?.tags.map((t) => t.id) : []}
          onApplied={finish}
          disabledReason={none}
          trigger={
            <Button variant="secondary" aria-label="Tag" title={none ?? 'Tag'} disabled={Boolean(none)}>
              <TagIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden lg:inline">Tag</span>
            </Button>
          }
        />
      ) : null}
      {can.productLabel || can.poLabel || permsLoading ? (
        <DropdownMenu>
          <DisabledReason reason={none}>
            <DropdownMenuTrigger asChild disabled={Boolean(none)}>
              <Button variant="secondary" aria-label="Label" title={none ?? 'Label'} disabled={Boolean(none)}>
                <Printer className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden lg:inline">Label</span>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItem
              icon={TagIcon}
              disabledReason={can.productLabel ? null : "You don't have permission to print product labels"}
              description="Per line or per unit (Use as line quantity)"
              onSelect={() => setLabelIds([...g.selectedIds])}
            >
              Product label
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={FileText}
              disabledReason={can.poLabel ? null : "You don't have permission to print purchase orders"}
              description="The purchase order document (PDF)"
              onSelect={() =>
                openFile(`/api/purchase-orders/documents?ids=${encodeURIComponent(g.selectedIds.join(','))}`)
              }
            >
              Purchase order
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {can.cancel || permsLoading ? (
        <DisabledReason reason={reasonCancel}>
          <Button
            variant="secondary"
            aria-label="Cancel order"
            title={reasonCancel ?? 'Cancel order'}
            disabled={Boolean(reasonCancel)}
            onClick={() => openPartial('cancel')}
          >
            <Ban className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden lg:inline">Cancel order</span>
          </Button>
        </DisabledReason>
      ) : null}
      {can.receive || permsLoading ? (
        <DisabledReason reason={reasonReceive}>
          <Button
            variant="secondary"
            aria-label="Receive PO"
            title={reasonReceive ?? 'Receive PO'}
            disabled={Boolean(reasonReceive)}
            onClick={() => openPartial('receive')}
          >
            <PackageCheck className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden lg:inline">Receive PO</span>
          </Button>
        </DisabledReason>
      ) : null}
      {can.del || can.removeSerials || permsLoading ? (
        <DropdownMenu>
          <DisabledReason reason={none}>
            <DropdownMenuTrigger asChild disabled={Boolean(none)}>
              <Button
                variant="secondary"
                aria-label="Delete"
                title={none ?? 'Delete'}
                disabled={Boolean(none)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden lg:inline">Delete</span>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            {/* Disabled items drop the red tone and say why inline (not only on hover). */}
            <DropdownMenuItem
              icon={Trash2}
              destructive={!(can.del ? reasonDelete : true)}
              description={
                can.del
                  ? (reasonDelete ?? 'Pending orders without receipts')
                  : "You don't have permission to delete purchase orders"
              }
              disabledReason={can.del ? reasonDelete : "You don't have permission to delete purchase orders"}
              onSelect={() => setDialog({ kind: 'delete', rows: selected })}
            >
              Delete purchase order
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Trash2}
              destructive={!reasonRemoveSerials}
              description={
                reasonRemoveSerials ??
                `${serialRows.reduce((n, r) => n + (r.preAdvisedSerials ?? 0), 0).toLocaleString()} pre-advised serial number(s)`
              }
              disabledReason={reasonRemoveSerials}
              onSelect={() => setDialog({ kind: 'remove-serials', rows: serialRows })}
            >
              Remove serial number
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  const confirmRecords = dialog
    ? {
        columns: [
          { key: 'code', label: 'PO number' },
          { key: 'status', label: 'Status' },
          { key: 'date', label: 'PO date' },
          { key: 'qty', label: 'Open qty' },
        ],
        rows: dialog.rows.map((r) => ({
          code: <Nowrap mono>{r.code}</Nowrap>,
          status: <StatusPill status={r.status} domain="purchaseOrder" size="sm" />,
          date: <Nowrap>{r.poDate ? fmt.date(r.poDate) : 'None'}</Nowrap>,
          qty: Math.max(0, r.totalQuantity - r.receivedQuantity).toLocaleString(),
        })),
      }
    : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Purchase Orders"
        tabs="receiving"
        actions={
          <>
            <ReceivingReportLinks />
            <HeaderActions
              canCreate={can.create}
              canImport={can.imp}
              canImportSerials={can.impSerials}
              loading={permsLoading}
            />
          </>
        }
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search by code or reference"
        bulkNoun="purchase order"
        trailing={trailing}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<PoRow>
          {...g.gridProps}
          loading={g.gridProps.loading && !slow}
          error={slowLoadError(g.gridProps.error, slow)}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/receiving/${row.id}`)}
          emptyTitle="No purchase orders match this view"
          emptyDescription="Clear the filters or create a purchase order to start receiving."
          emptyAction={
            can.create ? (
              <Link href="/receiving/new" className={buttonVariants({ variant: 'primary' })}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create purchase order
              </Link>
            ) : undefined
          }
        />
      </div>

      <ConfirmDialog
        open={dialog?.kind === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        variant="danger"
        icon={Ban}
        title={cancelCopy(dialog?.rows ?? []).title}
        description={`${cancelCopy(dialog?.rows ?? []).description}${skippedNote}`}
        records={confirmRecords}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => runBulk('cancel', dialog?.rows ?? [], dialog?.skipped)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'receive'}
        onOpenChange={(open) => !open && setDialog(null)}
        variant="info"
        icon={PackageCheck}
        title={`Receive ${dialog?.rows.length ?? 0} purchase order${dialog?.rows.length === 1 ? '' : 's'} in full?`}
        description={`Every open line is received into ${targets.join(', ')}.${skippedNote}`}
        records={confirmRecords}
        confirmLabel="Receive"
        cancelLabel="No"
        onConfirm={() => runBulk('receive', dialog?.rows ?? [], dialog?.skipped)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        variant="danger"
        title={`Delete ${dialog?.rows.length ?? 0} purchase order${dialog?.rows.length === 1 ? '' : 's'}?`}
        description="This action cannot be undone."
        records={confirmRecords}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => runBulk('delete', dialog?.rows ?? [])}
      />
      <ConfirmDialog
        open={dialog?.kind === 'remove-serials'}
        onOpenChange={(open) => !open && setDialog(null)}
        variant="danger"
        icon={Trash2}
        title={`Remove pre-advised serial numbers from ${dialog?.rows.length ?? 0} purchase order${dialog?.rows.length === 1 ? '' : 's'}?`}
        description="Only the pre-advice is removed. Serials already received stay on their receipts and in stock."
        records={
          dialog
            ? {
                columns: [
                  { key: 'code', label: 'PO number' },
                  { key: 'status', label: 'Status' },
                  { key: 'serials', label: 'Serials' },
                ],
                rows: dialog.rows.map((r) => ({
                  code: <Nowrap mono>{r.code}</Nowrap>,
                  status: <StatusPill status={r.status} domain="purchaseOrder" size="sm" />,
                  serials: (r.preAdvisedSerials ?? 0).toLocaleString(),
                })),
              }
            : undefined
        }
        confirmLabel="Remove"
        cancelLabel="No"
        onConfirm={() => runBulk('remove-serials', dialog?.rows ?? [])}
      />
      <PoLabelPrintModal
        open={labelIds !== null}
        onOpenChange={(open) => !open && setLabelIds(null)}
        ids={labelIds ?? []}
      />
      {logFor ? (
        <ChangeLogDrawer
          open
          onOpenChange={(open) => !open && setLogFor(null)}
          entityType="purchase_order"
          entityId={logFor.id}
          entityCode={logFor.code}
        />
      ) : null}
    </div>
  );
}
