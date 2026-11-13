'use client';

/**
 * Edit Product drawer (spec 01 §2 Step 3): UOM pack type, price, quantity, line notes,
 * live Available Pack Quantity, read-only fulfilment quantities and inventory pinning
 * (expiry / production date / lot / damage reason / location / LP). "Show details" opens
 * the same drawer read-only.
 */
import * as React from 'react';
import { useFormat } from '@/lib/format';
import { useApiQuery } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Drawer } from '@/components/ui/drawer';
import { FieldError, FieldLabel, FormGrid, FormSection } from '@/components/ui/form';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { LocationPicker, LpPicker } from '@/components/shared/entity-pickers';
import type { OrderProductFacts } from '@/server/repositories/orders-wizard';
import { ReadValue } from './fields';
import { NOTE_MAX, type OrderLineValue } from './order-form-model';
import { useOrderWizard } from './order-wizard-context';

export interface LineDrawerProps {
  readonly line: OrderLineValue | null;
  readonly warehouseId: string;
  readonly readOnly: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApply: (line: OrderLineValue) => void;
}

function Field({
  label,
  error,
  required,
  children,
}: {
  readonly label: string;
  readonly error?: string | null;
  readonly required?: boolean;
  readonly children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel required={required} htmlFor={id}>
        {label}
      </FieldLabel>
      <div id={id} className="contents">
        {children}
      </div>
      <FieldError id={`${id}-err`} message={error ?? undefined} />
    </div>
  );
}

