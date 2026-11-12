'use client';

/**
 * Order detail right rail (spec 01 §3): Other actions ▾, Summary (status, change log,
 * totals), Assigned jobs (+ / unassign), Billing charges, Printouts, Packages & tracking.
 * Every action is gated by the domain reason (tooltip) and the user's permission.
 */
import * as React from 'react';
import { OrderStatusPill } from '../order-status-pill';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Ban,
  ChevronDown,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileText,
  History,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Plus,
  Printer,
  Trash2,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useFormat } from '@/lib/format';
import { ORDER_BULK_PERMISSIONS, ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusPill } from '@/components/ui/status-pill';
import { Spinner } from '@/components/ui/spinner';
import { usePermissionSet } from '@/lib/permissions-client';
import { TERMINAL_ORDER_STATUSES } from './order-detail-tabs';
import { toast } from '@/components/ui/toast';
import { DisabledReason, Tooltip } from '@/components/ui/tooltip';
import { ChangeLogDrawer, PrintOptionsModal } from '@/components/shared';
import { OrderJobModal } from '../bulk/order-job-modal';
import {
  bulkToast,
  errorMessage,
  fetchPrintRecords,
  openFiles,
  runBulk,
  useInvalidateOrders,
  type OrderDetail,
  type OrderRow,
} from '../orders-client';
import {
  CancelOrdersModal,
  GuardModal,
  HoldReasonField,
  SuccessResultDialog,
  type GuardState,
} from '../bulk/order-modals';
import { RailCard } from '../wizard/order-summary';
import { orderTotals } from '../wizard/order-form-model';

import { CHECKING_PERMISSIONS, useOrderPermissions } from '../use-order-permissions';

export function rowFromDetail(d: OrderDetail): OrderRow {
  const o = d.order;
  return {
    id: o.id,
    version: o.version,
    code: o.code,
    status: o.status,
    clientId: o.clientId,
    warehouseId: o.warehouseId,
    jobId: o.jobId,
    retailerId: o.retailerId,
    channel: o.channel,
    isMerged: o.isMerged,
    hasLabel: d.shipments.some((s) => s.labelStatus === 'Active'),
    hasActiveTask: d.hasActiveTask,
    hasSerials: false,
    allocatedQuantity: d.lines.reduce((s, l) => s + l.allocatedQuantity, 0),
    tags: d.tags,
    orderDate: o.orderDate,
  };
}

type Pending =
  | 'ship'
  | 'delete'
  | 'cancel'
  | 'jobs'
  | 'hold'
  | 'release'
  | 'duplicate'
  | { kind: 'unassign'; jobId: string; code: string }
  | { kind: 'void'; shipmentId: string; tracking: string }
  | null;

function Row({
  label,
  value,
  action,
}: {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-secondary">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-right font-medium text-foreground">
        {value}
        {action}
      </span>
    </div>
  );
}

const BUSY_LABEL: Readonly<Record<string, string>> = {
  hold: 'Putting on hold…',
  release: 'Releasing…',
  duplicate: 'Duplicating…',
};

function Availability({ ok }: { readonly ok: boolean }) {
  return (
    <span className={ok ? 'text-xs font-semibold text-success' : 'text-xs text-faint'}>
      {ok ? 'Available' : 'Not available'}
    </span>
  );
}

export interface OrderDetailRailProps {
  readonly detail: OrderDetail;
  readonly onChanged: () => void;
}

