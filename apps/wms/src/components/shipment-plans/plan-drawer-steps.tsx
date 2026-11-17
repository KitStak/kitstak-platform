'use client';

/** The three steps of the Shipment Plan drawer: General, Others, Orders. */
import * as React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Calculator, PackagePlus, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import type { ShipmentPlanStatus } from '@/lib/enums';
import { editableLifecycleTimes } from '@/lib/grid-defs/shipping/shipment-plans';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormGrid, FormGridFull, FormSection } from '@/components/ui/form';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { ClientSelect, CustomerPicker, CustomFieldsSection, WarehouseSelect } from '@/components/shared';
import { PlanOrderPicker } from './plan-order-picker';
import type { EligibleOrderRow } from '@/server/repositories/shipment-plans-lists';
import {
  ComboField,
  CustomField,
  DateTimeField,
  GatePicker,
  NoteInput,
  NumberField,
  SelectField,
  TextInput,
  YesNoField,
} from './plan-form-controls';
import { totalsFollowOrders, type PlanFormValues, type PlanOrderItem } from './plan-form-model';
import type { PlanFormOptions } from './plans-client';

type F = PlanFormValues;

export interface Estimate {
  readonly weightLb: number;
  readonly volumeFt3: number;
  readonly units: number;
  readonly orders: number;
}

export async function fetchEstimate(orderIds: readonly string[]): Promise<Estimate> {
  return apiFetch<Estimate>('/api/shipment-plans/estimate', { query: { orderIds: orderIds.join(',') } });
}

export function usePlanOptions(warehouseId: string | null, customerId: string | null) {
  return useApiQuery<PlanFormOptions>(
    ['shipment-plan-options', warehouseId ?? '', customerId ?? ''],
    '/api/shipment-plans/options',
    {
      query: { warehouseId: warehouseId || undefined, customerId: customerId || undefined },
      staleTime: 30_000,
    },
  );
}

