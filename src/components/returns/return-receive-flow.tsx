"use client";

/**
 * Return Station flows (M04 §4–5, KitStaks-designed):
 *  - Return With RMA: scan the RMA / order code / tracking number → RMA lines → scan
 *    items, set condition and reasons → Complete (or Save progress).
 *  - Return Manually: client, optional order, scan products → Complete creates a Manual RMA.
 * Completing posts Return receipts (ledger Return Receiving) and uploads item photos.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardCheck, ExternalLink, PackageOpen, RotateCcw, Save, Search } from "lucide-react";
import { ScanField, type ScanFieldHandle } from "@/components/packing/scan-field";
import { beepDone, beepError, beepOk } from "@/components/packing/scan-feedback";
import { uploadFile } from "@/components/shared/upload-file";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { useShortcut } from "@/lib/keyboard";
import { useMe } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";
import { ReturnItemList } from "./return-items";
import { addManualProduct, applyScan, itemsFromRma, itemsPayload, totals, updateItem, validateItems, type CaptureItem, type ItemErrors } from "./return-station-model";
import type { ReturnDetail } from "./return-types";
import { errorText, useInvalidateReturns, useLookupOptions } from "./returns-client";
import { ShippedOrderPicker } from "./shipped-order-picker";

export interface StationContext {
  readonly warehouseId: string;
  readonly stationId: string;
  readonly stationCode: string;
  readonly targetLocationId: string | null;
  readonly targetLpId: string | null;
  readonly targetCode: string | null;
}

interface Candidate {
  readonly id: string; readonly rmaCode: string; readonly status: string; readonly orderCode: string | null; readonly customerName: string | null;
  readonly trackingNumber: string | null; readonly clientName: string; readonly requestedQty: number; readonly returnedQty: number; readonly receivable: boolean; readonly reason: string | null;
}

interface ReceiveResult {
  readonly returnOrderId: string; readonly rmaCode: string; readonly status: string; readonly receivedQty: number; readonly receiptIds: readonly string[]; readonly notified: number;
}

interface ResolvedProduct { readonly id: string; readonly sku: string; readonly name: string; readonly imageUrl: string | null }

function placement(s: StationContext) {
  return { stationLocationId: s.stationId, targetLocationId: s.targetLpId ? null : s.targetLocationId, targetLpId: s.targetLpId };
}

async function uploadPhotos(returnOrderId: string, photos: Readonly<Record<string, File>>): Promise<number> {
  let failed = 0;
  for (const file of Object.values(photos)) {
    try {
      const fileId = await uploadFile(file, "attachment", { entityType: "return_order", entityId: returnOrderId });
      await apiRequest("/api/attachments", { method: "POST", body: { entityType: "return_order", entityId: returnOrderId, documentType: "Other", fileId } });
    } catch {
      failed += 1;
    }
  }
  return failed;
}

function Done({ result, onNext, onExit, nextLabel }: { readonly result: ReceiveResult; readonly onNext: () => void; readonly onExit: () => void; readonly nextLabel: string }) {
  React.useEffect(() => { beepDone(); }, []);
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center"><div role="status" className="contents">
      <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
      <h2 className="text-[18px] font-semibold">Return {result.rmaCode} received</h2>
      <p className="text-[13px] text-secondary">{result.receivedQty} unit{result.receivedQty === 1 ? "" : "s"} received on {result.receiptIds.length} receipt{result.receiptIds.length === 1 ? "" : "s"}. Status: <StatusPill status={result.status} domain="return" size="sm" />{result.notified ? ` · ${result.notified} client user${result.notified === 1 ? "" : "s"} notified` : ""}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button variant="primary" autoFocus onClick={onNext}><RotateCcw className="h-3.5 w-3.5" aria-hidden />{nextLabel}</Button>
        <Link href={`/orders/returns/${result.returnOrderId}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-surface-sunken">View RMA<ExternalLink className="h-3.5 w-3.5" aria-hidden /></Link>
        <Button variant="ghost" onClick={onExit}>Back to station</Button>
      </div>
    </div></Card>
  );
}

function useCapture() {
  const [items, setItems] = React.useState<CaptureItem[]>([]);
  const [errors, setErrors] = React.useState<ItemErrors>({});
  const [photos, setPhotos] = React.useState<Record<string, File>>({});
  const [highlight, setHighlight] = React.useState<string | null>(null);
  const reset = (next: CaptureItem[] = []) => { setItems(next); setErrors({}); setPhotos({}); setHighlight(null); };
  const onPhoto = (key: string, file: File | null) => setPhotos((p) => {
    const next = { ...p };
    if (file) next[key] = file;
    else delete next[key];
    return next;
  });
  const onChange = (key: string, patch: Partial<CaptureItem>) => { setItems((xs) => updateItem(xs, key, patch)); setErrors((e) => ({ ...e, [key]: {} })); };
  return { items, setItems, errors, setErrors, photos, onPhoto, highlight, setHighlight, reset, onChange };
}

function Totals({ items }: { readonly items: readonly CaptureItem[] }) {
  const t = totals(items);
  return (
    <div className="flex items-center gap-3 text-[12px] text-secondary">
      <span className="tabular-nums"><strong className="text-[15px] text-foreground">{t.scanned}</strong>{t.expected !== null ? ` / ${t.expected}` : ""} units</span>
      {t.expected ? <ProgressBar value={t.scanned} max={t.expected} tone={t.scanned >= t.expected ? "success" : "primary"} className="w-32" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------- with RMA */

