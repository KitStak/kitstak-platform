'use client';

/**
 * Pack screen (`/packing-station/[stationId]/[mode]`, M04 §2). Left: mode tabs, source
 * scan (wedge + Enter), job card, product scan, order card. Right: packages, contents,
 * captures, carrier / service with Get Rate and pre-generated label upload. Footer:
 * Other Actions ▴ (Report Issue, Print Actions, Pack Without Label) and Complete
 * Packing And Create Label. Keyboard: Enter scans, F2 closes the package, F9 completes.
 * Packing Warnings (Data Setup) open at their trigger (order displayed / product scanned /
 * close pack) and must be acknowledged unless the type skips confirmation.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronUp,
  ClipboardList,
  FileText,
  Gift,
  ListChecks,
  Lock,
  PackageCheck,
  PackagePlus,
  PackageX,
  Printer,
  RotateCcw,
  Truck,
  X,
} from 'lucide-react';
import { uploadFile } from '@/components/shared/upload-file';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Kbd } from '@/components/ui/kbd';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useShortcut } from '@/lib/keyboard';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { errorText, openFileId, useHydratedCan } from '@/components/returns/returns-client';
import { ListSelectModal } from './list-select-modal';
import {
  addBox,
  buildCompletePayload,
  cancelSerial,
  closeBox,
  closeUsedBoxes,
  completeBlocker,
  completeStep,
  draftSnapshot,
  draftUnits,
  initialPackState,
  rateBlocker,
  rateSignature,
  rateSpecs,
  restoreDraft,
  scanProduct,
  totalsOf,
  type PackDraftSnapshot,
  type PackState,
} from './pack-model';
import { RateShopCard } from './pack-rate-shop';
import {
  CarrierPanel,
  Captures,
  ContentsSummary,
  PackageBoxes,
  PackHints,
  PackPreview,
  type CarrierChoice,
} from './pack-packages';
import { useFormat } from '@/lib/format';
import {
  isScanMiss,
  MODE_LABELS,
  PACK_MODES,
  type CompleteResult,
  type PackContext,
  type PackMode,
  type RateQuote,
  type ScanMissResponse,
  type ScanResponse,
} from './pack-types';
import { printPlan, printSummary, runPrintPlan, type PrinterSetup } from './auto-print';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { StickyFooterToastOffset } from './toast-offset';
import { ReportIssueDialog } from './report-issue-dialog';
import { PackingWarningDialog } from './packing-warning-dialog';
import { seenKey, warningDue, type PackWarningTrigger } from './pack-warning-model';
import { ScanField, type ScanFieldHandle } from './scan-field';
import { beepDone, beepError, beepOk } from './scan-feedback';

interface Station {
  readonly id: string;
  readonly code: string;
  readonly warehouseId: string;
  readonly description: string | null;
}

function defaultChoice(ctx: PackContext): CarrierChoice {
  const byConn =
    ctx.carriers.find(
      (c) =>
        c.connectionId === ctx.order.carrierConnectionId &&
        c.services.some((s) => s.id === ctx.order.carrierServiceId),
    ) ?? ctx.carriers.find((c) => c.services.some((s) => s.id === ctx.order.carrierServiceId));
  if (byConn) return { carrierKey: byConn.key, carrierServiceId: ctx.order.carrierServiceId };
  const first = ctx.carriers[0];
  return { carrierKey: first?.key ?? null, carrierServiceId: first?.services[0]?.id ?? null };
}

interface PrintStatus {
  readonly state: 'printing' | 'done' | 'failed';
  readonly text: string;
}

function ResultPanel({
  result,
  onNext,
  nextLabel,
  printed,
}: {
  readonly result: CompleteResult;
  readonly onNext: () => void;
  readonly nextLabel: string;
  readonly printed: PrintStatus | null;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <div role="status" className="flex flex-col items-center gap-2">
        <PackageCheck className="h-12 w-12 text-success" aria-hidden />
        <h2 className="text-lg font-semibold">Order {result.orderCode} packed</h2>
        <p className="text-sm text-secondary">
          {result.packedUnits} unit{result.packedUnits === 1 ? '' : 's'} · status{' '}
          <StatusPill status={result.status} domain="shipmentOrder" size="sm" />
          {result.shipped ? ' · auto-shipped' : ''}
        </p>
      </div>
      {printed ? (
        <p
          aria-live="polite"
          data-testid="pack-print-status"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs',
            printed.state === 'failed'
              ? 'bg-warning-soft text-warning'
              : printed.state === 'done'
                ? 'bg-success-soft text-success'
                : 'bg-neutral-soft text-secondary',
          )}
        >
          {printed.state === 'printing' ? (
            <Spinner className="h-3 w-3" label="Printing" />
          ) : (
            <Printer className="h-3.5 w-3.5" aria-hidden />
          )}
          {printed.text}
        </p>
      ) : null}
      {result.masterTrackingNumber ? (
        <div className="w-full max-w-md rounded-lg border border-border text-left text-sm">
          <p className="border-b border-border px-3 py-2 font-semibold">
            Master tracking <span className="font-mono">{result.masterTrackingNumber}</span>
          </p>
          <ul>
            {result.shipments.map((s) => (
              <li
                key={s.trackingNumber}
                className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 last:border-0"
              >
                <span>
                  Package {s.packageSeq} · <span className="font-mono">{s.trackingNumber}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!s.labelFileId}
                  onClick={() => openFileId(s.labelFileId)}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden />
                  Reprint label
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.labelError ? (
        <Callout variant="error" title="Label not created">
          {result.labelError} The order is packed; create the label from the order.
        </Callout>
      ) : null}
      {result.warnings.map((w) => (
        <Callout key={w} variant="attention" title="Heads up">
          {w}
        </Callout>
      ))}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" autoFocus onClick={onNext}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {nextLabel}
        </Button>
        {result.packingSlipFileId ? (
          <Button variant="secondary" onClick={() => openFileId(result.packingSlipFileId)}>
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Reprint packing slip
          </Button>
        ) : null}
        <Link
          href={`/orders/${result.orderId}`}
          className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-sunken"
        >
          View order
        </Link>
        <Link
          href="/shipments"
          className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-sunken"
        >
          Shipments
        </Link>
      </div>
    </Card>
  );
}

/** Logiwa keeps the job card visible before a scan: "Scan or Enter Tote Code to Find Job", "# of Orders in Tote 0/0". */
function EmptyJobCard({ mode }: { readonly mode: PackMode }) {
  const what = mode === 'order' ? 'Order' : MODE_LABELS[mode].tab;
  return (
    <Card className="p-4" data-testid="pack-job-empty">
      <p className="flex items-center gap-2 text-sm font-semibold text-secondary">
        <ClipboardList className="h-4 w-4" aria-hidden />
        {mode === 'order'
          ? 'Scan or enter an order code to find it'
          : `Scan or enter ${what.toLowerCase()} code to find job`}
      </p>
      <p className="mt-1 text-xs text-secondary">
        {mode === 'order' ? '# of Orders' : `# of Orders in ${what}`}:{' '}
        <strong className="tabular-nums text-foreground">0/0</strong> packed
      </p>
    </Card>
  );
}

