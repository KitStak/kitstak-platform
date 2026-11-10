"use client";

/**
 * Pack screen (`/packing-station/[stationId]/[mode]`, M04 §2). Left: mode tabs, source
 * scan (wedge + Enter), job card, product scan, order card. Right: packages, contents,
 * captures, carrier / service with Get Rate and pre-generated label upload. Footer:
 * Other Actions ▴ (Report Issue, Print Actions, Pack Without Label) and Complete
 * Packing And Create Label. Keyboard: Enter scans, F2 closes the package, F9 completes.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, ChevronUp, ClipboardList, FileText, Gift, ListChecks, PackageCheck, PackageX, Printer, RotateCcw, Truck, X } from "lucide-react";
import { uploadFile } from "@/components/shared/upload-file";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/api-client";
import { useShortcut } from "@/lib/keyboard";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { errorText, openFileId, useHydratedCan } from "@/components/returns/returns-client";
import { ListSelectModal } from "./list-select-modal";
import { buildCompletePayload, cancelSerial, closeBox, completeBlocker, initialPackState, scanProduct, totalsOf, boxWeightOz, type PackState } from "./pack-model";
import { CarrierPanel, Captures, ContentsSummary, PackageBoxes, PackHints, type CarrierChoice } from "./pack-packages";
import { MODE_LABELS, PACK_MODES, type CompleteResult, type PackContext, type PackMode, type RateQuote, type ScanResponse } from "./pack-types";
import { ReportIssueDialog } from "./report-issue-dialog";
import { ScanField, type ScanFieldHandle } from "./scan-field";
import { beepDone, beepError, beepOk } from "./scan-feedback";

interface Station { readonly id: string; readonly code: string; readonly warehouseId: string; readonly description: string | null }

function defaultChoice(ctx: PackContext): CarrierChoice {
  const byConn = ctx.carriers.find((c) => c.connectionId === ctx.order.carrierConnectionId && c.services.some((s) => s.id === ctx.order.carrierServiceId))
    ?? ctx.carriers.find((c) => c.services.some((s) => s.id === ctx.order.carrierServiceId));
  if (byConn) return { carrierKey: byConn.key, carrierServiceId: ctx.order.carrierServiceId };
  const first = ctx.carriers[0];
  return { carrierKey: first?.key ?? null, carrierServiceId: first?.services[0]?.id ?? null };
}

function ResultPanel({ result, onNext, nextLabel }: { readonly result: CompleteResult; readonly onNext: () => void; readonly nextLabel: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <div role="status" className="flex flex-col items-center gap-2">
        <PackageCheck className="h-12 w-12 text-success" aria-hidden />
        <h2 className="text-[18px] font-semibold">Order {result.orderCode} packed</h2>
        <p className="text-[13px] text-secondary">{result.packedUnits} unit{result.packedUnits === 1 ? "" : "s"} · status <StatusPill status={result.status} domain="shipmentOrder" size="sm" />{result.shipped ? " · auto-shipped" : ""}</p>
      </div>
      {result.masterTrackingNumber ? (
        <div className="w-full max-w-md rounded-lg border border-border text-left text-[13px]">
          <p className="border-b border-border px-3 py-2 font-semibold">Master tracking <span className="font-mono">{result.masterTrackingNumber}</span></p>
          <ul>{result.shipments.map((s) => (
            <li key={s.trackingNumber} className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 last:border-0">
              <span>Package {s.packageSeq} · <span className="font-mono">{s.trackingNumber}</span></span>
              <Button size="sm" variant="ghost" disabled={!s.labelFileId} onClick={() => openFileId(s.labelFileId)}><Printer className="h-3.5 w-3.5" aria-hidden />Label</Button>
            </li>
          ))}</ul>
        </div>
      ) : null}
      {result.labelError ? <Callout variant="error" title="Label not created">{result.labelError} The order is packed; create the label from the order.</Callout> : null}
      {result.warnings.map((w) => <Callout key={w} variant="attention" title="Heads up">{w}</Callout>)}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" autoFocus onClick={onNext}><RotateCcw className="h-3.5 w-3.5" aria-hidden />{nextLabel}</Button>
        {result.packingSlipFileId ? <Button variant="secondary" onClick={() => openFileId(result.packingSlipFileId)}><FileText className="h-3.5 w-3.5" aria-hidden />Packing slip</Button> : null}
        <Link href={`/orders/${result.orderId}`} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[13px] font-medium hover:bg-surface-sunken">View order</Link>
        <Link href="/shipments" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[13px] font-medium hover:bg-surface-sunken">Shipments</Link>
      </div>
    </Card>
  );
}

export function PackScreen({ stationId, mode }: { readonly stationId: string; readonly mode: PackMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const canCreateLabel = useHydratedCan("fulfillment.shipment_orders.create_label").allowed;
  const canReport = useHydratedCan("fulfillment.packing_station.report_issue").allowed;
  const canSlip = useHydratedCan("fulfillment.packing_station.print_packing_slip").allowed;
  const stationQ = useApiQuery<readonly Station[]>(["packing", "station", stationId], "/api/packing/stations", { query: { stationId } });
  const station = stationQ.data?.data[0] ?? null;

  const sourceRef = React.useRef<ScanFieldHandle>(null);
  const productRef = React.useRef<ScanFieldHandle>(null);
  const [scan, setScan] = React.useState<ScanResponse | null>(null);
  const [scanBusy, setScanBusy] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const [ctx, setCtx] = React.useState<PackContext | null>(null);
  const [ctxLoading, setCtxLoading] = React.useState(false);
  const [state, setState] = React.useState<PackState | null>(null);
  const [productError, setProductError] = React.useState<string | null>(null);
  const [choice, setChoice] = React.useState<CarrierChoice>({ carrierKey: null, carrierServiceId: null });
  const [rate, setRate] = React.useState<RateQuote | null>(null);
  const [rating, setRating] = React.useState(false);
  const [rateError, setRateError] = React.useState<string | null>(null);
  const [uploaded, setUploaded] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const [completing, setCompleting] = React.useState(false);
  const [completeError, setCompleteError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CompleteResult | null>(null);
  const [listOpen, setListOpen] = React.useState(mode === "order" && params.get("list") === "1");
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [noLabelOpen, setNoLabelOpen] = React.useState(false);

  const resetOrder = () => { setOrderId(null); setCtx(null); setState(null); setRate(null); setRateError(null); setUploaded(null); setShowErrors(false); setCompleteError(null); setProductError(null); };
  const resetAll = () => { resetOrder(); setScan(null); setScanError(null); setResult(null); requestAnimationFrame(() => sourceRef.current?.focus()); };

  const openOrder = React.useCallback(async (id: string) => {
    setCtxLoading(true);
    try {
      const { data } = await apiRequest<PackContext>(`/api/packing/orders/${id}`);
      const pkg = data.packages.find((p) => p.id === data.order.defaultPackageId) ?? null;
      setOrderId(id);
      setCtx(data);
      setState(initialPackState(data.lines.filter((l) => l.toPack > 0), pkg));
      setChoice(defaultChoice(data));
      setRate(null);
      setUploaded(null);
      setShowErrors(false);
      setCompleteError(null);
      requestAnimationFrame(() => productRef.current?.focus());
    } catch (e) {
      beepError();
      toast.error("Error", errorText(e));
    } finally {
      setCtxLoading(false);
    }
  }, []);

  const lookup = async (code: string) => {
    if (!station) return;
    setScanBusy(true);
    setScanError(null);
    try {
      const { data } = await apiRequest<ScanResponse>("/api/packing/scan", { query: { warehouseId: station.warehouseId, mode, code } });
      setScan(data);
      setResult(null);
      sourceRef.current?.flash("ok");
      beepOk();
      const first = data.orders.find((o) => o.packable);
      if (first) await openOrder(first.id);
    } catch (e) {
      beepError();
      sourceRef.current?.flash("error");
      const msg = errorText(e);
      setScanError(msg);
      toast.error("Error", msg);
    } finally {
      setScanBusy(false);
    }
  };

  const lines = React.useMemo(() => (ctx?.lines ?? []).filter((l) => l.toPack > 0), [ctx]);

  const onProduct = (code: string) => {
    if (!state) return;
    const out = scanProduct(lines, state, code);
    if (!out.ok) {
      beepError();
      productRef.current?.flash("error");
      setProductError(out.error);
      toast.error("Error", out.error);
      return;
    }
    beepOk();
    productRef.current?.flash("ok");
    setProductError(out.state.awaitingSerialFor ? out.message : null);
    setState(out.state);
    setRate(null);
  };

  const doClose = () => {
    if (!state) return;
    const out = closeBox(lines, state);
    if (out.error) { setShowErrors(true); beepError(); toast.error("Package not closed", out.error); return; }
    setState(out.state);
    setRate(null);
    beepOk();
    toast.success("Package closed", out.openedNext ? `Package ${out.state.boxes.length} is open for the remaining items.` : "Every item is packed. Complete packing when ready.");
    productRef.current?.focus();
  };

  const withLabelDisabledByClient = Boolean(ctx?.settings.disablePackingWithoutLabel);
  const useUploaded = Boolean(uploaded);
  const blocker = state ? completeBlocker(lines, state, { withLabel: !useUploaded, carrierServiceId: choice.carrierServiceId }) : "Scan an order first";
  const labelPermReason = !useUploaded && !canCreateLabel ? "You need the Create Label permission" : null;

  const complete = async (withLabel: boolean) => {
    if (!ctx || !state || !station) return;
    const b = completeBlocker(lines, state, { withLabel, carrierServiceId: choice.carrierServiceId });
    if (b) { setShowErrors(true); setCompleteError(b); beepError(); return; }
    setCompleting(true);
    setCompleteError(null);
    try {
      const payload = buildCompletePayload({
        orderId: ctx.order.id, stationId: station.id, version: ctx.order.version, withLabel,
        carrierConnectionId: withLabel ? (choice.carrierKey ?? "").split("|")[0] ?? null : null, carrierServiceId: withLabel ? choice.carrierServiceId : null,
      }, state);
      const { data } = await apiRequest<CompleteResult>("/api/packing/complete", { method: "POST", body: payload });
      setResult(data);
      beepDone();
      const first = data.shipments[0];
      if (first?.labelFileId) openFileId(first.labelFileId);
      if (data.packingSlipFileId) openFileId(data.packingSlipFileId);
      toast.success("Packing completed", `${data.orderCode} is ${data.status}${data.masterTrackingNumber ? ` · tracking ${data.masterTrackingNumber}` : ""}.`);
      resetOrder();
    } catch (e) {
      beepError();
      setCompleteError(errorText(e, "Packing could not be completed."));
    } finally {
      setCompleting(false);
    }
  };

  const getRate = async () => {
    if (!ctx || !state || !choice.carrierKey || !choice.carrierServiceId) return;
    const used = state.boxes.filter((b) => Object.keys(b.items).length > 0);
    const specs = (used.length ? used : state.boxes.slice(0, 1)).map((b) => ({ weightOz: boxWeightOz(b) || 16, length: b.length ?? 1, width: b.width ?? 1, height: b.height ?? 1 }));
    setRating(true);
    setRateError(null);
    try {
      const { data } = await apiRequest<{ quotes: readonly RateQuote[]; errors: readonly { message: string }[]; selected: RateQuote | null }>("/api/ops/shipping/rates", {
        method: "POST", body: { orderId: ctx.order.id, packages: specs, carrierConnectionIds: [choice.carrierKey.split("|")[0]] },
      });
      const match = data.quotes.find((q) => q.carrierServiceId === choice.carrierServiceId) ?? null;
      if (match) setRate(match);
      else setRateError(data.errors[0]?.message ?? "This service returned no rate for these packages.");
    } catch (e) {
      setRateError(errorText(e));
    } finally {
      setRating(false);
    }
  };

  const upload = async (file: File) => {
    if (!ctx) return;
    setUploading(true);
    try {
      const fileId = await uploadFile(file, "attachment", { entityType: "shipment_order", entityId: ctx.order.id });
      await apiRequest("/api/attachments", { method: "POST", body: { entityType: "shipment_order", entityId: ctx.order.id, documentType: "Shipment Label", fileId } });
      setUploaded(file.name);
      toast.success("Label attached", `${file.name} is attached to ${ctx.order.code}.`);
    } catch (e) {
      toast.error("Upload failed", errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const printSlip = async () => {
    if (!ctx) return;
    try {
      const { data } = await apiRequest<{ fileId: string | null }>("/api/packing/slip", { method: "POST", body: { orderId: ctx.order.id } });
      openFileId(data.fileId);
    } catch (e) {
      toast.error("Error", errorText(e));
    }
  };

  useShortcut("F2", () => { if (state && !result) doClose(); }, { allowInInputs: true, enabled: Boolean(state), description: "Close package", group: "Packing" });
  useShortcut("F9", () => { if (state && !completing) void complete(!useUploaded); }, { allowInInputs: true, enabled: Boolean(state), description: "Complete packing", group: "Packing" });
  useShortcut("Escape", () => { if (state?.awaitingSerialFor) { setState(cancelSerial(state)); setProductError(null); } }, { allowInInputs: true, enabled: Boolean(state?.awaitingSerialFor), preventDefault: false, description: "Cancel serial scan", group: "Packing" });

  if (stationQ.isPending) return <div className="space-y-3 p-6"><Skeleton className="h-8 w-72" /><Skeleton className="h-[480px]" /></div>;
  if (stationQ.error || !station) {
    return <EmptyState title="Packing station not found" description={stationQ.error?.message ?? "Choose a station on the Packing Station page."} action={<Link href="/packing-station" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-white">Choose a station</Link>} />;
  }

  const totals = state ? totalsOf(lines, state) : null;
  const nextPackable = scan?.orders.find((o) => o.packable && o.id !== result?.orderId && o.id !== orderId);
  const awaiting = state?.awaitingSerialFor ? lines.find((l) => l.orderLineId === state.awaitingSerialFor) : null;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/packing-station" className="inline-flex items-center gap-1 text-[12px] font-semibold text-secondary hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Packing station</Link>
          <h1 className="text-[18px] font-semibold">Pack at {station.code}</h1>
        </div>
        <nav aria-label="Pack mode" className="flex rounded-lg bg-surface-sunken p-0.5">
          {PACK_MODES.map((m) => (
            <Link key={m} href={`/packing-station/${station.id}/${m}`} aria-current={m === mode ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", m === mode ? "bg-surface text-foreground shadow-sm" : "text-secondary hover:text-foreground")}>
              {MODE_LABELS[m].tab}
            </Link>
          ))}
        </nav>
        <PackHints />
      </div>

      <div className="grid flex-1 gap-4 px-6 py-4 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.3fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Card className="space-y-3 p-4">
            <ScanField ref={sourceRef} id="pack-source" label={MODE_LABELS[mode].scan} placeholder={MODE_LABELS[mode].placeholder} onScan={lookup} busy={scanBusy} error={scanError} autoFocus />
            {mode === "order" ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setListOpen(true)}><ListChecks className="h-3.5 w-3.5" aria-hidden />List &amp; select</Button>
                <Button variant="ghost" onClick={resetAll} disabled={!scan && !ctx}><X className="h-3.5 w-3.5" aria-hidden />Clear</Button>
              </div>
            ) : scan || ctx ? <Button variant="ghost" size="sm" onClick={resetAll}><X className="h-3.5 w-3.5" aria-hidden />Clear</Button> : null}
          </Card>

          {scan ? (
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[13px] font-semibold"><ClipboardList className="h-4 w-4 text-secondary" aria-hidden />{scan.job ? `Job ${scan.job.code}` : `Source ${scan.sourceLabel}`}</p>
                {scan.job ? <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-medium text-secondary">{scan.job.jobType}</span> : null}
              </div>
              <p className="mt-1 text-[12px] text-secondary"># of orders in {MODE_LABELS[mode].tab.toLowerCase()}: <strong className="tabular-nums text-foreground">{scan.packedOrders + (result ? 1 : 0)}/{scan.totalOrders}</strong> packed</p>
              {scan.orders.length > 1 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {scan.orders.map((o) => (
                    <li key={o.id}>
                      <button type="button" disabled={!o.packable || o.id === result?.orderId} onClick={() => void openOrder(o.id)}
                        className={cn("flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-[12px] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", o.id === orderId ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-sunken")}>
                        <span className="font-semibold">{o.code}</span><span className="text-secondary">{o.unitsToPack} units</span><StatusPill status={o.id === result?.orderId ? result.status : o.status} domain="shipmentOrder" size="sm" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {ctx && state ? (
            <>
              <Card className="space-y-3 p-4">
                <ScanField ref={productRef} id="pack-product" label={awaiting ? `Scan serial number of ${awaiting.sku}` : "Scan product"} placeholder={awaiting ? "Serial number" : "SKU, barcode or FNSKU"} onScan={onProduct}
                  error={productError && !awaiting ? productError : null} hint={awaiting ? <>Waiting for the serial. <Kbd>Esc</Kbd> cancels.</> : "Each scan packs one unit into the open package."} />
                {totals ? (
                  <div className="flex items-center gap-3 text-[12px] text-secondary">
                    <span>Total qty <strong className="tabular-nums text-[15px] text-foreground">{totals.packed}/{totals.toPack}</strong></span>
                    <ProgressBar value={totals.packed} max={Math.max(1, totals.toPack)} tone={totals.packed >= totals.toPack ? "success" : "primary"} className="flex-1" />
                  </div>
                ) : null}
              </Card>
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-[15px] font-semibold"><Link href={`/orders/${ctx.order.id}`} className="hover:underline">{ctx.order.code}</Link><StatusPill status={ctx.order.status} domain="shipmentOrder" size="sm" />{ctx.order.priority === "High" ? <span className="rounded bg-danger-soft px-1.5 text-[11px] font-semibold text-danger">High</span> : null}</p>
                    <p className="text-[12px] text-secondary">{ctx.order.customerName} · {ctx.order.clientName}{ctx.order.storeOrderNumber ? ` · ${ctx.order.storeOrderNumber}` : ""}</p>
                    <p className="text-[11px] text-secondary">{ctx.order.shipTo}</p>
                  </div>
                  {ctx.order.isAutoShip ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">Auto-ship</span> : null}
                </div>
                {ctx.order.packingInstructions ? <Callout variant="attention" title="Packing instructions">{ctx.order.packingInstructions}</Callout> : null}
                {ctx.order.giftNote ? <Callout variant="info" title="Gift note"><span className="inline-flex items-center gap-1"><Gift className="h-3.5 w-3.5" aria-hidden />{ctx.order.giftNote}</span></Callout> : null}
                <ContentsSummary lines={lines} state={state} />
              </Card>
            </>
          ) : ctxLoading ? <Skeleton className="h-60" /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {result ? (
            <ResultPanel result={result} nextLabel={nextPackable ? `Pack next order (${nextPackable.code})` : "Scan next"}
              onNext={() => { const n = nextPackable; setResult(null); if (n) void openOrder(n.id); else resetAll(); }} />
          ) : ctx && state ? (
            <>
              <PackageBoxes lines={lines} packages={ctx.packages} state={state} onState={(s) => { setState(s); setRate(null); }} showErrors={showErrors} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={doClose} disabled={state.boxes[state.active]?.closed}><Check className="h-3.5 w-3.5" aria-hidden />Close pack<Kbd className="ml-1">F2</Kbd></Button>
              </div>
              <Captures lines={lines} state={state} onState={setState} />
              <CarrierPanel context={ctx} choice={choice} onChoice={(c) => { setChoice(c); setRate(null); }} rate={rate} rating={rating} rateError={rateError} onGetRate={() => void getRate()}
                onUpload={(f) => void upload(f)} uploading={uploading} uploadedName={uploaded} withLabelDisabled={false} />
              {completeError ? <Callout variant="error" title="Not completed">{completeError}</Callout> : null}
            </>
          ) : (
            <Card className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-secondary">
              <Truck className="h-10 w-10 text-faint" aria-hidden />
              <p className="text-[14px] font-medium text-body">{MODE_LABELS[mode].scan} to start</p>
              <p className="max-w-sm text-[12px]">Only picked orders that are Ready to Pack can be packed here.</p>
            </Card>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-6 py-3 shadow-[0_-4px_12px_rgba(0,0,0,.04)]">
        <DropdownMenu>
          <DisabledReason reason={ctx ? null : "Scan an order first"}>
            <DropdownMenuTrigger asChild disabled={!ctx}>
              <Button variant="secondary" disabled={!ctx}>Other actions<ChevronUp className="h-3.5 w-3.5" aria-hidden /></Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="start" side="top" className="min-w-[260px]">
            <DropdownMenuItem icon={AlertTriangle} disabledReason={canReport ? null : "You need the Report Issue permission"} description="Move the picked stock to a hospital location" onSelect={() => setIssueOpen(true)}>Report issue</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Print actions</DropdownMenuLabel>
            <DropdownMenuItem icon={FileText} disabledReason={canSlip ? null : "You need the Print Packing Slip permission"} description="PDF of the items being packed" onSelect={() => void printSlip()}>Packing slip</DropdownMenuItem>
            {(ctx?.activeLabels ?? []).map((l) => (
              <DropdownMenuItem key={l.trackingNumber} icon={Printer} disabledReason={l.labelFileId ? null : "No label file"} description={l.trackingNumber} onSelect={() => openFileId(l.labelFileId)}>Shipping label</DropdownMenuItem>
            ))}
            {ctx && ctx.activeLabels.length === 0 ? <DropdownMenuItem icon={Printer} disabledReason="Labels are created when packing completes">Shipping label</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={PackageX} disabledReason={withLabelDisabledByClient ? `Packing without a label is disabled for ${ctx?.order.clientName ?? "this client"}` : blocker && !blocker.startsWith("Choose a carrier") ? blocker : null}
              description="Complete packing without buying a label" onSelect={() => setNoLabelOpen(true)}>Pack without label</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2">
          {state && totals ? <span className="text-[12px] text-secondary tabular-nums">{totals.packed}/{totals.toPack} packed · {state.boxes.filter((b) => Object.keys(b.items).length).length} package(s)</span> : null}
          <DisabledReason reason={blocker ?? labelPermReason}>
            <Button variant="primary" size="lg" disabled={Boolean(blocker ?? labelPermReason) || completing} onClick={() => void complete(!useUploaded)}>
              {completing ? <Spinner className="h-4 w-4" label="Completing" /> : <PackageCheck className="h-4 w-4" aria-hidden />}
              {useUploaded ? "Complete packing (uploaded label)" : "Complete packing and create label"}
              <Kbd className="ml-1 border-white/30 bg-white/15 text-white shadow-none">F9</Kbd>
            </Button>
          </DisabledReason>
        </div>
      </div>

      {station ? <ListSelectModal open={listOpen} onOpenChange={setListOpen} warehouseId={station.warehouseId} onStart={(code) => { setListOpen(false); router.replace(`/packing-station/${station.id}/order`); void lookup(code); }} /> : null}
      {ctx ? <ReportIssueDialog open={issueOpen} onOpenChange={setIssueOpen} orderId={ctx.order.id} orderCode={ctx.order.code} warehouseId={ctx.order.warehouseId} defaultLocationId={ctx.hospitalLocationId}
        onDone={() => {
          const reported = ctx.order.id;
          const more = scan?.orders.some((o) => o.packable && o.id !== reported);
          if (scan && more) { resetOrder(); void lookup(scan.code); } else resetAll();
        }} /> : null}
      <ConfirmDialog open={noLabelOpen} onOpenChange={setNoLabelOpen} variant="attention" icon={PackageX} title={`Pack ${ctx?.order.code ?? ""} without a label?`}
        description="Packing completes and the order moves to Ready to Ship with no tracking number. Create or upload the label later from the order." confirmLabel="Yes, pack without label" cancelLabel="No"
        onConfirm={() => complete(false)} />
    </div>
  );
}
