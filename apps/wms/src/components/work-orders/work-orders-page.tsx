'use client';

/**
 * Work Orders list (`/work-orders`, Logiwa 02 §8). Shared grid (Equal/Starts With search,
 * 22 filters, chips, saved views, column chooser, density, page sizes, async xlsx export)
 * plus status pills with live counts, and the Logiwa toolbar: Tag, Disassemble Kit,
 * Create Kit, Warehouse Ops ▾ (Print Picking List, Batch Picking List, Picking/Job
 * Operations, Cancel Picking). Row ⋯: Show details / Edit / Change log / Cancel / Delete.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  Boxes,
  ChevronDown,
  MoreHorizontal,
  ClipboardList,
  Eye,
  FileStack,
  History,
  ListChecks,
  PackageOpen,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Tag as TagIcon,
  Trash2,
  Undo2,
  Upload,
  Warehouse,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DataGrid, GridToolbar, useGrid, type RowAction } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { ChangeLogDrawer, PrintOptionsModal, TagPopover } from '@/components/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Callout } from '@/components/ui/callout';
import { toast } from '@/components/ui/toast';
import { DisabledReason, Tooltip } from '@/components/ui/tooltip';
import { apiFetch } from '@/lib/api-client';
import { useCan, useMe } from '@/lib/permissions-client';
import { useApiQuery } from '@/lib/query-client';
import type { GridUrlState } from '@/lib/use-url-state';
import { WORK_ORDER_STATUSES } from '@/lib/enums';
import { WORK_ORDER_GRID_FIELDS, WORK_ORDERS_GRID_KEY } from '@/lib/grid-defs/work-orders/work-orders';
import {
  cancelPickingReason,
  cancelReason,
  createKitReason,
  deleteReason,
  disassembleReason,
  editReason,
  pickingReason,
  printReason,
  selectionReason,
} from '@/lib/grid-defs/work-orders/work-order-model';
import { createKitStockReason } from '@/lib/grid-defs/work-orders/wo-coverage';
import { DEFAULT_WAREHOUSE_ZONE } from '@/lib/grid-defs/work-orders/wo-time';
import { CreateKitDialog } from './create-kit-dialog';
import { DisassembleDialog } from './disassemble-dialog';
import { PickingDialog } from './picking-dialog';
import { buildWoColumns } from './wo-columns';
import {
  bulkToast,
  errorMessage,
  postBulk,
  useInvalidateWorkOrders,
  useWoFilterFields,
  useWoPlanner,
  WO_ENTITY,
  WO_P,
  type WorkOrderDetail,
  type WorkOrderRow,
} from './wo-client';
import { WorkOrderWizard } from './wizard/work-order-wizard';
import { WoStatusFilterPill, WoStatusPill } from './wo-status';

/** True once `pending` has stayed true for `ms` (default 10 s). */
export function useStalled(pending: boolean, ms = 10_000): boolean {
  const [stalled, setStalled] = React.useState(false);
  React.useEffect(() => {
    if (!pending) {
      setStalled(false);
      return;
    }
    const t = window.setTimeout(() => setStalled(true), ms);
    return () => window.clearTimeout(t);
  }, [pending, ms]);
  return stalled;
}

/** Status counts that take longer than this show "—" with Retry instead of loading forever. */
const STATUS_COUNTS_TIMEOUT_MS = 20_000;
/** After this long without permissions or rows, the page says so and offers Retry. */
export const WO_STALL_MS = 15_000;

