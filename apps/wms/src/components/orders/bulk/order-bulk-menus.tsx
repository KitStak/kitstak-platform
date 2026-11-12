'use client';

/**
 * Shipment Orders bulk menus (Logiwa parity + KitStaks additions):
 *   Backlog  Label ▾ · Warehouse Ops ▾ · Print ▾ · Delete ▾ · Tag
 *   Shipped  Label ▾ · Create RMA · Print ▾ · Tag
 * Every item is disabled until rows are selected (with a reason tooltip); guarded
 * actions open Logiwa's guard modal; destructive ones confirm with a records table.
 */
import * as React from 'react';
import { OrderStatusPill } from '../order-status-pill';
import { useRouter } from 'next/navigation';
import {
  Ban,
  ChevronDown,
  ClipboardList,
  FileBox,
  FileText,
  GitBranch,
  Layers,
  ListChecks,
  PackageCheck,
  PackageMinus,
  PauseCircle,
  PlayCircle,
  Printer,
  RotateCcw,
  ScanBarcode,
  Scissors,
  Tag,
  Trash2,
  Truck,
  Undo2,
  Warehouse,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { PrintOptionsModal } from '@/components/shared';
import { OrderTagPopover } from './order-tag-popover';
import { OrderJobModal, type JobOrderRef } from './order-job-modal';
import { apiFetch } from '@/lib/api-client';
import { CHECKING_PERMISSIONS, useOrderPermissions } from '../use-order-permissions';
import {
  ORDER_BULK_PERMISSIONS,
  ORDER_PERMISSIONS,
  type OrderView,
} from '@/lib/grid-defs/orders/shipment-orders';
import {
  bulkToast,
  errorMessage,
  fetchPrintRecords,
  openFiles,
  ORDER_INVALIDATE,
  runBulk,
  runLabels,
  usePatchOrderRows,
  type OrderRow,
} from '../orders-client';
import {
  eligibility,
  guardChecks,
  LOGIWA_GUARDS,
  partition,
  shipConfirmText,
  type EligibilityRow,
} from './order-eligibility';
import {
  BackorderModal,
  BulkResultModal,
  CancelOrdersModal,
  ChangeWarehouseModal,
  GuardModal,
  HoldReasonField,
  ReturnInfoDrawer,
  type BulkResultState,
  type GuardState,
} from './order-modals';
import type { BulkOutcome } from '../orders-client';

const plural = (n: number) => (n === 1 ? 'this order' : `${n} orders`);
const SIMPLE_CONFIRM = {
  'resolve-pick-short': {
    title: (n: number) => `Resolve pick short for ${plural(n)}?`,
    description:
      "Short lines are reallocated from other locations that have stock. Lines that still can't be filled are reduced to the picked quantity.",
    confirm: 'Resolve',
  },
  'resolve-pack-short': {
    title: (n: number) => `Resolve pack short for ${plural(n)}?`,
    description:
      'Unpacked quantities go back to the picked tote and the order returns to Packing Started so it can be repacked.',
    confirm: 'Resolve',
  },
  unmerge: {
    title: (n: number) => `Unmerge ${plural(n)}?`,
    description:
      'Merged orders are split back into their original shipment orders. Each original keeps its lines and change log.',
    confirm: 'Unmerge',
  },
} as const;

type Modal =
  | { kind: 'cancel' }
  | { kind: 'warehouse' }
  | { kind: 'backorder' }
  | { kind: 'jobs'; ids: readonly string[]; allocated?: boolean }
  | { kind: 'ship' }
  | { kind: 'delete' }
  | { kind: 'serials' }
  | { kind: 'cancelPicking'; target: readonly OrderRow[] }
  | { kind: 'hold' }
  | { kind: 'release' }
  | { kind: 'returnInfo' }
  | { kind: 'confirmSimple'; action: 'resolve-pick-short' | 'resolve-pack-short' | 'unmerge' }
  | {
      kind: 'print';
      typeKeys: readonly string[];
      records: readonly unknown[];
      title: string;
      clientId: string | null;
    };

export interface OrderBulkMenusProps {
  readonly view: OrderView;
  readonly rows: readonly OrderRow[];
  readonly onChanged: () => void;
  readonly returnInfoOpen?: boolean;
  readonly onReturnInfoOpenChange?: (open: boolean) => void;
}

const NONE = 'Select at least one order';
const LABEL_BUSY: Readonly<Record<string, string>> = {
  create: 'Creating labels',
  void: 'Voiding labels',
  reprint: 'Opening labels',
  return: 'Creating return labels',
  'void-return': 'Voiding return labels',
};
const OPS_BUSY: Readonly<Record<string, string>> = {
  'resolve-pick-short': 'Resolving',
  'resolve-pack-short': 'Resolving',
  unmerge: 'Unmerging',
  'cancel-picking': 'Cancelling picking',
};
const PRINT_BUSY: Readonly<Record<string, string>> = {
  'picking-list': 'Preparing picking list',
  'consolidated-picking-list': 'Preparing batch list',
  'packing-slip': 'Preparing packing slip',
  'manifest-bol': 'Preparing manifest',
  'pick-short-label': 'Preparing short label',
  'reprint-p': 'Opening labels',
};
const NO_PERMISSION = "You don't have permission for this action";

/** A bulk menu. While one of its commands runs (`busy`), the button shows a spinner and stays disabled until the result returns. */
function MenuButton({
  label,
  icon: Icon,
  reason,
  busy = null,
  children,
}: {
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly reason: string | null;
  readonly busy?: string | null;
  readonly children: React.ReactNode;
}) {
  const blocked = reason ?? (busy ? `${busy}…` : null);
  return (
    <DropdownMenu>
      <DisabledReason reason={blocked}>
        <DropdownMenuTrigger asChild disabled={Boolean(blocked)}>
          <Button variant="secondary" disabled={Boolean(blocked)} aria-busy={busy ? true : undefined}>
            {busy ? (
              <Spinner className="h-3.5 w-3.5" label={busy} />
            ) : (
              <Icon className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? `${busy}…` : label}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </DisabledReason>
      <DropdownMenuContent align="end" className="min-w-[230px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Job modal inputs; back-order parents are already allocated (Ready to Pick) even if the grid row is stale. */
function jobRefs(
  rows: readonly OrderRow[],
  ids: readonly string[],
  allocated: boolean,
): readonly JobOrderRef[] {
  return rows
    .filter((r) => ids.includes(r.id))
    .map((r) => ({
      id: r.id,
      code: r.code,
      warehouseId: r.warehouseId,
      status: allocated ? 'Ready to Pick' : r.status,
    }));
}

export function OrderBulkMenus({
  view,
  rows,
  onChanged,
  returnInfoOpen,
  onReturnInfoOpenChange,
}: OrderBulkMenusProps) {
  const router = useRouter();
  // While /api/me loads every menu renders disabled with "Checking permissions…" (no layout jump).
  const gate = useOrderPermissions();
  const can = (key: string) => gate.ready && gate.can(key);
  const [modal, setModal] = React.useState<Modal | null>(null);
  const [guard, setGuard] = React.useState<GuardState | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [holdReason, setHoldReason] = React.useState('');
  const busyLabel = (map: Readonly<Record<string, string>>) => (busy ? (map[busy] ?? null) : null);
  const ids = rows.map((r) => r.id);
  const codes = React.useMemo(() => new Map(rows.map((r) => [r.id, r.code])), [rows]);
  const empty = rows.length === 0 ? NONE : null;
  const reasonFor = (permission: string, check: string | null) =>
    !gate.ready ? CHECKING_PERMISSIONS : (empty ?? (can(permission) ? check : NO_PERMISSION));

  const [result, setResult] = React.useState<BulkResultState | null>(null);
  // Ship preview: order id → "Partially shipped: …" (null while loading / not opened).
  const [shipNotes, setShipNotes] = React.useState<ReadonlyMap<string, string> | null>(null);
  const patchRows = usePatchOrderRows();

  /** Selection clears after every bulk action (Logiwa parity): refetch + clear. */
  const done = () => {
    onChanged();
  };

  /** Full success → toast; any failure (or `always`, e.g. Ship) → the result window with per-order reasons. */
  const report = (
    outcome: BulkOutcome,
    verbPast: string,
    always = false,
    notes?: ReadonlyMap<string, string>,
  ) => {
    if (always || outcome.failed.length > 0) setResult({ verbPast, result: outcome, codes, notes });
    else bulkToast(outcome, verbPast, codes);
  };

  /** Guarded actions: Logiwa guard modal when nothing qualifies; otherwise run on the eligible rows. */
  const guarded = (
    check: (r: EligibilityRow) => boolean,
    message: string,
    run: (eligible: readonly OrderRow[]) => void | Promise<void>,
  ) => {
    const { eligible, skipped } = partition(rows, check);
    if (eligible.length === 0) {
      setGuard({ title: 'Warning', message });
      return;
    }
    if (skipped.length > 0)
      toast.info(
        'Some orders skipped',
        `${skipped.length} order${skipped.length === 1 ? '' : 's'} skipped: ${message}`,
      );
    void run(eligible as readonly OrderRow[]);
  };

  const labels = async (
    action: 'create' | 'void' | 'reprint' | 'return' | 'void-return',
    target: readonly OrderRow[],
    verb: string,
  ) => {
    setBusy(action);
    try {
      const outcome = await runLabels(
        action,
        target.map((r) => r.id),
      );
      report(outcome, verb);
      openFiles(outcome.fileIds);
      done();
    } catch (error) {
      toast.error('Label operation failed', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const simple = async (
    action: 'hold' | 'release' | 'resolve-pick-short' | 'resolve-pack-short' | 'unmerge' | 'cancel-picking',
    target: readonly OrderRow[],
    verb: string,
  ) => {
    setBusy(action);
    try {
      report(await runBulk(action, { ids: target.map((r) => r.id) }), verb);
      done();
    } catch (error) {
      toast.error('Action failed', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const print = async (type: string, title: string, guardMessage?: string) => {
    if (busy) return;
    // Pick lists need an active pick task; the row facts answer that at once, before any request.
    if (
      (type === 'picking-list' || type === 'consolidated-picking-list') &&
      !rows.some((r) => guardChecks.pickList(r))
    ) {
      setGuard({ title: 'Warning', message: guardMessage ?? LOGIWA_GUARDS.pickList });
      return;
    }
    setBusy(type);
    try {
      const res = await fetchPrintRecords(type, ids);
      if (res.records.length === 0) {
        setGuard({
          title: type === 'pick-short-label' ? 'Information' : 'Warning',
          heading: type === 'pick-short-label' ? 'Ineligible order(s) selected' : undefined,
          message: guardMessage ?? res.ineligible[0]?.reason ?? 'Nothing to print for the selected orders.',
          orders: type === 'pick-short-label' && res.ineligible.length === 0 ? [] : undefined,
        });
        return;
      }
      if (res.ineligible.length > 0)
        toast.info(
          'Some orders skipped',
          `${res.ineligible.length} order${res.ineligible.length === 1 ? '' : 's'} skipped: ${res.ineligible[0]?.reason}`,
        );
      const clientId = rows.every((r) => r.clientId === rows[0]?.clientId)
        ? (rows[0]?.clientId ?? null)
        : null;
      setModal({ kind: 'print', typeKeys: [res.typeKey], records: res.records, title, clientId });
    } catch (error) {
      toast.error('Print failed', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const reprintLabels = () =>
    guarded(
      (r) => guardChecks.reprint(r),
      LOGIWA_GUARDS.reprint,
      async (target) => {
        setBusy(view === 'shipped' ? 'reprint-p' : 'reprint');
        try {
          const res = await fetchPrintRecords(
            'shipping-label',
            target.map((r) => r.id),
          );
          if (!res.fileIds?.length) setGuard({ title: 'Warning', message: LOGIWA_GUARDS.reprint });
          else {
            openFiles(res.fileIds);
            done();
          }
        } catch (error) {
          toast.error('Reprint failed', errorMessage(error));
        } finally {
          setBusy(null);
        }
      },
    );

  /** Opens the Ship confirm and loads which orders ship only partly (packed < ordered). */
  const openShip = () => {
    setShipNotes(null);
    setModal({ kind: 'ship' });
    void apiFetch<{ partial: Record<string, string> }>('/api/orders/ship-preview', {
      method: 'POST',
      body: { ids },
    })
      .then((res) => setShipNotes(new Map(Object.entries(res.partial))))
      .catch(() => setShipNotes(new Map()));
  };

  const confirmShip = async () => {
    const outcome = await apiFetch<BulkOutcome>('/api/ops/shipping/ship', { method: 'POST', body: { ids } });
    report(outcome, 'shipped', true, shipNotes ?? undefined);
    done();
  };

  /** Hold / release behind a confirm; the result toast names the count ("1 order released"). */
  const confirmHold = async (action: 'hold' | 'release') => {
    const target = action === 'release' ? rows.filter((r) => r.status === 'On Hold') : rows;
    const reason = holdReason.trim();
    const outcome = await runBulk(
      action,
      action === 'hold' && reason
        ? { ids: target.map((r) => r.id), reason }
        : { ids: target.map((r) => r.id) },
    );
    setHoldReason('');
    // Hold is deterministic, so the rows flip at once; release restores each order's prior status (refetch).
    if (action === 'hold') patchRows(outcome.succeeded, { status: 'On Hold' });
    const n = outcome.succeeded.length;
    if (outcome.failed.length === 0)
      toast.success(
        'Success',
        `${n} order${n === 1 ? '' : 's'} ${action === 'hold' ? 'put on hold' : 'released'}`,
      );
    else report(outcome, action === 'hold' ? 'put on hold' : 'released');
    done();
  };

  const confirmDelete = async () => {
    report(await runBulk('delete', { ids }), 'deleted');
    done();
  };

  const confirmRemoveSerials = async () => {
    report(
      await runBulk('remove-serials', { ids: rows.filter((r) => r.hasSerials).map((r) => r.id) }),
      'updated',
    );
    done();
  };

  const createRma = () => {
    const target = rows.filter((r) => ['Shipped', 'Partially Shipped', 'Delivered'].includes(r.status));
    if (target.length === 0) {
      setGuard({ title: 'Warning', message: 'RMAs can only be created for shipped orders.' });
      return;
    }
    router.push(`/orders/returns/new?orderIds=${encodeURIComponent(target.map((r) => r.id).join(','))}`);
  };

  const recordTable = {
    columns: [
      { key: 'code', label: 'Order code' },
      { key: 'date', label: 'Order date' },
      { key: 'status', label: 'Status' },
    ],
    rows: rows.map((r) => ({
      code: r.code,
      date: new Date(String(r.orderDate)).toLocaleString(),
      status: <OrderStatusPill status={r.status} size="sm" />,
    })),
  };

  const tagButton = (
    <OrderTagPopover
      ids={ids}
      appliedTagIds={rows.length === 1 ? rows[0]?.tags.map((t) => t.id) : []}
      disabledReason={reasonFor(ORDER_PERMISSIONS.tag, null)}
      invalidate={ORDER_INVALIDATE}
      onApplied={done}
      trigger={
        <Button
          variant="secondary"
          disabled={Boolean(reasonFor(ORDER_PERMISSIONS.tag, null))}
          aria-label="Tag"
        >
          <Tag className="h-3.5 w-3.5" aria-hidden />
          Tag
        </Button>
      }
    />
  );

  const item = (
    key: string,
    label: string,
    icon: React.ComponentType<{ className?: string }>,
    permission: string,
    check: string | null,
    onSelect: () => void,
    extra: { destructive?: boolean; description?: string } = {},
  ) => {
    const reason = busy === key ? 'Working…' : reasonFor(permission, check);
    // Disabled items say why inline (not only in a tooltip), e.g. "Order must be Ready to Ship".
    return (
      <DropdownMenuItem
        key={key}
        icon={icon}
        destructive={extra.destructive}
        description={reason ?? extra.description}
        disabledReason={reason}
        onSelect={onSelect}
        className="data-[disabled]:opacity-50 data-[disabled]:[&_svg]:text-faint"
      >
        {label}
      </DropdownMenuItem>
    );
  };

  const P = ORDER_PERMISSIONS;
  const B = ORDER_BULK_PERMISSIONS;
  const anyReason = (keys: readonly string[]) =>
    !gate.ready ? CHECKING_PERMISSIONS : (empty ?? (keys.some(can) ? null : NO_PERMISSION));

  const backlogMenus = (
    <>
      <MenuButton
        label="Label"
        icon={ScanBarcode}
        busy={busyLabel(LABEL_BUSY)}
        reason={anyReason([
          P.createLabel,
          P.reprintLabel,
          P.voidLabel,
          P.createReturnLabel,
          P.createRetailerLabel,
          P.reprintRetailerLabel,
        ])}
      >
        {item(
          'create',
          'Create label',
          ScanBarcode,
          P.createLabel,
          eligibility.createLabel(rows),
          () => void labels('create', rows, 'labeled'),
          { description: 'Buys labels and opens the PDF in a new tab' },
        )}
        {item('reprint', 'Reprint label', Printer, P.reprintLabel, null, reprintLabels)}
        {item('void', 'Void label', XCircle, P.voidLabel, null, () =>
          guarded(
            (r) => guardChecks.void(r),
            LOGIWA_GUARDS.void,
            (t) => labels('void', t, 'voided'),
          ),
        )}
        {item(
          'return',
          'Create return label',
          Undo2,
          P.createReturnLabel,
          eligibility.returnLabel(rows),
          () => void labels('return', rows, 'labeled'),
        )}
        <DropdownMenuSeparator />
        {item(
          'retailer',
          'Create retailer label',
          FileBox,
          P.createRetailerLabel,
          eligibility.retailerLabel(rows),
          () =>
            setModal({
              kind: 'print',
              typeKeys: ['retailer-case-label'],
              records: rows.map((r) => ({ orderCode: r.code })),
              title: 'Create retailer label',
              clientId: null,
            }),
        )}
        {item(
          'retailer-reprint',
          'Reprint retailer label',
          FileBox,
          P.reprintRetailerLabel,
          eligibility.retailerLabel(rows),
          () =>
            setModal({
              kind: 'print',
              typeKeys: ['retailer-case-label'],
              records: rows.map((r) => ({ orderCode: r.code })),
              title: 'Reprint retailer label',
              clientId: null,
            }),
        )}
      </MenuButton>
      <MenuButton
        label="Warehouse ops"
        icon={Wrench}
        busy={busyLabel(OPS_BUSY)}
        reason={anyReason([P.ship, P.jobs, ...Object.values(B)])}
      >
        <DropdownMenuLabel>Fulfillment</DropdownMenuLabel>
        {item('ship', 'Ship order', Truck, P.ship, eligibility.ship(rows), () => openShip())}
        {item('backorder', 'Create backorder', GitBranch, B.backorder, eligibility.backorder(rows), () =>
          setModal({ kind: 'backorder' }),
        )}
        {item('jobs', 'Picking / job operations', ClipboardList, P.jobs, eligibility.jobs(rows), () =>
          setModal({ kind: 'jobs', ids }),
        )}
        {item('cancel-picking', 'Cancel picking', RotateCcw, B['cancel-picking'], null, () =>
          guarded(
            (r) => guardChecks.cancelPicking(r),
            LOGIWA_GUARDS.cancelPicking,
            (t) => setModal({ kind: 'cancelPicking', target: t }),
          ),
        )}
        {item(
          'warehouse',
          'Change warehouse',
          Warehouse,
          B['change-warehouse'],
          eligibility.changeWarehouse(rows),
          () => setModal({ kind: 'warehouse' }),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        {item('hold', 'Put on hold', PauseCircle, B.hold, eligibility.hold(rows), () =>
          setModal({ kind: 'hold' }),
        )}
        {item('release', 'Release hold', PlayCircle, B.release, eligibility.release(rows), () =>
          setModal({ kind: 'release' }),
        )}
        {item(
          'resolve-pick-short',
          'Resolve pick short',
          PackageCheck,
          B['resolve-pick-short'],
          eligibility.resolvePickShort(rows),
          () => setModal({ kind: 'confirmSimple', action: 'resolve-pick-short' }),
        )}
        {item(
          'resolve-pack-short',
          'Resolve pack short',
          PackageMinus,
          B['resolve-pack-short'],
          eligibility.resolvePackShort(rows),
          () => setModal({ kind: 'confirmSimple', action: 'resolve-pack-short' }),
        )}
        {item('unmerge', 'Unmerge order', Scissors, B.unmerge, eligibility.unmerge(rows), () =>
          setModal({ kind: 'confirmSimple', action: 'unmerge' }),
        )}
        <DropdownMenuSeparator />
        {item(
          'cancel',
          'Cancel order',
          Ban,
          B.cancel,
          eligibility.cancel(rows),
          () => setModal({ kind: 'cancel' }),
          { destructive: true },
        )}
      </MenuButton>
      <MenuButton
        label="Print"
        icon={Printer}
        busy={busyLabel(PRINT_BUSY)}
        reason={anyReason([
          P.printPickList,
          P.batchPickList,
          P.printPackingSlip,
          P.printManifest,
          P.pickPackShortLabel,
        ])}
      >
        {item(
          'picking-list',
          'Picking list',
          ListChecks,
          P.printPickList,
          null,
          () => void print('picking-list', 'Print picking list', LOGIWA_GUARDS.pickList),
        )}
        {item(
          'consolidated-picking-list',
          'Batch picking list',
          Layers,
          P.batchPickList,
          null,
          () => void print('consolidated-picking-list', 'Print batch picking list', LOGIWA_GUARDS.pickList),
        )}
        {item(
          'packing-slip',
          'Packing slip',
          FileText,
          P.printPackingSlip,
          null,
          () => void print('packing-slip', 'Print packing slip'),
        )}
        {item(
          'manifest-bol',
          'Manifest / BOL',
          FileBox,
          P.printManifest,
          null,
          () => void print('manifest-bol', 'Print manifest / BOL'),
        )}
        {item(
          'pick-short-label',
          'Pick / pack short label',
          ScanBarcode,
          P.pickPackShortLabel,
          null,
          () => void print('pick-short-label', 'Print pick / pack short label', LOGIWA_GUARDS.issueLabel),
        )}
      </MenuButton>
      <MenuButton label="Delete" icon={Trash2} reason={anyReason([P.delete, B['remove-serials']])}>
        {item(
          'delete',
          'Delete shipment order',
          Trash2,
          P.delete,
          eligibility.delete(rows),
          () => setModal({ kind: 'delete' }),
          { destructive: true },
        )}
        {item(
          'serials',
          'Remove serial number',
          XCircle,
          B['remove-serials'],
          null,
          () =>
            guarded(
              (r) => guardChecks.removeSerials(r),
              LOGIWA_GUARDS.removeSerials,
              () => setModal({ kind: 'serials' }),
            ),
          { destructive: true },
        )}
      </MenuButton>
    </>
  );

  const shippedMenus = (
    <>
      <MenuButton
        label="Label"
        icon={ScanBarcode}
        busy={busyLabel(LABEL_BUSY)}
        reason={anyReason([P.createReturnLabel, P.voidLabel, P.reprintLabel])}
      >
        {item(
          'return',
          'Create return label',
          Undo2,
          P.createReturnLabel,
          eligibility.returnLabel(rows),
          () =>
            guarded(
              (r) => guardChecks.returnLabel(r),
              'Return labels need a shipped order that has a shipping label.',
              (t) => labels('return', t, 'labeled'),
            ),
        )}
        {item(
          'void-return',
          'Void return label',
          XCircle,
          P.voidLabel,
          eligibility.voidReturnLabel(rows),
          () =>
            guarded(
              (r) => guardChecks.voidReturn(r),
              LOGIWA_GUARDS.voidReturn,
              (t) => labels('void-return', t, 'voided'),
            ),
        )}
        {item(
          'reprint',
          'Reprint label',
          Printer,
          P.reprintLabel,
          eligibility.reprintShipped(rows),
          reprintLabels,
        )}
      </MenuButton>
      <DisabledReason reason={reasonFor(P.createRma, null)}>
        <Button variant="secondary" disabled={Boolean(reasonFor(P.createRma, null))} onClick={createRma}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Create RMA
        </Button>
      </DisabledReason>
      <MenuButton
        label="Print"
        icon={Printer}
        busy={busyLabel(PRINT_BUSY)}
        reason={anyReason([P.reprintLabel, P.printPackingSlip, P.printManifest])}
      >
        {item(
          'reprint-p',
          'Reprint label',
          Printer,
          P.reprintLabel,
          eligibility.reprintShipped(rows),
          reprintLabels,
        )}
        {item(
          'packing-slip',
          'Packing slip',
          FileText,
          P.printPackingSlip,
          null,
          () => void print('packing-slip', 'Print packing slip'),
        )}
        {item(
          'manifest-bol',
          'Manifest / BOL',
          FileBox,
          P.printManifest,
          null,
          () => void print('manifest-bol', 'Print manifest / BOL'),
        )}
      </MenuButton>
    </>
  );

  return (
    <>
      {view === 'backlog' ? backlogMenus : shippedMenus}
      {tagButton}

      <GuardModal state={guard} onClose={() => setGuard(null)} />
      <BulkResultModal state={result} onClose={() => setResult(null)} />
      <CancelOrdersModal
        rows={rows}
        open={modal?.kind === 'cancel'}
        onOpenChange={(o) => setModal(o ? { kind: 'cancel' } : null)}
        onDone={done}
      />
      <ChangeWarehouseModal
        rows={rows}
        open={modal?.kind === 'warehouse'}
        onOpenChange={(o) => setModal(o ? { kind: 'warehouse' } : null)}
        onDone={done}
      />
      <BackorderModal
        rows={rows}
        open={modal?.kind === 'backorder'}
        onOpenChange={(o) => setModal(o ? { kind: 'backorder' } : null)}
        onCreated={(parentIds) => {
          done();
          setModal(parentIds.length ? { kind: 'jobs', ids: parentIds, allocated: true } : null);
        }}
      />
      <OrderJobModal
        open={modal?.kind === 'jobs'}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        orders={modal?.kind === 'jobs' ? jobRefs(rows, modal.ids, Boolean(modal.allocated)) : []}
        onDone={done}
      />
      <ConfirmDialog
        open={modal?.kind === 'ship'}
        onOpenChange={(o) => setModal(o ? { kind: 'ship' } : null)}
        variant="info"
        icon={Truck}
        title="Are you sure you want to ship orders?"
        description={
          shipNotes === null
            ? `${shipConfirmText(rows.length)} Checking packed quantities…`
            : shipConfirmText(rows.length, rows.filter((r) => shipNotes.has(r.id)).length)
        }
        records={
          shipNotes && shipNotes.size > 0
            ? {
                columns: [...recordTable.columns, { key: 'note', label: 'Shipment' }],
                rows: rows.map((r, i) => ({
                  ...recordTable.rows[i],
                  note: shipNotes.get(r.id) ?? 'Ships in full',
                })),
              }
            : recordTable
        }
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={confirmShip}
      />
      <ConfirmDialog
        open={modal?.kind === 'hold' || modal?.kind === 'release'}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="info"
        icon={modal?.kind === 'release' ? PlayCircle : PauseCircle}
        title={
          modal?.kind === 'release'
            ? 'Release the hold?'
            : `Put ${rows.length === 1 ? 'this order' : `${rows.length} orders`} on hold?`
        }
        description={
          modal?.kind === 'release'
            ? 'Released orders go back to Open and can be allocated and picked again.'
            : "Orders on hold can't be allocated, picked or shipped until the hold is released."
        }
        records={recordTable}
        cancelLabel="No"
        confirmLabel={modal?.kind === 'release' ? 'Release' : 'Put on hold'}
        onConfirm={() => confirmHold(modal?.kind === 'release' ? 'release' : 'hold')}
      >
        {modal?.kind === 'hold' ? <HoldReasonField value={holdReason} onChange={setHoldReason} /> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={modal?.kind === 'delete'}
        onOpenChange={(o) => setModal(o ? { kind: 'delete' } : null)}
        variant="danger"
        title={`Are you sure you want to delete ${rows.length === 1 ? 'your order' : `${rows.length} orders`}?`}
        description="Deleted orders leave every list. The change log keeps a Delete entry."
        records={recordTable}
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={modal?.kind === 'cancelPicking'}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="danger"
        icon={RotateCcw}
        title={`Cancel picking for ${modal?.kind === 'cancelPicking' && modal.target.length !== 1 ? `${modal.target.length} orders` : 'this order'}?`}
        description="Pending picking and packing tasks are cancelled, the orders leave their jobs and their stock is deallocated. The orders go back to Open."
        records={{
          columns: [
            { key: 'code', label: 'Order code' },
            { key: 'job', label: 'Job' },
            { key: 'status', label: 'Status' },
          ],
          rows: (modal?.kind === 'cancelPicking' ? modal.target : []).map((r) => ({
            code: r.code,
            job: r.jobCode ?? '—',
            status: <OrderStatusPill status={r.status} size="sm" />,
          })),
        }}
        cancelLabel="Go back"
        confirmLabel="Cancel picking"
        onConfirm={() =>
          modal?.kind === 'cancelPicking' ? simple('cancel-picking', modal.target, 'updated') : undefined
        }
      />
      <ConfirmDialog
        open={modal?.kind === 'confirmSimple'}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="info"
        title={modal?.kind === 'confirmSimple' ? SIMPLE_CONFIRM[modal.action].title(rows.length) : ''}
        description={modal?.kind === 'confirmSimple' ? SIMPLE_CONFIRM[modal.action].description : ''}
        records={recordTable}
        cancelLabel="No"
        confirmLabel={modal?.kind === 'confirmSimple' ? SIMPLE_CONFIRM[modal.action].confirm : 'Yes'}
        onConfirm={() =>
          modal?.kind === 'confirmSimple'
            ? simple(modal.action, rows, modal.action === 'unmerge' ? 'unmerged' : 'resolved')
            : undefined
        }
      />
      <ConfirmDialog
        open={modal?.kind === 'serials'}
        onOpenChange={(o) => setModal(o ? { kind: 'serials' } : null)}
        variant="danger"
        title="Are you sure?"
        description="All serial numbers in this shipment order will be removed."
        records={{ ...recordTable, rows: recordTable.rows.filter((_, i) => rows[i]?.hasSerials) }}
        cancelLabel="Cancel"
        confirmLabel="Remove"
        onConfirm={confirmRemoveSerials}
      />
      <PrintOptionsModal
        open={modal?.kind === 'print'}
        // Closing (Cancel / Escape / after printing) keeps the selection: printing changes no data,
        // so the user can run another action on the same orders.
        onOpenChange={(o) => {
          if (!o) setModal(null);
        }}
        typeKeys={modal?.kind === 'print' ? modal.typeKeys : []}
        records={modal?.kind === 'print' ? modal.records : []}
        clientId={modal?.kind === 'print' ? modal.clientId : null}
        title={modal?.kind === 'print' ? modal.title : 'Print options'}
      />
      {view === 'shipped' ? (
        <ReturnInfoDrawer
          rows={rows.filter((r) => guardChecks.returnInfo(r))}
          open={Boolean(returnInfoOpen)}
          onOpenChange={(o) => onReturnInfoOpenChange?.(o)}
          onDone={done}
        />
      ) : null}
    </>
  );
}
