'use client';

/**
 * Return Orders (`/orders/returns`, M04 §6). One row per RMA line, the shared grid
 * (search mode, filters, chips, saved views, column chooser, density, page sizes,
 * async xlsx export), 5 status pills with live RMA counts, and the bulk actions
 * Change Status (legal transitions only), Tag and Create RMA.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  Ban,
  ChevronDown,
  Download,
  Eye,
  History,
  PencilLine,
  Plus,
  Printer,
  ScanLine,
  Tag as TagIcon,
  Truck,
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
import { toast } from '@/components/ui/toast';
import { apiRequest } from '@/lib/api-client';
import { DisabledReason } from '@/components/ui/tooltip';
import { useApiQuery } from '@/lib/query-client';
import { RETURN_STATUSES, type ReturnStatus } from '@/lib/enums';
import { RETURN_ORDERS_GRID_KEY, RETURN_STATUS_HELP } from '@/lib/grid-defs/returns/return-orders';
import { statusTone } from '@/lib/status-colors';
import { cn } from '@/lib/utils';
import { BulkReturnInfoModal } from './bulk-return-info-modal';
import { ImportReturnsDialog } from './import-returns-dialog';
import { ChangeStatusModal } from './change-status-modal';
import { ReturnLabelDialog } from './return-label-fields';
import { buildReturnColumns } from './return-columns';
import {
  errorText,
  openFileId,
  RETURN_KEYS,
  useInvalidateReturns,
  useReturnFilterFields,
  useHydratedCan,
} from './returns-client';
import type { ReturnLineRow } from './return-types';

/** Muted look for a disabled toolbar menu item (the reason shows as its description). */
const MUTED_ITEM = 'opacity-60 [&_svg]:text-faint';

function activeStatus(
  filters: readonly { field: string; op: string; values?: readonly string[] }[],
): ReturnStatus | null {
  const f = filters.find((x) => x.field === 'status' && x.op === 'in');
  return f?.values?.length === 1 ? (f.values[0] as ReturnStatus) : null;
}

