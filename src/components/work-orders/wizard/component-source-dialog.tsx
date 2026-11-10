"use client";

/**
 * Pencil on a wizard component card: choose the exact source inventory (location / LP /
 * lot / expiry / production date) the component is taken from. Required for "without
 * picking" work orders; optional (restricts allocation) for "with picking".
 */
import * as React from "react";
import { Check, Lock } from "lucide-react";
import { DisabledReason } from "@/components/ui/tooltip";
import { DatePicker } from "@/components/ui/date-picker";
import { TextField } from "@/components/ui/text-field";
import { Field, fromDateOnly, toDateOnly } from "../wo-ui";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { suggestSource } from "@/lib/grid-defs/work-orders/source-suggest";
import type { StockBucket } from "../wo-client";
import { EMPTY_SOURCE, type SourceForm } from "./wo-form";

export interface ComponentSourceDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly component: { readonly productId: string; readonly sku: string; readonly name: string; readonly totalQty: number } | null;
  readonly warehouseId: string | null;
  readonly clientId: string | null;
  readonly value: SourceForm;
  readonly onChange: (value: SourceForm) => void;
  /** Without picking a stock row (location) is required; with picking a lot / expiry may restrict FEFO instead. */
  readonly requireLocation?: boolean;
}

export function ComponentSourceDialog(props: ComponentSourceDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg">{props.open && props.component ? <Body {...props} component={props.component} /> : null}</DialogContent>
    </Dialog>
  );
}

const sameBucket = (b: StockBucket, v: SourceForm) =>
  b.locationId === v.locationId && (b.lpId ?? null) === v.lpId && (b.lotNumber ?? null) === v.lotNumber && (b.expiryDate ?? null) === v.expiryDate;

const hasAttrs = (v: SourceForm) => Boolean(v.lotNumber || v.expiryDate || v.productionDate);

