"use client";

/**
 * Pencil on a wizard component card: choose the exact source inventory (location / LP /
 * lot / expiry / production date) the component is taken from. Required for "without
 * picking" work orders; optional (restricts allocation) for "with picking".
 */
import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
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

function Body({ onOpenChange, component, warehouseId, clientId, value, onChange }: ComponentSourceDialogProps & { readonly component: NonNullable<ComponentSourceDialogProps["component"]> }) {
  const stock = useApiQuery<StockBucket[]>(["kit-stock", component.productId, warehouseId ?? ""], warehouseId ? "/api/kits/stock" : null, {
    query: { productId: component.productId, warehouseId: warehouseId ?? "", clientId: clientId ?? "" }, staleTime: 0,
  });
  const buckets = stock.data?.data ?? [];
  const [picked, setPicked] = React.useState<SourceForm>(value);
  const choose = (b: StockBucket) => setPicked({ locationId: b.locationId, locationCode: b.locationCode, lpId: b.lpId, lpNumber: b.lpNumber, lotNumber: b.lotNumber, expiryDate: b.expiryDate, productionDate: b.productionDate });

  return (
    <>
      <DialogHeader title={`Source inventory · ${component.sku}`} description={`${component.name}. ${component.totalQty} units are needed for this work order. Choose where they come from.`} />
      <DialogBody>
        {!warehouseId ? <Callout variant="attention" title="Choose a warehouse first">Select the warehouse in step 1 to see its stock.</Callout> : stock.isPending ? (
          <div className="flex flex-col gap-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
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
                  return (
                    <tr key={b.id} className={cn("cursor-pointer border-t border-border hover:bg-surface-sunken/60", active && "bg-primary-soft")} onClick={() => choose(b)}>
                      <td className="px-3 py-1.5">
                        <input type="radio" name="source" aria-label={`Use ${b.locationCode}`} checked={active} onChange={() => choose(b)} className="accent-[var(--color-primary)]" />
                      </td>
                      <td className="px-3 py-1.5 font-semibold text-foreground">{b.locationCode}</td>
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
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" className="mr-auto" disabled={!picked.locationId} onClick={() => setPicked(EMPTY_SOURCE)}>Clear source</Button>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => { onChange(picked); onOpenChange(false); }}><Check className="h-3.5 w-3.5" aria-hidden />Apply</Button>
      </DialogFooter>
    </>
  );
}
