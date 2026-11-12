'use client';

/**
 * Modals behind the Shipment Orders bulk menus: Logiwa guard/info modals, Cancel Order
 * (reason required), Change Warehouse, Create Backorder eligibility, Bulk Update Return
 * Info drawer. Each one calls the real endpoint and reports per-order outcomes.
 */
import * as React from 'react';
import Link from 'next/link';
import { OrderStatusPill } from '../order-status-pill';
import { Badge } from '@/components/ui/badge';
import { bulkResultTitle } from './order-eligibility';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  GitMerge,
  Info,
  ListPlus,
  PackageOpen,
  Warehouse,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChipInput } from '@/components/ui/chip-input';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { DisabledReason } from '@/components/ui/tooltip';
import { errorTextClass, labelClass } from '@/components/ui/control-styles';
import { formatDateTime } from '@/lib/format';
import {
  bulkToast,
  errorMessage,
  runBulk,
  useOrderOptions,
  type BulkOutcome,
  type OrderRow,
} from '../orders-client';
import { toast } from '@/components/ui/toast';

/* ------------------------------------------------------------------ guard */

export interface GuardState {
  readonly title: string;
  readonly message: string;
  readonly heading?: string;
  readonly orders?: readonly { readonly code: string; readonly reason: string }[];
}

