'use client';

/**
 * Shipment Plan detail (`/shipment-plans/[id]`, KitStaks addition): header with the status
 * popover and every plan action, lifecycle stepper + loading progress, the plan facts, the
 * orders with live statuses (add / remove in place), the plan's LPs and the timeline.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  Minus,
  Edit3,
  FileText,
  History,
  ListPlus,
  PackagePlus,
  ScanBarcode,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { formatGridDateTime as formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ShipmentPlanStatus } from '@/lib/enums';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { StatRow, StatTile } from '@kitstak/ui/dashboard';
import { InfoTip } from '@/components/ui/info-tip';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { UnderlineTabs } from '@/components/ui/tabs';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { DetailHeader, KvList } from '@/components/shared';
import { PlanChangeLogDrawer } from './plan-change-log-drawer';
import { PlanOrderPicker } from './plan-order-picker';
import { errorMessage, useHydratedPermissions } from '@/components/shipping/shipping-client';
import { CreateLabelDialog } from '@/components/shipping/create-label-dialog';
import { PlanDrawer } from './plan-drawer';
import {
  deriveFromOrders,
  expectedLoad,
  lifecycleSteps,
  planProgressNote,
  shippedTileNote,
} from './plan-form-model';
import { PlanTimeline } from './plan-timeline';
import {
  LOADED_ORDER_STATUSES,
  reachedPlanStages,
  unlabeledLabel,
} from '@/lib/grid-defs/shipping/shipment-plans';
import { usePlanActions } from './plan-actions';
import { PlanStatusPopover } from './plan-status-popover';
import { planDetailKey, useInvalidatePlans, type PlanDetail, type PlanOrderRow } from './plans-client';

function DerivedValue({
  value,
  hint,
}: {
  readonly value: string | null | undefined;
  readonly hint: string | null | undefined;
}) {
  if (!value) return <span className="text-faint">None</span>;
  return (
    <span className="block min-w-0 break-words pr-1" title={hint ? `${value} (${hint})` : value}>
      {value}
      {hint ? <span className="ml-1 text-2xs text-faint">({hint.length > 40 ? 'mixed' : hint})</span> : null}
    </span>
  );
}
function Derived({
  plan,
  orders,
}: {
  readonly plan: string | null | undefined;
  readonly orders: readonly (string | null | undefined)[];
}) {
  const d = deriveFromOrders(plan, orders);
  return <DerivedValue value={d.value} hint={d.hint} />;
}
const dt = (v: unknown) => (typeof v === 'string' && v ? formatDateTime(v) : null);

function ExpectedLoadTile({ plan }: { readonly plan: PlanDetail }) {
  const load = expectedLoad({
    storedWeightLb: Number(plan.expectedTotalWeight ?? 0),
    storedVolumeFt3: Number(plan.expectedTotalVolume ?? 0),
    lineWeightLb: Number(plan.orderWeightLb ?? 0),
    lineVolumeFt3: Number(plan.orderVolumeFt3 ?? 0),
    missingDimsProducts: Number(plan.missingDimsProducts ?? 0),
    unitCount: Number(plan.unitCount ?? 0),
  });
  return (
    <StatTile
      label="Expected load"
      value={`${load.weightLb.toFixed(2)} lb`}
      href={null}
      caption={
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words">
            {load.volumeFt3.toFixed(2)} ft³ · {load.sourceLabel}
          </span>
          {load.detail ? <span className="whitespace-normal break-words">{load.detail}</span> : null}
          {load.warning ? (
            <span className="flex items-start gap-1 whitespace-normal break-words text-warning" role="note">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {load.warning}
            </span>
          ) : null}
        </span>
      }
    />
  );
}

/**
 * Stepper: a stage with a stamped time (loading started / completed, shipped) or a change-log transition is
 * done and shows its time; only a stage with neither, that the plan went past, reads "Skipped".
 */
