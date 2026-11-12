'use client';

/**
 * Transfer Product (spec 04 §2.7).
 *  - One Stock row: partial quantity + Move to LP/Location.
 *  - Several eligible rows (bulk): every free unit of each row moves to one destination; results
 *    are reported per row.
 * Rows a mixed selection cannot move (not Stock, count-locked, fully allocated) are listed as
 * skipped instead of blocking the action. The destination is pre-checked as soon as it is picked
 * (count lock, "only 1 SKU"); the check times out with a Retry instead of spinning, and Transfer
 * stays disabled until quantity and destination are valid.
 */
import * as React from 'react';
import { z } from 'zod';
import { useApiMutation } from '@/lib/query-client';
import { apiRequest, isApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Form, FormField, useZodForm } from '@/components/ui/form';
import { DestinationPicker } from './destination-picker';
import { BucketCard } from './bucket-card';
import { formatQty, useInventoryRefresh } from './inventory-shared';
import {
  DrawerFooter,
  PlacementNotice,
  QtyInput,
  isLargeQty,
  qtyIssue,
  usePlacementCheck,
} from './inventory-form-kit';
import { qtyValue } from './quantity-drawer';
import {
  countLockReason,
  skippedSummary,
  type BucketRow,
  type SkippedRow,
  type TransferResult,
} from './by-location-types';

const targetSchema = z.object({ kind: z.enum(['location', 'lp']), id: z.string() }).nullable();
type Target = z.infer<typeof targetSchema>;

export function transferProductSchema(maxPacks: number) {
  return z.object({ qty: qtyValue, target: targetSchema }).superRefine((v, ctx) => {
    const issue = qtyIssue(v.qty, { requiredMessage: 'Transfer Product Quantity is required' });
    if (issue) ctx.addIssue({ code: 'custom', path: ['qty'], message: issue });
    else if ((v.qty as number) > maxPacks)
      ctx.addIssue({
        code: 'custom',
        path: ['qty'],
        message: `The entered transfer quantity exceeds the existing inventory amount (${formatQty(maxPacks)} available).`,
      });
    if (!v.target)
      ctx.addIssue({ code: 'custom', path: ['target'], message: 'Move to LP/Location is required' });
  });
}

/** Why Transfer is disabled before submit (quantity / destination not valid yet). Null when ready. */
export function transferInputReason(
  qty: number | null | undefined,
  maxPacks: number,
  target: Target,
): string | null {
  const issue = qtyIssue(qty, { requiredMessage: 'Enter the quantity to transfer' });
  if (issue) return issue;
  if ((qty as number) > maxPacks) return `Only ${formatQty(maxPacks)} available`;
  if (!target) return 'Pick where to move it';
  return null;
}

const TARGET_ERROR_CODES = new Set(['RULE_VIOLATION', 'VALIDATION', 'NOT_FOUND']);

export interface TransferProductDrawerProps {
  /** Eligible rows; null closes the drawer. */
  readonly rows: readonly BucketRow[] | null;
  readonly skipped?: readonly SkippedRow[];
  readonly onClose: () => void;
  readonly onDone: () => void;
}