/** Product scan and order card placeholders (disabled) until an order loads, so the layout never jumps. */
function EmptyOrderCards() {
  return (
    <>
      <Card className="space-y-2 p-4 opacity-80" data-testid="pack-product-empty">
        <label htmlFor="pack-product-disabled" className="text-xs font-semibold text-body">
          Scan product
        </label>
        <input
          id="pack-product-disabled"
          disabled
          placeholder="Load an order to scan products"
          className="h-10 w-full cursor-not-allowed rounded-md border border-border bg-surface-sunken px-3 text-sm text-secondary"
        />
        <div className="flex items-center gap-3 text-xs text-secondary">
          <span>
            Total qty <strong className="tabular-nums text-base text-foreground">0/0</strong>
          </span>
          <ProgressBar value={0} max={1} className="flex-1" />
        </div>
      </Card>
      <Card className="space-y-1 p-4" data-testid="pack-order-empty">
        <p className="text-base font-semibold text-secondary">Select order to pack</p>
        <p className="text-xs text-secondary">
          SKU qty <strong className="tabular-nums text-foreground">0/0</strong> · Total qty{' '}
          <strong className="tabular-nums text-foreground">0/0</strong>
        </p>
      </Card>
    </>
  );
}

export function PackScreen({ stationId, mode }: { readonly stationId: string; readonly mode: PackMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const canCreateLabel = useHydratedCan('fulfillment.shipment_orders.create_label').allowed;
  const canExecute = useHydratedCan('fulfillment.task_details.execute_task').allowed;
  const canReport = useHydratedCan('fulfillment.packing_station.report_issue').allowed;
  const canSlip = useHydratedCan('fulfillment.packing_station.print_packing_slip').allowed;
  const canRetailer = useHydratedCan('fulfillment.shipment_orders.create_retailer_label').allowed;
  const canRetailerReprint = useHydratedCan('fulfillment.shipment_orders.reprint_retailer_label').allowed;
  const [retailerPrinted, setRetailerPrinted] = React.useState<string | null>(null);
  const stationQ = useApiQuery<readonly Station[]>(
    ['packing', 'station', stationId],
    '/api/packing/stations',
    { query: { stationId } },
  );
  const station = stationQ.data?.data[0] ?? null;
  const stationKey = station?.id ?? null;
  // A station code in the URL (e.g. /packing-station/PACK-01/tote) resolves to the station: swap in its id.
  React.useEffect(() => {
    if (!station || station.id === stationId) return;
    const qs = params.toString();
    router.replace(`/packing-station/${station.id}/${mode}${qs ? `?${qs}` : ''}`);
  }, [station, stationId, mode, params, router]);

  const sourceRef = React.useRef<ScanFieldHandle>(null);
  const productRef = React.useRef<ScanFieldHandle>(null);
  const [scan, setScan] = React.useState<ScanResponse | null>(null);
  const [scanBusy, setScanBusy] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [blockedOrder, setBlockedOrder] = React.useState<{
    readonly orderId: string;
    readonly orderCode: string;
  } | null>(null);
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const [ctx, setCtx] = React.useState<PackContext | null>(null);
  const [ctxLoading, setCtxLoading] = React.useState(false);
  const [state, setState] = React.useState<PackState | null>(null);
  // Once an order has loaded, the next scan is a product: move focus there after the commit,
  // so the order field's own "keep focus for the next scan" cannot win the race.
  const loadedOrder = ctxLoading ? null : orderId;
  React.useEffect(() => {
    if (loadedOrder) requestAnimationFrame(() => productRef.current?.focus());
  }, [loadedOrder]);
  const [productError, setProductError] = React.useState<string | null>(null);
  const [choice, setChoice] = React.useState<CarrierChoice>({ carrierKey: null, carrierServiceId: null });
  /** Last quote with the package/service signature it was fetched for (see `rateSignature`). */
  const [rateHit, setRateHit] = React.useState<{ readonly sig: string; readonly quote: RateQuote } | null>(
    null,
  );
  const [rating, setRating] = React.useState(false);
  const [rateError, setRateError] = React.useState<string | null>(null);
  /** Signature a quote was attempted for (set by Complete's quote step). */
  const [quoteTriedSig, setQuoteTriedSig] = React.useState<string | null>(null);
  /** Rate shop across every carrier account of the order (cheapest / fastest). */
  const [shop, setShop] = React.useState<{
    readonly sig: string;
    readonly quotes: readonly RateQuote[];
    readonly errors: readonly string[];
  } | null>(null);
  const [shopping, setShopping] = React.useState(false);
  const fmt = useFormat();
  const completeRef = React.useRef<HTMLButtonElement>(null);
  /**
   * The quote is derived: it stays valid while the rated packages and the service are unchanged
   * (closing a package keeps it), and goes stale when either changes.
   */
  const staleRate = () => {
    setRateError(null);
    setCompleteError(null);
  };
  const [uploaded, setUploaded] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const [completing, setCompleting] = React.useState(false);
  const [completeError, setCompleteError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CompleteResult | null>(null);
  const [listOpen, setListOpen] = React.useState(mode === 'order' && params.get('list') === '1');
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [noLabelOpen, setNoLabelOpen] = React.useState(false);
  const [printed, setPrinted] = React.useState<PrintStatus | null>(null);
  /** Progress restored from the server draft (shown as a note on the order card). */
  const [resumed, setResumed] = React.useState<{
    readonly units: number;
    readonly at: string;
    readonly by: string | null;
  } | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<'saving' | 'saved' | 'error' | null>(null);
  const lastSaved = React.useRef<string | null>(null);
  const printersQ = useApiQuery<readonly (PrinterSetup & { readonly warehouseId: string })[]>(
    ['printers'],
    '/api/printers',
    { staleTime: 60_000 },
  );
  const printerSetup = printersQ.data?.data.find((p) => p.warehouseId === station?.warehouseId) ?? null;

  /** Packing warning due now, and what to run once it is acknowledged. */
  const [warningPrompt, setWarningPrompt] = React.useState<{ readonly then: (() => void) | null } | null>(
    null,
  );
  const [warningSeen, setWarningSeen] = React.useState<ReadonlySet<string>>(new Set());
  const [warningBusy, setWarningBusy] = React.useState(false);
  const [warningError, setWarningError] = React.useState<string | null>(null);
  const resetOrder = () => {
    setOrderId(null);
    setCtx(null);
    setState(null);
    staleRate();
    setRateHit(null);
    setQuoteTriedSig(null);
    setShop(null);
    setResumed(null);
    setUploaded(null);
    setShowErrors(false);
    setCompleteError(null);
    setProductError(null);
    setWarningPrompt(null);
    setWarningSeen(new Set());
  };
  const resetAll = () => {
    resetOrder();
    setScan(null);
    setScanError(null);
    setBlockedOrder(null);
    setResult(null);
    requestAnimationFrame(() => sourceRef.current?.focus());
  };

  const openOrder = React.useCallback(
    async (id: string) => {
      setCtxLoading(true);
      try {
        // POST starts packing (Packing Started); view-only users fall back to a read.
        const query = stationKey ? { stationId: stationKey } : undefined;
        const { data } = await apiRequest<PackContext>(`/api/packing/orders/${id}`, {
          method: 'POST',
          query,
        }).catch((e: unknown) => {
          if (isApiError(e) && e.code === 'FORBIDDEN')
            return apiRequest<PackContext>(`/api/packing/orders/${id}`, { query });
          throw e;
        });
        const pkg = data.packages.find((p) => p.id === data.order.defaultPackageId) ?? null;
        const packLines = data.lines.filter((l) => l.toPack > 0);
        const fresh = initialPackState(packLines, pkg);
        // Resume server-saved progress (scans, packages, carrier, quote) when it still fits the order.
        const restored = data.draft ? restoreDraft(packLines, fresh, data.draft.state) : null;
        const draftChoice = data.draft?.state.choice;
        const validChoice =
          draftChoice?.carrierKey &&
          data.carriers.some(
            (c) =>
              c.key === draftChoice.carrierKey &&
              c.services.some((s) => s.id === draftChoice.carrierServiceId),
          )
            ? draftChoice
            : null;
        setOrderId(id);
        setCtx(data);
        setState(restored ?? fresh);
        setChoice(validChoice ?? defaultChoice(data));
        staleRate();
        setRateHit(restored && data.draft?.state.rate ? data.draft.state.rate : null);
        setQuoteTriedSig(null);
        setShop(null);
        lastSaved.current = restored && data.draft ? JSON.stringify(data.draft.state) : null;
        setResumed(
          restored && data.draft && draftUnits(restored) > 0
            ? { units: draftUnits(restored), at: data.draft.updatedAt, by: data.draft.updatedByName }
            : null,
        );
        setUploaded(null);
        setShowErrors(false);
        setCompleteError(null);
        setWarningSeen(new Set());
        setWarningError(null);
        if (data.countLock) {
          // Count-locked: block before any scan (Complete would be refused by the ledger).
          setWarningPrompt(null);
          beepError();
          toast.error(`Locked by ${data.countLock.planCode}`, data.countLock.reason);
          return;
        }
        if (warningDue(data.packingWarning, 'order_displayed', new Set())) setWarningPrompt({ then: null });
        else setWarningPrompt(null);
        requestAnimationFrame(() => productRef.current?.focus());
      } catch (e) {
        beepError();
        toast.error('Error', errorText(e));
      } finally {
        setCtxLoading(false);
      }
    },
    [stationKey],
  );

  const lookup = async (code: string) => {
    if (!station) return;
    setScanBusy(true);
    setScanError(null);
    setBlockedOrder(null);
    try {
      const { data } = await apiRequest<ScanResponse | ScanMissResponse>('/api/packing/scan', {
        query: { warehouseId: station.warehouseId, mode, code, stationId: station.id },
      });
      if (isScanMiss(data)) {
        // An ordinary mis-scan: answered 200 by the server, so no console error.
        beepError();
        sourceRef.current?.flash('error');
        setScanError(data.miss.message);
        if (data.miss.orderId && data.miss.orderCode)
          setBlockedOrder({ orderId: data.miss.orderId, orderCode: data.miss.orderCode });
        toast.error('Error', data.miss.message);
        return;
      }
      if (data.blocked) {
        beepError();
        sourceRef.current?.flash('error');
        setScanError(data.blocked.message);
        setBlockedOrder({ orderId: data.blocked.orderId, orderCode: data.blocked.orderCode });
        toast.error("Can't pack this order", data.blocked.message);
        return;
      }
      setScan(data);
      setResult(null);
      sourceRef.current?.flash('ok');
      beepOk();
      const first =
        data.orders.find((o) => o.packable && !o.countLock) ?? data.orders.find((o) => o.packable);
      if (first) await openOrder(first.id);
    } catch (e) {
      beepError();
      sourceRef.current?.flash('error');
      const msg = errorText(e);
      setScanError(msg);
      toast.error('Error', msg);
    } finally {
      setScanBusy(false);
    }
  };

  const lines = React.useMemo(() => (ctx?.lines ?? []).filter((l) => l.toPack > 0), [ctx]);
  const sig = state ? rateSignature(state, choice.carrierServiceId) : '';
  const rate = rateHit && rateHit.sig === sig ? rateHit.quote : null;
  const quoteTried = quoteTriedSig === sig;

  // Keep the in-progress pack on the server (debounced), so a reload or another device resumes it.
  const saveKey =
    ctx && state && canExecute && !result
      ? JSON.stringify(draftSnapshot({ ...state, awaitingSerialFor: null }, choice, rateHit))
      : null;
  const draftOrderId = ctx?.order.id ?? null;
  React.useEffect(() => {
    if (!saveKey || !draftOrderId || saveKey === lastSaved.current) return;
    if (lastSaved.current === null && draftUnits(JSON.parse(saveKey) as PackDraftSnapshot) === 0) return; // nothing worth keeping yet
    const t = window.setTimeout(() => {
      setSaveStatus('saving');
      void apiRequest(`/api/packing/orders/${draftOrderId}/draft`, {
        method: 'PUT',
        body: { stationId: stationKey, state: JSON.parse(saveKey) as PackDraftSnapshot },
      })
        .then(() => {
          lastSaved.current = saveKey;
          setSaveStatus('saved');
        })
        .catch(() => setSaveStatus('error'));
    }, 400);
    return () => window.clearTimeout(t);
  }, [saveKey, draftOrderId, stationKey]);

  /** Start the order over: drop the saved progress and the screen's scans. */
  const discardProgress = async () => {
    if (!ctx) return;
    try {
      await apiRequest(`/api/packing/orders/${ctx.order.id}/draft`, { method: 'DELETE' });
    } catch (e) {
      toast.error('Progress not discarded', errorText(e));
      return;
    }
    const pkg = ctx.packages.find((p) => p.id === ctx.order.defaultPackageId) ?? null;
    lastSaved.current = null;
    setState(initialPackState(lines, pkg));
    setRateHit(null);
    setQuoteTriedSig(null);
    setShop(null);
    setResumed(null);
    setSaveStatus(null);
    toast.success('Started over', `${ctx.order.code}: saved packing progress discarded.`);
    productRef.current?.focus();
  };

  /** Runs `action` now, or after the packer acknowledges a warning due at `trigger`. */
  const withWarning = (trigger: PackWarningTrigger, action: () => void) => {
    if (warningDue(ctx?.packingWarning, trigger, warningSeen)) {
      setWarningError(null);
      setWarningPrompt({ then: action });
      return;
    }
    action();
  };

  const acknowledgeWarning = async () => {
    const w = ctx?.packingWarning;
    if (!w || !ctx) {
      setWarningPrompt(null);
      return;
    }
    if (!w.skipConfirmation) {
      setWarningBusy(true);
      setWarningError(null);
      try {
        await apiRequest('/api/packing/warning-ack', {
          method: 'POST',
          body: {
            orderId: ctx.order.id,
            warningTypeId: w.id,
            trigger: w.trigger,
            stationId: station?.id ?? null,
          },
        });
      } catch (e) {
        setWarningError(errorText(e, 'The acknowledgement could not be saved. Try again.'));
        return;
      } finally {
        setWarningBusy(false);
      }
    }
    setWarningSeen((prev) => new Set([...prev, seenKey(w)]));
    const then = warningPrompt?.then ?? null;
    setWarningPrompt(null);
    requestAnimationFrame(() => productRef.current?.focus());
    then?.();
  };

  const onProduct = (code: string) => {
    if (!state) return;
    if (warningDue(ctx?.packingWarning, 'product_scanned', warningSeen)) {
      withWarning('product_scanned', () => onProductScanned(code));
      return;
    }
    onProductScanned(code);
  };

  const onProductScanned = (code: string) => {
    if (!state) return;
    if (lockReason) {
      beepError();
      productRef.current?.flash('error');
      setProductError(lockReason);
      toast.error('Count-locked', lockReason);
      return;
    }
    const out = scanProduct(lines, state, code);
    if (!out.ok) {
      beepError();
      productRef.current?.flash('error');
      setProductError(out.error);
      toast.error('Error', out.error);
      return;
    }
    beepOk();
    productRef.current?.flash('ok');
    setProductError(out.state.awaitingSerialFor ? out.message : null);
    setState(out.state);
    staleRate();
  };

  const doClose = () => {
    if (!state) return;
    if (warningDue(ctx?.packingWarning, 'close_pack', warningSeen)) {
      withWarning('close_pack', closeNow);
      return;
    }
    closeNow();
  };

  const closeNow = () => {
    if (!state) return;
    const out = closeBox(lines, state);
    if (out.error) {
      setShowErrors(true);
      beepError();
      toast.error('Package not closed', out.error);
      return;
    }
    setState(out.state);
    staleRate();
    // Closing does not change the rated packages, so the quote stays. If an earlier quote no longer
    // matches (sizes or weights changed since), re-rate automatically.
    if (
      rateHit &&
      rateHit.sig !== rateSignature(out.state, choice.carrierServiceId) &&
      !rateBlocker(out.state) &&
      choice.carrierServiceId
    )
      void getRate(out.state);
    beepOk();
    toast.success(
      'Package closed',
      out.openedNext
        ? `Package ${out.state.boxes.length} is open for the remaining items.`
        : 'Every item is packed. Complete packing when ready.',
    );
    productRef.current?.focus();
  };

  const withLabelDisabledByClient = Boolean(ctx?.settings.disablePackingWithoutLabel);
  const useUploaded = Boolean(uploaded);
  const lockReason = ctx?.countLock?.reason ?? null;
  const blocker =
    lockReason ??
    (state
      ? completeBlocker(lines, state, { withLabel: !useUploaded, carrierServiceId: choice.carrierServiceId })
      : 'Scan an order first');
  const executeReason = canExecute ? null : 'You need the Execute Task permission to pack orders';
  const labelPermReason =
    executeReason ?? (!useUploaded && !canCreateLabel ? 'You need the Create Label permission' : null);

  const complete = async (withLabel: boolean) => {
    if (!ctx || !state || !station) return;
    if (lockReason) {
      setCompleteError(lockReason);
      beepError();
      toast.error(`Locked by ${ctx.countLock?.planCode ?? 'a count plan'}`, lockReason);
      return;
    }
    const b = completeBlocker(lines, state, { withLabel, carrierServiceId: choice.carrierServiceId });
    if (b) {
      setShowErrors(true);
      setCompleteError(b);
      beepError();
      toast.error('Not ready to complete', b);
      return;
    }
    // Complete closes the open package itself, so a "Close pack" warning is due here too.
    if (warningDue(ctx.packingWarning, 'close_pack', warningSeen)) {
      withWarning('close_pack', () => void complete(withLabel));
      return;
    }
    // One rule for rate and label: Complete closes the open package itself, and with a label
    // the operator always sees the rate before it is bought (first press quotes, second buys).
    const closed = closeUsedBoxes(state);
    if (closed !== state) setState(closed);
    if (completeStep({ withLabel, hasRate: Boolean(rate), quoteTried }) === 'quote') {
      setCompleteError(null);
      const q = await getRate(closed);
      setQuoteTriedSig(rateSignature(closed, choice.carrierServiceId));
      if (q) {
        // No toast: it would cover the footer. The rate shows in the footer chip (aria-live) and on the button.
        beepOk();
      } else {
        beepError();
        setCompleteError(
          'No rate came back for this service. Change the service, or press F9 again to buy the label without a quote.',
        );
      }
      requestAnimationFrame(() => completeRef.current?.focus());
      return;
    }
    setCompleting(true);
    setCompleteError(null);
    try {
      const payload = buildCompletePayload(
        {
          orderId: ctx.order.id,
          stationId: station.id,
          version: ctx.order.version,
          withLabel,
          carrierConnectionId: withLabel ? ((choice.carrierKey ?? '').split('|')[0] ?? null) : null,
          carrierServiceId: withLabel ? choice.carrierServiceId : null,
        },
        closed,
      );
      const { data } = await apiRequest<CompleteResult>('/api/packing/complete', {
        method: 'POST',
        body: payload,
      });
      setResult(data);
      beepDone();
      toast.success(
        'Packing completed',
        `${data.orderCode} is ${data.status}${data.masterTrackingNumber ? ` · tracking ${data.masterTrackingNumber}` : ''}.`,
      );
      resetOrder();
      // Print every label and the packing slip through the user's printer setup (reprint stays on the card).
      const jobs = printPlan(data, printerSetup);
      if (jobs.length) {
        setPrinted({ state: 'printing', text: 'Printing…' });
        void runPrintPlan(jobs).then((r) => {
          setPrinted({
            state: r.failed.length ? 'failed' : 'done',
            text: r.failed.length
              ? `Not printed: ${r.failed.join(', ')}. Use the buttons below.`
              : `Printed: ${printSummary(jobs, r.via)}`,
          });
        });
      } else setPrinted(null);
    } catch (e) {
      beepError();
      setCompleteError(errorText(e, 'Packing could not be completed.'));
    } finally {
      setCompleting(false);
    }
  };

  const getRate = async (forState: PackState | null = state): Promise<RateQuote | null> => {
    if (!ctx || !forState || !choice.carrierKey || !choice.carrierServiceId) return null;
    setRating(true);
    setRateError(null);
    try {
      const { data } = await apiRequest<{
        quotes: readonly RateQuote[];
        errors: readonly { message: string }[];
        selected: RateQuote | null;
      }>('/api/ops/shipping/rates', {
        method: 'POST',
        body: {
          orderId: ctx.order.id,
          packages: rateSpecs(forState),
          carrierConnectionIds: [choice.carrierKey.split('|')[0]],
        },
      });
      const match = data.quotes.find((q) => q.carrierServiceId === choice.carrierServiceId) ?? null;
      if (match) setRateHit({ sig: rateSignature(forState, choice.carrierServiceId), quote: match });
      else setRateError(data.errors[0]?.message ?? 'This service returned no rate for these packages.');
      return match;
    } catch (e) {
      setRateError(errorText(e));
      return null;
    } finally {
      setRating(false);
    }
  };

  /** Rate shop: quote every carrier account and service available to the order, for the current packages. */
  const rateShop = async () => {
    if (!ctx || !state) return;
    const conns = [...new Set(ctx.carriers.map((c) => c.connectionId))];
    if (conns.length === 0) return;
    setShopping(true);
    setRateError(null);
    const forSig = JSON.stringify(rateSpecs(state));
    try {
      const { data } = await apiRequest<{
        quotes: readonly RateQuote[];
        errors: readonly { carrierConnectionId: string; message: string }[];
      }>('/api/ops/shipping/rates', {
        method: 'POST',
        body: { orderId: ctx.order.id, packages: rateSpecs(state), carrierConnectionIds: conns },
      });
      // Only services this client may use (the carrier dropdown's options).
      const allowed = data.quotes.filter((q) =>
        ctx.carriers.some(
          (c) =>
            c.connectionId === q.carrierConnectionId && c.services.some((s) => s.id === q.carrierServiceId),
        ),
      );
      setShop({
        sig: forSig,
        quotes: allowed,
        errors: data.errors.map(
          (e) =>
            `${ctx.carriers.find((c) => c.connectionId === e.carrierConnectionId)?.connectionName ?? 'Carrier'}: ${e.message}`,
        ),
      });
      if (allowed.length === 0)
        setRateError(data.errors[0]?.message ?? 'No carrier returned a rate for these packages.');
      else beepOk();
    } catch (e) {
      setRateError(errorText(e));
    } finally {
      setShopping(false);
    }
  };

  /** Use a rate-shop quote: select its carrier account and service, and keep the quote. */
  const pickQuote = (q: RateQuote) => {
    if (!ctx || !state) return;
    const carrier = ctx.carriers.find(
      (c) => c.connectionId === q.carrierConnectionId && c.services.some((s) => s.id === q.carrierServiceId),
    );
    if (!carrier) return;
    setChoice({ carrierKey: carrier.key, carrierServiceId: q.carrierServiceId });
    setRateHit({ sig: rateSignature(state, q.carrierServiceId), quote: q });
    staleRate();
    toast.success(
      'Service selected',
      `${q.carrierCode} ${q.serviceName} · ${fmt.money(q.price, q.currency, 'summary')} · ${q.transitDays} day${q.transitDays === 1 ? '' : 's'}`,
    );
  };

  const upload = async (file: File) => {
    if (!ctx) return;
    setUploading(true);
    try {
      const fileId = await uploadFile(file, 'attachment', {
        entityType: 'shipment_order',
        entityId: ctx.order.id,
      });
      await apiRequest('/api/attachments', {
        method: 'POST',
        body: {
          entityType: 'shipment_order',
          entityId: ctx.order.id,
          documentType: 'Shipment Label',
          fileId,
        },
      });
      setUploaded(file.name);
      toast.success('Label attached', `${file.name} is attached to ${ctx.order.code}.`);
    } catch (e) {
      toast.error('Upload failed', errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const printSlip = async () => {
    if (!ctx) return;
    try {
      const { data } = await apiRequest<{ fileId: string | null }>('/api/packing/slip', {
        method: 'POST',
        body: { orderId: ctx.order.id },
      });
      openFileId(data.fileId);
    } catch (e) {
      toast.error('Error', errorText(e));
    }
  };

  const printRetailer = async (reprint: boolean) => {
    if (!ctx) return;
    const cases = state ? state.boxes.filter((b) => Object.values(b.items).some((q) => q > 0)).length : 0;
    try {
      const { data } = await apiRequest<{ fileId: string; cases: number }>('/api/packing/retailer-label', {
        method: 'POST',
        body: { orderId: ctx.order.id, reprint, ...(cases > 0 ? { caseCount: cases } : {}) },
      });
      setRetailerPrinted(ctx.order.id);
      toast.success(
        reprint ? 'Retailer label reprinted' : 'Retailer label created',
        `${data.cases} case label${data.cases === 1 ? '' : 's'} for ${ctx.order.code}`,
      );
      openFileId(data.fileId);
    } catch (e) {
      toast.error('Retailer label not printed', errorText(e));
    }
  };
  const retailerReason = !ctx?.order.retailerName ? 'This order has no retailer' : null;
  const retailerDone = Boolean(ctx?.order.retailerLabelPrinted) || retailerPrinted === ctx?.order.id;

  useShortcut(
    'F2',
    () => {
      if (state && !result && !warningPrompt) doClose();
    },
    { allowInInputs: true, enabled: Boolean(state), description: 'Close package', group: 'Packing' },
  );
  useShortcut(
    'F9',
    () => {
      if (completing || rating || result || warningPrompt) return;
      if (!state) {
        beepError();
        toast.error(
          'Nothing to complete',
          ctxLoading
            ? 'The order is still loading.'
            : mode === 'order'
              ? 'Scan an order first.'
              : `${MODE_LABELS[mode].scan} first, then its order loads.`,
        );
        sourceRef.current?.focus();
        return;
      }
      if (labelPermReason) {
        beepError();
        setCompleteError(labelPermReason);
        toast.error('Not completed', labelPermReason);
        return;
      }
      void complete(!useUploaded);
    },
    { allowInInputs: true, description: 'Complete packing', group: 'Packing' },
  );
  useShortcut(
    'Escape',
    () => {
      if (state?.awaitingSerialFor) {
        setState(cancelSerial(state));
        setProductError(null);
      }
    },
    {
      allowInInputs: true,
      enabled: Boolean(state?.awaitingSerialFor),
      preventDefault: false,
      description: 'Cancel serial scan',
      group: 'Packing',
    },
  );

  if (stationQ.isPending)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-[480px]" />
      </div>
    );
  if (stationQ.error || !station) {
    return (
      <EmptyState
        title="Packing station not found"
        description={stationQ.error?.message ?? 'Choose a station on the Packing Station page.'}
        action={
          <Link
            href="/packing-station"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-white"
          >
            Choose a station
          </Link>
        }
      />
    );
  }

  const totals = state ? totalsOf(lines, state) : null;
  const selectedCarrier = ctx?.carriers.find((c) => c.key === choice.carrierKey) ?? null;
  const selectedSvc = selectedCarrier?.services.find((s) => s.id === choice.carrierServiceId) ?? null;
  const selectedService =
    selectedCarrier && selectedSvc
      ? {
          carrierCode: selectedSvc.name.toLowerCase().startsWith(selectedCarrier.carrierCode.toLowerCase())
            ? ''
            : selectedCarrier.carrierCode,
          name: selectedSvc.name,
        }
      : null;
  const nextPackable = scan?.orders.find((o) => o.packable && o.id !== result?.orderId && o.id !== orderId);
  const awaiting = state?.awaitingSerialFor
    ? lines.find((l) => l.orderLineId === state.awaitingSerialFor)
    : null;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <StickyFooterToastOffset />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
        <div className="flex flex-col gap-1">
          <Breadcrumbs
            items={[
              { label: 'Fulfillment' },
              { label: 'Outbound' },
              { label: 'Packing Station', href: '/packing-station' },
              { label: station.code },
            ]}
          />
          <div className="flex items-center gap-3">
            <Link
              href="/packing-station"
              className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Change station
            </Link>
            <h1 className="text-lg font-semibold">Pack at {station.code}</h1>
          </div>
        </div>
        <div
          role="tablist"
          aria-label="Pack mode"
          className="flex rounded-lg bg-surface-sunken p-0.5"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = PACK_MODES.indexOf(mode);
            const next =
              PACK_MODES[(i + (e.key === 'ArrowRight' ? 1 : PACK_MODES.length - 1)) % PACK_MODES.length];
            if (next) {
              e.preventDefault();
              router.push(`/packing-station/${station.id}/${next}`);
            }
          }}
        >
          {PACK_MODES.map((m) => (
            <Link
              key={m}
              href={`/packing-station/${station.id}/${m}`}
              role="tab"
              aria-selected={m === mode}
              tabIndex={m === mode ? 0 : -1}
              aria-controls="pack-workspace"
              id={`pack-tab-${m}`}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                m === mode ? 'bg-surface text-foreground shadow-sm' : 'text-secondary hover:text-foreground',
              )}
            >
              {MODE_LABELS[m].tab}
            </Link>
          ))}
        </div>
        <PackHints />
      </div>

      {executeReason ? (
        <div className="px-6 pt-4">
          <Callout variant="attention" title="Read-only view">
            {executeReason}. You can look up orders and totes, but packing, labels and issue reports are
            disabled.
          </Callout>
        </div>
      ) : null}

      <div
        id="pack-workspace"
        role="tabpanel"
        aria-labelledby={`pack-tab-${mode}`}
        className="grid flex-1 gap-4 px-6 py-4 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.3fr)]"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <Card className="space-y-3 p-4">
            <ScanField
              ref={sourceRef}
              id="pack-source"
              label={MODE_LABELS[mode].scan}
              placeholder={MODE_LABELS[mode].placeholder}
              onScan={lookup}
              busy={scanBusy}
              error={scanError}
              autoFocus
            />
            {blockedOrder ? (
              <p className="-mt-1 text-xs">
                <Link
                  href={`/orders/${blockedOrder.orderId}`}
                  className="font-medium text-primary hover:underline"
                  data-testid="pack-blocked-order-link"
                >
                  Open {blockedOrder.orderCode}
                </Link>
                <span className="text-secondary"> to view or reprint its label</span>
              </p>
            ) : null}
            {mode === 'order' ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setListOpen(true)}>
                  <ListChecks className="h-3.5 w-3.5" aria-hidden />
                  List &amp; select
                </Button>
                <Button variant="ghost" onClick={resetAll} disabled={!scan && !ctx}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Clear
                </Button>
              </div>
            ) : scan || ctx ? (
              <Button variant="ghost" size="sm" onClick={resetAll}>
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear
              </Button>
            ) : null}
          </Card>

          {scan ? (
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardList className="h-4 w-4 text-secondary" aria-hidden />
                  {scan.job ? `Job ${scan.job.code}` : `Source ${scan.sourceLabel}`}
                </p>
                {scan.job ? (
                  <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-2xs font-medium text-secondary">
                    {scan.job.jobType}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-secondary">
                {mode === 'order' ? '# of Orders' : `# of Orders in ${MODE_LABELS[mode].tab}`}:{' '}
                <strong className="tabular-nums text-foreground">
                  {scan.packedOrders + (result ? 1 : 0)}/{scan.totalOrders}
                </strong>{' '}
                packed
              </p>
              {scan.orders.length > 1 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {scan.orders.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        disabled={!o.packable || o.id === result?.orderId}
                        onClick={() => void openOrder(o.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                          o.id === orderId
                            ? 'border-primary bg-primary-soft'
                            : 'border-border hover:bg-surface-sunken',
                        )}
                      >
                        <span className="font-semibold">{o.code}</span>
                        <span className="text-secondary">{o.unitsToPack} units</span>
                        {o.countLock ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-1.5 py-0.5 text-2xs font-semibold text-danger"
                            title={o.countLock.reason}
                          >
                            <Lock className="h-3 w-3" aria-hidden />
                            {o.countLock.planCode}
                          </span>
                        ) : null}
                        <StatusPill
                          status={o.id === result?.orderId ? result.status : o.status}
                          domain="shipmentOrder"
                          size="sm"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : (
            <EmptyJobCard mode={mode} />
          )}

          {ctx && state ? (
            <>
              <Card className="space-y-3 p-4">
                <ScanField
                  ref={productRef}
                  id="pack-product"
                  disabled={Boolean(lockReason)}
                  label={awaiting ? `Scan serial number of ${awaiting.sku}` : 'Scan product'}
                  placeholder={awaiting ? 'Serial number' : 'SKU, barcode or FNSKU'}
                  onScan={onProduct}
                  error={productError && !awaiting ? productError : null}
                  hint={
                    awaiting ? (
                      <>
                        Waiting for the serial. <Kbd>Esc</Kbd> cancels.
                      </>
                    ) : (
                      'Each scan packs one unit into the open package.'
                    )
                  }
                />
                {totals ? (
                  <div className="flex items-center gap-3 text-xs text-secondary">
                    <span>
                      Total qty{' '}
                      <strong className="tabular-nums text-base text-foreground">
                        {totals.packed}/{totals.toPack}
                      </strong>
                    </span>
                    <ProgressBar
                      value={totals.packed}
                      max={Math.max(1, totals.toPack)}
                      tone={totals.packed >= totals.toPack ? 'success' : 'data'}
                      className="flex-1"
                    />
                  </div>
                ) : null}
              </Card>
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-base font-semibold">
                      <Link href={`/orders/${ctx.order.id}`} className="hover:underline">
                        {ctx.order.code}
                      </Link>
                      <StatusPill status={ctx.order.status} domain="shipmentOrder" size="sm" />
                      {ctx.order.priority === 'High' ? (
                        <span className="rounded bg-danger-soft px-1.5 text-2xs font-semibold text-danger">
                          High
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-secondary">
                      {ctx.order.customerName} · {ctx.order.clientName}
                      {ctx.order.storeOrderNumber ? ` · ${ctx.order.storeOrderNumber}` : ''}
                    </p>
                    <p className="text-2xs text-secondary">{ctx.order.shipTo}</p>
                  </div>
                  {ctx.order.isAutoShip ? (
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-2xs font-semibold text-success">
                      Auto-ship
                    </span>
                  ) : null}
                </div>
                {ctx.countLock ? (
                  <div data-testid="pack-lock-callout">
                    <Callout variant="error" title={`Locked by count plan ${ctx.countLock.planCode}`}>
                      {ctx.countLock.reason}
                      <span className="mt-1 flex flex-wrap gap-3 text-xs">
                        <Link
                          href={ctx.countLock.planId ? `/counts/${ctx.countLock.planId}` : '/counts'}
                          className="font-medium text-primary hover:underline"
                        >
                          Open {ctx.countLock.planCode}
                        </Link>
                        <Link href="/packing-station" className="font-medium text-primary hover:underline">
                          Choose another station
                        </Link>
                      </span>
                    </Callout>
                  </div>
                ) : null}
                {ctx.packingWarning ? (
                  <div data-testid="pack-warning-callout">
                    <Callout variant="attention" title={`Packing warning: ${ctx.packingWarning.name}`}>
                      {ctx.packingWarning.text}
                      <span className="mt-1 block text-2xs text-secondary">
                        {warningSeen.has(seenKey(ctx.packingWarning))
                          ? ctx.packingWarning.skipConfirmation
                            ? 'Shown'
                            : 'Acknowledged'
                          : `Shows when: ${ctx.packingWarning.triggerLabel.toLowerCase()}`}
                      </span>
                    </Callout>
                  </div>
                ) : null}
                {ctx.order.packingInstructions ? (
                  <Callout variant="attention" title="Packing instructions">
                    {ctx.order.packingInstructions}
                  </Callout>
                ) : null}
                {ctx.order.giftNote ? (
                  <Callout variant="info" title="Gift note">
                    <span className="inline-flex items-center gap-1">
                      <Gift className="h-3.5 w-3.5" aria-hidden />
                      {ctx.order.giftNote}
                    </span>
                  </Callout>
                ) : null}
                {resumed ? (
                  <div
                    data-testid="pack-resumed"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-info/30 bg-info-soft px-2.5 py-1.5 text-xs text-body"
                  >
                    <span>
                      Resumed: <strong className="tabular-nums">{resumed.units}</strong> unit
                      {resumed.units === 1 ? '' : 's'} already scanned · saved {fmt.dateTime(resumed.at)}
                      {resumed.by ? ` by ${resumed.by}` : ''}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void discardProgress()}
                      disabled={!canExecute}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      Start over
                    </Button>
                  </div>
                ) : null}
                <ContentsSummary lines={lines} state={state} />
                {canExecute && saveStatus ? (
                  <p
                    aria-live="polite"
                    data-testid="pack-save-status"
                    className={cn('text-2xs', saveStatus === 'error' ? 'text-danger' : 'text-secondary')}
                  >
                    {saveStatus === 'saving'
                      ? 'Saving progress…'
                      : saveStatus === 'saved'
                        ? 'Progress saved. Reopening this order resumes here.'
                        : 'Progress not saved. Check your connection; scans stay on this screen.'}
                  </p>
                ) : null}
              </Card>
            </>
          ) : ctxLoading ? (
            <Skeleton className="h-60" />
          ) : (
            <EmptyOrderCards />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {result ? (
            <ResultPanel
              result={result}
              printed={printed}
              nextLabel={nextPackable ? `Pack next order (${nextPackable.code})` : 'Scan next'}
              onNext={() => {
                const n = nextPackable;
                setResult(null);
                if (n) void openOrder(n.id);
                else resetAll();
              }}
            />
          ) : ctx && state ? (
            <>
              <PackageBoxes
                lines={lines}
                packages={ctx.packages}
                state={state}
                onState={(s) => {
                  setState(s);
                  staleRate();
                }}
                showErrors={showErrors}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={doClose}
                  disabled={state.boxes[state.active]?.closed || Boolean(lockReason)}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  Close pack<Kbd className="ml-1">F2</Kbd>
                </Button>
                <DisabledReason
                  reason={
                    lockReason
                      ? 'Count-locked'
                      : ctx.settings.disallowMultipleShipmentPackages
                        ? `${ctx.order.clientName} does not allow multiple packages per order`
                        : state.boxes.length >= 50
                          ? '50 packages is the maximum'
                          : null
                  }
                >
                  <Button
                    variant="ghost"
                    data-testid="pack-add-package"
                    disabled={
                      Boolean(lockReason) ||
                      Boolean(ctx.settings.disallowMultipleShipmentPackages) ||
                      state.boxes.length >= 50
                    }
                    onClick={() => {
                      setState(addBox(state));
                      staleRate();
                      toast.success(
                        'Package added',
                        `Package ${state.boxes.length + 1} is open. Scans go into it.`,
                      );
                      productRef.current?.focus();
                    }}
                  >
                    <PackagePlus className="h-3.5 w-3.5" aria-hidden />
                    Add package
                  </Button>
                </DisabledReason>
              </div>
              <Captures
                lines={lines}
                state={state}
                onState={(s) => {
                  setState(s);
                  setCompleteError(null);
                }}
              />
              <CarrierPanel
                context={ctx}
                choice={choice}
                onChoice={(c) => {
                  setChoice(c);
                  staleRate();
                }}
                rate={rate}
                rating={rating}
                rateError={rateError}
                onGetRate={() => void getRate()}
                onUpload={(f) => void upload(f)}
                uploading={uploading}
                uploadedName={uploaded}
                withLabelDisabled={false}
                rateDisabledReason={rateBlocker(state)}
              />
              {ctx.carriers.length > 0 ? (
                <RateShopCard
                  quotes={shop?.quotes ?? null}
                  errors={shop?.errors ?? []}
                  stale={Boolean(shop) && shop?.sig !== JSON.stringify(rateSpecs(state))}
                  shopping={shopping}
                  disabledReason={rateBlocker(state)}
                  accounts={new Set(ctx.carriers.map((c) => c.connectionId)).size}
                  selectedServiceId={rate ? choice.carrierServiceId : null}
                  onShop={() => void rateShop()}
                  onPick={pickQuote}
                />
              ) : null}
              {completeError ? (
                <Callout variant="error" title="Not completed">
                  {completeError}
                </Callout>
              ) : null}
            </>
          ) : (
            <PackPreview
              loading={ctxLoading}
              title={`${MODE_LABELS[mode].scan} to start`}
              hint="Only picked orders that are Ready to Pack can be packed here. The package, carrier and label controls unlock once an order is loaded."
            />
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-6 py-3 shadow-[0_-4px_12px_rgba(0,0,0,.04)]">
        <DropdownMenu>
          <DisabledReason reason={ctx ? null : 'Scan an order first'}>
            <DropdownMenuTrigger asChild disabled={!ctx}>
              <Button variant="secondary" disabled={!ctx}>
                Other actions
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="start" side="top" className="min-w-[260px]">
            <DropdownMenuItem
              icon={AlertTriangle}
              disabledReason={canReport ? null : 'You need the Report Issue permission'}
              description={
                ctx && !ctx.hospital
                  ? 'No hospital location configured in this warehouse'
                  : ctx?.hospital
                    ? `Move the picked stock to hospital ${ctx.hospital.code}`
                    : 'Move the picked stock to a hospital location'
              }
              onSelect={() => setIssueOpen(true)}
            >
              Report issue
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Print actions</DropdownMenuLabel>
            <DropdownMenuItem
              icon={FileText}
              disabledReason={canSlip ? null : 'You need the Print Packing Slip permission'}
              description="PDF of the items being packed"
              onSelect={() => void printSlip()}
            >
              Packing slip
            </DropdownMenuItem>
            {(ctx?.activeLabels ?? []).map((l) => (
              <DropdownMenuItem
                key={l.trackingNumber}
                icon={Printer}
                disabledReason={l.labelFileId ? null : 'No label file'}
                description={l.trackingNumber}
                onSelect={() => openFileId(l.labelFileId)}
              >
                Shipping label
              </DropdownMenuItem>
            ))}
            {ctx && ctx.activeLabels.length === 0 ? (
              <DropdownMenuItem icon={Printer} disabledReason="Labels are created when packing completes">
                Shipping label
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              icon={Printer}
              disabledReason={canRetailer ? retailerReason : 'You need the Create Retailer Label permission'}
              description={
                ctx?.order.retailerName
                  ? `Case labels for ${ctx.order.retailerName}`
                  : 'Case labels for B2B retailer orders'
              }
              onSelect={() => void printRetailer(false)}
            >
              Create retailer label
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Printer}
              disabledReason={
                !canRetailerReprint
                  ? 'You need the Reprint Retailer Label permission'
                  : (retailerReason ?? (retailerDone ? null : 'Create the retailer label first'))
              }
              description="Print the case labels again"
              onSelect={() => void printRetailer(true)}
            >
              Reprint retailer label
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={PackageX}
              disabledReason={
                executeReason
                  ? executeReason
                  : withLabelDisabledByClient
                    ? `Packing without a label is disabled for ${ctx?.order.clientName ?? 'this client'}`
                    : blocker && !blocker.startsWith('Choose a carrier')
                      ? blocker
                      : null
              }
              description="Complete packing without buying a label"
              onSelect={() => setNoLabelOpen(true)}
            >
              Pack without label
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2">
          {state && totals ? (
            <span className="text-xs text-secondary tabular-nums">
              {totals.packed}/{totals.toPack} packed ·{' '}
              {state.boxes.filter((b) => Object.keys(b.items).length).length} package(s)
            </span>
          ) : null}
          {ctx && state ? (
            <span
              aria-live="polite"
              className={cn(
                'inline-flex max-w-[440px] items-center gap-1.5 truncate rounded-md border px-2.5 py-1 text-xs',
                rate ? 'border-success/40 bg-success-soft text-success' : 'border-border text-secondary',
              )}
            >
              <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {useUploaded ? (
                <>
                  Uploaded label · <strong className="truncate">{uploaded}</strong>
                </>
              ) : selectedService ? (
                <>
                  <span className="truncate">
                    Selected:{' '}
                    <strong className="font-semibold text-foreground">
                      {selectedService.carrierCode ? `${selectedService.carrierCode} ` : ''}
                      {selectedService.name}
                    </strong>
                  </span>
                  <span aria-hidden>·</span>
                  {rating ? (
                    <span className="inline-flex items-center gap-1">
                      <Spinner className="h-3 w-3" label="Rating" />
                      Getting rate…
                    </span>
                  ) : rate ? (
                    <>
                      <strong className="tabular-nums">
                        {fmt.money(rate.price, rate.currency, 'summary')}
                      </strong>
                      <span className="whitespace-nowrap">
                        · {rate.transitDays} day{rate.transitDays === 1 ? '' : 's'}
                      </span>
                    </>
                  ) : (
                    <span>{quoteTried ? 'No quote' : 'Rate shown before buying'}</span>
                  )}
                </>
              ) : (
                'No shipping service chosen'
              )}
            </span>
          ) : null}
          <DisabledReason reason={blocker ?? labelPermReason}>
            <Button
              ref={completeRef}
              variant="primary"
              size="lg"
              disabled={Boolean(blocker ?? labelPermReason) || completing || rating}
              onClick={() => void complete(!useUploaded)}
            >
              {completing || rating ? (
                <Spinner className="h-4 w-4" label={rating ? 'Getting rate' : 'Completing'} />
              ) : (
                <PackageCheck className="h-4 w-4" aria-hidden />
              )}
              {useUploaded
                ? 'Complete packing (uploaded label)'
                : state && completeStep({ withLabel: true, hasRate: Boolean(rate), quoteTried }) === 'quote'
                  ? 'Get rate and review'
                  : rate
                    ? `Buy label (${fmt.money(rate.price, rate.currency, 'summary')}) and complete`
                    : 'Complete packing and create label'}
              <Kbd className="ml-1 border-white/30 bg-white/15 text-white shadow-none">F9</Kbd>
            </Button>
          </DisabledReason>
        </div>
      </div>

      {station ? (
        <ListSelectModal
          open={listOpen}
          onOpenChange={setListOpen}
          warehouseId={station.warehouseId}
          stationId={station.id}
          onStart={(code) => {
            setListOpen(false);
            router.replace(`/packing-station/${station.id}/order`);
            void lookup(code);
          }}
        />
      ) : null}
      {ctx ? (
        <PackingWarningDialog
          key={warningPrompt && ctx.packingWarning ? `open-${seenKey(ctx.packingWarning)}` : 'closed'}
          warning={warningPrompt && ctx.packingWarning ? ctx.packingWarning : null}
          orderCode={ctx.order.code}
          onAcknowledge={() => void acknowledgeWarning()}
          busy={warningBusy}
          error={warningError}
        />
      ) : null}
      {ctx ? (
        <ReportIssueDialog
          open={issueOpen}
          onOpenChange={setIssueOpen}
          orderId={ctx.order.id}
          orderCode={ctx.order.code}
          warehouseId={ctx.order.warehouseId}
          defaultLocationId={ctx.hospitalLocationId}
          defaultHospital={ctx.hospital ?? null}
          lines={lines.map((l) => ({
            orderLineId: l.orderLineId,
            sku: l.sku,
            name: l.name,
            imageUrl: l.imageUrl,
            toPack: l.toPack,
            packed: state ? state.boxes.reduce((s, b) => s + (b.items[l.orderLineId] ?? 0), 0) : 0,
          }))}
          onDone={() => {
            const reported = ctx.order.id;
            const more = scan?.orders.some((o) => o.packable && o.id !== reported);
            if (scan && more) {
              resetOrder();
              void lookup(scan.code);
            } else resetAll();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={noLabelOpen}
        onOpenChange={setNoLabelOpen}
        variant="attention"
        icon={PackageX}
        title={`Pack ${ctx?.order.code ?? ''} without a label?`}
        description="Packing completes and the order moves to Ready to Ship with no tracking number. Create or upload the label later from the order."
        confirmLabel="Yes, pack without label"
        cancelLabel="No"
        onConfirm={() => complete(false)}
      />
    </div>
  );
}