export function WoStatusPills({ grid }: { readonly grid: GridUrlState }) {
  const filters = grid.query.filters.filter((f) => f.field !== 'status');
  const qs = new URLSearchParams(grid.queryString);
  for (const key of [...qs.keys()])
    if (key === 'f.status' || key === 'page' || key === 'ps' || key === 'sort') qs.delete(key);
  const counts = useApiQuery<Readonly<Record<string, number>>>(
    ['wo-status-counts', qs.toString()],
    `/api/work-orders/status-counts${qs.toString() ? `?${qs.toString()}` : ''}`,
    { timeoutMs: STATUS_COUNTS_TIMEOUT_MS },
  );
  const current = grid.query.filters.find((f) => f.field === 'status');
  const values = current && current.op === 'in' ? current.values : [];
  const only = values.length === 1 ? values[0] : null;
  // The pills never hide behind loading (Logiwa parity): while counts load, or if they fail,
  // every pill still renders and filters; only the count shows a skeleton (loading) or "—" (failed).
  const data = counts.data?.data;
  const failed = !data && counts.isError;
  const fmt = (n: number | undefined): string | null =>
    data ? (n ?? 0).toLocaleString() : counts.isPending ? null : 'None';
  const countTitle = failed ? `Counts unavailable: ${counts.error?.message ?? 'request failed'}` : undefined;
  const total = data ? Object.values(data).reduce((s, n) => s + n, 0) : undefined;
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-6 pt-3"
      role="group"
      aria-label="Filter by status"
      aria-busy={counts.isPending || undefined}
      data-filters={filters.length}
    >
      <WoStatusFilterPill
        item={{
          key: 'all',
          label: 'All',
          count: fmt(total),
          countTitle,
          status: null,
          active: !current,
          onClick: () => grid.removeFilter('status'),
        }}
      />
      {WORK_ORDER_STATUSES.map((s) => (
        <WoStatusFilterPill
          key={s}
          item={{
            key: s,
            label: s,
            count: fmt(data?.[s]),
            countTitle,
            status: s,
            active: only === s,
            onClick: () =>
              only === s
                ? grid.removeFilter('status')
                : grid.upsertFilter({ field: 'status', op: 'in', values: [s] }),
          }}
        />
      ))}
      {failed ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void counts.refetch()}
          disabled={counts.isFetching}
          title={countTitle}
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', counts.isFetching && 'animate-spin motion-reduce:animate-none')}
            aria-hidden
          />
          Retry counts
        </Button>
      ) : null}
    </div>
  );
}

type Confirm = { kind: 'delete' | 'cancel' | 'cancelPicking'; rows: readonly WorkOrderRow[] } | null;
type Wizard = { mode: 'create' | 'edit'; id?: string } | null;

function HeaderActions({
  canCreate,
  canImport,
  onCreate,
  loading = false,
}: {
  readonly canCreate: boolean;
  readonly canImport: boolean;
  readonly onCreate: () => void;
  readonly loading?: boolean;
}) {
  // While permissions load, reserve the buttons' space (disabled) so nothing pops in later.
  if (loading) {
    return (
      <>
        <Button variant="secondary" disabled aria-hidden tabIndex={-1}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
        </Button>
        <DisabledReason reason="Checking permissions…">
          <Button variant="primary" disabled tabIndex={-1}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create work order
          </Button>
        </DisabledReason>
      </>
    );
  }
  return (
    <>
      {canImport ? (
        <Link href="/imports/work-orders" className={buttonVariants({ variant: 'secondary' })}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
        </Link>
      ) : null}
      {canCreate ? (
        <Button variant="primary" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create work order
        </Button>
      ) : null}
    </>
  );
}

