'use client';

/**
 * Create Kit preview (Kit Inventory): pick how many kits to build and see the inventory deltas
 * before committing. Step 1 Quantity, step 2 Preview (kit +N, each component −BOM×N against the
 * warehouse's usable free stock), step 3 hand-off: kitting runs through a work order, so the last
 * step opens the Create Work Order wizard prefilled with this kit and quantity. Nothing is posted
 * to the ledger from this drawer.
 */
import * as React from 'react';
import { ArrowLeft, ArrowRight, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { DisabledReason } from '@/components/ui/tooltip';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import type { KitInventoryRow } from '@/lib/grid-defs/work-orders/kits';
import type { DeltaLine } from '@/lib/grid-defs/work-orders/kit-steps';
import { KitDeltaTable, QtyChip } from '../work-orders/kit-delta-table';
import type { KitDetail } from '../work-orders/wo-client';
import { QtyInput, qtyIssue } from '../inventory/inventory-form-kit';

type Step = 'qty' | 'preview';

/** Kit +qty, components −BOM×qty, at warehouse level against usable free stock. Exported for tests. */
export function kitBuildDeltas(
  kit: Pick<KitDetail, 'sku' | 'onHandQty' | 'components'>,
  qty: number,
  warehouseLabel: string,
): DeltaLine[] {
  return [
    {
      key: 'kit',
      sku: kit.sku,
      location: `${warehouseLabel} · kit stock`,
      current: kit.onHandQty,
      change: qty,
    },
    ...kit.components.map((c) => ({
      key: c.productId,
      sku: c.sku,
      location: `${warehouseLabel} · free`,
      current: c.freeQty,
      change: -c.bomQty * qty,
    })),
  ];
}

/** Components that would go negative for this quantity (sku → short by). Exported for tests. */
export function kitBuildShortages(
  kit: Pick<KitDetail, 'components'>,
  qty: number,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of kit.components) {
    const short = c.bomQty * qty - c.freeQty;
    if (short > 0) out[c.productId] = short;
  }
  return out;
}

export function KitBuildPreviewDrawer({
  row,
  onOpenChange,
  onCreateWorkOrder,
  canCreate,
}: {
  readonly row: KitInventoryRow | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreateWorkOrder: (row: KitInventoryRow, qty: number) => void;
  readonly canCreate: boolean;
}) {
  return (
    <Drawer
      open={row !== null}
      onOpenChange={onOpenChange}
      title={row ? `Create kit · ${row.sku}` : 'Create kit'}
      width={60}
      bodyClassName="flex flex-col p-0"
    >
      {row ? (
        <Body
          key={row.id}
          row={row}
          onClose={() => onOpenChange(false)}
          onCreateWorkOrder={onCreateWorkOrder}
          canCreate={canCreate}
        />
      ) : null}
    </Drawer>
  );
}