export function LineDrawer({ line, warehouseId, readOnly, onOpenChange, onApply }: LineDrawerProps) {
  const fmt = useFormat();
  const { options } = useOrderWizard();
  const [draft, setDraft] = React.useState<OrderLineValue | null>(line);
  React.useEffect(() => setDraft(line), [line]);
  const facts = useApiQuery<readonly OrderProductFacts[]>(
    ['order-product-facts', line?.productId ?? '', warehouseId],
    line ? '/api/orders/product-facts' : null,
    {
      query: { ids: line?.productId ?? '', warehouseId },
      staleTime: 10_000,
    },
  );
  const fact = facts.data?.data?.[0];
  if (!draft || !line) return null;
  const set = <K extends keyof OrderLineValue>(key: K, value: OrderLineValue[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const packOptions = (fact?.packTypes ?? [{ packType: draft.packType, uomQty: draft.uomRatio }]).map(
    (p) => ({ value: p.packType, label: `${p.packType}${p.uomQty > 1 ? ` (${p.uomQty})` : ''}` }),
  );
  const ratio = fact?.packTypes.find((p) => p.packType === draft.packType)?.uomQty ?? draft.uomRatio ?? 1;
  const atp = fact?.atp ?? draft.atp;
  const qtyError = !draft.quantity || draft.quantity < 1 ? 'Quantity must be at least 1' : null;
  const priceError = draft.unitPrice < 0 ? "Price can't be negative" : null;
  const damageOptions = (options?.damageReasons ?? []).map((d) => ({ value: d.label, label: d.label }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(line);
  const toDate = (v: string | null) => (v ? new Date(v) : null);
  const ro = readOnly;

  return (
    <Drawer
      open
      onOpenChange={onOpenChange}
      title={ro ? 'Product details' : 'Edit product'}
      description={`${line.sku} · ${line.name}`}
      width={45}
      dirty={dirty && !ro}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {ro ? 'Close' : 'Cancel'}
          </Button>
          {!ro ? (
            <Button
              variant="primary"
              disabled={Boolean(qtyError || priceError)}
              onClick={() => onApply({ ...draft, uomRatio: ratio, atp: atp ?? null })}
            >
              Apply
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <FormGrid columns={2}>
          <ReadValue label="SKU">{line.sku}</ReadValue>
          <ReadValue label="Name">{line.name}</ReadValue>
          <Field label="UOM pack type" required>
            <Select
              aria-label="UOM pack type"
              options={packOptions}
              value={draft.packType}
              onChange={(v) => v && set('packType', v)}
              disabled={ro}
            />
          </Field>
          <ReadValue label="UOM ratio">{fmt.quantity(ratio)}</ReadValue>
          <Field label="Quantity" required error={qtyError}>
            <NumberInput
              aria-label="Quantity"
              min={1}
              value={draft.quantity}
              onChange={(v) => set('quantity', v ?? 0)}
              disabled={ro}
              invalid={Boolean(qtyError)}
            />
          </Field>
          <Field label="Price per item" error={priceError}>
            <NumberInput
              aria-label="Price per item"
              min={0}
              decimals={2}
              value={draft.unitPrice}
              onChange={(v) => set('unitPrice', v ?? 0)}
              disabled={ro}
              suffix="USD"
            />
          </Field>
          <ReadValue label="Total price">{fmt.money(draft.quantity * draft.unitPrice)}</ReadValue>
          <ReadValue label="Available pack quantity">
            {facts.isLoading && (atp === null || atp === undefined) ? (
              'Loading…'
            ) : atp === null || atp === undefined ? (
              'None'
            ) : (
              <span
                className={
                  atp <= 0
                    ? 'font-semibold text-danger'
                    : atp < draft.quantity
                      ? 'font-semibold text-warning'
                      : 'font-semibold text-success'
                }
              >
                {fmt.quantity(Math.floor(atp / Math.max(1, ratio)))} {draft.packType}
              </span>
            )}
          </ReadValue>
        </FormGrid>

        <FormSection title="Line notes">
          <FormGrid columns={1}>
            {(['lineNote1', 'lineNote2', 'lineNote3'] as const).map((k, i) => (
              <Field key={k} label={`Line notes ${i + 1}`}>
                <TextField
                  aria-label={`Line notes ${i + 1}`}
                  value={draft[k]}
                  maxLength={NOTE_MAX}
                  showCount={!ro}
                  onChange={(e) => set(k, e.target.value)}
                  disabled={ro}
                />
              </Field>
            ))}
          </FormGrid>
        </FormSection>

        <FormSection title="Order details" description="Fulfilment progress for this line (read-only).">
          <FormGrid columns={3}>
            <ReadValue label="Allocated UOM qty">{fmt.quantity(line.allocatedQuantity)}</ReadValue>
            <ReadValue label="Cancelled UOM qty">{fmt.quantity(line.cancelledQuantity)}</ReadValue>
            <ReadValue label="Sorted UOM qty">{fmt.quantity(line.sortedQuantity)}</ReadValue>
            <ReadValue label="Picked UOM qty">{fmt.quantity(line.pickedQuantity)}</ReadValue>
            <ReadValue label="Packed UOM qty">{fmt.quantity(line.packedQuantity)}</ReadValue>
            <ReadValue label="Shipped UOM qty">{fmt.quantity(line.shippedQuantity)}</ReadValue>
          </FormGrid>
        </FormSection>

        <FormSection
          title="Inventory details"
          description="Pin the line to a specific lot, date, location or LP. Allocation only uses matching stock."
        >
          <FormGrid columns={2}>
            <Field label="Expiry date">
              <DatePicker
                aria-label="Expiry date"
                value={toDate(draft.expiryDate)}
                onChange={(d) => set('expiryDate', d ? d.toISOString() : null)}
                disabled={ro}
                clearable
              />
            </Field>
            <Field label="Production date">
              <DatePicker
                aria-label="Production date"
                value={toDate(draft.productionDate)}
                onChange={(d) => set('productionDate', d ? d.toISOString() : null)}
                disabled={ro}
                clearable
              />
            </Field>
            <Field label="Lot batch number">
              <TextField
                aria-label="Lot batch number"
                value={draft.lotNumber}
                maxLength={100}
                onChange={(e) => set('lotNumber', e.target.value)}
                disabled={ro}
              />
            </Field>
            <Field label="Damage reason">
              <Select
                aria-label="Damage reason"
                options={damageOptions}
                value={draft.damageReason}
                onChange={(v) => set('damageReason', v)}
                clearable
                disabled={ro}
                placeholder="Not damaged"
              />
            </Field>
            <Field label="Inventory location">
              <LocationPicker
                aria-label="Inventory location"
                warehouseId={warehouseId}
                value={draft.pinnedLocationId}
                selectedLabel={draft.pinnedLocationCode ?? undefined}
                onChange={(v, item) =>
                  setDraft((d) =>
                    d
                      ? { ...d, pinnedLocationId: v, pinnedLocationCode: item ? String(item.label) : null }
                      : d,
                  )
                }
                disabled={ro}
                clearable
                placeholder="Search (3+ characters)"
              />
            </Field>
            <Field label="Inventory LP">
              <LpPicker
                aria-label="Inventory LP"
                warehouseId={warehouseId}
                value={draft.pinnedLpId}
                selectedLabel={draft.pinnedLpCode ?? undefined}
                onChange={(v, item) =>
                  setDraft((d) =>
                    d ? { ...d, pinnedLpId: v, pinnedLpCode: item ? String(item.label) : null } : d,
                  )
                }
                disabled={ro}
                clearable
                placeholder="Search (3+ characters)"
              />
            </Field>
          </FormGrid>
        </FormSection>
      </div>
    </Drawer>
  );
}