export function GeneralStep({
  form,
  statuses,
  isEdit,
  lastEstimate,
  onApplyEstimate,
}: {
  readonly form: UseFormReturn<F>;
  readonly statuses: readonly ShipmentPlanStatus[];
  readonly isEdit: boolean;
  readonly lastEstimate: Estimate | null;
  readonly onApplyEstimate: () => void;
}) {
  const warehouseId = form.watch('warehouseId') || null;
  const orders = form.watch('orders');
  const options = usePlanOptions(warehouseId, null);
  const carriers = options.data?.data.carriers ?? [];
  const hasOrders = orders.length > 0;
  // Lifecycle times open for correction once the stored status reached their stage.
  const editableTimes = editableLifecycleTimes(
    isEdit ? String(form.formState.defaultValues?.status ?? 'Open') : 'Open',
  );
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Plan">
        <FormGrid>
          <TextInput<F>
            name="code"
            label="Shipment plan code"
            required
            maxLength={40}
            info="Generated from the SP sequence; change it if you have your own load number."
          />
          <CustomField<F>
            name="warehouseId"
            label="Warehouse"
            required
            info={hasOrders ? "Remove the plan's orders to change the warehouse" : undefined}
          >
            {(c) => (
              <WarehouseSelect
                id={c.id}
                value={c.value}
                invalid={c.invalid}
                onBlur={c.onBlur}
                disabled={hasOrders}
                clearable={false}
                onChange={(v) => {
                  c.onChange(v ?? '');
                  form.setValue('carrierConnectionId', null);
                  form.setValue('loadingGateLocationId', null);
                  form.setValue('loadingGateLabel', '');
                }}
              />
            )}
          </CustomField>
          <CustomField<F>
            name="clientId"
            label="Client"
            info="Optional. When set, only this client's orders can join the plan."
          >
            {(c) => (
              <ClientSelect
                id={c.id}
                value={c.value}
                warehouseId={warehouseId}
                invalid={c.invalid}
                onBlur={c.onBlur}
                disabled={hasOrders}
                clearable
                onChange={(v) => {
                  c.onChange(v);
                  form.setValue('customerId', null);
                  form.setValue('customerAddressId', null);
                }}
              />
            )}
          </CustomField>
          <ComboField<F>
            name="carrierConnectionId"
            label="Carrier"
            options={carriers}
            placeholder={
              !warehouseId
                ? 'Select a warehouse first'
                : carriers.length
                  ? 'Select carrier'
                  : 'No carriers set up for this warehouse'
            }
            disabled={!warehouseId}
            emptyText="No carriers for this warehouse"
          />
          <TextInput<F>
            name="truckPlateNumber"
            label="Truck plate number"
            maxLength={40}
            placeholder="e.g. 7KTR412"
          />
          <CustomField<F>
            name="loadingGateLocationId"
            label="Loading gate"
            info="A location in a Loading or Shipment area of the warehouse."
          >
            {(c) => (
              <GatePicker
                id={c.id}
                value={c.value}
                selectedLabel={form.watch('loadingGateLabel') || undefined}
                warehouseId={warehouseId}
                invalid={c.invalid}
                onBlur={c.onBlur}
                disabled={!warehouseId}
                placeholder={warehouseId ? 'Search a dock or staging location' : 'Select a warehouse first'}
                onChange={(v, item) => {
                  c.onChange(v);
                  form.setValue('loadingGateLabel', item ? String(item.label) : '');
                }}
              />
            )}
          </CustomField>
          <SelectField<F>
            name="status"
            label="Status"
            required
            disabled={!isEdit}
            options={statuses.map((s) => ({ value: s, label: s }))}
            info={
              isEdit
                ? 'Only the legal next statuses are offered. Use Ship to ship the plan.'
                : 'A new plan always starts as Open. Its status moves through the lifecycle after it is saved.'
            }
          />
          <YesNoField<F>
            name="preventLpnEditDuringLoading"
            label="Prevent LPN edit during loading"
            info="Locks the plan's license plates while the truck is being loaded."
          />
        </FormGrid>
      </FormSection>
      <FormSection title="Schedule">
        <FormGrid>
          <DateTimeField<F> name="plannedShipmentAt" label="Planned shipment date" />
          {isEdit ? (
            <>
              <DateTimeField<F>
                name="actualShipmentAt"
                label="Actual shipment date"
                disabled
                info="Set automatically when the plan ships."
              />
              <DateTimeField<F>
                name="loadingStartedAt"
                label="Loading started date"
                disabled={!editableTimes.has('loadingStartedAt')}
                info={
                  editableTimes.has('loadingStartedAt')
                    ? 'Stamped when loading started. Correct it if the dock recorded a different time; the change is logged.'
                    : 'Set automatically when the status moves to Loading Started.'
                }
              />
              <DateTimeField<F>
                name="loadingCompletedAt"
                label="Loading completed date"
                disabled={!editableTimes.has('loadingCompletedAt')}
                info={
                  editableTimes.has('loadingCompletedAt')
                    ? 'Stamped when loading completed. Correct it if needed; the change is logged.'
                    : 'Set automatically when the status moves to Loading Completed.'
                }
              />
              <DateTimeField<F>
                name="truckDepartedAt"
                label="Truck departed date"
                disabled={!editableTimes.has('truckDepartedAt')}
                info={
                  editableTimes.has('truckDepartedAt')
                    ? 'Enter when the truck left the gate. Ship stamps it if it is still empty.'
                    : 'Can be entered once loading is completed. Ship stamps it automatically.'
                }
              />
            </>
          ) : (
            <p className="col-span-full text-xs text-secondary">
              Loading, departure and actual shipment times are recorded automatically as the plan moves
              through its lifecycle.
            </p>
          )}
        </FormGrid>
      </FormSection>
      <FormSection title="Load">
        <FormGrid>
          <NumberField<F> name="expectedTotalWeight" label="Expected total weight" decimals={2} suffix="lb" />
          <NumberField<F>
            name="expectedTotalVolume"
            label="Expected total volume"
            decimals={2}
            suffix="ft³"
          />
          <FormGridFull>
            <div className="flex items-center justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2 text-xs text-secondary">
              <span className="flex items-center gap-1.5">
                <Calculator className="h-3.5 w-3.5" aria-hidden />
                {lastEstimate && hasOrders
                  ? `From ${lastEstimate.orders} ${lastEstimate.orders === 1 ? 'order' : 'orders'} (${lastEstimate.units} units): ${lastEstimate.weightLb} lb · ${lastEstimate.volumeFt3} ft³`
                  : 'Totals are computed from the orders you add on the Orders step.'}
              </span>
              <DisabledReason reason={hasOrders ? null : 'Add orders first'}>
                <Button size="sm" variant="ghost" disabled={!hasOrders} onClick={onApplyEstimate}>
                  Use order totals
                </Button>
              </DisabledReason>
            </div>
          </FormGridFull>
          <FormGridFull>
            <NoteInput<F> name="note" label="Note" maxLength={2000} />
          </FormGridFull>
        </FormGrid>
      </FormSection>
    </div>
  );
}

