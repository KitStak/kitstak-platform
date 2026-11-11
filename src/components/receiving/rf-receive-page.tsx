"use client";

/**
 * RF receiving (`/receiving/rf`): the handheld, receive-by-scan path (Logiwa mobile partial
 * receiving). One column, large touch targets, every field accepts a scanner's Enter:
 *   1. Scan the PO (or tap an open PO).
 *   2. Scan the product barcode or SKU. Scanning the same product again adds one.
 *   3. Quantity, lot / expiry / production date and serials when the product tracks them.
 *   4. Scan the receiving location (the putaway suggestion is prefilled) and, optionally, an LP.
 *   5. Confirm posts one partial receipt through the same receive API as the desktop drawer
 *      and returns to step 2 for the next product; the session log lists every receipt.
 */
import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCircle2, MapPin, Minus, Package, Plus, RotateCcw, ScanLine, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { addSerial, EMPTY_DRAFT, matchLine, openQty, rfReceiveBody, rfReceiveIssue, type RfDraft } from "@/lib/grid-defs/receiving/rf-receive";
import { errorMessage, PO_KEYS, useCan, useInvalidateReceiving, type PoDetail, type PoLineRow, type PoRow } from "./receiving-shared";

interface PickerOption { readonly id: string; readonly label: string; readonly sublabel?: string | null }
interface Suggestion { readonly suggestions: readonly { readonly locationId: string; readonly code: string; readonly reasons: readonly string[] }[]; readonly defaultLocation: { readonly id: string; readonly code: string } | null }
interface LpType { readonly id: string; readonly code: string }
interface LogEntry { readonly at: number; readonly sku: string; readonly qty: number; readonly location: string; readonly lp: string | null; readonly receipts: number }

const inputCls = "h-12 w-full rounded-lg border border-border-strong bg-surface px-3 text-md text-foreground placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";

/** Scan field: Enter submits, the text is selected after each scan so the next one replaces it. */
function ScanInput({ label, placeholder, onScan, autoFocus, busy, testId, inputRef }: {
  readonly label: string; readonly placeholder: string; readonly onScan: (value: string) => void; readonly autoFocus?: boolean; readonly busy?: boolean; readonly testId: string; readonly inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [value, setValue] = React.useState("");
  const local = React.useRef<HTMLInputElement>(null);
  const ref = inputRef ?? local;
  return (
    <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (!v) return; onScan(v); setValue(""); ref.current?.focus(); }}>
      <label className="text-xs font-semibold text-secondary" htmlFor={testId}>{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
          <input id={testId} data-testid={testId} ref={ref} className={`${inputCls} pl-10`} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go" />
        </div>
        <Button type="submit" variant="primary" className="h-12 px-4" disabled={busy || !value.trim()} aria-label={`Submit ${label}`}>{busy ? "…" : "Go"}</Button>
      </div>
    </form>
  );
}