export function TransferProductDrawer({ rows, skipped = [], onClose, onDone }: TransferProductDrawerProps) {
  const open = rows !== null && rows.length > 0;
  const single = rows && rows.length === 1 ? rows[0] : null;
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={rows && rows.length > 1 ? `Transfer Product (${rows.length} rows)` : 'Transfer Product'}
      width={35}
    >
      {single ? (
        <TransferProductForm
          key={single.id}
          row={single}
          skipped={skipped}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
      {rows && rows.length > 1 ? (
        <BulkTransferForm
          key={rows.map((r) => r.id).join(',')}
          rows={rows}
          skipped={skipped}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
    </Drawer>
  );
}

/** "N of M selected rows will be skipped (…)" with the first few rows named. */
export function SkippedRowsCallout({
  eligible,
  skipped,
}: {
  readonly eligible: readonly BucketRow[];
  readonly skipped: readonly SkippedRow[];
}) {
  const summary = skippedSummary({ eligible, skipped });
  if (!summary) return null;
  return (
    <Callout variant="attention" title={summary}>
      <ul className="mt-0.5 max-h-24 overflow-auto">
        {skipped.slice(0, 8).map((s) => (
          <li key={s.row.id} className="truncate">
            {s.row.sku} @ {s.row.location}
            {s.row.lpNumber ? ` / ${s.row.lpNumber}` : ''}: {s.message}
          </li>
        ))}
        {skipped.length > 8 ? <li className="text-faint">+{skipped.length - 8} more</li> : null}
      </ul>
    </Callout>
  );
}

function TransferProductForm({
  row,
  skipped,
  onClose,
  onDone,
}: {
  readonly row: BucketRow;
  readonly skipped: readonly SkippedRow[];
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const schema = React.useMemo(() => transferProductSchema(row.freePackQty), [row.freePackQty]);
  const form = useZodForm(schema, { qty: null, target: null });
  const target = form.watch('target');
  const qty = form.watch('qty');
  const placement = usePlacementCheck(target, [row.productId], [row.id]);
  const refresh = useInventoryRefresh();
  const mutation = useApiMutation<z.output<typeof schema>, TransferResult, z.input<typeof schema>>({
    path: '/api/inventory/transfer-product',
    body: (v) => ({ inventoryId: row.id, qty: v.qty, target: v.target, version: row.version }),
    successTitle: 'Transfer completed successfully',
    errorTitle: 'Transfer was not completed',
    successMessage: (d) =>
      d.moved.map((m) => `${formatQty(m.qty)} × ${m.sku}: ${m.from} → ${m.to}`).join(' · '),
    form,
    onError: (error) => {
      if (TARGET_ERROR_CODES.has(error.code) && !error.fieldErrors)
        form.setError('target', { message: error.message });
      if (error.code === 'INSUFFICIENT_STOCK') form.setError('qty', { message: error.message });
    },
    onSuccess: () => {
      refresh();
      form.reset(form.getValues());
      onDone();
    },
  });
  const sourceLock = countLockReason(row);
  const blocked =
    sourceLock ??
    transferInputReason(qty as number | null, row.freePackQty, target) ??
    placement.check?.blocking ??
    (placement.checking ? 'Checking the destination…' : null);
  return (
    <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="flex h-full flex-col" guardUnsaved>
      <div className="flex flex-col gap-4">
        <SkippedRowsCallout eligible={[row]} skipped={skipped} />
        <BucketCard row={row} compact locationLabel="Transfer from LP/Loc" />
        {sourceLock ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-xs text-danger"
          >
            {sourceLock}
          </p>
        ) : null}
        <FormField
          name="qty"
          label="Transfer Product Quantity"
          required
          description={
            isLargeQty(qty)
              ? `Large quantity: ${formatQty(qty as number)}. Double-check it.`
              : `${formatQty(row.freePackQty)} ${row.packType} available`
          }
        >
          {(c) => (
            <div className="flex items-center gap-2">
              <QtyInput
                id={c.id}
                name={c.name}
                aria-describedby={c['aria-describedby']}
                aria-invalid={c['aria-invalid']}
                value={c.value as number | null}
                onChange={(v) => c.onChange(v)}
                onBlur={c.onBlur}
                invalid={c.invalid}
                placeholder="Enter quantity"
                className="flex-1"
                data-autofocus
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  form.setValue('qty', row.freePackQty, { shouldDirty: true, shouldValidate: true })
                }
              >
                All {formatQty(row.freePackQty)}
              </Button>
            </div>
          )}
        </FormField>
        <FormField name="target" label="Move to LP/Location" required>
          {(c) => (
            <div className="flex flex-col gap-1.5">
              <DestinationPicker
                value={c.value as Target}
                onChange={(v) => {
                  c.onChange(v);
                  form.clearErrors('target');
                }}
                warehouseId={row.warehouseId}
                productIds={[row.productId]}
                exclude={[row.id]}
                onScanMiss={(code, reason) =>
                  form.setError('target', { message: reason ?? `No destination matches "${code}"` })
                }
              />
              <PlacementNotice state={placement} />
            </div>
          )}
        </FormField>
      </div>
      <DrawerFooter
        submitLabel="Transfer"
        onCancel={onClose}
        pending={mutation.isPending}
        blockedReason={blocked}
      />
    </Form>
  );
}

interface RowOutcome {
  readonly id: string;
  readonly ok: boolean;
  readonly message: string;
}

/** Bulk: all free units of each row → one destination, row by row (each move is its own ledger transaction). */
function BulkTransferForm({
  rows,
  skipped,
  onClose,
  onDone,
}: {
  readonly rows: readonly BucketRow[];
  readonly skipped: readonly SkippedRow[];
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const form = useZodForm(z.object({ target: targetSchema }), { target: null });
  const target = form.watch('target');
  const productIds = React.useMemo(() => [...new Set(rows.map((r) => r.productId))], [rows]);
  const rowIds = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const placement = usePlacementCheck(target, productIds, rowIds);
  const refresh = useInventoryRefresh();
  const [pending, setPending] = React.useState(false);
  const [outcomes, setOutcomes] = React.useState<readonly RowOutcome[]>([]);
  const warehouses = new Set(rows.map((r) => r.warehouseId));
  const totalPacks = rows.reduce((s, r) => s + r.freePackQty, 0);
  const done = new Set(outcomes.filter((o) => o.ok).map((o) => o.id));
  const remaining = rows.filter((r) => !done.has(r.id));

  const submit = async () => {
    if (!target) return;
    setPending(true);
    const next: RowOutcome[] = outcomes.filter((o) => o.ok);
    for (const r of remaining) {
      try {
        await apiRequest<TransferResult>('/api/inventory/transfer-product', {
          method: 'POST',
          body: { inventoryId: r.id, qty: r.freePackQty, target, version: r.version },
        });
        next.push({ id: r.id, ok: true, message: `${formatQty(r.freePackQty)} moved` });
      } catch (e) {
        next.push({ id: r.id, ok: false, message: isApiError(e) ? e.message : 'Transfer failed' });
      }
    }
    setOutcomes(next);
    setPending(false);
    refresh();
    const ok = next.filter((o) => o.ok).length;
    const failed = next.length - ok;
    if (failed === 0) {
      toast.success(
        'Transfer completed successfully',
        `${ok} of ${rows.length} rows moved${skipped.length ? ` · ${skipped.length} skipped` : ''}.`,
      );
      form.reset(form.getValues());
      onDone();
    } else {
      toast.error(
        'Transfer partly completed',
        `${ok} of ${rows.length} rows moved · ${failed} failed. See the drawer for each row.`,
      );
    }
  };

  const blocked =
    warehouses.size > 1
      ? 'The selected rows are in different warehouses. Transfer one warehouse at a time.'
      : !target
        ? 'Pick where to move it'
        : (placement.check?.blocking ?? (placement.checking ? 'Checking the destination…' : null));
  const outcomeFor = (id: string) => outcomes.find((o) => o.id === id);

  return (
    <Form form={form} onSubmit={() => submit()} className="flex h-full flex-col" guardUnsaved>
      <div className="flex flex-col gap-4">
        <SkippedRowsCallout eligible={rows} skipped={skipped} />
        <div className="rounded-lg border border-border bg-surface-sunken/60 p-3 text-sm">
          <div className="font-semibold text-foreground">
            {rows.length} rows · {formatQty(totalPacks)} free units move
          </div>
          <p className="text-xs text-secondary">
            Every free unit of each row moves. Allocated units stay where they are. To move part of a row,
            transfer it on its own.
          </p>
          <ul className="mt-2 max-h-48 overflow-auto">
            {rows.map((r) => {
              const o = outcomeFor(r.id);
              return (
                <li key={r.id} className="flex items-center gap-2 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-body">
                    {r.sku} · {r.location}
                    {r.lpNumber ? ` / ${r.lpNumber}` : ''}
                  </span>
                  <span className="shrink-0 tabular-nums text-secondary">
                    {formatQty(r.freePackQty)} {r.packType}
                  </span>
                  {o ? (
                    <span
                      className={
                        o.ok
                          ? 'shrink-0 text-xs text-success'
                          : 'shrink-0 max-w-[45%] truncate text-xs text-danger'
                      }
                      title={o.message}
                    >
                      {o.ok ? 'Moved' : o.message}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
        <FormField name="target" label="Move to LP/Location" required>
          {(c) => (
            <div className="flex flex-col gap-1.5">
              <DestinationPicker
                value={c.value as Target}
                onChange={(v) => c.onChange(v)}
                warehouseId={rows[0]?.warehouseId ?? null}
                productIds={productIds}
                exclude={rowIds}
                onScanMiss={(code, reason) =>
                  form.setError('target', { message: reason ?? `No destination matches "${code}"` })
                }
              />
              <PlacementNotice state={placement} />
            </div>
          )}
        </FormField>
      </div>
      <DrawerFooter
        submitLabel={
          outcomes.some((o) => !o.ok) ? `Retry ${remaining.length} failed` : `Transfer ${rows.length} rows`
        }
        onCancel={onClose}
        pending={pending}
        blockedReason={blocked}
      />
    </Form>
  );
}