export function WorkOrdersPage() {
  const router = useRouter();
  const search = useSearchParams();
  const invalidate = useInvalidateWorkOrders();
  const fields = useWoFilterFields(WORK_ORDER_GRID_FIELDS, WO_ENTITY);
  const g = useGrid<WorkOrderRow>({ gridKey: WORK_ORDERS_GRID_KEY, path: '/api/work-orders', fields });
  // Never spin silently: after 15 s of loading the grid (or the permission bootstrap), say so and
  // offer Retry. The grid request itself times out at 30 s into the grid's error state + Retry.
  const gridStalled = useStalled(g.isLoading, WO_STALL_MS);
  const me = useMe();
  // Stale-result guard (critic R2: pills raced and showed the previous filter's rows). Rows from
  // the server always match the status filter, so a mismatch means an older response is on screen:
  // hide it behind the loading state and refetch the active key once. Shared fix filed as R2-22.
  const statusFilter = g.grid.query.filters.find((f) => f.field === 'status');
  const activeStatuses = statusFilter && statusFilter.op === 'in' ? statusFilter.values : null;
  const staleRows = Boolean(activeStatuses && g.rows.some((r) => !activeStatuses.includes(r.status)));
  const refetchedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!staleRows || g.isFetching || refetchedFor.current === g.grid.queryString) return;
    refetchedFor.current = g.grid.queryString;
    g.refetch();
  }, [staleRows, g.isFetching, g.grid.queryString, g]);
  const columns = React.useMemo(() => buildWoColumns(), []);
  const planner = useWoPlanner();
  const permsLoading = useCan(WO_P.view).isLoading;
  const permsStalled = useStalled(permsLoading, WO_STALL_MS);
  const can = {
    create: useCan(WO_P.create).allowed && planner,
    edit: useCan(WO_P.edit).allowed && planner,
    del: useCan(WO_P.del).allowed && planner,
    createKit: useCan(WO_P.createKit).allowed,
    disassemble: useCan(WO_P.disassemble).allowed,
    tag: useCan(WO_P.tag).allowed,
    picking: useCan(WO_P.picking).allowed,
    cancelPicking: useCan(WO_P.cancelPicking).allowed,
    imp: useCan(WO_P.importFile).allowed,
  };

  // Remember every row seen so selections across pages keep their status for the guards.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, WorkOrderRow>>(new Map());
  const rowsKey = g.rows.map((r) => `${r.id}:${r.version}:${r.status}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on row identity, not array identity
  React.useEffect(() => {
    setSeen((prev) => new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)]));
  }, [rowsKey]);
  const selected = g.selectedIds
    .map((id) => g.rows.find((r) => r.id === id) ?? seen.get(id))
    .filter((r): r is WorkOrderRow => Boolean(r));
  const codeOf = (id: string) => seen.get(id)?.code ?? 'work order';

  // Deep link: /work-orders?create=1 opens the wizard, but only once permissions say the viewer may
  // create (no forbidden next-code call for viewers/operators). Otherwise the param is dropped with a toast.
  const [wizard, setWizard] = React.useState<Wizard>(null);
  const deepLinkCreate = search.get('create') === '1';
  React.useEffect(() => {
    if (!deepLinkCreate || permsLoading) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('create');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', qs ? `?${qs}` : window.location.pathname);
    if (can.create) setWizard({ mode: 'create' });
    else
      toast.info(
        "Can't create work orders",
        "Your role doesn't include creating work orders. Ask an administrator for access.",
      );
  }, [deepLinkCreate, permsLoading, can.create]);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [kitFor, setKitFor] = React.useState<string | null>(null);
  // { id: null } = standalone Disassemble (kit stock by BOM, no work order).
  const [disFor, setDisFor] = React.useState<{ readonly id: string | null } | null>(null);
  const [picking, setPicking] = React.useState<readonly string[] | null>(null);
  const [print, setPrint] = React.useState<{ records: readonly unknown[]; consolidated: boolean } | null>(
    null,
  );
  const [logFor, setLogFor] = React.useState<WorkOrderRow | null>(null);
  // After the wizard saves, the list stays mounted (no navigation, no page skeleton); the new
  // record is announced in place with an Open link, and the grid refetches behind it.
  const [justCreated, setJustCreated] = React.useState<WorkOrderRow | null>(null);
  React.useEffect(() => {
    if (!justCreated) return;
    const t = window.setTimeout(() => setJustCreated(null), 12_000);
    return () => window.clearTimeout(t);
  }, [justCreated]);

  const finish = async () => {
    g.clearSelection();
    await invalidate();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const path = {
      delete: null,
      cancel: '/api/work-orders/cancel',
      cancelPicking: '/api/work-orders/cancel-picking',
    }[confirm.kind];
    try {
      if (path) {
        const res = await postBulk(
          path,
          confirm.rows.map((r) => r.id),
        );
        bulkToast(res, codeOf, {
          done: confirm.kind === 'cancel' ? 'cancelled' : 'reset to Open; picking cancelled',
        });
      } else {
        const results = await Promise.allSettled(
          confirm.rows.map((r) =>
            apiFetch(`/api/work-orders/${encodeURIComponent(r.id)}`, { method: 'DELETE' }),
          ),
        );
        bulkToast(
          {
            succeeded: confirm.rows.filter((_, i) => results[i]?.status === 'fulfilled').map((r) => r.id),
            failed: confirm.rows.flatMap((r, i) => {
              const x = results[i];
              return x?.status === 'rejected' ? [{ id: r.id, message: errorMessage(x.reason) }] : [];
            }),
          },
          codeOf,
          { done: 'deleted' },
        );
      }
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      await finish();
    }
  };

  const printLists = async (consolidated: boolean) => {
    try {
      const records = await apiFetch<readonly unknown[]>('/api/work-orders/pick-list', {
        method: 'POST',
        body: { ids: g.selectedIds, consolidated },
      });
      if (records.length === 0) {
        toast.info('Nothing to print', 'The selected work orders have nothing left to pick.');
        return;
      }
      setPrint({ records, consolidated });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    }
  };

  const rowActions = (row: WorkOrderRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, href: `/work-orders/${row.id}` },
    ...(can.edit
      ? [
          {
            key: 'edit',
            label: 'Edit',
            icon: Pencil,
            disabledReason: editReason(row),
            onSelect: () => setWizard({ mode: 'edit', id: row.id }),
          },
        ]
      : []),
    { key: 'log', label: 'Change log', icon: History, onSelect: () => setLogFor(row) },
    ...(can.edit
      ? [
          {
            key: 'cancel',
            label: cancelReason(row) ? 'Cancel work order (unavailable)' : 'Cancel work order',
            icon: Ban,
            destructive: !cancelReason(row),
            disabledReason: cancelReason(row),
            onSelect: () => setConfirm({ kind: 'cancel', rows: [row] }),
          },
        ]
      : []),
    ...(can.del
      ? [
          {
            key: 'delete',
            label: 'Delete',
            icon: Trash2,
            destructive: !deleteReason(row),
            disabledReason: deleteReason(row),
            onSelect: () => setConfirm({ kind: 'delete', rows: [row] }),
          },
        ]
      : []),
  ];

  const single = { single: true } as const;
  const rKitBase = selectionReason(
    selected,
    (r: WorkOrderRow) => createKitReason(r, { canForcePicks: can.picking && planner }),
    single,
  );
  // Without picking, Create Kit draws on the chosen sources / usable FEFO stock: check it (lock-aware)
  // before the drawer opens, so a count-locked source never surfaces only on step 3.
  const kitCandidate =
    !rKitBase && can.createKit && selected.length === 1 && selected[0]?.type !== 'Work Order with Picking'
      ? (selected[0] ?? null)
      : null;
  const kitDetail = useApiQuery<WorkOrderDetail>(
    ['work-order', kitCandidate?.id ?? ''],
    kitCandidate ? `/api/work-orders/${encodeURIComponent(kitCandidate.id)}` : null,
    { staleTime: 15_000, timeoutMs: 20_000 },
  );
  const kitDetailData = kitDetail.data?.data;
  const rKit =
    rKitBase ??
    (kitCandidate && kitDetailData && kitDetailData.workOrder.id === kitCandidate.id
      ? createKitStockReason(kitCandidate, kitDetailData.components)
      : null);
  const rDis = selectionReason(selected, disassembleReason, single);
  const rPrint = selectionReason(selected, printReason);
  const rPick = selectionReason(selected, pickingReason);
  const rCancelPick = selectionReason(selected, cancelPickingReason);
  const none = selected.length === 0 ? 'Select at least one work order' : null;

  const trailing = permsLoading ? (
    <div className="flex items-center gap-2" aria-hidden>
      <Button variant="secondary" disabled tabIndex={-1}>
        <TagIcon className="h-3.5 w-3.5" aria-hidden />
        Tag
      </Button>
      <Button variant="secondary" disabled tabIndex={-1} className="hidden md:inline-flex">
        <PackageOpen className="h-3.5 w-3.5" aria-hidden />
        Disassemble kit
      </Button>
      <Button variant="secondary" disabled tabIndex={-1} className="hidden md:inline-flex">
        <Boxes className="h-3.5 w-3.5" aria-hidden />
        Create kit
      </Button>
      <Button variant="secondary" disabled tabIndex={-1}>
        <Printer className="h-3.5 w-3.5" aria-hidden />
        Print
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button variant="secondary" disabled tabIndex={-1}>
        <Warehouse className="h-3.5 w-3.5" aria-hidden />
        Warehouse ops
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      {can.tag ? (
        <TagPopover
          entityType={WO_ENTITY}
          scope={WO_ENTITY}
          ids={g.selectedIds}
          appliedTagIds={selected.length === 1 ? selected[0]?.tags.map((t) => t.id) : []}
          onApplied={() => void finish()}
          disabledReason={none}
          trigger={
            <Button variant="secondary" disabled={Boolean(none)}>
              <TagIcon className="h-3.5 w-3.5" aria-hidden />
              Tag
            </Button>
          }
        />
      ) : null}
      {can.disassemble ? (
        <Button
          variant="secondary"
          className="hidden md:inline-flex"
          title={
            selected.length === 1 && !rDis
              ? `Disassemble kits built by ${selected[0]?.code}`
              : 'Disassemble kit-to-stock kits from stock'
          }
          onClick={() => setDisFor({ id: selected.length === 1 && !rDis ? (selected[0]?.id ?? null) : null })}
        >
          <PackageOpen className="h-3.5 w-3.5" aria-hidden />
          Disassemble kit
        </Button>
      ) : null}
      {can.createKit ? (
        // Unavailable Create kit stays hoverable/focusable (aria-disabled, not disabled), so the reason
        // shows as a tooltip on hover or focus and as a toast on click (judge R1: WO000095 gave no reason).
        <Tooltip content={rKit ?? 'Build kits for the selected work order'}>
          <Button
            variant="secondary"
            aria-disabled={rKit ? true : undefined}
            data-disabled-reason={rKit ?? undefined}
            aria-description={rKit ?? undefined}
            className={cn('hidden md:inline-flex', rKit && 'cursor-not-allowed opacity-50 hover:bg-surface')}
            onClick={() => {
              if (rKit) {
                toast.info('Create kit unavailable', rKit);
                return;
              }
              setKitFor(selected[0]?.id ?? null);
            }}
          >
            <Boxes className="h-3.5 w-3.5" aria-hidden />
            Create kit
          </Button>
        </Tooltip>
      ) : null}
      {/* Narrow screens: every action stays reachable through More. Controls a role can never use are hidden. */}
      {can.create || can.imp || can.createKit || can.disassemble ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="md:hidden" aria-label="More actions">
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            {can.create ? (
              <DropdownMenuItem icon={Plus} onSelect={() => setWizard({ mode: 'create' })}>
                Create work order
              </DropdownMenuItem>
            ) : null}
            {can.imp ? (
              <DropdownMenuItem icon={Upload} onSelect={() => router.push('/imports/work-orders')}>
                Import
              </DropdownMenuItem>
            ) : null}
            {can.createKit ? (
              <DropdownMenuItem
                icon={Boxes}
                disabledReason={rKit}
                onSelect={() => setKitFor(selected[0]?.id ?? null)}
              >
                Create kit
              </DropdownMenuItem>
            ) : null}
            {can.disassemble ? (
              <DropdownMenuItem
                icon={PackageOpen}
                onSelect={() =>
                  setDisFor({ id: selected.length === 1 && !rDis ? (selected[0]?.id ?? null) : null })
                }
              >
                Disassemble kit
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {can.picking || can.createKit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" aria-label="Print work order documents">
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[260px]">
            {rPrint ? (
              <p
                role="note"
                className="max-w-[260px] border-b border-border px-3 py-2 text-xs text-muted-foreground"
              >
                Unavailable: {rPrint}
              </p>
            ) : null}
            <DropdownMenuItem
              icon={Printer}
              disabledReason={rPrint}
              description="One picking list per work order"
              onSelect={() => void printLists(false)}
            >
              Print picking list
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={FileStack}
              disabledReason={rPrint}
              description="All selected work orders on one list"
              onSelect={() => void printLists(true)}
            >
              Batch picking list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {can.picking || can.cancelPicking ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <Warehouse className="h-3.5 w-3.5" aria-hidden />
              Warehouse ops
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[260px]">
            <DropdownMenuItem
              icon={ListChecks}
              disabledReason={can.picking ? rPick : "You don't have permission to run picking/job operations"}
              description="Allocate components and create picking jobs"
              onSelect={() => setPicking(selected.map((r) => r.id))}
            >
              Picking/job operations
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Undo2}
              destructive
              disabledReason={can.cancelPicking ? rCancelPick : "You don't have permission to cancel picking"}
              description="Release allocations and cancel the picking job"
              onSelect={() => setConfirm({ kind: 'cancelPicking', rows: selected })}
            >
              Cancel picking
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  const confirmRecords = confirm
    ? {
        columns: [
          { key: 'code', label: 'Work order' },
          { key: 'status', label: 'Status' },
          { key: 'kit', label: 'Kit SKU' },
          { key: 'qty', label: 'Built / requested' },
        ],
        rows: confirm.rows.map((r) => ({
          code: r.code,
          status: <WoStatusPill status={r.status} size="sm" />,
          kit: r.kitSku,
          qty: `${r.processedQty} / ${r.requestedQty}`,
        })),
      }
    : undefined;
  const n = confirm?.rows.length ?? 0;
  const plural = n === 1 ? 'work order' : `${n} work orders`;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Work Orders"
        crumbLabel="Work Orders"
        tabs="work-orders"
        actions={
          <HeaderActions
            loading={permsLoading}
            canCreate={can.create}
            canImport={can.imp}
            onCreate={() => setWizard({ mode: 'create' })}
          />
        }
      />
      <WoStatusPills grid={g.grid} />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search by code"
        bulkNoun="work order"
        trailing={trailing}
      />
      {justCreated ? (
        <style>{`tr[data-row-id="${CSS.escape(justCreated.id)}"]>td{background-color:color-mix(in oklab,var(--color-success,#16a34a) 14%,transparent)!important;transition:background-color .6s}`}</style>
      ) : null}
      {justCreated ? (
        <div className="px-6 pb-2">
          <Callout
            variant="success"
            title={`Work order ${justCreated.code} created`}
            onDismiss={() => setJustCreated(null)}
            action={
              <Link
                href={`/work-orders/${justCreated.id}`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Open
              </Link>
            }
          >
            {justCreated.kitSku} × {justCreated.requestedQty} · {justCreated.status}. It is in the list below.
          </Callout>
        </div>
      ) : null}
      {gridStalled || permsStalled ? (
        <div className="px-6 pb-2" role="status">
          <Callout
            variant="attention"
            title={gridStalled ? 'Still loading work orders…' : 'Still checking your permissions…'}
            action={
              <Button
                size="sm"
                variant="secondary"
                disabled={g.isFetching && me.isFetching}
                onClick={() => {
                  if (gridStalled) g.refetch();
                  if (permsStalled) void me.refetch();
                }}
              >
                <RefreshCw
                  className={cn(
                    'h-3.5 w-3.5',
                    (g.isFetching || me.isFetching) && 'animate-spin motion-reduce:animate-none',
                  )}
                  aria-hidden
                />
                Retry
              </Button>
            }
          >
            {gridStalled
              ? 'This is taking longer than usual. The toolbar and filters stay usable; Retry sends the request again. After 30 s the request stops and the grid shows the error.'
              : 'Create work order and the toolbar actions turn on once your role is loaded. Retry asks the server again.'}
          </Callout>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<WorkOrderRow>
          {...g.gridProps}
          data={staleRows ? [] : g.gridProps.data}
          loading={g.gridProps.loading || staleRows}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/work-orders/${row.id}`)}
          emptyTitle="No work orders match this view"
          emptyDescription="Clear the filters, or create a work order to start kitting."
          emptyAction={
            can.create ? (
              <Button variant="primary" onClick={() => setWizard({ mode: 'create' })}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create work order
              </Button>
            ) : undefined
          }
        />
      </div>

      <WorkOrderWizard
        open={wizard !== null}
        onOpenChange={(o) => {
          if (!o) setWizard(null);
        }}
        mode={wizard?.mode ?? 'create'}
        workOrderId={wizard?.id ?? null}
        onSaved={(row) => {
          if (wizard?.mode === 'create') setJustCreated(row);
          void finish();
        }}
      />
      <CreateKitDialog
        open={kitFor !== null}
        onOpenChange={(o) => {
          if (!o) setKitFor(null);
        }}
        workOrderId={kitFor}
        onDone={() => {
          void finish();
        }}
      />
      <DisassembleDialog
        open={disFor !== null}
        onOpenChange={(o) => {
          if (!o) setDisFor(null);
        }}
        workOrderId={disFor?.id ?? null}
        onDone={() => {
          void finish();
        }}
      />
      <PickingDialog
        open={picking !== null}
        onOpenChange={(o) => {
          if (!o) setPicking(null);
        }}
        ids={picking ?? []}
        onDone={() => {
          void finish();
        }}
      />
      <PrintOptionsModal
        open={print !== null}
        onOpenChange={(o) => {
          if (!o) setPrint(null);
        }}
        typeKeys={[print?.consolidated ? 'work-order-consolidated-picking-list' : 'work-order-picking-list']}
        records={print?.records ?? []}
        title={print?.consolidated ? 'Batch picking list' : 'Print picking list'}
        clientId={selected.length === 1 ? selected[0]?.clientId : null}
      />
      {logFor ? (
        <ChangeLogDrawer
          open
          onOpenChange={(o) => {
            if (!o) setLogFor(null);
          }}
          entityType={WO_ENTITY}
          entityId={logFor.id}
          entityCode={logFor.code}
          timeZone={logFor.warehouseTimeZone ?? DEFAULT_WAREHOUSE_ZONE}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        variant="danger"
        icon={confirm?.kind === 'delete' ? Trash2 : confirm?.kind === 'cancel' ? Ban : ClipboardList}
        title={
          confirm?.kind === 'delete'
            ? `Delete ${plural}?`
            : confirm?.kind === 'cancel'
              ? `Cancel ${plural}?`
              : `Cancel picking for ${plural}?`
        }
        description={
          confirm?.kind === 'delete'
            ? 'This action cannot be undone.'
            : confirm?.kind === 'cancel'
              ? "Allocated components go back to free stock and open picking tasks and jobs are cancelled. Cancelled work orders can't be reopened."
              : 'Component allocations are released, pending picking tasks and the job are cancelled, and the work order returns to Open.'
        }
        records={confirmRecords}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={runConfirm}
      />
    </div>
  );
}