export function OthersStep({
  form,
  canManageFields,
}: {
  readonly form: UseFormReturn<F>;
  readonly canManageFields: boolean;
}) {
  const clientId = form.watch('clientId');
  const customerId = form.watch('customerId');
  const options = usePlanOptions(form.watch('warehouseId') || null, customerId);
  const addresses = options.data?.data.addresses ?? [];
  const retailers = options.data?.data.retailers ?? [];
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Consignee">
        <FormGrid>
          <CustomField<F> name="customerId" label="Customer" info="Type at least 3 characters to search.">
            {(c) => (
              <CustomerPicker
                id={c.id}
                aria-label="Customer"
                value={c.value}
                clientId={clientId}
                selectedLabel={form.watch('customerLabel') || undefined}
                invalid={c.invalid}
                onBlur={c.onBlur}
                onChange={(v, item) => {
                  c.onChange(v);
                  form.setValue('customerLabel', item?.label ?? '');
                  form.setValue('customerAddressId', null);
                }}
              />
            )}
          </CustomField>
          <ComboField<F>
            name="customerAddressId"
            label="Customer address"
            options={addresses}
            disabled={!customerId}
            placeholder={
              !customerId
                ? 'Select a customer first'
                : addresses.length
                  ? 'Select address'
                  : 'This customer has no addresses'
            }
            emptyText="No addresses"
          />
          <ComboField<F>
            name="retailerId"
            label="Retailer"
            options={retailers}
            placeholder="Select retailer"
            emptyText="No retailers"
          />
        </FormGrid>
      </FormSection>
      <CustomFieldsSection
        entityType="shipment_plan"
        canManage={canManageFields}
        values={form.watch('customFields')}
        onChange={(v) => form.setValue('customFields', { ...v }, { shouldDirty: true })}
      />
    </div>
  );
}