export function OrderActionsMenu({ detail, onChanged }: OrderDetailRailProps) {
  const router = useRouter();
  const invalidate = useInvalidateOrders();
  const perms = useOrderPermissions();
  const [pending, setPending] = React.useState<Pending>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [holdReason, setHoldReason] = React.useState('');
  // Ship preview note: undefined while loading, null = ships in full.
  const [shipNote, setShipNote] = React.useState<string | null | undefined>(undefined);
  const [duplicated, setDuplicated] = React.useState<{ id: string; code: string } | null>(null);
  const o = detail.order;
  const a = detail.actions;
  const gate = (permission: string, reason: string | null | undefined) =>
    perms.reason(permission) ?? reason ?? null;
  /** Disabled items show their reason inline (not only as a tooltip), matching the bulk menus. */
  const why = (reason: string | null, hint?: string) => ({
    disabledReason: reason,
    description: reason && reason !== CHECKING_PERMISSIONS ? reason : hint,
  });
  const row = rowFromDetail(detail);
  const codes = new Map([[o.id, o.code]]);

  /** Runs inside the confirm dialog (its button shows progress); a failure keeps the dialog open with the reason. */
  const simple = async (action: 'hold' | 'release', verb: string) => {
    setBusy(action);
    try {
      const reason = holdReason.trim();
      const result = await runBulk(
        action,
        action === 'hold' && reason ? { ids: [o.id], reason } : { ids: [o.id] },
      );
      setHoldReason('');
      bulkToast(result, verb, codes);
      onChanged();
      if (result.failed.length > 0) throw new Error(result.failed[0]?.message ?? 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async () => {
    setBusy('duplicate');
    try {
      const copy = await apiFetch<{ id: string; code: string }>(`/api/orders/${o.id}/duplicate`, {
        method: 'POST',
      });
      await invalidate();
      setDuplicated(copy);
    } catch (error) {
      toast.error("Couldn't duplicate the order", errorMessage(error));
      throw error;
    } finally {
      setBusy(null);
    }
  };

  const ship = async () => {
    const result = await apiFetch<{
      succeeded: string[];
      failed: { id: string; code: string; message: string }[];
    }>('/api/ops/shipping/ship', { method: 'POST', body: { ids: [o.id] } });
    const partial = shipNote;
    if (partial && result.failed.length === 0)
      toast.warning(
        'Order partially shipped',
        `${o.code}: ${partial}. It stays in the backlog as Partially Shipped.`,
      );
    else bulkToast(result, 'shipped', codes);
    onChanged();
  };

  const remove = async () => {
    await apiFetch(`/api/orders/${o.id}`, { method: 'DELETE' });
    toast.success('Order deleted', `${o.code} was deleted.`);
    await invalidate();
    router.push('/orders');
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="w-full justify-between" aria-busy={busy ? true : undefined}>
            <span className="flex items-center gap-1.5">
              {busy ? (
                <Spinner className="h-3.5 w-3.5" label={BUSY_LABEL[busy] ?? 'Working'} />
              ) : (
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              )}
              {busy ? (BUSY_LABEL[busy] ?? 'Working…') : 'Other actions'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[260px]">
          <DropdownMenuItem
            icon={Truck}
            {...why(
              gate(
                ORDER_PERMISSIONS.ship,
                a.ship ??
                  (o.status !== 'Ready to Ship'
                    ? `Only Ready to Ship orders can be shipped; this order is ${o.status}.`
                    : null),
              ),
            )}
            onSelect={() => {
              setShipNote(undefined);
              setPending('ship');
              void apiFetch<{ partial: Record<string, string> }>('/api/orders/ship-preview', {
                method: 'POST',
                body: { ids: [o.id] },
              })
                .then((r) => setShipNote(r.partial[o.id] ?? null))
                .catch(() => setShipNote(null));
            }}
          >
            Ship order
          </DropdownMenuItem>
          {o.status === 'On Hold' ? (
            <DropdownMenuItem
              icon={PlayCircle}
              {...why(gate(ORDER_BULK_PERMISSIONS.release, a.release))}
              onSelect={() => setPending('release')}
            >
              Release hold
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              icon={PauseCircle}
              {...why(gate(ORDER_BULK_PERMISSIONS.hold, a.hold))}
              onSelect={() => setPending('hold')}
            >
              Put on hold
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            icon={Copy}
            {...why(gate(ORDER_PERMISSIONS.create, a.duplicate), 'New Open order with the same lines')}
            onSelect={() => setPending('duplicate')}
          >
            Duplicate order
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={Ban}
            destructive
            {...why(gate(ORDER_BULK_PERMISSIONS.cancel, a.cancel))}
            onSelect={() => setPending('cancel')}
          >
            Cancel order
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={Trash2}
            destructive
            {...why(gate(ORDER_PERMISSIONS.delete, a.delete))}
            onSelect={() => setPending('delete')}
          >
            Delete order
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={pending === 'ship'}
        onOpenChange={(v) => !v && setPending(null)}
        variant="info"
        icon={Truck}
        title="Are you sure you want to ship this order?"
        description={
          shipNote === undefined
            ? `${o.code} will be shipped. Checking packed quantities…`
            : shipNote
              ? `${o.code} is only partly packed. ${shipNote}. The packed units ship and the order becomes Partially Shipped, staying in the backlog.`
              : `${o.code} will move to Shipped & Canceled Orders and its inventory leaves the warehouse.`
        }
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={ship}
      />
      <ConfirmDialog
        open={pending === 'delete'}
        onOpenChange={(v) => !v && setPending(null)}
        variant="danger"
        title="Are you sure you want to delete your order?"
        description={`${o.code} leaves every list. The change log keeps a Delete entry.`}
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={remove}
      />
      <ConfirmDialog
        open={pending === 'hold'}
        onOpenChange={(v) => !v && setPending(null)}
        variant="info"
        icon={PauseCircle}
        title="Put this order on hold?"
        description={`${o.code} stops in its current step until the hold is released. Allocated stock stays allocated.`}
        cancelLabel="No"
        confirmLabel="Put on hold"
        onConfirm={() => simple('hold', 'put on hold')}
      >
        <HoldReasonField id="detail-hold-reason" value={holdReason} onChange={setHoldReason} />
      </ConfirmDialog>
      <ConfirmDialog
        open={pending === 'release'}
        onOpenChange={(v) => !v && setPending(null)}
        variant="info"
        icon={PlayCircle}
        title="Release the hold on this order?"
        description={`${o.code} returns to the status it had before the hold.`}
        cancelLabel="No"
        confirmLabel="Release hold"
        onConfirm={() => simple('release', 'released')}
      />
      <ConfirmDialog
        open={pending === 'duplicate'}
        onOpenChange={(v) => !v && setPending(null)}
        variant="info"
        icon={Copy}
        title="Duplicate this order?"
        description={`A new Open order is created with the same customer, address, shipping and ${detail.lines.length} ${detail.lines.length === 1 ? 'line' : 'lines'}. ${o.code} is not changed.`}
        cancelLabel="No"
        confirmLabel="Duplicate"
        onConfirm={duplicate}
      />
      <SuccessResultDialog
        open={Boolean(duplicated)}
        onClose={() => setDuplicated(null)}
        title={duplicated ? `${duplicated.code} was created` : 'Order duplicated'}
        description={
          duplicated
            ? `${duplicated.code} is an Open copy of ${o.code}. Its order date is now and its expected shipment date keeps the same lead time. Its change log records where it came from.`
            : ''
        }
        primaryLabel={duplicated ? `Open ${duplicated.code}` : 'Open'}
        onPrimary={() => {
          if (duplicated) router.push(`/orders/${encodeURIComponent(duplicated.code)}`);
        }}
      />
      <CancelOrdersModal
        rows={[row]}
        open={pending === 'cancel'}
        onOpenChange={(v) => setPending(v ? 'cancel' : null)}
        onDone={() => onChanged()}
      />
    </>
  );
}

export function SummaryCard({ detail }: { readonly detail: OrderDetail }) {
  const fmt = useFormat();
  const perms = useOrderPermissions();
  const [logOpen, setLogOpen] = React.useState(false);
  const o = detail.order;
  const t = orderTotals(
    detail.lines.map((l) => ({
      productId: l.productId,
      isKit: l.isKit,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      weightOz: l.weightOz,
    })),
    o.discount,
  );
  const { permissions } = usePermissionSet();
  // Read-only history: the same rule as the grid row kebab (anyone who can see the order).
  const logReason = !perms.ready
    ? CHECKING_PERMISSIONS
    : permissions.has(ORDER_PERMISSIONS.changeLog) || permissions.has(ORDER_PERMISSIONS.view)
      ? null
      : "You don't have permission to view the change log";
  return (
    <RailCard title="Summary">
      <div className="flex items-start justify-between gap-2">
        <p
          className="min-w-0 truncate text-lg font-semibold tracking-[-0.01em] text-foreground"
          title={o.code}
        >
          {o.code}
        </p>
        <OrderStatusPill status={o.status} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Row
          label="Warehouse"
          value={detail.warehouseLabel}
          action={
            <Tooltip content="Copy warehouse">
              <button
                type="button"
                aria-label="Copy warehouse"
                className="rounded p-0.5 text-faint hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(detail.warehouseLabel)
                    .then(() => toast.success('Copied', detail.warehouseLabel))
                }
              >
                <Copy className="h-3 w-3" aria-hidden />
              </button>
            </Tooltip>
          }
        />
        <Row label="Client" value={detail.clientName} />
        <Row label="Order type" value={detail.orderTypeName} />
        <Row label="Store order #" value={o.storeOrderNumber ?? '—'} />
        <Row label="Last update" value={fmt.dateTime(o.updatedAt)} />
        {detail.masterOrderCode ? (
          <Row
            label="Master order"
            value={
              <Link
                className="text-primary hover:underline"
                href={`/orders/${encodeURIComponent(detail.masterOrderCode)}`}
              >
                {detail.masterOrderCode}
              </Link>
            }
          />
        ) : null}
        {detail.backOrders.length ? (
          <Row
            label="Backorders"
            value={detail.backOrders.map((b) => (
              <Link
                key={b.id}
                className="text-primary hover:underline"
                href={`/orders/${encodeURIComponent(b.code)}`}
              >
                {b.code}
              </Link>
            ))}
          />
        ) : null}
        {o.status === 'Cancelled' ? (
          <Row label="Cancel reason" value={detail.cancelReasonName ?? '—'} />
        ) : null}
      </div>
      <DisabledReason reason={logReason}>
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => setLogOpen(true)}
          disabled={Boolean(logReason)}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          Show change log
        </Button>
      </DisabledReason>
      <dl className="flex flex-col gap-1.5 border-t border-border pt-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-secondary">Price</dt>
          <dd className="tabular-nums">{fmt.money(t.price, 'USD', 'summary')}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-secondary">Discount</dt>
          <dd className="tabular-nums">{fmt.money(t.discount, 'USD', 'summary')}</dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{fmt.money(t.total, 'USD', 'summary')}</dd>
        </div>
      </dl>
      <ChangeLogDrawer
        open={logOpen}
        onOpenChange={setLogOpen}
        entityType="shipment_order"
        entityId={o.id}
        entityCode={o.code}
      />
    </RailCard>
  );
}

export function JobsCard({ detail, onChanged }: OrderDetailRailProps) {
  const perms = useOrderPermissions();
  const [modal, setModal] = React.useState(false);
  const [unassign, setUnassign] = React.useState<{ jobId: string; code: string } | null>(null);
  const o = detail.order;
  const terminal = TERMINAL_ORDER_STATUSES.has(o.status);
  const addReason = terminal
    ? `A ${o.status} order can't get a picking job.`
    : (perms.reason(ORDER_PERMISSIONS.jobs) ??
      detail.actions.jobs ??
      (o.jobId ? 'This order already has a picking job. Unassign it first.' : null));
  const removeReason = perms.reason(ORDER_PERMISSIONS.jobs);
  return (
    <RailCard
      title="Assigned jobs"
      action={
        <DisabledReason reason={addReason}>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Assign a job"
            disabled={Boolean(addReason)}
            onClick={() => setModal(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DisabledReason>
      }
    >
      {detail.jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border px-3 py-4 text-center">
          <ClipboardList className="h-5 w-5 text-faint" aria-hidden />
          <p className="text-sm font-semibold text-foreground">No job assigned</p>
          <p className="text-xs text-secondary">
            {terminal
              ? o.status === 'Cancelled'
                ? 'The order is cancelled, so no job can be assigned.'
                : `The order is ${o.status}; it was fulfilled without a job on record.`
              : o.status === 'Ready to Pick'
                ? 'Stock is allocated. Create a picking job to start picking and print the picking list.'
                : 'Press the + button to assign a new job.'}
          </p>
          {!addReason ? (
            <Button variant="secondary" size="sm" className="mt-1" onClick={() => setModal(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create picking job
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.jobs.map((j) => (
            <li key={j.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/jobs/${encodeURIComponent(j.id)}`}
                  className="block truncate text-sm font-semibold text-primary hover:underline"
                >
                  {j.code}
                </Link>
                <span className="block truncate text-xs text-secondary">{j.jobType}</span>
              </div>
              <StatusPill status={j.status} domain="job" size="sm" />
              {j.status === 'Pending' ? (
                <DisabledReason reason={removeReason}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Unassign ${j.code}`}
                    disabled={Boolean(removeReason)}
                    onClick={() => setUnassign({ jobId: j.id, code: j.code })}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </DisabledReason>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <OrderJobModal
        open={modal}
        onOpenChange={setModal}
        orders={[{ id: o.id, code: o.code, status: o.status, warehouseId: o.warehouseId }]}
        onDone={() => onChanged()}
      />
      <ConfirmDialog
        open={Boolean(unassign)}
        onOpenChange={(v) => !v && setUnassign(null)}
        variant="danger"
        title="Unassign this job?"
        description={
          unassign ? `${o.code} will be removed from ${unassign.code} and its allocation released.` : ''
        }
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={async () => {
          if (!unassign) return;
          await apiFetch(`/api/orders/${o.id}/jobs/${unassign.jobId}`, { method: 'DELETE' });
          toast.success('Job unassigned', `${o.code} was removed from ${unassign.code}.`);
          onChanged();
        }}
      />
    </RailCard>
  );
}

interface Charge {
  readonly feeName: string;
  readonly operationType: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly totalPrice: number;
  readonly activityDate: string | null;
  readonly reportCode: string;
}

export function DocumentsCards({ detail, onChanged }: OrderDetailRailProps) {
  const fmt = useFormat();
  const perms = useOrderPermissions();
  const [print, setPrint] = React.useState<{
    typeKey: string;
    records: readonly unknown[];
    title: string;
  } | null>(null);
  const [guard, setGuard] = React.useState<GuardState | null>(null);
  const [voiding, setVoiding] = React.useState<{ shipmentId: string; tracking: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const o = detail.order;
  const label = detail.shipments.find((s) => s.labelStatus === 'Active' && s.labelType === 'Shipping Label');
  const hasJob = detail.jobs.length > 0 || Boolean(o.jobId);
  // A released job has active pick tasks; a completed job's list can still be reprinted.
  const pickListReady = hasJob && (detail.hasPickTask || detail.jobs.some((j) => j.status === 'Completed'));
  const cancelled = o.status === 'Cancelled';
  const pickListState = cancelled
    ? 'na'
    : pickListReady
      ? 'ready'
      : TERMINAL_ORDER_STATUSES.has(o.status)
        ? 'na'
        : hasJob
          ? 'unreleased'
          : 'nojob';

  const downloadCharges = async () => {
    setBusy('billing');
    try {
      const rows = await apiFetch<readonly Charge[]>(`/api/orders/${o.id}/billing-charges`);
      if (rows.length === 0) {
        toast.info(
          'No billing charges yet',
          `No billing report has charged ${o.code} so far. Charges appear after the next billing calculation.`,
        );
        return;
      }
      const head = [
        'Bill number',
        'Fee',
        'Operation',
        'SKU',
        'Quantity',
        'Unit price',
        'Total',
        'Activity date',
      ];
      const body = rows.map((r) => [
        r.reportCode,
        r.feeName,
        r.operationType,
        r.sku ?? '',
        r.quantity,
        r.unitPrice.toFixed(2),
        r.totalPrice.toFixed(2),
        r.activityDate ?? '',
      ]);
      const csv = [head, ...body]
        .map((r) =>
          r
            .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)))
            .join(','),
        )
        .join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${o.code}-billing-charges.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error('Download failed', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const printType = async (type: 'packing-slip' | 'picking-list', title: string) => {
    setBusy(type);
    try {
      const res = await fetchPrintRecords(type, [o.id]);
      if (res.records.length === 0)
        setGuard({
          title: 'Warning',
          message: res.ineligible[0]?.reason ?? 'Nothing to print for this order.',
        });
      else setPrint({ typeKey: res.typeKey, records: res.records, title });
    } catch (error) {
      toast.error('Print failed', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const perm = (k: string) => perms.reason(k);

  return (
    <>
      <RailCard title="Billing charges">
        <DisabledReason reason={perm(ORDER_PERMISSIONS.billing)}>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void downloadCharges()}
            disabled={busy === 'billing' || Boolean(perm(ORDER_PERMISSIONS.billing))}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download billing charges
          </Button>
        </DisabledReason>
        <p className="text-xs text-secondary">Click to download the latest billing charges.</p>
      </RailCard>

      <RailCard title="Printouts">
        <div className="flex flex-col gap-2">
          <Row
            label="Shipment label"
            value={<Availability ok={Boolean(label)} />}
            action={
              <DisabledReason
                reason={
                  label?.labelFileId
                    ? perm(ORDER_PERMISSIONS.reprintLabel)
                    : 'This order has no label to reprint.'
                }
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Reprint shipment label"
                  disabled={!label?.labelFileId || Boolean(perm(ORDER_PERMISSIONS.reprintLabel))}
                  onClick={() => label?.labelFileId && openFiles([label.labelFileId])}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DisabledReason>
            }
          />
          <Row
            label="Packing slip"
            value={<Availability ok={!cancelled} />}
            action={
              <DisabledReason
                reason={
                  cancelled ? 'Not available on a cancelled order' : perm(ORDER_PERMISSIONS.printPackingSlip)
                }
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Print packing slip"
                  disabled={
                    cancelled || busy === 'packing-slip' || Boolean(perm(ORDER_PERMISSIONS.printPackingSlip))
                  }
                  onClick={() => void printType('packing-slip', 'Print packing slip')}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DisabledReason>
            }
          />
          <Row
            label="Picking list"
            value={
              pickListState === 'ready' ? (
                <Availability ok />
              ) : pickListState === 'na' ? (
                <Availability ok={false} />
              ) : (
                <span className="text-xs text-warning">
                  {pickListState === 'unreleased' ? 'Job not released' : 'Needs a job'}
                </span>
              )
            }
            action={
              <DisabledReason
                reason={
                  pickListState === 'na'
                    ? `Not available on a ${o.status} order`
                    : !hasJob
                      ? 'Available once a picking job exists'
                      : !pickListReady
                        ? 'The picking list is available once the job is released.'
                        : perm(ORDER_PERMISSIONS.printPickList)
                }
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Print picking list"
                  disabled={
                    pickListState !== 'ready' ||
                    busy === 'picking-list' ||
                    Boolean(perm(ORDER_PERMISSIONS.printPickList))
                  }
                  onClick={() => void printType('picking-list', 'Print picking list')}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DisabledReason>
            }
          />
          <Row
            label="Other documents"
            value={<span className="text-xs text-secondary">Upload or view</span>}
            action={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Go to documents"
                onClick={() => window.dispatchEvent(new CustomEvent('order:show-documents'))}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
              </Button>
            }
          />
        </div>
      </RailCard>

      <RailCard title="Packages & tracking">
        {detail.shipments.length === 0 ? (
          <p className="text-xs text-secondary">
            No labels yet. Labels appear here once the order is packed and labeled.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.shipments.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 rounded-md border border-border px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="truncate font-mono text-xs font-semibold text-foreground"
                    title={s.trackingNumber}
                  >
                    {s.trackingNumber}
                  </span>
                  <StatusPill status={s.labelStatus} size="sm" />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-secondary">
                  <span className="truncate">
                    {s.carrierCode} · {s.serviceName} · Pkg {s.packageSeq}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reprint label ${s.trackingNumber}`}
                      disabled={!s.labelFileId}
                      onClick={() => s.labelFileId && openFiles([s.labelFileId])}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <DisabledReason
                      reason={
                        s.labelStatus !== 'Active'
                          ? 'Only active labels can be voided'
                          : s.actualShipmentAt
                            ? "Shipped labels can't be voided"
                            : perm(ORDER_PERMISSIONS.voidLabel)
                      }
                    >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Void label ${s.trackingNumber}`}
                        disabled={
                          s.labelStatus !== 'Active' ||
                          Boolean(s.actualShipmentAt) ||
                          Boolean(perm(ORDER_PERMISSIONS.voidLabel))
                        }
                        onClick={() => setVoiding({ shipmentId: s.id, tracking: s.trackingNumber })}
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </DisabledReason>
                  </span>
                </div>
                <span className="text-2xs text-faint">
                  {fmt.money(s.shippingCost)} · {fmt.dateTime(s.labelCreatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailCard>

      <GuardModal state={guard} onClose={() => setGuard(null)} />
      <PrintOptionsModal
        open={Boolean(print)}
        onOpenChange={(v) => !v && setPrint(null)}
        typeKeys={print ? [print.typeKey] : []}
        records={print?.records ?? []}
        clientId={o.clientId}
        title={print?.title ?? 'Print options'}
      />
      <ConfirmDialog
        open={Boolean(voiding)}
        onOpenChange={(v) => !v && setVoiding(null)}
        variant="danger"
        title="Void this label?"
        description={
          voiding ? `Label ${voiding.tracking} is voided with the carrier and can't be used again.` : ''
        }
        cancelLabel="No"
        confirmLabel="Void label"
        onConfirm={async () => {
          if (!voiding) return;
          await apiFetch('/api/ops/shipping/void', {
            method: 'POST',
            body: { shipmentId: voiding.shipmentId },
          });
          toast.success('Label voided', `${voiding.tracking} was voided.`);
          onChanged();
        }}
      />
    </>
  );
}
