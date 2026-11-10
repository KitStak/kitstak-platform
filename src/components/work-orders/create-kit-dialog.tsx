"use client";

/**
 * Create Kit (Logiwa bulk action, single work order). Asks for the kits to build
 * (≤ requested − processed), the output location / LP and the kit's lot, expiry and
 * production date when tracked. A live preview shows every component's consumption
 * against its free stock. Posts `/api/work-orders/create-kit` (ledger Kitting + Kitting receipt).
 */
import * as React from "react";
import { AlertTriangle, Boxes, CheckCircle2, RefreshCw } from "lucide-react";
import { LocationPicker, LpPicker } from "@/components/shared/entity-pickers";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { remainingQty } from "@/lib/grid-defs/work-orders/work-order-model";
import { errorMessage, useInvalidateWorkOrders, type WorkOrderDetail } from "./wo-client";
import { Field, focusFirst, fromDateOnly, toDateOnly } from "./wo-ui";

export interface CreateKitDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workOrderId: string | null;
  readonly onDone?: () => void;
}

export function CreateKitDialog({ open, onOpenChange, workOrderId, onDone }: CreateKitDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {open && workOrderId ? <Body key={workOrderId} workOrderId={workOrderId} onClose={() => onOpenChange(false)} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type Key = "qty" | "locationId" | "lotNumber" | "expiryDate" | "productionDate";

function Body({ workOrderId, onClose, onDone }: { readonly workOrderId: string; readonly onClose: () => void; readonly onDone?: () => void }) {
  const detail = useApiQuery<WorkOrderDetail>(["work-order", workOrderId], `/api/work-orders/${encodeURIComponent(workOrderId)}`, { staleTime: 0 });
  const invalidate = useInvalidateWorkOrders();
  const d = detail.data?.data;
  const [qty, setQty] = React.useState<number | null>(null);
  const [locationId, setLocationId] = React.useState<string | null>(null);
  const [locationLabel, setLocationLabel] = React.useState<string | undefined>(undefined);
  const [lpId, setLpId] = React.useState<string | null>(null);
  const [lot, setLot] = React.useState("");
  const [expiry, setExpiry] = React.useState<Date | null>(null);
  const [production, setProduction] = React.useState<Date | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<Key, string>>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const seeded = React.useRef(false);

  React.useEffect(() => {
    if (!d || seeded.current) return;
    seeded.current = true;
    setQty(remainingQty(d.workOrder));
    setLocationId(d.workOrder.outputLocationId);
    setLocationLabel(d.outputLocationCode ?? undefined);
    setLot(d.workOrder.outputLot ?? "");
    setExpiry(fromDateOnly(d.workOrder.outputExpiry));
  }, [d]);

  if (!d) {
    return (
      <>
        <DialogHeader title="Create kit" />
        <DialogBody>{detail.error ? <Callout variant="error" title="Work order not available">{detail.error.message}</Callout> : <div className="flex flex-col gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-28 w-full" /></div>}</DialogBody>
      </>
    );
  }

  const wo = d.workOrder;
  const remaining = remainingQty(wo);
  const withPicking = wo.type === "Work Order with Picking";
  const build = qty ?? 0;
  const lines = d.components.map((c) => {
    const need = c.componentQty * build;
    const reserved = withPicking ? c.allocatedQty : 0;
    const available = reserved + c.freeQty;
    return { ...c, need, available, short: Math.max(0, need - available) };
  });
  const anyShort = lines.some((l) => l.short > 0);

  const validate = (): boolean => {
    const next: Partial<Record<Key, string>> = {};
    if (!qty || qty < 1) next.qty = "Enter how many kits to build";
    else if (qty > remaining) next.qty = `At most ${remaining} kits are left to build`;
    if (!locationId) next.locationId = "Select an output location";
    if (d.kit.trackLot && !lot.trim()) next.lotNumber = `${d.kit.sku} is lot tracked; enter a lot number`;
    if (d.kit.trackExpiry && !expiry) next.expiryDate = `${d.kit.sku} is expiry tracked; enter an expiry date`;
    if (d.kit.trackProductionDate && !production) next.productionDate = "Enter the production date";
    setErrors(next);
    const keys = (["qty", "locationId", "lotNumber", "expiryDate", "productionDate"] as const).filter((k) => next[k]);
    focusFirst(rootRef.current, keys);
    return keys.length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await apiFetch<{ status: string; processedQty: number }>("/api/work-orders/create-kit", {
        method: "POST",
        body: { workOrderId: wo.id, version: wo.version, qty, locationId, lpId, lotNumber: lot.trim() || null, expiryDate: toDateOnly(expiry), productionDate: toDateOnly(production) },
      });
      toast.success("Success", `${qty} ${d.kit.sku} kit${qty === 1 ? "" : "s"} built on ${wo.code}. ${res.status === "Completed" ? "The work order is completed." : `${res.processedQty} of ${wo.requestedQty} built.`}`);
      await invalidate();
      onDone?.();
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      else setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const reason = saving ? "Building…" : anyShort ? "Some components are short for this quantity" : null;

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (!reason) void submit(); }} className="flex min-h-0 flex-col">
      <DialogHeader title="Create kit" description={`Build ${d.kit.sku} kits on ${wo.code}. Components are consumed from ${withPicking ? "their picked or allocated stock" : "their chosen source locations"}, and the kits are received into the output location.`} />
      <DialogBody>
        <div ref={rootRef} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-sunken/60 px-3 py-2.5 text-[12px]">
            <span className="flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" aria-hidden /><span className="font-semibold text-foreground">{d.kit.sku}</span><span className="text-secondary">{d.kit.name}</span></span>
            <span className="ml-auto flex items-center gap-4 tabular-nums text-secondary">
              <span>Requested <strong className="text-foreground">{wo.requestedQty}</strong></span>
              <span>Built <strong className="text-foreground">{wo.processedQty}</strong></span>
              <span>Left <strong className="text-foreground">{remaining}</strong></span>
            </span>
          </div>
          {conflict ? (
            <Callout variant="attention" title="This record changed since you opened it" action={<Button type="button" size="sm" variant="secondary" onClick={() => { setConflict(false); seeded.current = false; void detail.refetch(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reload</Button>}>
              Someone else updated this work order. Reload and check the quantities again.
            </Callout>
          ) : null}
          {serverError ? <Callout variant="error" title="Kits not built">{serverError}</Callout> : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field id="qty" label="Kit quantity" required error={errors.qty} info={`Up to ${remaining} (requested − processed).`}>
              <NumberInput id="qty" value={qty} min={1} max={remaining} onChange={(v) => { setQty(v); setErrors((e) => ({ ...e, qty: undefined })); }} invalid={Boolean(errors.qty)} suffix="kits" />
            </Field>
            <Field id="locationId" label="Output location" required error={errors.locationId} info="Where the built kits are received. Defaults to the kitting area.">
              <LocationPicker id="locationId" warehouseId={wo.warehouseId} value={locationId} selectedLabel={locationLabel} onChange={(v, o) => { setLocationId(v); setLocationLabel(o?.label); setErrors((e) => ({ ...e, locationId: undefined })); }} invalid={Boolean(errors.locationId)} />
            </Field>
            <Field id="lpId" label="Output LP">
              <LpPicker id="lpId" warehouseId={wo.warehouseId} value={lpId} onChange={(v) => setLpId(v)} />
            </Field>
            <Field id="lotNumber" label="Lot number" required={d.kit.trackLot} error={errors.lotNumber}>
              <TextField id="lotNumber" value={lot} maxLength={120} placeholder={d.kit.trackLot ? "Enter lot number" : "Optional"} invalid={Boolean(errors.lotNumber)} onChange={(e) => { setLot(e.target.value); setErrors((x) => ({ ...x, lotNumber: undefined })); }} />
            </Field>
            <Field id="expiryDate" label="Expiry date" required={d.kit.trackExpiry} error={errors.expiryDate}>
              <DatePicker id="expiryDate" value={expiry} onChange={(v) => { setExpiry(v); setErrors((x) => ({ ...x, expiryDate: undefined })); }} invalid={Boolean(errors.expiryDate)} />
            </Field>
            <Field id="productionDate" label="Production date" required={d.kit.trackProductionDate} error={errors.productionDate}>
              <DatePicker id="productionDate" value={production} onChange={(v) => { setProduction(v); setErrors((x) => ({ ...x, productionDate: undefined })); }} invalid={Boolean(errors.productionDate)} />
            </Field>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse text-[12px]">
              <caption className="sr-only">Component consumption</caption>
              <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                <tr><th scope="col" className="px-3 py-2">Component</th><th scope="col" className="px-3 py-2 text-right">Per kit</th><th scope="col" className="px-3 py-2 text-right">Consumes</th><th scope="col" className="px-3 py-2 text-right">{withPicking ? "Reserved + free" : "Free"}</th><th scope="col" className="px-3 py-2">Source</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-1.5"><span className="font-semibold text-foreground">{l.sku}</span> <span className="text-secondary">{l.name}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.componentQty}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-foreground">{l.need}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums", l.short > 0 ? "font-semibold text-danger" : "text-secondary")}>
                      <span className="inline-flex items-center gap-1">{l.short > 0 ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <CheckCircle2 className="h-3 w-3 text-success" aria-hidden />}{l.available}</span>
                    </td>
                    <td className="px-3 py-1.5 text-secondary">{l.locationCode ?? (withPicking ? "Kitting area" : "FEFO")}{l.lotNumber ? ` · lot ${l.lotNumber}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {anyShort ? <Callout variant="attention" title="Not enough components">Lower the kit quantity, or move stock to the chosen source locations first.</Callout> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <DisabledReason reason={reason}>
          <Button type="submit" variant="primary" disabled={Boolean(reason)} aria-busy={saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" label="Building" /> : null}
            Create kit
          </Button>
        </DisabledReason>
      </DialogFooter>
    </form>
  );
}