function Body({ onOpenChange, component, warehouseId, clientId, value, onChange, requireLocation = true }: ComponentSourceDialogProps & { readonly component: NonNullable<ComponentSourceDialogProps["component"]> }) {
  const stock = useApiQuery<StockBucket[]>(["kit-stock", component.productId, warehouseId ?? ""], warehouseId ? "/api/kits/stock" : null, {
    query: { productId: component.productId, warehouseId: warehouseId ?? "", clientId: clientId ?? "" }, staleTime: 0,
  });
  const buckets = stock.data?.data ?? [];
  const [picked, setPicked] = React.useState<SourceForm>(value);
  const choose = (b: StockBucket) => setPicked({ locationId: b.locationId, locationCode: b.locationCode, lpId: b.lpId, lpNumber: b.lpNumber, lotNumber: b.lotNumber, expiryDate: b.expiryDate, productionDate: b.productionDate });
  const suggested = React.useMemo(() => suggestSource(buckets, component.totalQty), [buckets, component.totalQty]);
  // Pre-select the FEFO/FIFO suggestion when no source was chosen yet.
  const preselected = React.useRef(false);
  React.useEffect(() => {
    if (preselected.current || !suggested || value.locationId) return;
    preselected.current = true;
    choose(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when stock arrives
  }, [suggested, value.locationId]);
  const pickedBucket = buckets.find((b) => sameBucket(b, picked));
  // Apply needs loaded stock and a selected row (or an explicit Clear of a previous source).
  const applyReason = !warehouseId ? "Select a warehouse first"
    : stock.isPending ? "Loading stock…"
      : stock.error ? "Stock could not be loaded"
        : picked.locationId && pickedBucket?.lockedBy ? `${pickedBucket.locationCode} is locked by count plan ${pickedBucket.lockedBy}`
          : !picked.locationId && requireLocation && !value.locationId ? "Select a source row"
            : !picked.locationId && !requireLocation && !hasAttrs(picked) && !value.locationId && !hasAttrs(value) ? "Select a source row or enter a lot / expiry to restrict allocation" : null;
  const lockedCount = buckets.filter((b) => b.lockedBy).length;
  const patchAttr = (p: Partial<SourceForm>) => setPicked((s) => ({ ...s, ...p }));

  return (
    <>
      <DialogHeader title={`Source inventory · ${component.sku}`} description={`${component.name}. ${component.totalQty} ${component.totalQty === 1 ? "unit is" : "units are"} needed for this work order. Choose where they come from.`} />
      <DialogBody>
        {!warehouseId ? <Callout variant="attention" title="Choose a warehouse first">Select the warehouse in step 1 to see its stock.</Callout> : stock.isPending ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-2"><span className="flex items-center gap-2 text-[12px] text-secondary"><Spinner className="h-3.5 w-3.5" label="Loading stock" />Loading stock…</span><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
        ) : stock.error ? <Callout variant="error" title="Stock not available">{stock.error.message}</Callout> : buckets.length === 0 ? (
          <Callout variant="attention" title="No stock">{component.sku} has no free stock in this warehouse. Receive or move stock first, or use a work order with picking.</Callout>
        ) : (
          <div className="ks-scroll max-h-[52vh] overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[12px]">
              <caption className="sr-only">Stock of {component.sku}</caption>
              <thead className="sticky top-0 bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                <tr><th scope="col" className="w-8 px-3 py-2"><span className="sr-only">Selected</span></th><th scope="col" className="px-3 py-2">Location</th><th scope="col" className="px-3 py-2">LP</th><th scope="col" className="px-3 py-2">Lot no</th><th scope="col" className="px-3 py-2">Exp date</th><th scope="col" className="px-3 py-2">Prod date</th><th scope="col" className="px-3 py-2 text-right">Free</th></tr>
              </thead>
              <tbody>
                {buckets.map((b) => {
                  const active = sameBucket(b, picked);
                  const enough = b.freeQty >= component.totalQty;
                  const locked = Boolean(b.lockedBy);
                  return (
                    <tr key={b.id} aria-disabled={locked || undefined} title={locked ? `Locked by count plan ${b.lockedBy}: stock can't leave this location until the count is finished or cancelled` : undefined}
                      className={cn("border-t border-border", locked ? "cursor-not-allowed bg-surface-sunken/40 text-faint" : "cursor-pointer hover:bg-surface-sunken/60", active && "bg-primary-soft")}
                      onClick={() => { if (!locked) choose(b); }}>
                      <td className="px-3 py-1.5">
                        <input type="radio" name="source" aria-label={locked ? `${b.locationCode} is locked by count plan ${b.lockedBy}` : `Use ${b.locationCode}`} checked={active} disabled={locked} onChange={() => choose(b)} className="accent-[var(--color-primary)] disabled:cursor-not-allowed" />
                      </td>
                      <td className={cn("px-3 py-1.5 font-semibold", locked ? "text-faint" : "text-foreground")}>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {b.locationCode}
                          {locked ? <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger"><Lock className="h-2.5 w-2.5" aria-hidden />Locked · {b.lockedBy}</span> : null}
                          {suggested?.id === b.id ? <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success" title="First expiring / first received bucket that covers the quantity">FEFO pick</span> : null}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-secondary">{b.lpNumber ?? "–"}</td>
                      <td className="px-3 py-1.5 text-secondary">{b.lotNumber ?? "–"}</td>
                      <td className="px-3 py-1.5 text-secondary">{b.expiryDate?.slice(0, 10) ?? "–"}</td>
                      <td className="px-3 py-1.5 text-secondary">{b.productionDate?.slice(0, 10) ?? "–"}</td>
                      <td className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", enough ? "text-foreground" : "text-warning")} title={enough ? undefined : "Less than the work order needs"}>{b.freeQty}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {lockedCount > 0 ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-secondary"><Lock className="h-3 w-3 text-danger" aria-hidden />{lockedCount} bucket{lockedCount === 1 ? " is" : "s are"} in a location locked by a count plan and can&rsquo;t be used until the count is finished or cancelled.</p>
        ) : null}
        {warehouseId && !stock.isPending && !stock.error ? (
          <fieldset className="mt-4 flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-[12px] font-semibold text-foreground">Attributes</legend>
            {picked.locationId ? (
              <p className="text-[12px] text-secondary">Taken from the selected stock: lot <strong className="text-foreground">{picked.lotNumber ?? "–"}</strong> · expiry <strong className="text-foreground">{picked.expiryDate?.slice(0, 10) ?? "–"}</strong> · production <strong className="text-foreground">{picked.productionDate?.slice(0, 10) ?? "–"}</strong>. Clear the source to enter attributes instead.</p>
            ) : requireLocation ? (
              <p className="text-[12px] text-secondary">Without picking, choose a stock row above; its lot, expiry and production date are used.</p>
            ) : (
              <>
                <p className="text-[12px] text-secondary">No fixed location: allocation picks FEFO stock that matches these attributes.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field id="srcLot" label="Lot / batch number">
                    <TextField id="srcLot" value={picked.lotNumber ?? ""} maxLength={120} placeholder="Any lot" onChange={(e) => patchAttr({ lotNumber: e.target.value.trim() ? e.target.value : null })} />
                  </Field>
                  <Field id="srcExpiry" label="Expiry date">
                    <DatePicker id="srcExpiry" value={fromDateOnly(picked.expiryDate)} onChange={(d) => patchAttr({ expiryDate: toDateOnly(d) })} />
                  </Field>
                  <Field id="srcProduction" label="Production date">
                    <DatePicker id="srcProduction" value={fromDateOnly(picked.productionDate)} onChange={(d) => patchAttr({ productionDate: toDateOnly(d) })} />
                  </Field>
                </div>
              </>
            )}
          </fieldset>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" className="mr-auto" disabled={!picked.locationId && !hasAttrs(picked)} onClick={() => setPicked(EMPTY_SOURCE)}>Clear source</Button>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <DisabledReason reason={applyReason}>
          <Button type="button" variant="primary" disabled={Boolean(applyReason)} onClick={() => { onChange(picked); onOpenChange(false); }}><Check className="h-3.5 w-3.5" aria-hidden />Apply</Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}