function StepCard({ n, title, done, children, action }: { readonly n: number; readonly title: string; readonly done?: React.ReactNode; readonly children?: React.ReactNode; readonly action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-xs" aria-label={title}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-success text-white" : "bg-primary-soft text-primary"}`}>{done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}</span>
        <h2 className="flex-1 text-base font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {done ? <div className="text-base text-body">{done}</div> : null}
      {children}
    </section>
  );
}

function OpenPoList({ onPick }: { readonly onPick: (po: PoRow) => void }) {
  const q = useApiQuery<PoRow[]>(["rf-open-pos"], "/api/purchase-orders", { query: { "f.status": "in:Pending,Started", sort: "plannedReceivingDate", ps: 100 }, staleTime: 15_000 });
  const rows = q.data?.data ?? [];
  if (q.isPending) return <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  if (rows.length === 0) return <p className="text-sm text-secondary">No open purchase orders in your warehouses.</p>;
  return (
    <ul className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto ks-scroll" aria-label="Open purchase orders">
      {rows.slice(0, 30).map((po) => (
        <li key={po.id}>
          <button type="button" onClick={() => onPick(po)} className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left hover:border-primary hover:bg-primary-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-base font-semibold text-foreground">{po.code}</span>
              <span className="block truncate text-xs text-secondary">{po.vendorName} · {po.clientName}</span>
            </span>
            <span className="text-right text-xs tabular-nums text-secondary">{po.receivedQuantity.toLocaleString()}/{po.totalQuantity.toLocaleString()}</span>
            <StatusPill status={po.status} domain="purchaseOrder" size="sm" />
          </button>
        </li>
      ))}
    </ul>
  );
}

async function resolvePicker(kind: "locations" | "lps", code: string, warehouseId: string): Promise<PickerOption | null> {
  const { data } = await apiRequest<PickerOption[]>(`/api/pickers/${kind}`, { query: { q: code, warehouseId, limit: 20 } });
  return data.find((o) => o.label.trim().toLowerCase() === code.trim().toLowerCase()) ?? null;
}

function LineReceive({ po, line, onDone, onCancel, lpTypes, bump }: { readonly po: PoDetail; readonly line: PoLineRow; readonly onDone: (entry: LogEntry) => void; readonly onCancel: () => void; readonly lpTypes: readonly LpType[]; readonly bump: number }) {
  const invalidate = useInvalidateReceiving();
  const qc = useQueryClient();
  const [d, setD] = React.useState<RfDraft>({ ...EMPTY_DRAFT, lpTypeId: line.lpTypeId ?? lpTypes[0]?.id ?? null });
  /** The location the operator scanned; until then the putaway suggestion is used. */
  const [scanned, setScanned] = React.useState<{ readonly id: string; readonly code: string } | null>(null);
  const [lpCode, setLpCode] = React.useState<string | null>(null);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const set = (patch: Partial<RfDraft>) => { setD((prev) => ({ ...prev, ...patch })); setScanError(null); };
  const open = openQty(line);
  // Scanning the same product again adds one unit.
  const lastBump = React.useRef(bump);
  React.useEffect(() => {
    if (bump === lastBump.current) return;
    lastBump.current = bump;
    setD((prev) => ({ ...prev, quantity: Math.max(0, prev.quantity) + 1 }));
  }, [bump]);
  const suggest = useApiQuery<Suggestion>(["po-suggest", po.id, line.id, Math.max(1, d.quantity), "", "", ""], `/api/purchase-orders/${po.id}/suggest`, {
    query: { lineId: line.id, qty: Math.max(1, d.quantity) }, staleTime: 30_000, retry: false, placeholderData: (prev) => prev,
  });
  const top = suggest.data?.data.suggestions[0] ?? null;
  const fallback = suggest.data?.data.defaultLocation ?? null;
  // The location follows the newest putaway suggestion (or the default receiving location)
  // until the operator scans one; a scanned suggested location still counts as directed putaway.
  const suggested = top ? { id: top.locationId, code: top.code } : fallback;
  const location = scanned ?? suggested;
  const locCode = location?.code ?? null;
  const fromSuggestion = scanned ? (suggest.data?.data.suggestions ?? []).some((s) => s.locationId === scanned.id) : Boolean(top);
  const draft: RfDraft = { ...d, locationId: location?.id ?? null };

  const issue = rfReceiveIssue(line, draft);
  const serialNeed = line.tracking.serial ? d.quantity * Math.max(1, line.uomQuantity) : 0;

  const scanLocation = async (code: string) => {
    try {
      const hit = await resolvePicker("locations", code, po.warehouseId);
      if (!hit) { setScanError(`Location ${code} was not found in ${po.warehouseName}.`); return; }
      setScanned({ id: hit.id, code: hit.label });
      setScanError(null);
    } catch (e) { setScanError(errorMessage(e)); }
  };
  const scanLp = async (code: string) => {
    try {
      const hit = await resolvePicker("lps", code, po.warehouseId);
      if (!hit) { setScanError(`LP ${code} was not found. Switch to New LP to create one.`); return; }
      set({ lpMode: "existing", lpId: hit.id });
      setLpCode(hit.label);
    } catch (e) { setScanError(errorMessage(e)); }
  };

  const confirm = async () => {
    if (issue || busy) return;
    setBusy(true);
    try {
      const body = rfReceiveBody(line, draft, { version: po.version, fromSuggestion, suggestQty: fromSuggestion ? Math.max(1, d.quantity) : null });
      const { data } = await apiRequest<{ status: string; receivedUnits: number; receiptIds: string[] }>(`/api/purchase-orders/${po.id}/receive`, { method: "POST", body });
      toast.success("Received", `${d.quantity.toLocaleString()} × ${line.sku} into ${locCode ?? "the location"}. ${po.code} is ${data.status}.`);
      await qc.invalidateQueries({ queryKey: PO_KEYS.detail(po.id) });
      void invalidate();
      onDone({ at: Date.now(), sku: line.sku, qty: d.quantity, location: locCode ?? "", lp: d.lpMode === "existing" ? lpCode : d.lpMode === "new" ? "New LP" : null, receipts: data.receiptIds.length });
    } catch (e) {
      setScanError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="rf-line">
      <StepCard n={3} title="Quantity" action={<Button variant="ghost" size="sm" onClick={onCancel}><X className="h-4 w-4" aria-hidden />Change product</Button>}>
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-surface-sunken p-3">
          <Package className="h-8 w-8 shrink-0 text-faint" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-foreground">{line.sku}</p>
            <p className="truncate text-xs text-secondary">{line.productName}</p>
          </div>
          <div className="text-right text-xs text-secondary"><span className="block text-lg font-bold tabular-nums text-foreground" data-testid="rf-open">{open.toLocaleString()}</span>open of {line.orderedQuantity.toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="h-12 w-12" aria-label="One less" onClick={() => set({ quantity: Math.max(1, d.quantity - 1) })}><Minus className="h-5 w-5" aria-hidden /></Button>
          <input aria-label="Quantity" data-testid="rf-qty" inputMode="numeric" className={`${inputCls} text-center text-lg font-bold tabular-nums`} value={Number.isFinite(d.quantity) && d.quantity > 0 ? String(d.quantity) : ""}
            onChange={(e) => set({ quantity: e.target.value === "" ? 0 : Number(e.target.value.replace(/\D/g, "")) })} />
          <Button variant="secondary" className="h-12 w-12" aria-label="One more" onClick={() => set({ quantity: d.quantity + 1 })}><Plus className="h-5 w-5" aria-hidden /></Button>
          <Button variant="ghost" className="h-12" onClick={() => set({ quantity: Math.max(1, open) })} disabled={open < 1}>All open</Button>
        </div>
        <p className="mt-1 text-xs text-faint">{line.packType}{line.uomQuantity > 1 ? ` · ${line.uomQuantity} units each` : ""}</p>
        {line.tracking.lot || line.tracking.expiry || line.tracking.production ? (
          <div className="mt-3 grid grid-cols-1 gap-2">
            {line.tracking.lot ? <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">Lot/batch number<input data-testid="rf-lot" className={inputCls} value={d.lotNumber} onChange={(e) => set({ lotNumber: e.target.value })} autoComplete="off" /></label> : null}
            {line.tracking.expiry ? <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">Expiry date<input data-testid="rf-expiry" type="date" className={inputCls} value={d.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} /></label> : null}
            {line.tracking.production ? <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">Production date<input type="date" className={inputCls} value={d.productionDate} onChange={(e) => set({ productionDate: e.target.value })} /></label> : null}
          </div>
        ) : null}
        {line.tracking.serial ? (
          <div className="mt-3 flex flex-col gap-2">
            <ScanInput label={`Serial numbers (${d.serials.length}/${serialNeed})`} placeholder="Scan a serial number" testId="rf-serial" onScan={(v) => { const r = addSerial(d.serials, v); if (r.error) setScanError(r.error); else set({ serials: r.serials }); }} />
            {d.serials.length > 0 ? <ul className="flex flex-wrap gap-1.5">{d.serials.map((s) => <li key={s}><button type="button" className="rounded-full border border-border px-2 py-1 font-mono text-xs" onClick={() => set({ serials: d.serials.filter((x) => x !== s) })} aria-label={`Remove serial ${s}`}>{s} ×</button></li>)}</ul> : null}
          </div>
        ) : null}
      </StepCard>

      <StepCard n={4} title="Location and LP" done={locCode ? <span className="flex flex-wrap items-center gap-2"><MapPin className="h-4 w-4 text-primary" aria-hidden /><span className="font-mono font-semibold" data-testid="rf-location">{locCode}</span>{fromSuggestion ? <Badge tone="info" size="sm">Suggested</Badge> : <Badge tone="neutral" size="sm">Scanned</Badge>}</span> : undefined}>
        {suggest.isPending && !locCode ? <p className="mb-2 text-xs text-secondary">Finding the putaway location…</p> : null}
        {top && top.reasons[0] && fromSuggestion ? <p className="mb-2 text-xs text-secondary">{top.reasons[0]}</p> : null}
        <div className="mt-2 flex flex-col gap-3">
          <ScanInput label={locCode ? "Scan another location" : "Scan location"} placeholder="e.g. D-02-05-1" testId="rf-location-scan" onScan={(v) => void scanLocation(v)} />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-secondary">LP</span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="LP">
              {(["none", "existing", "new"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={d.lpMode === m} disabled={m === "new" && lpTypes.length === 0}
                  onClick={() => set({ lpMode: m, lpId: m === "existing" ? d.lpId : null })}
                  className={`h-11 rounded-lg border text-sm font-medium disabled:opacity-50 ${d.lpMode === m ? "border-primary bg-primary-soft text-primary" : "border-border text-body"}`}>
                  {m === "none" ? "No LP" : m === "existing" ? "Scan LP" : "New LP"}
                </button>
              ))}
            </div>
            {d.lpMode === "existing" ? (lpCode && d.lpId ? <p className="text-base">LP <span className="font-mono font-semibold">{lpCode}</span> <button type="button" className="ml-2 text-xs text-primary" onClick={() => { set({ lpId: null }); setLpCode(null); }}>Change</button></p> : <ScanInput label="Scan LP" placeholder="LP number" testId="rf-lp-scan" onScan={(v) => void scanLp(v)} />) : null}
            {d.lpMode === "new" ? (
              <select aria-label="LP type" className={inputCls} value={d.lpTypeId ?? ""} onChange={(e) => set({ lpTypeId: e.target.value || null })}>
                {lpTypes.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
              </select>
            ) : null}
          </div>
        </div>
      </StepCard>

      {d.quantity > open ? (
        <label className="flex items-start gap-3 rounded-xl border border-warning/50 bg-warning-soft p-3 text-sm text-warning">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={d.allowOverReceipt} onChange={(e) => set({ allowOverReceipt: e.target.checked })} data-testid="rf-over" />
          <span>Receive {(d.quantity - open).toLocaleString()} more than the open quantity ({open.toLocaleString()}).</span>
        </label>
      ) : null}
      {scanError ? <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{scanError}</p> : null}
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <p className="mb-2 min-h-[18px] text-xs text-secondary" aria-live="polite" data-testid="rf-issue">{issue ?? `Ready: ${d.quantity.toLocaleString()} × ${line.sku} into ${locCode ?? ""}.`}</p>
        <Button variant="primary" className="h-14 w-full text-md" disabled={Boolean(issue) || busy} onClick={() => void confirm()} data-testid="rf-confirm">
          <CheckCircle2 className="h-5 w-5" aria-hidden />{busy ? "Receiving…" : `Receive ${d.quantity.toLocaleString()}`}
        </Button>
      </div>
    </div>
  );
}

export function RfReceivePage() {
  const can = useCan("inventory.purchase_orders.receive_po");
  const [poId, setPoId] = React.useState<string | null>(null);
  const [lineId, setLineId] = React.useState<string | null>(null);
  const [lineKey, setLineKey] = React.useState(0);
  const [bump, setBump] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [log, setLog] = React.useState<readonly LogEntry[]>([]);
  const skuRef = React.useRef<HTMLInputElement>(null);
  const q = useApiQuery<PoDetail>(PO_KEYS.detail(poId ?? ""), poId ? `/api/purchase-orders/${poId}` : null, { retry: false });
  const po = q.data?.data ?? null;
  const lpTypes = useApiQuery<LpType[]>(["po-lp-types", po?.warehouseId ?? ""], po ? "/api/purchase-orders/lp-types" : null, { query: { warehouseId: po?.warehouseId ?? "" } }).data?.data ?? [];
  const line = po?.lines.find((l) => l.id === lineId) ?? null;
  const closed = po ? po.status === "Completed" || po.status === "Cancelled" : false;

  const scanPo = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiRequest<PoRow[]>("/api/purchase-orders", { query: { q: code, qm: "eq", ps: 100 } });
      const exact = data.filter((p) => p.code.toLowerCase() === code.toLowerCase() || (p.referenceNumber ?? "").toLowerCase() === code.toLowerCase());
      const hit = exact[0] ?? (data.length === 1 ? data[0] : undefined);
      if (!hit) setError(`No purchase order matches ${code}.`);
      else { setPoId(hit.id); setLineId(null); }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const scanSku = (code: string) => {
    if (!po) return;
    const hit = matchLine(po.lines, code);
    if (!hit) { setError(`${code} is not on ${po.code}.`); return; }
    setError(null);
    if (hit.id === lineId) { setBump((b) => b + 1); return; }
    setLineId(hit.id);
    setLineKey((k) => k + 1);
  };

  if (can.isLoading) return <div className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (!can.allowed) {
    return <div className="mx-auto max-w-md px-4 pt-4"><Callout variant="attention" title="You can't receive purchase orders">Ask an administrator for the Receive PO permission.</Callout></div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-8 pt-3" data-testid="rf-receive">
      <div className="flex items-center gap-2">
        <Link href="/receiving" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-surface-sunken" aria-label="Back to purchase orders"><ArrowLeft className="h-5 w-5" aria-hidden /></Link>
        <h1 className="flex-1 text-lg font-semibold text-foreground">RF receiving</h1>
        {log.length > 0 ? <Badge tone="success" size="sm">{log.length} received</Badge> : null}
      </div>

      <StepCard n={1} title="Purchase order"
        done={po ? <span className="flex flex-wrap items-center gap-2"><span className="font-mono font-semibold" data-testid="rf-po">{po.code}</span><StatusPill status={po.status} domain="purchaseOrder" size="sm" /><span className="text-xs text-secondary">{po.vendorName}</span></span> : undefined}
        action={po ? <Button variant="ghost" size="sm" onClick={() => { setPoId(null); setLineId(null); setError(null); }}><RotateCcw className="h-4 w-4" aria-hidden />Change</Button> : undefined}>
        {!poId ? (
          <div className="flex flex-col gap-3">
            <ScanInput label="Scan PO" placeholder="PO number or reference" testId="rf-po-scan" onScan={(v) => void scanPo(v)} autoFocus busy={busy} />
            <p className="text-xs font-semibold text-faint">Or pick an open PO</p>
            <OpenPoList onPick={(p) => { setPoId(p.id); setLineId(null); setError(null); }} />
          </div>
        ) : q.isPending ? <Skeleton className="h-6 w-1/2" /> : q.isError ? <Callout variant="error" title="Couldn't load the purchase order">{errorMessage(q.error)}</Callout> : null}
        {po ? (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken" aria-label={`${po.receivedQuantity} of ${po.totalQuantity} received`}>
            <div className="h-full bg-success transition-all" style={{ width: `${Math.min(100, po.totalQuantity ? (po.receivedQuantity / po.totalQuantity) * 100 : 0)}%` }} />
          </div>
        ) : null}
      </StepCard>

      {po && closed ? <Callout variant="attention" title={`${po.code} is ${po.status}`}>There is nothing left to receive on this order. Scan another PO.</Callout> : null}

      {po && !closed ? (
        <StepCard n={2} title="Product" done={line ? <span><span className="font-semibold">{line.sku}</span> <span className="text-xs text-secondary">{line.barcode}</span></span> : undefined}>
          <div className={line ? "mt-2" : ""}>
            <ScanInput inputRef={skuRef} label={line ? "Scan the next product" : "Scan product"} placeholder="Barcode or SKU" testId="rf-sku-scan" onScan={scanSku} autoFocus />
          </div>
          {!line ? (
            <ul className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border" aria-label="Open lines">
              {po.lines.map((l) => (
                <li key={l.id}>
                  <button type="button" className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-sunken" onClick={() => { setLineId(l.id); setLineKey((k) => k + 1); setError(null); }}>
                    <span className="min-w-0 flex-1"><span className="block truncate text-base font-semibold">{l.sku}</span><span className="block truncate text-xs text-secondary">{l.barcode}</span></span>
                    <span className={`text-sm tabular-nums ${openQty(l) === 0 ? "text-success" : "text-body"}`}>{l.receivedQuantity.toLocaleString()}/{l.orderedQuantity.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </StepCard>
      ) : null}

      {error ? <p role="alert" data-testid="rf-error" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p> : null}

      {po && line && !closed ? (
        <LineReceive key={`${line.id}-${lineKey}`} po={po} line={line} lpTypes={lpTypes} bump={bump} onCancel={() => setLineId(null)}
          onDone={(entry) => { setLog((prev) => [entry, ...prev]); setLineId(null); setTimeout(() => skuRef.current?.focus(), 0); }} />
      ) : null}

      {log.length > 0 ? (
        <section className="rounded-xl border border-border bg-surface p-4" aria-label="Received this session">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Received this session</h2>
          <ul className="flex flex-col gap-1.5 text-sm" data-testid="rf-log">
            {log.map((e) => (
              <li key={e.at} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                <span className="font-semibold">{e.qty.toLocaleString()} × {e.sku}</span>
                <span className="min-w-0 flex-1 truncate text-secondary">→ {e.location}{e.lp ? ` · ${e.lp}` : ""}</span>
              </li>
            ))}
          </ul>
          {po ? <Link href={`/receiving/${po.id}`} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Open {po.code} on desktop</Link> : null}
        </section>
      ) : null}
    </div>
  );
}