export function ReturnWithRma({ station, initialCode, onExit }: { readonly station: StationContext; readonly initialCode?: string | null; readonly onExit: () => void }) {
  const invalidate = useInvalidateReturns();
  const lookupRef = React.useRef<ScanFieldHandle>(null);
  const itemRef = React.useRef<ScanFieldHandle>(null);
  const [lookupBusy, setLookupBusy] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<readonly Candidate[] | null>(null);
  const [rma, setRma] = React.useState<ReturnDetail | null>(null);
  const [itemError, setItemError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<"complete" | "partial" | null>(null);
  const [result, setResult] = React.useState<ReceiveResult | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const cap = useCapture();
  const damage = useLookupOptions("damage_reason", rma?.clientId);
  const reasons = useLookupOptions("return_reason", rma?.clientId);

  const load = React.useCallback(async (id: string) => {
    const { data } = await apiRequest<ReturnDetail>(`/api/returns/${id}`);
    setRma(data);
    setCandidates(null);
    cap.reset(itemsFromRma(data.lines));
    beepOk();
    requestAnimationFrame(() => itemRef.current?.focus());
  }, [cap]);

  const lookup = async (code: string) => {
    setLookupBusy(true);
    setLookupError(null);
    try {
      const { data } = await apiRequest<readonly Candidate[]>("/api/returns/lookup", { query: { warehouseId: station.warehouseId, code } });
      if (data.length === 0) throw new Error(`No return found for "${code}" in this warehouse.`);
      const receivable = data.filter((c) => c.receivable);
      if (receivable.length === 1 && data.length === 1) await load(receivable[0]?.id ?? "");
      else if (receivable.length === 0) throw new Error(data[0]?.reason ?? "This return can't be received.");
      else setCandidates(data);
    } catch (e) {
      beepError();
      lookupRef.current?.flash("error");
      setLookupError(errorText(e));
    } finally {
      setLookupBusy(false);
    }
  };

  const ran = React.useRef(false);
  React.useEffect(() => {
    if (initialCode && !ran.current) { ran.current = true; void lookup(initialCode); }
  });

  const scanItem = async (code: string) => {
    if (!rma) return;
    let out = applyScan(cap.items, code);
    if (!out.ok) {
      try {
        const { data } = await apiRequest<ResolvedProduct | null>("/api/returns/products", { query: { clientId: rma.clientId, code } });
        if (data) {
          const withCode = cap.items.map((i) => (i.productId === data.id ? { ...i, scanCodes: [...i.scanCodes, code.toLowerCase()] } : i));
          const retry = applyScan(withCode, code);
          if (retry.ok || cap.items.some((i) => i.productId === data.id)) out = retry;
          else out = { ok: false, error: `${data.sku} is not on RMA ${rma.rmaCode}.` };
        }
      } catch {
        /* keep the first message */
      }
    }
    if (!out.ok) {
      beepError();
      itemRef.current?.flash("error");
      setItemError(out.error);
      toast.error("Wrong item", out.error);
      return;
    }
    beepOk();
    itemRef.current?.flash("ok");
    setItemError(null);
    cap.setItems(out.items);
    cap.setHighlight(out.key);
  };

  const submit = async (complete: boolean) => {
    if (!rma) return;
    const v = validateItems(cap.items);
    cap.setErrors(v.errors);
    if (v.message) { setSubmitError(v.message); beepError(); return; }
    setSaving(complete ? "complete" : "partial");
    setSubmitError(null);
    try {
      const { data } = await apiRequest<ReceiveResult>("/api/returns/receive", {
        method: "POST", body: { returnOrderId: rma.id, ...placement(station), items: itemsPayload(cap.items, true), complete },
      });
      const failedPhotos = await uploadPhotos(rma.id, cap.photos);
      if (failedPhotos) toast.warning("Some photos weren't saved", `${failedPhotos} photo${failedPhotos === 1 ? "" : "s"} failed to upload. Add them from the RMA.`);
      await invalidate();
      if (!complete && data.status !== "Completed") {
        toast.success("Progress saved", `${data.receivedQty} unit${data.receivedQty === 1 ? "" : "s"} received on ${data.rmaCode}. Status: ${data.status}.`);
        await load(rma.id);
        return;
      }
      setResult(data);
    } catch (e) {
      beepError();
      setSubmitError(errorText(e, "The return could not be received."));
    } finally {
      setSaving(null);
    }
  };

  useShortcut("F9", (e) => { e.preventDefault(); if (rma && !saving) void submit(true); }, { enabled: Boolean(rma) && !result, allowInInputs: true, description: "Complete the return", group: "Return station" });

  const startOver = () => { setResult(null); setRma(null); setCandidates(null); cap.reset(); setSubmitError(null); setItemError(null); requestAnimationFrame(() => lookupRef.current?.focus()); };

  if (result) return <Done result={result} onNext={startOver} onExit={onExit} nextLabel="Receive next return" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onExit}><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Station</Button>
        <p className="text-[12px] text-secondary">Return with RMA · {station.stationCode}{station.targetCode ? ` → ${station.targetCode}` : ""}</p>
      </div>
      <Card className="p-4">
        <ScanField ref={lookupRef} id="rma-lookup" label="RMA, order code or tracking number" onScan={lookup} busy={lookupBusy} error={lookupError} autoFocus={!rma}
          hint="Scan the return label, the packing slip or type the RMA code." size={rma ? "md" : "lg"} />
        {candidates ? (
          <div className="mt-3 space-y-1.5" role="listbox" aria-label="Matching returns">
            <p className="text-[12px] font-medium text-body">{candidates.length} returns match. Choose one:</p>
            {candidates.map((c) => (
              <button key={c.id} type="button" role="option" aria-selected={false} disabled={!c.receivable} onClick={() => void load(c.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-[13px] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" title={c.reason ?? undefined}>
                <span><strong>{c.rmaCode}</strong> · {c.orderCode ?? "Manual"} · {c.customerName ?? "—"}</span>
                <span className="flex items-center gap-2 text-[12px] text-secondary">{c.returnedQty}/{c.requestedQty}<StatusPill status={c.status} domain="return" size="sm" /></span>
              </button>
            ))}
          </div>
        ) : null}
      </Card>
      {rma ? (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="flex items-center gap-2 text-[15px] font-semibold">RMA {rma.rmaCode}<StatusPill status={rma.status} domain="return" size="sm" /></p>
              <p className="text-[12px] text-secondary">{rma.order?.code ?? "Manual"} · {rma.customerName ?? "—"} · {rma.clientName}{rma.trackingNumber ? ` · ${rma.trackingNumber}` : ""}</p>
            </div>
            <Totals items={cap.items} />
          </Card>
          {cap.items.length === 0 ? (
            <Callout variant="info" title="Nothing left to receive">Every line of {rma.rmaCode} is already received. Complete it from the RMA page.</Callout>
          ) : (
            <>
              <Card className="p-4">
                <ScanField ref={itemRef} id="rma-item" label="Scan item" onScan={scanItem} error={itemError} hint={<>Each scan adds one unit. <Kbd>F9</Kbd> completes the return.</>} />
              </Card>
              <ReturnItemList items={cap.items} errors={cap.errors} highlightKey={cap.highlight} damageReasons={damage} returnReasons={reasons} photos={cap.photos} onPhoto={cap.onPhoto}
                onChange={cap.onChange} targetCode={station.targetCode} stationCode={station.stationCode} />
            </>
          )}
          {submitError ? <Callout variant="error" title="Not received">{submitError}</Callout> : null}
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface py-3">
            <Button variant="ghost" onClick={startOver} disabled={Boolean(saving)}>Scan another RMA</Button>
            <Button variant="secondary" onClick={() => void submit(false)} disabled={Boolean(saving) || cap.items.length === 0}><Save className="h-3.5 w-3.5" aria-hidden />{saving === "partial" ? "Saving…" : "Save progress"}</Button>
            <Button variant="primary" onClick={() => void submit(true)} disabled={Boolean(saving) || cap.items.length === 0}><ClipboardCheck className="h-3.5 w-3.5" aria-hidden />{saving === "complete" ? "Completing…" : "Complete return"}<Kbd className="ml-1 border-white/30 bg-white/15 text-white shadow-none">F9</Kbd></Button>
          </div>
        </>
      ) : !candidates ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center text-secondary">
          <Search className="h-8 w-8 text-faint" aria-hidden />
          <p className="text-[13px]">Scan a return to load its lines.</p>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- manual */

export function ReturnManually({ station, onExit }: { readonly station: StationContext; readonly onExit: () => void }) {
  const me = useMe();
  const invalidate = useInvalidateReturns();
  const clients = me.data?.data.contextOptions.clients ?? [];
  const [clientId, setClientId] = React.useState<string | null>(me.data?.data.context.clientId ?? null);
  const [order, setOrder] = React.useState<{ id: string; code: string } | null>(null);
  const [customerName, setCustomerName] = React.useState("");
  const [note, setNote] = React.useState("");
  const [picking, setPicking] = React.useState(false);
  const [itemError, setItemError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ReceiveResult | null>(null);
  const itemRef = React.useRef<ScanFieldHandle>(null);
  const cap = useCapture();
  const damage = useLookupOptions("damage_reason", clientId);
  const reasons = useLookupOptions("return_reason", clientId);

  const changeClient = (id: string | null) => {
    if (cap.items.length && id !== clientId) cap.reset();
    setClientId(id);
    setOrder(null);
    setClientError(null);
  };

  const scan = async (code: string) => {
    if (!clientId) { setClientError("Choose the client first"); beepError(); return; }
    setBusy(true);
    try {
      const { data } = await apiRequest<ResolvedProduct | null>("/api/returns/products", { query: { clientId, code } });
      if (!data) throw new Error(`No product of this client matches "${code}".`);
      const out = addManualProduct(cap.items, data, code);
      cap.setItems(out.items);
      cap.setHighlight(out.key);
      setItemError(null);
      beepOk();
      itemRef.current?.flash("ok");
    } catch (e) {
      beepError();
      itemRef.current?.flash("error");
      const msg = errorText(e);
      setItemError(msg);
      toast.error("Product not found", msg);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!clientId) { setClientError("Choose the client"); return; }
    const v = validateItems(cap.items);
    cap.setErrors(v.errors);
    if (v.message) { setSubmitError(v.message === "Scan at least one item" ? "Scan at least one product" : v.message); beepError(); return; }
    setSaving(true);
    setSubmitError(null);
    try {
      const { data } = await apiRequest<ReceiveResult>("/api/returns/manual", {
        method: "POST",
        body: { warehouseId: station.warehouseId, clientId, shipmentOrderId: order?.id ?? null, customerName: customerName.trim() || null, note: note.trim() || null, ...placement(station), items: itemsPayload(cap.items, false) },
      });
      const failed = await uploadPhotos(data.returnOrderId, cap.photos);
      if (failed) toast.warning("Some photos weren't saved", "Add them from the RMA.");
      await invalidate();
      setResult(data);
    } catch (e) {
      beepError();
      setSubmitError(errorText(e, "The manual return could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  useShortcut("F9", (e) => { e.preventDefault(); if (!saving) void submit(); }, { enabled: cap.items.length > 0 && !result, allowInInputs: true, description: "Complete the return", group: "Return station" });

  if (result) {
    return <Done result={result} onExit={onExit} nextLabel="Start another manual return" onNext={() => { setResult(null); cap.reset(); setOrder(null); setCustomerName(""); setNote(""); }} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onExit}><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Station</Button>
        <p className="text-[12px] text-secondary">Return manually · {station.stationCode}{station.targetCode ? ` → ${station.targetCode}` : ""}</p>
      </div>
      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-client" className="text-[12px] font-semibold text-body">Client <span className="text-danger">*</span></label>
          <Select id="manual-client" value={clientId} invalid={Boolean(clientError)} onChange={changeClient} options={clients.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))} placeholder="Choose the client" />
          {clientError ? <p className="text-[11px] text-danger">{clientError}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-body">Shipment order <span className="font-normal text-secondary">(optional)</span></span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="flex-1 justify-start" disabled={!clientId} onClick={() => setPicking(true)} title={clientId ? undefined : "Choose the client first"}>
              <PackageOpen className="h-3.5 w-3.5" aria-hidden />{order ? order.code : "Link a shipped order"}
            </Button>
            {order ? <Button variant="ghost" onClick={() => setOrder(null)}>Clear</Button> : null}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-customer" className="text-[12px] font-semibold text-body">Customer name</label>
          <TextField id="manual-customer" value={customerName} maxLength={200} onChange={(e) => setCustomerName(e.target.value)} placeholder={order ? "From the order" : "Who sent it back"} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-note" className="text-[12px] font-semibold text-body">Note</label>
          <TextField id="manual-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. No RMA in the box" />
        </div>
      </Card>
      <Card className={cn("p-4", !clientId && "opacity-70")}>
        <ScanField ref={itemRef} id="manual-item" label="Scan product" onScan={scan} busy={busy} error={itemError} disabled={!clientId} autoFocus
          hint={clientId ? <>SKU or barcode. Each scan adds one unit. <Kbd>F9</Kbd> completes.</> : "Choose the client to start scanning."} />
      </Card>
      {cap.items.length ? (
        <>
          <div className="flex justify-end"><Totals items={cap.items} /></div>
          <ReturnItemList items={cap.items} errors={cap.errors} highlightKey={cap.highlight} damageReasons={damage} returnReasons={reasons} photos={cap.photos} onPhoto={cap.onPhoto}
            onChange={cap.onChange} onRemove={(key) => cap.setItems(cap.items.filter((i) => i.key !== key))} targetCode={station.targetCode} stationCode={station.stationCode} />
        </>
      ) : null}
      {submitError ? <Callout variant="error" title="Not saved">{submitError}</Callout> : null}
      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-surface py-3">
        <Button variant="ghost" onClick={onExit} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving || cap.items.length === 0}><ClipboardCheck className="h-3.5 w-3.5" aria-hidden />{saving ? "Saving…" : "Complete manual return"}<Kbd className="ml-1 border-white/30 bg-white/15 text-white shadow-none">F9</Kbd></Button>
      </div>
      <ShippedOrderPicker open={picking} onOpenChange={setPicking} clientId={clientId} warehouseId={station.warehouseId} title="Link a shipped order" confirmLabel="Link order"
        onPick={async (id) => {
          if (id) {
            try {
              const { data } = await apiRequest<readonly { id: string; code: string; customerName?: string }[]>("/api/returns/shippable", { query: { orderIds: id } });
              const o = data[0];
              if (o?.code) { setOrder({ id: o.id, code: o.code }); if (!customerName && o.customerName) setCustomerName(o.customerName); }
            } catch (e) {
              toast.error("Order not linked", errorText(e));
            }
          }
          setPicking(false);
        }} />
    </div>
  );
}