function OrdersTable({
  orders,
  selected,
  onToggle,
  onToggleAll,
}: {
  readonly orders: readonly PlanOrderItem[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onToggleAll: () => void;
}) {
  const all = orders.length > 0 && orders.every((o) => selected.has(o.id));
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
          <tr>
            <th className="w-9 px-3 py-2">
              <Checkbox aria-label="Select all orders" checked={all} onCheckedChange={onToggleAll} />
            </th>
            <th className="px-2 py-2">Order code</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-3 py-2 text-right">Total qty</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t border-border">
              <td className="px-3 py-1.5">
                <Checkbox
                  aria-label={`Select ${o.code}`}
                  checked={selected.has(o.id)}
                  onCheckedChange={() => onToggle(o.id)}
                />
              </td>
              <td className="px-2 py-1.5 font-semibold">{o.code}</td>
              <td className="px-2 py-1.5">
                <StatusPill status={o.status} domain="shipmentOrder" />
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{o.totalQuantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Picked, packed and labelled (or already gone): Ship can move it. */
export const isShipReady = (status: string): boolean =>
  ['Ready to Ship', 'Shipped', 'Partially Shipped', 'Delivered'].includes(status);

export function OrdersStep({
  form,
  planId,
  lastEstimate,
  onEstimate,
}: {
  readonly form: UseFormReturn<F>;
  readonly planId: string | null;
  readonly lastEstimate: Estimate | null;
  readonly onEstimate: (e: Estimate) => void;
}) {
  const orders = form.watch('orders');
  const warehouseId = form.watch('warehouseId');
  const clientId = form.watch('clientId');
  const [picking, setPicking] = React.useState(false);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const eligible = useApiQuery<EligibleOrderRow[]>(
    ['shipment-plan-eligible', warehouseId, clientId ?? '', planId ?? ''],
    warehouseId ? '/api/shipment-plans/eligible-orders' : null,
    {
      query: { warehouseId, clientId: clientId || undefined, planId: planId || undefined, ps: 1000 },
      staleTime: 0,
    },
  );

  const setOrders = async (next: PlanOrderItem[]) => {
    form.setValue('orders', next, { shouldDirty: true, shouldValidate: true });
    try {
      const est = await fetchEstimate(next.map((o) => o.id));
      if (totalsFollowOrders(form.getValues(), lastEstimate)) {
        form.setValue('expectedTotalWeight', est.weightLb, { shouldDirty: true });
        form.setValue('expectedTotalVolume', est.volumeFt3, { shouldDirty: true });
      }
      onEstimate(est);
    } catch {
      toast.warning(
        'Totals not updated',
        "We couldn't compute the expected weight and volume. You can enter them on the General step.",
      );
    }
  };

  const add = async (ids: readonly string[]) => {
    const pool = new Map((eligible.data?.data ?? []).map((o) => [o.id, o]));
    const existing = new Set(orders.map((o) => o.id));
    const fresh = ids.filter((id) => !existing.has(id));
    const ok = fresh.map((id) => pool.get(id)).filter((o): o is EligibleOrderRow => Boolean(o));
    const skipped = fresh.length - ok.length;
    if (skipped > 0)
      toast.warning(
        `${skipped} ${skipped === 1 ? 'order was' : 'orders were'} not added`,
        'They are already in another active shipment plan or are no longer eligible.',
      );
    if (ok.length === 0) return;
    await setOrders([
      ...orders,
      ...ok.map((o) => ({ id: o.id, code: o.code, status: o.status, totalQuantity: o.totalQuantity })),
    ]);
    // Draft-only change: nothing is persisted until Save, so say so (no "Success").
    toast.info(
      'Added to draft',
      `${ok.length} ${ok.length === 1 ? 'order' : 'orders'} will join the plan when you save.`,
    );
  };

  const remove = async () => {
    await setOrders(orders.filter((o) => !selected.has(o.id)));
    setSelected(new Set());
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const addReason = !warehouseId ? 'Select a warehouse on the General step first' : null;
  const error = form.formState.errors.orders?.message;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-secondary">
          {orders.length} {orders.length === 1 ? 'order' : 'orders'} ·{' '}
          {orders.reduce((s, o) => s + o.totalQuantity, 0)} units
        </p>
        <div className="flex items-center gap-2">
          <DisabledReason reason={selected.size === 0 ? 'Select orders to remove' : null}>
            <Button variant="secondary" disabled={selected.size === 0} onClick={() => void remove()}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Remove
            </Button>
          </DisabledReason>
          <DisabledReason reason={addReason}>
            <Button variant="primary" disabled={Boolean(addReason)} onClick={() => setPicking(true)}>
              <PackagePlus className="h-3.5 w-3.5" aria-hidden />
              Add order(s)
            </Button>
          </DisabledReason>
        </div>
      </div>
      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <PackagePlus className="h-6 w-6 text-faint" aria-hidden />
          <p className="text-sm font-semibold">No order added yet.</p>
          <p className="max-w-sm text-xs text-secondary">
            Only orders of the plan&apos;s warehouse that are not shipped, cancelled, on hold or in another
            active plan can be added.
          </p>
          <DisabledReason reason={addReason}>
            <Button size="sm" disabled={Boolean(addReason)} onClick={() => setPicking(true)}>
              Add order
            </Button>
          </DisabledReason>
        </div>
      ) : (
        <OrdersTable
          orders={orders}
          selected={selected}
          onToggle={toggle}
          onToggleAll={() =>
            setSelected(
              orders.every((o) => selected.has(o.id)) ? new Set() : new Set(orders.map((o) => o.id)),
            )
          }
        />
      )}
      {orders.some((o) => !isShipReady(o.status)) ? (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground"
        >
          <strong>
            {orders.filter((o) => !isShipReady(o.status)).length} of {orders.length}
          </strong>{' '}
          orders are not Ready to Ship yet (
          {[...new Set(orders.filter((o) => !isShipReady(o.status)).map((o) => o.status))].join(', ')}). They
          can ride on the plan, but Ship only ships orders that are picked and packed.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {picking ? (
        <PlanOrderPicker
          open
          onOpenChange={(o) => (o ? undefined : setPicking(false))}
          title="Add order(s)"
          warehouseId={warehouseId}
          clientId={clientId}
          planId={planId}
          excludeIds={orders.map((o) => o.id)}
          onConfirm={async (ids) => {
            await add(ids);
            setPicking(false);
          }}
        />
      ) : null}
    </div>
  );
}
