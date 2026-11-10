"use client";

/**
 * Disassemble Kit (Logiwa bulk action, single work order). Pick the kit stock to break
 * down and how many kits, then where the components go. Posts ledger "Disassemble Kit"
 * and one DisassembleKit receipt per component.
 */
import * as React from "react";
import { PackageOpen, RefreshCw } from "lucide-react";
import { LocationPicker, LpPicker } from "@/components/shared/entity-pickers";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { errorMessage, useInvalidateWorkOrders, type StockBucket, type WorkOrderDetail } from "./wo-client";
import { Field, focusFirst } from "./wo-ui";

export interface DisassembleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workOrderId: string | null;
  readonly onDone?: () => void;
}

export function DisassembleDialog({ open, onOpenChange, workOrderId, onDone }: DisassembleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {open && workOrderId ? <Body key={workOrderId} workOrderId={workOrderId} onClose={() => onOpenChange(false)} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type Key = "sourceInventoryId" | "qty" | "targetLocationId";

export function bucketLabel(b: StockBucket): string {
  const bits = [b.locationCode, b.lpNumber ? `LP ${b.lpNumber}` : null, b.lotNumber ? `lot ${b.lotNumber}` : null, b.expiryDate ? `exp ${b.expiryDate.slice(0, 10)}` : null].filter(Boolean);
  return `${bits.join(" · ")} — ${b.freeQty} free`;
}

function Body({ workOrderId, onClose, onDone }: { readonly workOrderId: string; readonly onClose: () => void; readonly onDone?: () => void }) {
  const detail = useApiQuery<WorkOrderDetail>(["work-order", workOrderId], `/api/work-orders/${encodeURIComponent(workOrderId)}`, { staleTime: 0 });
  const d = detail.data?.data;
  const wo = d?.workOrder;
  const stock = useApiQuery<StockBucket[]>(["kit-stock", wo?.kitProductId ?? "", wo?.warehouseId ?? ""], wo ? "/api/kits/stock" : null, {
    query: wo ? { productId: wo.kitProductId, warehouseId: wo.warehouseId, clientId: wo.clientId } : undefined, staleTime: 0,
  });
  const invalidate = useInvalidateWorkOrders();
  const [pickedBucket, setBucketId] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState<number | null>(1);
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [targetLp, setTargetLp] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<Key, string>>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buckets = (stock.data?.data ?? []).filter((b) => b.freeQty > 0);

  const bucketId = pickedBucket ?? buckets[0]?.id ?? null;

  if (!d || !wo) {
    return (
      <>
        <DialogHeader title="Disassemble kit" />
        <DialogBody>{detail.error ? <Callout variant="error" title="Work order not available">{detail.error.message}</Callout> : <div className="flex flex-col gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-24 w-full" /></div>}</DialogBody>
      </>
    );
  }

  const left = Math.max(0, wo.processedQty - d.disassembledQty);
  const bucket = buckets.find((b) => b.id === bucketId) ?? null;
  const max = Math.min(left, bucket?.freeQty ?? left);
  const n = qty ?? 0;

  const validate = (): boolean => {
    const next: Partial<Record<Key, string>> = {};
    if (!bucketId) next.sourceInventoryId = "Select the kit stock to disassemble";
    if (!qty || qty < 1) next.qty = "Enter how many kits to disassemble";
    else if (qty > max) next.qty = `At most ${max} kits can be disassembled from this stock`;
    if (!targetId) next.targetLocationId = "Select a component location";
    setErrors(next);
    const keys = (["sourceInventoryId", "qty", "targetLocationId"] as const).filter((k) => next[k]);
    focusFirst(rootRef.current, keys);
    return keys.length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await apiFetch<{ receiptIds: readonly string[] }>("/api/work-orders/disassemble", {
        method: "POST", body: { workOrderId: wo.id, version: wo.version, qty, sourceInventoryId: bucketId, targetLocationId: targetId, targetLpId: targetLp },
      });
      toast.success("Success", `${qty} ${d.kit.sku} kit${qty === 1 ? "" : "s"} disassembled. ${res.receiptIds.length} DisassembleKit receipt${res.receiptIds.length === 1 ? "" : "s"} created.`);
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

  const reason = saving ? "Disassembling…" : left <= 0 ? "Every kit built by this work order was already disassembled" : !stock.isPending && buckets.length === 0 ? "No free kit stock in this warehouse" : null;

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (!reason) void submit(); }} className="flex min-h-0 flex-col">
      <DialogHeader title="Disassemble kit" description={`Break ${d.kit.sku} kits back into their components. The kit stock goes down and each component is received as a DisassembleKit receipt.`} />
      <DialogBody>
        <div ref={rootRef} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-sunken/60 px-3 py-2.5 text-[12px]">
            <span className="flex items-center gap-2"><PackageOpen className="h-4 w-4 text-primary" aria-hidden /><span className="font-semibold text-foreground">{wo.code}</span><span className="text-secondary">{d.kit.sku}</span></span>
            <span className="ml-auto flex items-center gap-4 tabular-nums text-secondary">
              <span>Built <strong className="text-foreground">{wo.processedQty}</strong></span>
              <span>Disassembled <strong className="text-foreground">{d.disassembledQty}</strong></span>
              <span>Can disassemble <strong className="text-foreground">{left}</strong></span>
            </span>
          </div>
          {conflict ? (
            <Callout variant="attention" title="This record changed since you opened it" action={<Button type="button" size="sm" variant="secondary" onClick={() => { setConflict(false); void detail.refetch(); void stock.refetch(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reload</Button>}>
              Reload to see the latest quantities.
            </Callout>
          ) : null}
          {serverError ? <Callout variant="error" title="Not disassembled">{serverError}</Callout> : null}
          <Field id="sourceInventoryId" label="Kit stock" required error={errors.sourceInventoryId} info="Free, undamaged kit stock in the work order's warehouse.">
            {stock.isPending ? <Skeleton className="h-8 w-full" /> : (
              <Select id="sourceInventoryId" value={bucketId} onChange={(v) => { setBucketId(v); setErrors((e) => ({ ...e, sourceInventoryId: undefined })); }} invalid={Boolean(errors.sourceInventoryId)}
                placeholder={buckets.length ? "Select kit stock" : "No free kit stock"} disabled={buckets.length === 0}
                options={buckets.map((b) => ({ value: b.id, label: bucketLabel(b), textValue: b.locationCode }))} />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field id="qty" label="Kit quantity" required error={errors.qty} info={`Up to ${max}.`}>
              <NumberInput id="qty" value={qty} min={1} max={Math.max(1, max)} onChange={(v) => { setQty(v); setErrors((e) => ({ ...e, qty: undefined })); }} invalid={Boolean(errors.qty)} suffix="kits" />
            </Field>
            <Field id="targetLocationId" label="Component location" required error={errors.targetLocationId}>
              <LocationPicker id="targetLocationId" warehouseId={wo.warehouseId} value={targetId} onChange={(v) => { setTargetId(v); setErrors((e) => ({ ...e, targetLocationId: undefined })); }} invalid={Boolean(errors.targetLocationId)} />
            </Field>
            <Field id="targetLpId" label="Component LP">
              <LpPicker id="targetLpId" warehouseId={wo.warehouseId} value={targetLp} onChange={(v) => setTargetLp(v)} />
            </Field>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse text-[12px]">
              <caption className="sr-only">Components returned to stock</caption>
              <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                <tr><th scope="col" className="px-3 py-2">Component</th><th scope="col" className="px-3 py-2 text-right">Per kit</th><th scope="col" className="px-3 py-2 text-right">Returned</th></tr>
              </thead>
              <tbody>
                {d.components.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-3 py-1.5"><span className="font-semibold text-foreground">{c.sku}</span> <span className="text-secondary">{c.name}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{c.componentQty}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-success">+{c.componentQty * n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <DisabledReason reason={reason}>
          <Button type="submit" variant="primary" disabled={Boolean(reason)} aria-busy={saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" label="Disassembling" /> : null}
            Disassemble
          </Button>
        </DisabledReason>
      </DialogFooter>
    </form>
  );
}
