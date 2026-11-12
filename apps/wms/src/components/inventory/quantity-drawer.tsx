'use client';

/**
 * Add / Adjust / Remove Inventory drawer (spec 04 §2.1–2.3) for one Stock row.
 * Adjust takes the absolute New Quantity; the server posts the delta. The reason is
 * mandatory when the warehouse says so; Save stays disabled until the form is valid.
 * Beats Logiwa: a live "after save" preview and inline errors under each field.
 */
import * as React from 'react';
import { z } from 'zod';
import { ArrowRight } from 'lucide-react';
import { useApiMutation } from '@/lib/query-client';
import { Drawer } from '@/components/ui/drawer';
import { Form, FormField, useZodForm } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { BucketCard } from './bucket-card';
import { DrawerFooter, QtyInput, isLargeQty, qtyIssue } from './inventory-form-kit';
import { NOTE_FOCUS, formatQty, useInventoryReasons, useInventoryRefresh } from './inventory-shared';
import { countLockReason, type BucketRow, type QuantityMode } from './by-location-types';
import { reasonAllows, reasonDirectionMessage } from '@/lib/grid-defs/inventory/reason-direction';

const TITLES: Readonly<Record<QuantityMode, string>> = {
  add: 'Add Inventory',
  adjust: 'Adjust Inventory',
  remove: 'Remove Inventory',
};
const QTY_LABELS: Readonly<Record<QuantityMode, string>> = {
  add: 'Quantity to Add',
  adjust: 'New Quantity',
  remove: 'Quantity to Remove',
};
const PLACEHOLDERS: Readonly<Record<QuantityMode, string>> = {
  add: 'Enter quantity to add',
  adjust: 'Enter new quantity',
  remove: 'Enter quantity to remove',
};

/** Quantity field value: a number (possibly invalid: NaN, negative, fractional) or null; the schema explains what's wrong. */
export const qtyValue = z.custom<number | null>((v) => v === null || typeof v === 'number', {
  message: 'Enter a quantity',
});

export function quantitySchema(
  mode: QuantityMode,
  row: Pick<BucketRow, 'totalPackQty' | 'freePackQty' | 'allocatedPackQty'>,
  reasonRequired: boolean,
) {
  return z
    .object({
      qty: qtyValue,
      reasonId: z.string().nullable(),
      note: z.string().max(400, 'At most 400 characters'),
    })
    .superRefine((v, ctx) => {
      if (reasonRequired && !v.reasonId)
        ctx.addIssue({ code: 'custom', path: ['reasonId'], message: 'Adjustment Reason is required' });
      const issue = qtyIssue(v.qty, {
        allowZero: mode === 'adjust',
        requiredMessage: `${QTY_LABELS[mode]} is required`,
      });
      if (issue) {
        ctx.addIssue({ code: 'custom', path: ['qty'], message: issue });
        return;
      }
      const qty = v.qty as number;
      if (mode === 'remove' && qty > row.freePackQty)
        ctx.addIssue({
          code: 'custom',
          path: ['qty'],
          message: `Only ${formatQty(row.freePackQty)} unallocated can be removed`,
        });
      if (mode === 'adjust') {
        if (qty < row.allocatedPackQty)
          ctx.addIssue({
            code: 'custom',
            path: ['qty'],
            message: `${formatQty(row.allocatedPackQty)} are allocated; the quantity can't go below that`,
          });
        else if (qty === row.totalPackQty)
          ctx.addIssue({ code: 'custom', path: ['qty'], message: 'Enter a different quantity' });
      }
    });
}

export function resultingQty(mode: QuantityMode, current: number, qty: number | null): number | null {
  // No preview for values the form rejects (fractions, negatives, NaN): "1 → -0.5" would look like a plan.
  if (qty === null || !Number.isInteger(qty) || qty < 0) return null;
  if (mode === 'add') return current + qty;
  if (mode === 'remove') return current - qty;
  return qty;
}

/** Signed change the save will post (null while the value is invalid). */
export function signedDelta(mode: QuantityMode, current: number, qty: number | null): number | null {
  const after = resultingQty(mode, current, qty);
  return after === null ? null : after - current;
}

/** A decrease needs a confirm step when it removes more than 25% of the row or more than 10 units. */
export const LARGE_DECREASE_UNITS = 10;
export function isLargeDecrease(current: number, delta: number | null): boolean {
  if (delta === null || delta >= 0) return false;
  return -delta > LARGE_DECREASE_UNITS || (current > 0 && -delta / current > 0.25);
}

/** "Save (−14)" / "Save (+3)" / "Save". */
export function saveLabel(delta: number | null): string {
  if (delta === null || delta === 0) return 'Save';
  return `Save (${delta > 0 ? '+' : '−'}${formatQty(Math.abs(delta))})`;
}