function StatusPills({
  counts,
  active,
  onPick,
}: {
  readonly counts: Readonly<Record<string, number>> | undefined;
  readonly active: ReturnStatus | null;
  readonly onPick: (s: ReturnStatus | null) => void;
}) {
  const total = Object.values(counts ?? {}).reduce((s, n) => s + n, 0);
  return (
    <div
      role="toolbar"
      aria-label="Filter by status"
      className="flex flex-wrap items-center gap-1.5 px-6 pb-2"
    >
      <button
        type="button"
        aria-pressed={active === null}
        title="Counts are return lines: one grid row per RMA line"
        onClick={() => onPick(null)}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          active === null
            ? 'border-foreground bg-foreground text-surface [[data-theme=dark]_&]:border-white/35 [[data-theme=dark]_&]:bg-white/10 [[data-theme=dark]_&]:text-foreground'
            : 'border-border bg-surface text-body hover:bg-surface-sunken',
        )}
      >
        <span className="sr-only">Counts are lines. </span>All lines{' '}
        <span className="tabular-nums opacity-70">{counts ? total.toLocaleString() : '…'}</span>
      </button>
      {RETURN_STATUSES.map((s) => {
        const t = statusTone(s, 'return');
        // Tone as CSS variables: light mode keeps the pastel tint; dark mode uses a translucent fill of the hue.
        const vars = { '--pill-bg': t.bg, '--pill-fg': t.fg } as React.CSSProperties;
        const on = active === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            title={RETURN_STATUS_HELP[s]}
            onClick={() => onPick(on ? null : s)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              'bg-[var(--pill-bg)] text-[var(--pill-fg)]',
              on
                ? 'border-[var(--pill-fg)] shadow-sm ring-1 ring-current'
                : 'border-transparent hover:brightness-95',
            )}
            style={vars}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            {s}
            <span className="tabular-nums opacity-80">
              {counts ? (counts[s] ?? 0).toLocaleString() : '…'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ReturnOrdersPage() {
  const router = useRouter();
  const invalidate = useInvalidateReturns();
  const fields = useReturnFilterFields();
  const g = useGrid<ReturnLineRow>({ gridKey: RETURN_ORDERS_GRID_KEY, path: '/api/returns', fields });
  const columns = React.useMemo(() => buildReturnColumns(), []);
  // Same query string as the grid (the server drops the status filter), so pills and Total agree.
  const summaryQs = g.grid.queryString;
  const summary = useApiQuery<Record<string, number>>(
    [...RETURN_KEYS.summary, summaryQs],
    `/api/returns/summary${summaryQs ? `?${summaryQs}` : ''}`,
    { staleTime: 0 },
  );
  const perm = {
    status: useHydratedCan('inventory.return_orders.change_status'),
    tag: useHydratedCan('inventory.return_orders.tag'),
    create: useHydratedCan('fulfillment.shipment_orders.create_rma'),
    station: useHydratedCan('inventory.return_station.view'),
    log: useHydratedCan('inventory.return_orders.view'),
    label: useHydratedCan('fulfillment.shipment_orders.create_return_label'),
  };
  const can = {
    status: perm.status.allowed,
    tag: perm.tag.allowed,
    create: perm.create.allowed,
    station: perm.station.allowed,
    log: perm.log.allowed,
    label: perm.label.allowed,
  };
  // While /api/me loads, header and toolbar actions render in place, disabled, so the layout is stable.
  const show = (k: keyof typeof perm) => perm[k].allowed || perm[k].isLoading;
  const checking = (k: keyof typeof perm) => (perm[k].isLoading ? 'Checking your permissions…' : null);

  // Rows selected on earlier pages stay known so bulk actions still see them after paging.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, ReturnLineRow>>(() => new Map());
  const rows = g.rows;
  React.useEffect(() => {
    if (rows.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- merges the grid's server page into the cross-page selection cache
    setSeen((prev) =>
      rows.every((r) => prev.get(r.id) === r)
        ? prev
        : new Map([...prev, ...rows.map((r) => [r.id, r] as const)]),
    );
  }, [rows]);
  const selected = g.selectedIds
    .map((id) => seen.get(id) ?? g.rows.find((r) => r.id === id))
    .filter((r): r is ReturnLineRow => Boolean(r));
  const rmaIds = [...new Set(selected.map((r) => r.returnOrderId))];

  const [statusFor, setStatusFor] = React.useState<{
    ids?: readonly string[];
    lineIds?: readonly string[];
    version?: number;
    statuses?: readonly string[];
  } | null>(null);
  const [logFor, setLogFor] = React.useState<ReturnLineRow | null>(null);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [labelFor, setLabelFor] = React.useState<ReturnLineRow | null>(null);
  const [voidOpen, setVoidOpen] = React.useState(false);

  const finish = async () => {
    g.clearSelection();
    await invalidate();
  };

  const status = activeStatus(g.grid.query.filters as never);
  const pick = (s: ReturnStatus | null) => {
    if (s) g.grid.upsertFilter({ field: 'status', op: 'in', values: [s] });
    else g.grid.removeFilter('status');
  };

  const rowOpen = (r: ReturnLineRow) =>
    r.status === 'Pending' || r.status === 'In Transit' || r.status === 'Started';
  const rowActions = (row: ReturnLineRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, href: `/orders/returns/${row.returnOrderId}` },
    ...(can.status
      ? [
          {
            key: 'status',
            label: 'Change status',
            icon: ArrowRightLeft,
            disabledReason:
              row.status === 'Completed' || row.status === 'Cancelled'
                ? `${row.status} returns can't be changed.`
                : null,
            onSelect: () =>
              setStatusFor({ ids: [row.returnOrderId], version: row.version, statuses: [row.status] }),
          },
        ]
      : []),
    ...(can.station
      ? [
          {
            key: 'receive',
            label: 'Receive at station',
            icon: ScanLine,
            href: `/return-station?rma=${encodeURIComponent(row.rmaCode)}&warehouseId=${row.warehouseId}`,
            disabledReason: !rowOpen(row) ? `A ${row.status.toLowerCase()} return can't be received.` : null,
          },
        ]
      : []),
    ...(can.label
      ? [
          {
            key: 'label',
            label:
              row.labelShipmentId && row.labelStatus !== 'Voided'
                ? 'Reprint return label'
                : 'Create return label',
            icon: row.labelShipmentId && row.labelStatus !== 'Voided' ? Printer : Truck,
            disabledReason:
              row.labelShipmentId && row.labelStatus !== 'Voided'
                ? row.labelFileId
                  ? null
                  : 'The label has no file to reprint'
                : !row.shipmentOrderId
                  ? 'Manual returns have no shipment order to label'
                  : !rowOpen(row)
                    ? `A ${row.status.toLowerCase()} return can't get a new label.`
                    : null,
            onSelect: () => {
              if (row.labelShipmentId && row.labelStatus !== 'Voided') openFileId(row.labelFileId);
              else setLabelFor(row);
            },
          },
        ]
      : []),
    ...(can.log ? [{ key: 'log', label: 'Change log', icon: History, onSelect: () => setLogFor(row) }] : []),
  ];

  const none = selected.length === 0 && !g.allMatchingSelected ? 'Select at least one return line' : null;
  const allTerminal =
    selected.length > 0 && selected.every((r) => r.status === 'Completed' || r.status === 'Cancelled');
  const statusReason =
    none ??
    (g.allMatchingSelected
      ? 'Select rows on this page to change their status'
      : allTerminal
        ? "Completed and cancelled returns can't be changed"
        : null);
  const tagReason = none ?? (g.allMatchingSelected ? 'Select rows on this page to tag them' : null);

  // One representative row per selected RMA (bulk label actions act on RMAs).
  const rmaRows = rmaIds
    .map((id) => selected.find((r) => r.returnOrderId === id))
    .filter((r): r is ReturnLineRow => Boolean(r));
  const isOpen = (r: ReturnLineRow) =>
    r.status === 'Pending' || r.status === 'In Transit' || r.status === 'Started';
  const withLabel = rmaRows.filter((r) => r.labelShipmentId && r.labelStatus !== 'Voided');
  const voidable = withLabel.filter((r) => r.status !== 'Completed');
  const pageOnly = g.allMatchingSelected ? 'Select rows on this page for label actions' : null;
  const createLabelReason =
    none ??
    pageOnly ??
    (rmaRows.length !== 1
      ? 'Select the lines of exactly one RMA'
      : !rmaRows[0]?.shipmentOrderId
        ? 'Manual returns have no shipment order to label'
        : !isOpen(rmaRows[0])
          ? `A ${rmaRows[0].status.toLowerCase()} return can't get a new label`
          : null);
  const reprintReason =
    none ??
    pageOnly ??
    (withLabel.some((r) => r.labelFileId) ? null : 'None of the selected RMAs has a return label file');
  const voidReason =
    none ??
    pageOnly ??
    (voidable.length ? null : 'None of the selected RMAs has an active return label to void');
  const infoReason =
    none ??
    (g.allMatchingSelected
      ? 'Select rows on this page to update them'
      : rmaRows.every((r) => !isOpen(r))
        ? "Completed and cancelled returns can't be edited"
        : null);

  const voidLabels = async () => {
    let ok = 0;
    const errors: string[] = [];
    for (const r of voidable) {
      try {
        await apiRequest(`/api/returns/${r.returnOrderId}/label`, { method: 'DELETE' });
        ok += 1;
      } catch (e) {
        errors.push(`${r.rmaCode}: ${errorText(e)}`);
      }
    }
    if (ok)
      toast.success(
        'Return labels voided',
        `${ok} of ${voidable.length} voided.${errors.length ? ` ${errors[0]}` : ''}`,
      );
    else toast.error('No labels voided', errors[0] ?? 'Nothing to void');
    await finish();
  };

  const trailing = (
    <div className="flex items-center gap-2">
      {show('label') && !can.label ? (
        <DisabledReason reason={checking('label')}>
          <Button variant="secondary" disabled>
            <Truck className="h-3.5 w-3.5" aria-hidden />
            Label
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DisabledReason>
      ) : null}
      {can.label ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <Truck className="h-3.5 w-3.5" aria-hidden />
              Label
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[260px]">
            {/* Disabled items are muted and say why inline (not only in a tooltip). */}
            <DropdownMenuItem
              icon={Truck}
              disabledReason={createLabelReason}
              className={createLabelReason ? MUTED_ITEM : undefined}
              description={createLabelReason ?? 'Prepaid return label for the customer'}
              onSelect={() => setLabelFor(rmaRows[0] ?? null)}
            >
              Create return label
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Printer}
              disabledReason={reprintReason}
              className={reprintReason ? MUTED_ITEM : undefined}
              description={
                reprintReason ??
                (withLabel.length
                  ? `${withLabel.length} label${withLabel.length === 1 ? '' : 's'}`
                  : undefined)
              }
              onSelect={() => withLabel.forEach((r) => openFileId(r.labelFileId))}
            >
              Reprint return label
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Ban}
              destructive={!voidReason}
              disabledReason={voidReason}
              className={voidReason ? MUTED_ITEM : undefined}
              description={voidReason ?? 'Voids with the carrier and clears tracking'}
              onSelect={() => setVoidOpen(true)}
            >
              Void return label
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {show('status') ? (
        <DisabledReason reason={checking('status') ?? statusReason}>
          <Button
            variant="secondary"
            disabled={!can.status || Boolean(statusReason)}
            onClick={() => setStatusFor({ ids: rmaIds, statuses: rmaRows.map((r) => r.status) })}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
            Change status
          </Button>
        </DisabledReason>
      ) : null}
      {show('tag') && !can.tag ? (
        <DisabledReason reason={checking('tag')}>
          <Button variant="secondary" disabled>
            <TagIcon className="h-3.5 w-3.5" aria-hidden />
            Tag
          </Button>
        </DisabledReason>
      ) : null}
      {can.tag ? (
        <TagPopover
          entityType="return_order"
          scope="return_order"
          ids={rmaIds}
          onApplied={() => void finish()}
          disabledReason={tagReason}
          trigger={
            <Button variant="secondary" disabled={Boolean(tagReason)}>
              <TagIcon className="h-3.5 w-3.5" aria-hidden />
              Tag
            </Button>
          }
        />
      ) : null}
    </div>
  );

  const actions = (
    <>
      {show('status') ? (
        <DisabledReason reason={checking('status') ?? infoReason}>
          <Button
            variant="secondary"
            disabled={!can.status || Boolean(infoReason)}
            onClick={() => setInfoOpen(true)}
          >
            <PencilLine className="h-3.5 w-3.5" aria-hidden />
            Bulk update return info
          </Button>
        </DisabledReason>
      ) : null}
      {can.station ? (
        <Link href="/return-station" className={buttonVariants({ variant: 'secondary' })}>
          <ScanLine className="h-3.5 w-3.5" aria-hidden />
          Return station
        </Link>
      ) : show('station') ? (
        <DisabledReason reason={checking('station')}>
          <Button variant="secondary" disabled>
            <ScanLine className="h-3.5 w-3.5" aria-hidden />
            Return station
          </Button>
        </DisabledReason>
      ) : null}
      {can.create ? (
        <Button variant="secondary" onClick={() => setImportOpen(true)} data-testid="returns-import-open">
          <Download className="h-3.5 w-3.5" aria-hidden />
          Import from Loop
        </Button>
      ) : null}
      {can.create ? (
        <Link href="/orders/returns/new" className={buttonVariants({ variant: 'primary' })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create RMA
        </Link>
      ) : show('create') ? (
        <DisabledReason reason={checking('create')}>
          <Button variant="primary" disabled>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create RMA
          </Button>
        </DisabledReason>
      ) : null}
    </>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Return Orders"
        breadcrumbs={[{ label: 'Fulfillment' }, { label: 'Outbound' }, { label: 'Return Orders' }]}
        tabs="orders"
        actions={actions}
      />
      <StatusPills counts={summary.data?.data} active={status} onPick={pick} />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search by RMA, order, tracking or SKU"
        bulkNoun="return line"
        trailing={trailing}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<ReturnLineRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/orders/returns/${row.returnOrderId}`)}
          emptyTitle={status ? `No ${status.toLowerCase()} returns` : 'No return orders match this view'}
          emptyDescription="Clear the filters, or create an RMA from a shipped order."
          emptyAction={
            can.create ? (
              <Link href="/orders/returns/new" className={buttonVariants({ variant: 'primary' })}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create RMA
              </Link>
            ) : undefined
          }
        />
      </div>
      <ImportReturnsDialog
        key={importOpen ? 'import-open' : 'import-closed'}
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={() => void finish()}
      />
      <ChangeStatusModal
        open={statusFor !== null}
        onOpenChange={(o) => !o && setStatusFor(null)}
        selection={statusFor ?? {}}
        version={statusFor?.version}
        currentStatuses={statusFor?.statuses}
        onDone={() => void finish()}
      />
      <BulkReturnInfoModal
        open={infoOpen}
        onOpenChange={setInfoOpen}
        ids={rmaIds}
        onDone={() => void finish()}
      />
      {labelFor ? (
        <ReturnLabelDialog
          open
          onOpenChange={(o) => !o && setLabelFor(null)}
          returnId={labelFor.returnOrderId}
          rmaCode={labelFor.rmaCode}
          warehouseId={labelFor.warehouseId}
          clientId={labelFor.clientId}
          onDone={() => void finish()}
        />
      ) : null}
      <ConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        variant="danger"
        icon={Ban}
        title={`Void ${voidable.length} return label${voidable.length === 1 ? '' : 's'}?`}
        description="The carrier label is voided and the RMA tracking number is cleared. You can create a new label afterwards."
        records={{
          columns: [
            { key: 'rma', label: 'RMA' },
            { key: 'tracking', label: 'Tracking' },
          ],
          rows: voidable.map((r) => ({ rma: r.rmaCode, tracking: r.trackingNumber ?? 'None' })),
        }}
        confirmLabel="Void"
        cancelLabel="Keep"
        onConfirm={voidLabels}
      />
      {logFor ? (
        <ChangeLogDrawer
          open
          onOpenChange={(o) => !o && setLogFor(null)}
          entityType="return_order"
          entityId={logFor.returnOrderId}
          entityCode={logFor.rmaCode}
        />
      ) : null}
    </div>
  );
}