function Lifecycle({
  status,
  reached,
  stamps,
}: {
  readonly status: ShipmentPlanStatus;
  readonly reached: ReadonlySet<string>;
  readonly stamps: Readonly<Partial<Record<ShipmentPlanStatus, string | null>>>;
}) {
  if (status === 'Cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
        <X className="h-4 w-4" aria-hidden />
        This plan was cancelled. Its orders were released.
      </div>
    );
  }
  const steps = lifecycleSteps(status, reached, stamps);
  return (
    <ol className="flex items-start gap-1" aria-label="Plan lifecycle">
      {steps.map((st, i) => {
        const { stage: s, state, at: stamp } = st;
        const skipped = state === 'skipped';
        const done = state === 'done';
        const current = state === 'current';
        return (
          <li
            key={s}
            className="flex min-w-0 flex-1 items-start gap-1"
            aria-current={current ? 'step' : undefined}
            data-stage={s}
            data-state={state}
          >
            <span
              title={skipped ? `${s} was skipped: the plan went straight past this stage` : undefined}
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold',
                skipped
                  ? 'border-dashed border-border-strong text-faint'
                  : done
                    ? 'border-success bg-success text-white'
                    : current
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border text-faint',
              )}
            >
              {skipped ? (
                <Minus className="h-3.5 w-3.5" aria-hidden />
              ) : done ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                i + 1
              )}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span
                className={cn(
                  'truncate pt-1 text-xs',
                  current ? 'font-semibold text-foreground' : skipped ? 'text-faint' : 'text-secondary',
                )}
              >
                {s}
                {skipped ? <span className="sr-only"> (skipped)</span> : null}
              </span>
              {stamp ? (
                <span className="truncate text-2xs tabular-nums text-faint" title={formatDateTime(stamp)}>
                  {formatDateTime(stamp)}
                </span>
              ) : skipped ? (
                <span aria-hidden className="text-2xs text-faint">
                  Skipped
                </span>
              ) : null}
            </span>
            {i < steps.length - 1 ? (
              <span className={cn('mx-1 mt-3 h-px flex-1', done ? 'bg-success' : 'bg-border')} aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function OrdersSection({
  plan,
  canEdit,
  onChanged,
}: {
  readonly plan: PlanDetail;
  readonly canEdit: boolean;
  readonly onChanged: () => void;
}) {
  const [picking, setPicking] = React.useState(false);
  const [labeling, setLabeling] = React.useState(false);
  const canLabel = useHydratedPermissions().has('fulfillment.shipment_orders.create_label');
  const labelReason =
    plan.status === 'Cancelled'
      ? 'This plan was cancelled'
      : plan.orders.length === 0
        ? 'Add orders to the plan first'
        : null;
  const [removing, setRemoving] = React.useState<PlanOrderRow | null>(null);
  const editReason = !canEdit ? "You don't have permission to edit shipment plans" : plan.editBlockedReason;
  // Shipped and cancelled plans are final: no row-level remove at all.
  const terminal = plan.status === 'Shipped' || plan.status === 'Cancelled';
  const call = async (method: 'POST' | 'DELETE', orderIds: readonly string[], verb: string) => {
    try {
      const row = await apiFetch<{ orderCount: number }>(
        `/api/shipment-plans/${encodeURIComponent(plan.id)}/orders`,
        { method, body: { orderIds } },
      );
      toast.success(
        'Success',
        `${plural(orderIds.length, 'order')} ${verb}. The plan now has ${plural(row.orderCount, 'order')}.`,
      );
      onChanged();
    } catch (error) {
      toast.error(
        method === 'POST' ? "Couldn't add the orders" : "Couldn't remove the order",
        errorMessage(error),
      );
    }
  };
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">
          Orders <span className="ml-1 text-secondary">{plan.orders.length}</span>
        </h2>
        <span className="flex items-center gap-2">
          {canLabel && plan.status !== 'Shipped' ? (
            <DisabledReason reason={labelReason}>
              <Button
                size="sm"
                variant="secondary"
                disabled={Boolean(labelReason)}
                onClick={() => setLabeling(true)}
                data-testid="plan-create-label"
              >
                <ScanBarcode className="h-3.5 w-3.5" aria-hidden />
                Create label for order(s)
              </Button>
            </DisabledReason>
          ) : null}
          {canEdit && !terminal ? (
            <DisabledReason reason={editReason}>
              <Button
                size="sm"
                variant="secondary"
                disabled={Boolean(editReason)}
                onClick={() => setPicking(true)}
              >
                <PackagePlus className="h-3.5 w-3.5" aria-hidden />
                Add order(s)
              </Button>
            </DisabledReason>
          ) : null}
        </span>
      </header>
      {plan.orders.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-secondary">
          {canEdit && !terminal
            ? 'No order added yet. Add orders to start loading this truck.'
            : 'No orders on this plan.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-2xs font-semibold text-faint">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-2">Order status</th>
                <th className="px-2">Plan status</th>
                <th className="px-2">Customer</th>
                <th className="px-2">Carrier / service</th>
                <th className="px-2 text-right">Qty</th>
                {canEdit && !terminal ? (
                  <th className="w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {plan.orders.map((o) => (
                <tr key={String(o.id)} className="border-t border-border">
                  <td className="px-4 py-2">
                    <Link
                      className="font-semibold text-primary hover:underline"
                      href={`/orders/${encodeURIComponent(String(o.orderCode))}`}
                    >
                      {String(o.orderCode)}
                    </Link>
                  </td>
                  <td className="px-2">
                    <StatusPill status={String(o.orderStatus)} domain="shipmentOrder" />
                  </td>
                  <td className="px-2">
                    <StatusPill status={String(o.planStatus)} domain="shipmentPlan" size="sm" />
                  </td>
                  <td className="truncate px-2">{String(o.customerName ?? 'None')}</td>
                  <td className="truncate px-2">
                    {[o.orderCarrier, o.shippingService].filter(Boolean).join(' · ') || 'None'}
                  </td>
                  <td className="px-2 text-right tabular-nums">{String(o.totalQuantity ?? 0)}</td>
                  {canEdit && !terminal ? (
                    <td className="px-2">
                      <DisabledReason
                        reason={
                          editReason ??
                          (o.planStatus === 'Shipped' ? 'Shipped orders stay on the plan' : null)
                        }
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${String(o.orderCode)}`}
                          disabled={Boolean(editReason) || o.planStatus === 'Shipped'}
                          onClick={() => setRemoving(o)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </DisabledReason>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {picking ? (
        <PlanOrderPicker
          open
          onOpenChange={(o) => (o ? undefined : setPicking(false))}
          title={`Add order(s) to ${plan.code}`}
          warehouseId={plan.warehouseId}
          clientId={plan.clientId}
          planId={plan.id}
          excludeIds={plan.orders.map((o) => o.orderId)}
          onConfirm={async (ids) => {
            await call('POST', ids, 'added');
            setPicking(false);
          }}
        />
      ) : null}
      <CreateLabelDialog
        open={labeling}
        onOpenChange={setLabeling}
        planId={plan.id}
        title={`Create label for ${plan.code} order(s)`}
        onDone={onChanged}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => (o ? undefined : setRemoving(null))}
        variant="danger"
        title={`Remove ${String(removing?.orderCode ?? '')} from ${plan.code}?`}
        description="The order leaves this plan and can join another one. The order itself is not changed."
        cancelLabel="No"
        confirmLabel="Yes, remove"
        onConfirm={() => (removing ? call('DELETE', [removing.orderId], 'removed') : undefined)}
      />
    </section>
  );
}

const isGone = (status: string): boolean => ['Shipped', 'Partially Shipped', 'Delivered'].includes(status);

function LpsSection({ plan }: { readonly plan: PlanDetail }) {
  // Orders with no LP row: picked as loose units (or not allocated to an LP yet).
  const withLp = new Set(plan.lps.map((l) => String(l.orderId)));
  const loose = plan.orders.filter((o) => !withLp.has(String(o.orderId)));
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">
          License plates <span className="ml-1 text-secondary">{plan.lps.length}</span>
        </h2>
        <Link
          href={`/shipment-plans/lps?f.planCode=eq:${encodeURIComponent(plan.code)}`}
          className="text-xs text-primary hover:underline"
        >
          Open in Plan LPs
        </Link>
      </header>
      {loose.length > 0 ? (
        <p className="border-b border-border bg-surface-sunken px-4 py-2 text-xs text-secondary">
          <span className="font-semibold text-foreground">
            {loose.length === 1 ? '1 order' : `${loose.length} orders`} without a license plate:
          </span>{' '}
          {loose
            .map(
              (o) =>
                `${String(o.orderCode)} (${isGone(String(o.orderStatus)) ? 'shipped loose' : 'not on an LP yet'})`,
            )
            .join(', ')}
        </p>
      ) : null}
      {plan.lps.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-secondary">
          {plan.orders.length === 0
            ? 'No orders on this plan.'
            : 'No license plates were used for these orders.'}
        </p>
      ) : (
        <ul className="divide-y divide-border text-xs">
          {plan.lps.map((l) => (
            <li key={String(l.id)} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="font-semibold">
                {String(l.lpNumber)}
                {l.parentLpNumber ? (
                  <span className="ml-2 font-normal text-secondary">in {String(l.parentLpNumber)}</span>
                ) : null}
              </span>
              <span className="text-secondary">{String(l.orderCode)}</span>
              <span className="tabular-nums text-secondary">
                {typeof l.weight === 'number' && l.weight > 0 ? (
                  `${l.weight.toFixed(2)} lb`
                ) : (
                  <span title="This license plate was never weighed and its contents have no product weight">
                    No weight
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlanDetailPage({ id }: { readonly id: string }) {
  const router = useRouter();
  const invalidate = useInvalidatePlans();
  const q = useApiQuery<PlanDetail>(planDetailKey(id), `/api/shipment-plans/${encodeURIComponent(id)}`, {
    staleTime: 0,
  });
  const [editing, setEditing] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const [tab, setTab] = React.useState<'orders' | 'lps' | 'history'>('orders');
  const refetch = () => {
    invalidate();
    void q.refetch();
  };
  const a = usePlanActions({ onChanged: refetch, onDeleted: () => router.push('/shipment-plans') });

  if (q.isError) {
    const missing = q.error.status === 404;
    return (
      <div className="px-6 py-10">
        <EmptyState
          title={missing ? 'Shipment plan not found' : "Couldn't load this shipment plan"}
          description={
            missing
              ? "It may have been deleted, or it belongs to a warehouse you can't access."
              : q.error.message
          }
          action={
            missing ? (
              <Link href="/shipment-plans" className="text-primary hover:underline">
                Back to Shipment Plan
              </Link>
            ) : (
              <Button onClick={() => void q.refetch()}>Retry</Button>
            )
          }
        />
      </div>
    );
  }
  const p = q.data?.data;
  if (!p)
    return (
      <div className="flex flex-col gap-4 px-6 py-6">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  const units = p.orders.reduce((s, o) => s + Number(o.totalQuantity ?? 0), 0);
  const loadedStatuses: readonly string[] = LOADED_ORDER_STATUSES;
  // Same rule as the server's loadedPercent: Ready to Ship or already shipped counts as loaded.
  const loadedCount = p.orders.filter((o) => loadedStatuses.includes(String(o.orderStatus ?? ''))).length;
  const progressNote = planProgressNote(p.status, p.orderCount, p.shippedCount);
  const loadMismatch =
    (p.status === 'Loading Started' || p.status === 'Loading Completed') && p.loadedCount < p.orderCount
      ? `${p.orderCount - p.loadedCount} of ${p.orderCount} orders not Ready to Ship`
      : null;
  const shipBlocked = a.can.ship ? p.shipBlockedReason : null;
  return (
    <div className="flex flex-col gap-5 px-6 pb-10 pt-4">
      <div className="flex flex-col gap-1">
        <Breadcrumbs
          items={[
            { label: 'Fulfillment' },
            { label: 'Shipment Plan', href: '/shipment-plans' },
            { label: p.code },
          ]}
        />
        <DetailHeader
          title={p.code}
          backHref="/shipment-plans"
          backLabel="Shipment Plan"
          badges={
            <span className="flex flex-wrap items-center gap-2">
              <PlanStatusPopover
                status={p.status}
                nextStatuses={p.nextStatuses}
                disabledReason={a.statusReason(p)}
                canChange={a.can.status}
                blocked={p.statusBlocks}
                extras={[a.departExtra(p)].filter((x): x is NonNullable<typeof x> => x !== null)}
                onPick={(s) => a.requestStatus(p, s)}
              />
              {progressNote ? (
                <span
                  className="rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-2xs font-semibold text-warning"
                  title="Some orders on this plan already shipped. The plan becomes Shipped when the rest ship."
                >
                  {progressNote}
                </span>
              ) : null}
              {p.unlabeledReadyCount > 0 && p.status !== 'Shipped' && p.status !== 'Cancelled' ? (
                <span
                  role="status"
                  className="rounded-full border border-danger/40 bg-danger-soft px-2 py-0.5 text-2xs font-semibold text-danger"
                  title={`${unlabeledLabel(p.unlabeledReadyCount, p.unlabeledReadyCodes)}. Ship skips orders without an active label.`}
                >
                  {p.unlabeledReadyCount === 1
                    ? '1 order has no label'
                    : `${p.unlabeledReadyCount} orders have no label`}
                </span>
              ) : null}
              {loadMismatch ? (
                <span
                  role="status"
                  className="rounded-full border border-danger/40 bg-danger-soft px-2 py-0.5 text-2xs font-semibold text-danger"
                  title="The plan is loading but some orders are not packed and Ready to Ship. Ship skips them."
                >
                  {loadMismatch}
                </span>
              ) : null}
            </span>
          }
          meta={
            <span>
              {p.warehouseCode as string}
              {p.clientName ? ` · ${String(p.clientName)}` : ''} · created {dt(p.createdAt)}
            </span>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <DisabledReason reason={a.deleteReason([p])}>
                <Button
                  variant="ghost"
                  className={a.deleteReason([p]) ? 'text-faint' : 'text-danger hover:bg-danger-soft'}
                  disabled={Boolean(a.deleteReason([p]))}
                  onClick={() => a.requestDelete([p])}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete
                </Button>
              </DisabledReason>
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
              <Button variant="ghost" onClick={() => setLog(true)}>
                <History className="h-3.5 w-3.5" aria-hidden />
                Change log
              </Button>
              <DisabledReason reason={a.printReason([p])}>
                <Button
                  variant="secondary"
                  disabled={Boolean(a.printReason([p]))}
                  onClick={() => a.print([p])}
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Manifest / BOL
                </Button>
              </DisabledReason>
              <DisabledReason reason={a.jobsReason([p])}>
                <Button
                  variant="secondary"
                  disabled={Boolean(a.jobsReason([p]))}
                  onClick={() => a.openJobs([p])}
                >
                  <ListPlus className="h-3.5 w-3.5" aria-hidden />
                  Picking/job operations
                </Button>
              </DisabledReason>
              <DisabledReason
                reason={
                  !a.can.edit ? "You don't have permission to edit shipment plans" : p.editBlockedReason
                }
              >
                <Button
                  variant="secondary"
                  disabled={!a.can.edit || Boolean(p.editBlockedReason)}
                  onClick={() => setEditing(true)}
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden />
                  Edit
                </Button>
              </DisabledReason>
              <DisabledReason reason={a.shipReason([p])}>
                <Button disabled={Boolean(a.shipReason([p]))} onClick={() => a.requestShip([p])}>
                  <Truck className="h-3.5 w-3.5" aria-hidden />
                  Ship
                </Button>
              </DisabledReason>
            </div>
          }
        />
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
        <Lifecycle
          status={p.status}
          reached={reachedPlanStages(
            p.status,
            p.timeline.map((t) => t.message),
          )}
          stamps={{
            'Loading Started': p.loadingStartedAt as string | null,
            'Loading Completed': p.loadingCompletedAt as string | null,
            Shipped: (p.actualShipmentAt ?? p.truckDepartedAt) as string | null,
          }}
        />
        {shipBlocked && p.status !== 'Shipped' && p.status !== 'Cancelled' ? (
          <p className="mt-3 border-t border-border pt-3 text-xs text-secondary">
            <span className="font-semibold text-foreground">Ship is unavailable:</span> {shipBlocked}
          </p>
        ) : null}
      </div>
      <StatRow label="Plan totals">
        <StatTile label="Orders" value={p.orderCount} href={null} caption={plural(units, 'unit')} />
        <StatTile
          label="Loaded"
          value={`${p.loadedPercent}%`}
          href={null}
          caption={
            <span className="flex w-full flex-col gap-1">
              <span>
                {loadedCount} of {p.orderCount} ready or shipped
              </span>
              <ProgressBar
                value={p.loadedPercent}
                size="sm"
                tone={p.loadedPercent === 100 ? 'success' : 'data'}
                label="Loading progress"
              />
            </span>
          }
          explain={
            <InfoTip
              content="Orders that are Ready to Ship or already shipped, out of all orders on the plan."
              label="About loaded"
            />
          }
        />
        <StatTile
          label="Shipped"
          value={`${p.shippedCount} of ${p.orderCount}`}
          href={null}
          caption={shippedTileNote(p.shippedCount, p.orderCount, dt(p.actualShipmentAt))}
        />
        <ExpectedLoadTile plan={p} />
      </StatRow>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <UnderlineTabs
            ariaLabel="Plan sections"
            className="px-0"
            active={tab}
            onChange={(k) => setTab(k as typeof tab)}
            tabs={[
              { key: 'orders', label: 'Orders', count: p.orderCount },
              { key: 'lps', label: 'License plates', count: p.lps.length },
              { key: 'history', label: 'History' },
            ]}
          />
          {tab === 'orders' ? <OrdersSection plan={p} canEdit={a.can.edit} onChanged={refetch} /> : null}
          {tab === 'lps' ? <LpsSection plan={p} /> : null}
          {tab === 'history' ? (
            <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold">History</h2>
                <Button size="sm" variant="ghost" onClick={() => setLog(true)}>
                  Open full change log
                </Button>
              </div>
              <PlanTimeline planId={p.id} limit={100} />
            </section>
          ) : null}
        </div>
        <div className="flex flex-col gap-5">
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-3 text-base font-semibold">Plan details</h2>
            <KvList
              columns={1}
              layout="inline"
              items={[
                {
                  key: 'carrier',
                  label: 'Carrier',
                  value: (
                    <Derived
                      plan={p.carrierName}
                      orders={p.orders.map((o) =>
                        [o.orderCarrier, o.shippingService].filter(Boolean).join(' · '),
                      )}
                    />
                  ),
                },
                { key: 'truck', label: 'Truck plate', value: p.truckPlateNumber },
                { key: 'gate', label: 'Loading gate', value: p.loadingGate as string | null },
                { key: 'planned', label: 'Planned shipment', value: dt(p.plannedShipmentAt) },
                { key: 'ls', label: 'Loading started', value: dt(p.loadingStartedAt) },
                { key: 'lc', label: 'Loading completed', value: dt(p.loadingCompletedAt) },
                { key: 'td', label: 'Truck departed', value: dt(p.truckDepartedAt) },
                { key: 'actual', label: 'Actual shipment', value: dt(p.actualShipmentAt) },
                {
                  key: 'customer',
                  label: 'Customer',
                  value: <DerivedValue value={p.customerName as string | null} hint={p.customerNameHint} />,
                },
                {
                  key: 'address',
                  label: 'Customer address',
                  value: <DerivedValue value={p.customerAddress} hint={p.customerAddressHint} />,
                },
                { key: 'retailer', label: 'Retailer', value: p.retailerName as string | null },
                {
                  key: 'lpn',
                  label: 'Prevent LPN edit',
                  value: p.preventLpnEditDuringLoading ? 'Yes' : 'No',
                },
                { key: 'note', label: 'Note', value: p.note },
              ]}
            />
          </section>
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-3 text-base font-semibold">Timeline</h2>
            <PlanTimeline planId={p.id} />
          </section>
        </div>
      </div>
      {editing ? (
        <PlanDrawer
          open
          onOpenChange={(o) => (o ? undefined : setEditing(false))}
          editId={p.id}
          onSaved={refetch}
        />
      ) : null}
      {log ? (
        <PlanChangeLogDrawer
          open
          onOpenChange={(o) => (o ? undefined : setLog(false))}
          entityId={p.id}
          entityCode={p.code}
        />
      ) : null}
      {a.dialogs}
    </div>
  );
}