export interface QuantityDrawerProps {
  readonly row: BucketRow | null;
  readonly mode: QuantityMode;
  readonly onClose: () => void;
  readonly onDone: () => void;
}

export function QuantityDrawer({ row, mode, onClose, onDone }: QuantityDrawerProps) {
  return (
    <Drawer
      open={row !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={TITLES[mode]}
      width={35}
    >
      {row ? (
        <QuantityForm key={`${row.id}:${mode}`} row={row} mode={mode} onClose={onClose} onDone={onDone} />
      ) : null}
    </Drawer>
  );
}

function QuantityForm({
  row,
  mode,
  onClose,
  onDone,
}: {
  readonly row: BucketRow;
  readonly mode: QuantityMode;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const reasons = useInventoryReasons();
  const required = reasons?.mandatoryReason[row.warehouseId] ?? true;
  const schema = React.useMemo(() => quantitySchema(mode, row, required), [mode, row, required]);
  const form = useZodForm(schema, {
    qty: mode === 'adjust' ? row.totalPackQty : null,
    reasonId: null,
    note: '',
  });
  const qty = form.watch('qty');
  const after = resultingQty(mode, row.totalPackQty, qty);
  const delta = signedDelta(mode, row.totalPackQty, qty);
  const [pendingConfirm, setPendingConfirm] = React.useState<z.output<typeof schema> | null>(null);
  const refresh = useInventoryRefresh();
  const mutation = useApiMutation<
    z.output<typeof schema>,
    { from: number; to: number; deleted?: boolean },
    z.input<typeof schema>
  >({
    path: `/api/inventory/buckets/${row.id}/quantity`,
    body: (v) => ({ mode, qty: v.qty, reasonId: v.reasonId, note: v.note || null, version: row.version }),
    successTitle: 'Inventory updated successfully',
    errorTitle: 'Inventory was not updated',
    successMessage: (d) =>
      d.deleted
        ? `${row.sku} @ ${row.location}: ${formatQty(d.from)} → 0 ${row.uomPackType}. The empty record was removed.`
        : `${row.sku} @ ${row.location}: ${formatQty(d.from)} → ${formatQty(d.to)} ${row.uomPackType}.`,
    form,
    onSuccess: () => {
      refresh();
      form.reset(form.getValues());
      onDone();
    },
  });

  const lock = countLockReason(row);
  // Save with nothing filled must flag every required field, not only the first one the resolver reports.
  const showAllErrors = () => {
    const parsed = schema.safeParse(form.getValues());
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      const name = issue.path[0];
      if ((name === 'qty' || name === 'reasonId' || name === 'note') && !form.getFieldState(name).error)
        form.setError(name, { type: 'custom', message: issue.message });
    }
  };
  // Reasons follow the sign of the change: "Inventory is missing" is not offered for an increase.
  const unitDelta = delta === null ? null : delta * row.unitsPerPack;
  const reasonId = form.watch('reasonId');
  const allReasons = reasons?.adjustmentReasons ?? [];
  const selectedReason = allReasons.find((r) => r.id === reasonId) ?? null;
  const reasonMismatch =
    selectedReason && !reasonAllows(selectedReason.direction ?? 'both', unitDelta)
      ? reasonDirectionMessage(selectedReason.name, selectedReason.direction ?? 'both')
      : null;
  const reasonOptions = allReasons
    .filter((r) => r.id === reasonId || reasonAllows(r.direction ?? 'both', unitDelta))
    .map((r) => ({
      value: r.id,
      label: r.direction && r.direction !== 'both' ? `${r.name} (${r.direction})` : r.name,
    }));
  return (
    <Form
      form={form}
      onSubmit={(v) => {
        if (isLargeDecrease(row.totalPackQty, signedDelta(mode, row.totalPackQty, v.qty))) {
          setPendingConfirm(v);
          return;
        }
        return mutation.mutateAsync(v);
      }}
      onInvalid={showAllErrors}
      className="flex h-full flex-col"
      guardUnsaved
    >
      <div className="flex flex-col gap-4">
        <BucketCard row={row} compact />
        {lock ? (
          <Callout variant="attention" title="Location locked by a count">
            {lock}
          </Callout>
        ) : null}
        <FormField
          name="reasonId"
          label="Adjustment Reason"
          required={required}
          description={required ? undefined : 'Optional for this warehouse'}
        >
          {(c) => (
            <Combobox
              id={c.id}
              aria-label="Adjustment reason"
              aria-describedby={c['aria-describedby']}
              options={reasonOptions}
              value={c.value as string | null}
              onChange={(v) => c.onChange(v)}
              onBlur={c.onBlur}
              invalid={c.invalid}
              placeholder="Select adjustment reason"
            />
          )}
        </FormField>
        {reasonMismatch ? (
          <p role="alert" className="-mt-2 text-xs text-danger">
            {reasonMismatch}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-secondary">Current Quantity</span>
            <div
              className="flex h-8 items-center rounded-md border border-border bg-surface-sunken px-3 tabular-nums text-body"
              aria-label="Current quantity"
            >
              {formatQty(row.totalPackQty)} <span className="ml-1 text-faint">{row.packType}</span>
            </div>
          </div>
          <FormField
            name="qty"
            label={QTY_LABELS[mode]}
            required
            info={
              mode === 'adjust'
                ? 'Replaces current inventory with this new total. Setting the quantity to 0 will delete this inventory record.'
                : undefined
            }
          >
            {(c) => (
              <QtyInput
                id={c.id}
                name={c.name}
                aria-describedby={c['aria-describedby']}
                aria-invalid={c['aria-invalid']}
                value={c.value as number | null}
                onChange={(v) => c.onChange(v)}
                onBlur={c.onBlur}
                invalid={c.invalid}
                placeholder={PLACEHOLDERS[mode]}
                data-autofocus
              />
            )}
          </FormField>
        </div>
        {mode === 'adjust' && qty === 0 ? (
          <Callout variant="attention" title="This deletes the inventory record">
            Saving 0 posts −{formatQty(row.totalPackQty)} {row.packType} and removes this row from Inventory
            by Location.
          </Callout>
        ) : mode === 'remove' && qty !== null && qty === row.totalPackQty && row.allocatedPackQty === 0 ? (
          <Callout variant="attention" title="Removes every unit">
            This row reaches 0 and is removed from Inventory by Location.
          </Callout>
        ) : isLargeQty(qty) ? (
          <p className="text-xs text-warning">
            That is a large quantity ({formatQty(qty as number)} {row.packType}). Double-check it before
            saving.
          </p>
        ) : null}
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
            after !== null && after < 0 ? 'border-danger/40 bg-danger-soft' : 'border-border bg-surface',
          )}
          aria-live="polite"
        >
          <span className="text-secondary">After save</span>
          <span className="tabular-nums text-body">{formatQty(row.totalPackQty)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-faint" aria-hidden />
          <span className="font-semibold tabular-nums text-foreground">
            {after === null ? '—' : formatQty(after)}
          </span>
          <span className="text-faint">{row.packType}</span>
          {after !== null && row.unitsPerPack > 1 ? (
            <span className="ml-auto text-faint">
              {formatQty(after * row.unitsPerPack)} {row.uomPackType}
            </span>
          ) : null}
        </div>
        {row.allocatedQty > 0 ? (
          <Callout variant="attention" title={`${formatQty(row.allocatedPackQty)} ${row.packType} allocated`}>
            Allocated units stay reserved;{' '}
            {mode === 'adjust' ? "the new quantity can't go below them." : 'only free units can be removed.'}
          </Callout>
        ) : null}
        <FormField name="note" label="Note">
          {(c) => (
            <Textarea
              id={c.id}
              name={c.name}
              aria-describedby={c['aria-describedby']}
              value={c.value as string}
              onChange={(e) => c.onChange(e.target.value)}
              onBlur={c.onBlur}
              maxLength={400}
              placeholder="Enter note"
              rows={3}
              invalid={c.invalid}
              className={NOTE_FOCUS}
            />
          )}
        </FormField>
      </div>
      {/* Save disables while any error shows; its mouse-down keeps focus in the field, so the first click on an
          untouched form submits and flags EVERY required field instead of only the one that blurred. */}
      <DrawerFooter
        onCancel={onClose}
        pending={mutation.isPending}
        blockedReason={lock ?? reasonMismatch}
        submitLabel={saveLabel(delta)}
      />
      <ConfirmDialog
        open={pendingConfirm !== null}
        onOpenChange={(o) => {
          if (!o) setPendingConfirm(null);
        }}
        variant="attention"
        title={`Remove ${formatQty(-(delta ?? 0))} ${row.packType}?`}
        description={`${row.sku} @ ${row.location} goes from ${formatQty(row.totalPackQty)} to ${formatQty(row.totalPackQty + (delta ?? 0))} ${row.packType}. This posts a −${formatQty(-(delta ?? 0))} change to the ledger.`}
        confirmLabel={`Yes, remove ${formatQty(-(delta ?? 0))}`}
        cancelLabel="Go back"
        onConfirm={async () => {
          const v = pendingConfirm;
          setPendingConfirm(null);
          if (v) await mutation.mutateAsync(v).catch(() => undefined);
        }}
      />
    </Form>
  );
}