/** Logiwa "Warning" / "Information" modal with an OK button. */
export function GuardModal({
  state,
  onClose,
}: {
  readonly state: GuardState | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="sm">
        <div className="flex items-center gap-3 rounded-t-lg bg-warning-soft px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warning text-white">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
          <DialogHeader title={state?.title ?? 'Warning'} className="p-0" />
        </div>
        <DialogBody className="flex flex-col gap-3">
          {state?.heading ? <p className="text-base font-semibold text-foreground">{state.heading}</p> : null}
          <p className="text-sm leading-5 text-body">{state?.message}</p>
          {state?.orders && state.orders.length > 0 ? (
            <ul className="ks-scroll max-h-40 divide-y divide-border overflow-auto rounded-md border border-border text-xs">
              {state.orders.map((o) => (
                <li key={o.code} className="flex gap-3 px-3 py-1.5">
                  <span className="w-28 shrink-0 font-semibold text-foreground">{o.code}</span>
                  <span className="text-secondary">{o.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose} autoFocus>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- result */

export interface BulkResultState {
  readonly verbPast: string;
  readonly result: BulkOutcome;
  readonly codes: ReadonlyMap<string, string>;
  /** Per-order note for succeeded rows (e.g. "Partially shipped: 1 of 2 units of SKU remain"). */
  readonly notes?: ReadonlyMap<string, string>;
}

/** Optional hold reason (kept in the change log + order Notes, shown on the detail hold banner). */
export function HoldReasonField({
  value,
  onChange,
  id = 'hold-reason',
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly id?: string;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1">
      <label htmlFor={id} className={labelClass}>
        Hold reason
      </label>
      <Textarea
        id={id}
        value={value}
        maxLength={500}
        showCount
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional, e.g. Address check with customer"
      />
    </div>
  );
}

/** Neutral/success result window for a completed action (never the red danger band). */
export function SuccessResultDialog({
  open,
  title,
  description,
  primaryLabel,
  onPrimary,
  closeLabel = 'Stay here',
  onClose,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: React.ReactNode;
  readonly primaryLabel: string;
  readonly onPrimary: () => void;
  readonly closeLabel?: string;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <div className="flex items-center gap-3 rounded-t-lg bg-success-soft px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-white">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          </span>
          <DialogHeader title={title} className="p-0" />
        </div>
        <DialogBody>
          <p className="text-sm leading-5 text-body">{description}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {closeLabel}
          </Button>
          <Button
            variant="primary"
            autoFocus
            onClick={() => {
              onPrimary();
              onClose();
            }}
          >
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bulk result window (Logiwa Ship Order parity, used by every KitStaks bulk action that
 * reports failures): title, Success N / Error N badges and an SO Code | Description table.
 */
export function BulkResultModal({
  state,
  onClose,
}: {
  readonly state: BulkResultState | null;
  readonly onClose: () => void;
}) {
  const ok = state?.result.succeeded.length ?? 0;
  const bad = state?.result.failed.length ?? 0;
  const rows = state
    ? [
        ...state.result.failed.map((f) => ({
          id: f.id,
          code: state.codes.get(f.id) ?? '—',
          description: f.message,
          ok: false,
          warn: false,
        })),
        ...state.result.succeeded.map((id) => {
          const note = state.notes?.get(id);
          return {
            id,
            code: state.codes.get(id) ?? '—',
            description: note ?? `Order ${state.verbPast}.`,
            ok: true,
            warn: Boolean(note),
          };
        }),
      ]
    : [];
  const title = state ? bulkResultTitle(state.verbPast, ok, bad) : '';
  return (
    <Dialog open={state !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="md" aria-describedby={undefined}>
        <div
          className={cn(
            'flex items-center gap-3 rounded-t-lg px-5 py-4',
            bad > 0 ? 'bg-warning-soft' : 'bg-success-soft',
          )}
        >
          <span
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full text-white',
              bad > 0 ? 'bg-warning' : 'bg-success',
            )}
          >
            {bad > 0 ? (
              <AlertTriangle className="h-4 w-4" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
          </span>
          <DialogHeader title={title} className="p-0" />
        </div>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex items-center gap-2" aria-label="Result counts">
            <Badge tone="success" shape="pill">
              Success {ok}
            </Badge>
            <Badge tone="danger" shape="pill">
              Error {bad}
            </Badge>
          </div>
          <div className="ks-scroll max-h-[300px] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-surface-sunken">
                <tr>
                  {['SO code', 'Description'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="border-b border-border px-2.5 py-1.5 text-2xs font-semibold text-faint"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-b-0">
                    <td className="w-32 px-2.5 py-1.5 font-semibold text-foreground">{r.code}</td>
                    <td
                      className={cn(
                        'px-2.5 py-1.5',
                        !r.ok ? 'text-danger' : r.warn ? 'font-semibold text-warning' : 'text-success',
                      )}
                    >
                      {r.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose} autoFocus>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrdersTable({
  rows,
  extra,
}: {
  readonly rows: readonly OrderRow[];
  readonly extra?: (r: OrderRow) => React.ReactNode;
}) {
  return (
    <div className="ks-scroll max-h-[220px] overflow-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-surface-sunken">
          <tr>
            {['Order code', 'Order status', 'Order date', ...(extra ? ['Note'] : [])].map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-border px-2.5 py-1.5 text-2xs font-semibold text-faint"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-b-0">
              <td className="px-2.5 py-1.5 font-semibold text-foreground">{r.code}</td>
              <td className="px-2.5 py-1.5">
                <OrderStatusPill status={r.status} size="sm" />
              </td>
              <td className="px-2.5 py-1.5 tabular-nums text-secondary">
                {formatDateTime(String(r.orderDate ?? ''))}
              </td>
              {extra ? <td className="px-2.5 py-1.5 text-secondary">{extra(r)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function codesOf(rows: readonly OrderRow[]): ReadonlyMap<string, string> {
  return new Map(rows.map((r) => [r.id, r.code]));
}

/* ----------------------------------------------------------------- cancel */

/** Rejects with a readable error when `p` has not settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `The server did not respond within ${Math.round(ms / 1000)}s. Nothing was changed; try again.`,
          ),
        ),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function CancelOrdersModal({
  rows,
  open,
  onOpenChange,
  onDone,
}: {
  readonly rows: readonly OrderRow[];
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly onDone: (r: BulkOutcome) => void;
}) {
  const clientId =
    rows.length > 0 && rows.every((r) => r.clientId === rows[0]?.clientId) ? rows[0]?.clientId : undefined;
  const options = useOrderOptions(null, clientId);
  const [reasonId, setReasonId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const reasons = options.data?.data.cancelReasons ?? [];
  const missing = touched && !reasonId;

  const close = (o: boolean) => {
    if (!o) {
      setReasonId(null);
      setNote('');
      setTouched(false);
      setFailure(null);
    }
    onOpenChange(o);
  };

  const submit = async () => {
    setTouched(true);
    if (!reasonId) {
      document.getElementById('cancel-reason')?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      // A hung request must not leave the dialog spinning forever.
      const result = await withTimeout(
        runBulk('cancel', { ids: rows.map((r) => r.id), reasonId, note: note.trim() || null }),
        30_000,
      );
      bulkToast(result, 'cancelled', codesOf(rows));
      onDone(result);
      close(false);
    } catch (error) {
      const message = errorMessage(error, 'The server did not respond. Nothing was cancelled; try again.');
      setFailure(message);
      toast.error('Cancel failed', message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg" hideClose>
        <div className="flex items-center gap-3 rounded-t-lg bg-danger px-5 py-4 text-white">
          <Ban className="h-5 w-5 shrink-0" aria-hidden />
          <DialogTitle className="flex-1 text-base font-semibold">
            Are you sure you want to cancel {rows.length === 1 ? 'this order' : `${rows.length} orders`}?
          </DialogTitle>
          {/* White close on the danger header (the default dark icon is unreadable on red). */}
          <DialogClose
            aria-label="Close"
            className="rounded p-1 text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogClose>
        </div>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-sm text-body">
            Please select <strong>cancel reason</strong> for the selected order(s). Allocated inventory is
            released and each order gets a change-log entry.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="cancel-reason" className={labelClass}>
              Cancel reason{' '}
              <span className="text-danger" aria-hidden>
                *
              </span>
            </label>
            <Select
              id="cancel-reason"
              options={reasons.map((r) => ({ value: r.value, label: r.label }))}
              value={reasonId}
              onChange={(v) => {
                setReasonId(v);
                setTouched(true);
              }}
              placeholder={
                options.isPending
                  ? 'Loading reasons…'
                  : reasons.length
                    ? 'Select a cancel reason'
                    : 'No cancel reasons in Data Setup'
              }
              invalid={missing}
            />
            {missing ? (
              <p id="cancel-reason-error" className={errorTextClass}>
                Select a cancel reason to continue.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cancel-note" className={labelClass}>
              Note
            </label>
            <Textarea
              id="cancel-note"
              value={note}
              maxLength={500}
              showCount
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional context for the change log"
            />
          </div>
          <OrdersTable rows={rows} />
          {failure ? (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              Couldn&apos;t cancel: {failure}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
            Go back
          </Button>
          <DisabledReason reason={!reasonId ? 'Select a cancel reason' : null}>
            <Button
              variant="danger"
              onClick={() => void submit()}
              disabled={busy || !reasonId}
              aria-busy={busy}
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
              Cancel order{rows.length === 1 ? '' : 's'}
            </Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------- change warehouse */

export function ChangeWarehouseModal({
  rows,
  open,
  onOpenChange,
  onDone,
}: {
  readonly rows: readonly OrderRow[];
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly onDone: (r: BulkOutcome) => void;
}) {
  const options = useOrderOptions();
  const [warehouseId, setWarehouseId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [report, setReport] = React.useState<BulkOutcome | null>(null);
  const withJobs = rows.filter((r) => r.jobId);
  const n = rows.length;
  const close = (o: boolean) => {
    if (!o) {
      setWarehouseId(null);
      setReport(null);
    }
    onOpenChange(o);
  };
  const submit = async () => {
    if (!warehouseId) return;
    setBusy(true);
    try {
      const result = await runBulk('change-warehouse', { ids: rows.map((r) => r.id), warehouseId });
      onDone(result);
      if (result.failed.length > 0) setReport(result);
      else {
        bulkToast(result, 'moved', codesOf(rows));
        close(false);
      }
    } catch (error) {
      toast.error('Change warehouse failed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const codes = codesOf(rows);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md">
        <DialogHeader title="Change warehouse" />
        <DialogBody className="flex flex-col gap-4">
          {report ? (
            <>
              <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-body">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                {report.succeeded.length} of {n} moved · {report.failed.length} skipped
              </div>
              <ul className="ks-scroll max-h-48 divide-y divide-border overflow-auto rounded-md border border-border text-xs">
                {report.failed.map((f) => (
                  <li key={f.id} className="flex gap-3 px-3 py-1.5">
                    <span className="w-28 shrink-0 font-semibold">{codes.get(f.id)}</span>
                    <span className="text-secondary">{f.message}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="flex gap-3 rounded-md border border-warning/40 bg-warning-soft p-3">
                <Warehouse className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <p className="text-sm leading-5 text-body">
                  You are about to change {n} order{n === 1 ? "'s" : "s'"} warehouse. It may cause shortage
                  for orders. This operation does not cause any changes to the orders that have picking jobs.
                  {withJobs.length > 0 ? (
                    <strong className="block pt-1">
                      {withJobs.length} selected order{withJobs.length === 1 ? ' has' : 's have'} a job and
                      will be skipped.
                    </strong>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="cw-warehouse" className={labelClass}>
                  Warehouse{' '}
                  <span className="text-danger" aria-hidden>
                    *
                  </span>
                </label>
                <Select
                  id="cw-warehouse"
                  options={(options.data?.data.warehouses ?? []).map((w) => ({
                    value: w.value,
                    label: w.label,
                  }))}
                  value={warehouseId}
                  onChange={setWarehouseId}
                  placeholder="Select a warehouse"
                />
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {report ? (
            <Button variant="primary" onClick={() => close(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
                Cancel
              </Button>
              <DisabledReason reason={warehouseId ? null : 'Select a warehouse'}>
                <Button variant="primary" disabled={!warehouseId || busy} onClick={() => void submit()}>
                  {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                  Change warehouse
                </Button>
              </DisabledReason>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- backorder */

export function BackorderModal({
  rows,
  open,
  onOpenChange,
  onCreated,
}: {
  readonly rows: readonly OrderRow[];
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly onCreated: (parentIds: readonly string[], result: BulkOutcome, path: 'merge' | 'create') => void;
}) {
  const eligible = rows.filter((r) => r.status === 'Shortage' && Number(r.allocatedQuantity) > 0);
  const [busy, setBusy] = React.useState<'merge' | 'create' | null>(null);
  const run = async (path: 'merge' | 'create') => {
    setBusy(path);
    try {
      const result = await runBulk('backorder', { ids: eligible.map((r) => r.id) });
      bulkToast(result, 'back-ordered', codesOf(rows));
      onCreated(result.succeeded, result, path);
    } catch (error) {
      toast.error('Create backorder failed', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };
  const ineligible = rows.filter((r) => !eligible.includes(r));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <div className="relative overflow-hidden rounded-t-lg bg-gradient-to-br from-primary to-[#2448b8] px-6 py-6 text-white">
          <PackageOpen className="absolute -right-3 -top-3 h-24 w-24 opacity-15" aria-hidden />
          <p className="text-md font-semibold">Create backorder</p>
          <p className="mt-1 text-sm text-white/85">
            {eligible.length} of {rows.length} order{rows.length === 1 ? ' is' : 's are'} eligible for
            creating picking job and backorder
          </p>
        </div>
        <DialogBody className="flex flex-col gap-3">
          <p className="text-sm text-body">
            The allocated quantity stays on the original order and gets a picking job. The short quantity
            moves to a new back order that keeps the original as its master.
          </p>
          {ineligible.length > 0 ? (
            <ul className="ks-scroll max-h-36 divide-y divide-border overflow-auto rounded-md border border-border text-xs">
              {ineligible.map((r) => (
                <li key={r.id} className="flex gap-3 px-3 py-1.5">
                  <span className="w-28 shrink-0 font-semibold">{r.code}</span>
                  <span className="text-secondary">
                    {r.status !== 'Shortage'
                      ? `Only Shortage orders can be back-ordered; this order is ${r.status}.`
                      : 'Nothing is allocated yet; allocate stock first.'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <DisabledReason reason={eligible.length ? null : 'No selected order is eligible'}>
            <Button
              className="bg-[#EB8C00] text-white hover:bg-[#d27d00]"
              disabled={!eligible.length || busy !== null}
              onClick={() => void run('merge')}
            >
              {busy === 'merge' ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <GitMerge className="h-3.5 w-3.5" aria-hidden />
              )}
              Merge into existing job
            </Button>
          </DisabledReason>
          <DisabledReason reason={eligible.length ? null : 'No selected order is eligible'}>
            <Button
              variant="primary"
              disabled={!eligible.length || busy !== null}
              onClick={() => void run('create')}
            >
              {busy === 'create' ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <ListPlus className="h-3.5 w-3.5" aria-hidden />
              )}
              Create new job
            </Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------- return info drawer */

export function ReturnInfoDrawer({
  rows,
  open,
  onOpenChange,
  onDone,
}: {
  readonly rows: readonly OrderRow[];
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly onDone: (r: BulkOutcome) => void;
}) {
  const warehouseId =
    rows.length && rows.every((r) => r.warehouseId === rows[0]?.warehouseId)
      ? rows[0]?.warehouseId
      : undefined;
  const options = useOrderOptions(warehouseId);
  const [serviceId, setServiceId] = React.useState<string | null>(null);
  const [cost, setCost] = React.useState<number | null>(null);
  const [tracking, setTracking] = React.useState<readonly string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const dirty = Boolean(serviceId || cost !== null || tracking.length);
  const services = (options.data?.data.carriers ?? []).flatMap((c) =>
    c.services.map((s) => ({ value: s.id, label: `${c.carrierCode} · ${s.name}`, group: c.label })),
  );
  const reset = () => {
    setServiceId(null);
    setCost(null);
    setTracking([]);
  };
  const submit = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ids: rows.map((r) => r.id) };
      if (serviceId) body.returnCarrierServiceId = serviceId;
      if (cost !== null) body.returnShippingCost = cost;
      if (tracking.length) body.returnTrackingNumbers = tracking;
      const result = await runBulk('update-return-info', body);
      bulkToast(result, 'updated', codesOf(rows));
      onDone(result);
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error('Update return info failed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      dirty={dirty && !busy}
      title="Bulk update return info"
      description={`${rows.length} shipped order${rows.length === 1 ? '' : 's'} selected. Empty fields are left unchanged.`}
      width={35}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Link
            href="/imports/shipment-orders-update"
            className="text-xs font-medium text-primary hover:underline"
          >
            Import return info from Excel
          </Link>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <DisabledReason reason={dirty ? null : 'Enter at least one return field'}>
              <Button variant="primary" disabled={!dirty || busy} onClick={() => void submit()}>
                {busy ? <Spinner className="h-3.5 w-3.5" /> : null}Update
              </Button>
            </DisabledReason>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-md bg-primary-soft px-3 py-2 text-xs text-body">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          Return info is used by return labels and RMAs created from these orders.
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ri-service" className={labelClass}>
            Return carrier and shipping option
          </label>
          <Select
            id="ri-service"
            options={services}
            value={serviceId}
            onChange={setServiceId}
            placeholder={
              options.isPending
                ? 'Loading carrier services…'
                : !warehouseId
                  ? 'Select orders from one warehouse to set a service'
                  : services.length
                    ? 'Select a service'
                    : 'No carrier services for this warehouse'
            }
            disabled={options.isPending || !warehouseId}
            clearable
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ri-cost" className={labelClass}>
            Return shipping cost
          </label>
          <NumberInput id="ri-cost" value={cost} onChange={setCost} min={0} decimals={2} suffix="USD" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ri-tracking" className={labelClass}>
            Return tracking numbers
          </label>
          <ChipInput
            id="ri-tracking"
            value={tracking}
            onChange={setTracking}
            placeholder="Enter and add tracking number"
            maxItems={50}
            maxLength={100}
          />
        </div>
        <ul
          className={cn(
            'ks-scroll max-h-48 divide-y divide-border overflow-auto rounded-md border border-border text-xs',
          )}
        >
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="font-semibold">{r.code}</span>
              <OrderStatusPill status={r.status} size="sm" />
            </li>
          ))}
        </ul>
      </div>
    </Drawer>
  );
}