function Body({
  row,
  onClose,
  onCreateWorkOrder,
  canCreate,
}: {
  readonly row: KitInventoryRow;
  readonly onClose: () => void;
  readonly onCreateWorkOrder: (row: KitInventoryRow, qty: number) => void;
  readonly canCreate: boolean;
}) {
  const [step, setStep] = React.useState<Step>('qty');
  const [qty, setQty] = React.useState<number | null>(
    Math.max(1, Math.min(row.requiredKittingQty || 1, Math.max(1, row.netKittingCapacity))),
  );
  const [touched, setTouched] = React.useState(false);
  const kit = useApiQuery<KitDetail>(
    ['kit', row.kitProductId, row.warehouseId],
    `/api/kits/${encodeURIComponent(row.kitProductId)}`,
    { query: { warehouseId: row.warehouseId }, staleTime: 0 },
  );
  const k = kit.data?.data ?? null;
  const issue = qtyIssue(qty, { requiredMessage: 'Enter how many kits to build' });
  const n = issue ? 0 : (qty ?? 0);
  const shortages = k && n > 0 ? kitBuildShortages(k, n) : {};
  const shortCount = Object.keys(shortages).length;
  const capacity = k?.netKittingCapacity ?? row.netKittingCapacity;
  const kitToOrder = row.kitType !== null && row.kitType !== 'Kit to Stock';
  const createReason = !canCreate
    ? "You don't have permission to create work orders"
    : kitToOrder
      ? 'Kit-to-order kits are built during fulfillment, not by work orders'
      : shortCount > 0
        ? 'Not enough component stock for this quantity'
        : null;

  const steps: readonly { key: Step; label: string }[] = [
    { key: 'qty', label: 'Quantity' },
    { key: 'preview', label: 'Inventory preview' },
  ];
  return (
    <>
      <ol className="flex items-center gap-2 border-b border-border px-5 py-3 text-xs" aria-label="Steps">
        {steps.map((s, i) => (
          <li
            key={s.key}
            aria-current={step === s.key ? 'step' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5',
              step === s.key ? 'font-semibold text-foreground' : 'text-secondary',
            )}
          >
            <span
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-2xs',
                step === s.key ? 'bg-primary text-white' : 'bg-surface-sunken',
              )}
            >
              {i + 1}
            </span>
            {s.label}
            {i < steps.length - 1 ? (
              <span className="mx-1 text-faint" aria-hidden>
                ›
              </span>
            ) : null}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 text-secondary">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-sunken text-2xs">
            3
          </span>
          Work order
        </li>
      </ol>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-foreground">{row.sku}</span>
          <span className="text-sm text-secondary">{row.name}</span>
          <QtyChip label="Warehouse" value={row.warehouseCode} />
          <QtyChip label="Kit type" value={row.kitType ?? 'None'} />
          <QtyChip label="Can build now" value={capacity} />
          <QtyChip label="Required" value={row.requiredKittingQty} />
        </div>
        {kitToOrder ? (
          <Callout variant="attention" title="Kit to order">
            This kit is assembled during order fulfillment. The preview still shows what one build would
            consume.
          </Callout>
        ) : null}
        {kit.error ? (
          <Callout
            variant="error"
            title="Kit details are not available"
            action={
              <Button size="sm" variant="secondary" onClick={() => void kit.refetch()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Retry
              </Button>
            }
          >
            {kit.error.message}
          </Callout>
        ) : null}
        {step === 'qty' ? (
          <div className="flex max-w-sm flex-col gap-1.5">
            <label htmlFor="kit-build-qty" className="text-sm font-medium text-foreground">
              Kits to build <span className="text-danger">*</span>
            </label>
            <QtyInput
              id="kit-build-qty"
              autoFocus
              value={qty}
              onChange={(v) => setQty(v)}
              onBlur={() => setTouched(true)}
              invalid={touched && Boolean(issue)}
              suffix={row.packType}
            />
            {touched && issue ? (
              <p className="text-xs text-danger">{issue}</p>
            ) : (
              <p className="text-xs text-secondary">
                You can build up to <strong className="tabular-nums text-foreground">{capacity}</strong> with
                usable component stock.{' '}
                {capacity > 0 ? (
                  <button
                    type="button"
                    className="font-medium text-info underline-offset-2 hover:underline"
                    onClick={() => setQty(capacity)}
                  >
                    Use {capacity}
                  </button>
                ) : null}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-secondary">
              Building <strong className="text-foreground">{n}</strong> {row.packType} of {row.sku} changes
              inventory like this:
            </p>
            {!k ? (
              <div role="status" className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <KitDeltaTable
                caption={`Inventory change for building ${n} ${row.sku}`}
                currentLabel="Current qty"
                lines={kitBuildDeltas(k, n, row.warehouseCode)}
                flags={Object.fromEntries(
                  Object.entries(shortages).map(([id, s]) => [
                    id,
                    <span key={id} className="rounded bg-danger/10 px-1 text-2xs font-semibold text-danger">
                      Short {s}
                    </span>,
                  ]),
                )}
              />
            )}
            {shortCount > 0 ? (
              <Callout
                variant="error"
                title={`${shortCount} component${shortCount === 1 ? ' is' : 's are'} short`}
              >
                Lower the quantity to {capacity} or receive more stock first.
              </Callout>
            ) : null}
            <p className="text-xs text-secondary">
              Nothing changes yet. Kitting runs through a work order: the next step opens Create Work Order
              with this kit and quantity, and the work order&apos;s Create Kit step posts these movements.
            </p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {step === 'preview' ? (
          <Button variant="secondary" onClick={() => setStep('qty')}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </Button>
        ) : null}
        {step === 'qty' ? (
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!issue) setStep('preview');
            }}
          >
            Preview
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : (
          <DisabledReason reason={createReason}>
            <Button
              variant="primary"
              disabled={Boolean(createReason) || !k}
              onClick={() => onCreateWorkOrder(row, n)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create Work Order for {n}
            </Button>
          </DisabledReason>
        )}
      </div>
    </>
  );
}
