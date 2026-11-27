'use client';

/**
 * Return Station flows (M04 §4–5, KitStaks-designed):
 *  - Return With RMA: scan the RMA / order code / tracking number → RMA lines → scan
 *    items, set condition and reasons → Complete (or Save progress).
 *  - Return Manually: client, optional order, scan products → Complete creates a Manual RMA.
 * Completing posts Return receipts (ledger Return Receiving) and uploads item photos.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  PackageOpen,
  RotateCcw,
  Save,
  Search,
} from 'lucide-react';
import { ScanField, type ScanFieldHandle } from '@/components/packing/scan-field';
import { beepDone, beepError, beepOk } from '@/components/packing/scan-feedback';
import { uploadFile } from '@/components/shared/upload-file';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { StatusPill } from '@/components/ui/status-pill';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { useShortcut } from '@/lib/keyboard';
import { useMe } from '@/lib/permissions-client';
import { cn } from '@/lib/utils';
import { ReturnItemList, useReturnRules } from './return-items';
import {
  addManualProduct,
  applyScan,
  itemsFromRma,
  itemsPayload,
  shortAfterReceive,
  totals,
  updateItem,
  validateItems,
  type CaptureItem,
  type ItemErrorField,
  type ItemErrors,
} from './return-station-model';
import type { ReturnDetail } from './return-types';
import {
  errorText,
  useApplyStationKpis,
  useInvalidateReturns,
  useLookupOptions,
  type StationKpis,
} from './returns-client';
import { ShippedOrderPicker } from './shipped-order-picker';

export interface StationContext {
  readonly warehouseId: string;
  readonly stationId: string;
  readonly stationCode: string;
  readonly targetLocationId: string | null;
  readonly targetLpId: string | null;
  readonly targetCode: string | null;
}

interface Candidate {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly orderCode: string | null;
  readonly customerName: string | null;
  readonly trackingNumber: string | null;
  readonly clientName: string;
  readonly requestedQty: number;
  readonly returnedQty: number;
  readonly receivable: boolean;
  readonly reason: string | null;
}

interface ReceiveResult {
  readonly returnOrderId: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly receivedQty: number;
  readonly receiptIds: readonly string[];
  readonly notified: number;
  readonly kpis?: StationKpis;
}

interface ResolvedProduct {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly trackLot?: boolean;
  readonly trackExpiry?: boolean;
  readonly trackProductionDate?: boolean;
  readonly trackSerial?: boolean;
}

/**
 * Server field errors (`items.<i>.<field>`, index into the posted items = rows with quantity > 0)
 * mapped back onto the capture rows, so the failing lot / serial / disposition is highlighted.
 */
export function mapServerItemErrors(
  items: readonly CaptureItem[],
  fieldErrors: Readonly<Record<string, readonly string[]>>,
): ItemErrors {
  const posted = items.filter((i) => i.quantity > 0);
  const out: Record<string, Partial<Record<ItemErrorField, string>>> = {};
  for (const [path, msgs] of Object.entries(fieldErrors)) {
    const m = /^items\.(\d+)\.(\w+)$/.exec(path);
    const row = m ? posted[Number(m[1])] : undefined;
    if (!m || !row || !msgs[0]) continue;
    const field =
      (
        [
          'quantity',
          'damageReasonId',
          'lotNumber',
          'expiryDate',
          'productionDate',
          'serials',
          'disposition',
          'packType',
          'productId',
        ] as const
      ).find((f) => f === m[2]) ?? 'productId';
    out[row.key] = { ...out[row.key], [field]: msgs[0] };
  }
  return out;
}

function placement(s: StationContext) {
  return {
    stationLocationId: s.stationId,
    targetLocationId: s.targetLpId ? null : s.targetLocationId,
    targetLpId: s.targetLpId,
  };
}

const INFLIGHT_KEY = 'kitstaks.returns.inflight';
export interface InflightReceive {
  readonly returnOrderId: string;
  readonly rmaCode: string;
  readonly at: string;
}

/** A receive the page was closed during (its outcome is unknown until the RMA is checked). */
export function readInflightReceive(): InflightReceive | null {
  try {
    const raw = window.sessionStorage.getItem(INFLIGHT_KEY);
    return raw ? (JSON.parse(raw) as InflightReceive) : null;
  } catch {
    return null;
  }
}
export function clearInflightReceive(): void {
  try {
    window.sessionStorage.removeItem(INFLIGHT_KEY);
  } catch {
    /* storage blocked */
  }
}
function markInflight(v: InflightReceive): void {
  try {
    window.sessionStorage.setItem(INFLIGHT_KEY, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
}

/** Warns before leaving the page while a receive is being committed. */
function useCommitGuard(active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}

/** Blocking progress state while the receipt posts (prevents double scans). */
function CommitOverlay({ label }: { readonly label: string }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
    >
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 shadow-lg">
        <Spinner className="h-5 w-5" label={label} />
        <div>
          <p className="text-base font-semibold text-foreground">{label}</p>
          <p className="text-xs text-secondary">Posting the receipt. Keep this page open.</p>
        </div>
      </div>
    </div>
  );
}
/** Photo file name carries the SKU ("MLT-WIDGET · photo.jpg") so the RMA's Photos tab groups it by line. */
export function photoFileName(sku: string, name: string): string {
  return `${sku} · ${name}`.slice(0, 200);
}

async function uploadPhotos(
  returnOrderId: string,
  photos: Readonly<Record<string, File>>,
  items: readonly CaptureItem[],
): Promise<number> {
  let failed = 0;
  for (const [key, raw] of Object.entries(photos)) {
    try {
      const sku = items.find((i) => i.key === key)?.sku;
      const file = sku ? new File([raw], photoFileName(sku, raw.name), { type: raw.type }) : raw;
      const fileId = await uploadFile(file, 'attachment', {
        entityType: 'return_order',
        entityId: returnOrderId,
      });
      await apiRequest('/api/attachments', {
        method: 'POST',
        body: { entityType: 'return_order', entityId: returnOrderId, documentType: 'Other', fileId },
      });
    } catch {
      failed += 1;
    }
  }
  return failed;
}

function Done({
  result,
  onNext,
  onExit,
  nextLabel,
}: {
  readonly result: ReceiveResult;
  readonly onNext: () => void;
  readonly onExit: () => void;
  readonly nextLabel: string;
}) {
  React.useEffect(() => {
    beepDone();
  }, []);
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <div role="status" className="contents">
        <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
        <h2 className="text-lg font-semibold">Return {result.rmaCode} received</h2>
        <p className="text-sm text-secondary">
          {result.receivedQty} unit{result.receivedQty === 1 ? '' : 's'} received on{' '}
          {result.receiptIds.length} receipt{result.receiptIds.length === 1 ? '' : 's'}. Status:{' '}
          <StatusPill status={result.status} domain="return" size="sm" />
          {result.notified
            ? ` · ${result.notified} client user${result.notified === 1 ? '' : 's'} notified`
            : ''}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button variant="primary" autoFocus onClick={onNext}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {nextLabel}
          </Button>
          <Link
            href={`/orders/returns/${result.returnOrderId}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-sunken"
          >
            View RMA
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <Button variant="ghost" onClick={onExit}>
            Back to station
          </Button>
        </div>
      </div>
    </Card>
  );
}

function useCapture() {
  const [items, setItems] = React.useState<CaptureItem[]>([]);
  const [errors, setErrors] = React.useState<ItemErrors>({});
  const [photos, setPhotos] = React.useState<Record<string, File>>({});
  const [highlight, setHighlight] = React.useState<string | null>(null);
  const reset = (next: CaptureItem[] = []) => {
    setItems(next);
    setErrors({});
    setPhotos({});
    setHighlight(null);
  };
  const onPhoto = (key: string, file: File | null) =>
    setPhotos((p) => {
      const next = { ...p };
      if (file) next[key] = file;
      else delete next[key];
      return next;
    });
  const onChange = (key: string, patch: Partial<CaptureItem>) => {
    setItems((xs) => updateItem(xs, key, patch));
    setErrors((e) => ({ ...e, [key]: {} }));
  };
  return { items, setItems, errors, setErrors, photos, onPhoto, highlight, setHighlight, reset, onChange };
}

function Totals({ items }: { readonly items: readonly CaptureItem[] }) {
  const t = totals(items);
  return (
    <div className="flex items-center gap-3 text-xs text-secondary">
      <span className="tabular-nums">
        <strong className="text-base text-foreground">{t.scanned}</strong>
        {t.expected !== null ? ` / ${t.expected}` : ''} units
      </span>
      {t.expected ? (
        <ProgressBar
          value={t.scanned}
          max={t.expected}
          tone={t.scanned >= t.expected ? 'success' : 'data'}
          className="w-32"
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- with RMA */

export function ReturnWithRma({
  station,
  initialCode,
  onExit,
  onSwitchWarehouse,
}: {
  readonly station: StationContext;
  readonly initialCode?: string | null;
  readonly onExit: () => void;
  /** Offered when the code matches an RMA in another warehouse the user can access. */
  readonly onSwitchWarehouse?: (warehouseId: string, code: string) => void;
}) {
  const [elsewhere, setElsewhere] = React.useState<{
    readonly warehouseId: string;
    readonly warehouseCode: string;
    readonly code: string;
  } | null>(null);
  const invalidate = useInvalidateReturns();
  const applyKpis = useApplyStationKpis();
  const lookupRef = React.useRef<ScanFieldHandle>(null);
  const itemRef = React.useRef<ScanFieldHandle>(null);
  const [lookupBusy, setLookupBusy] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<readonly Candidate[] | null>(null);
  const [rma, setRma] = React.useState<ReturnDetail | null>(null);
  // After an RMA loads, the item field mounts in the next commit: focus it then, so the
  // lookup field's own "keep focus for the next scan" cannot win the race.
  const loadedRmaId = rma?.id ?? null;
  React.useEffect(() => {
    if (loadedRmaId) requestAnimationFrame(() => itemRef.current?.focus());
  }, [loadedRmaId]);
  const [itemError, setItemError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<'complete' | 'partial' | null>(null);
  const [result, setResult] = React.useState<ReceiveResult | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const cap = useCapture();
  const damage = useLookupOptions('damage_reason', rma?.clientId);
  const reasons = useLookupOptions('return_reason', rma?.clientId);
  const rules = useReturnRules();
  const [shortConfirm, setShortConfirm] = React.useState<{
    readonly total: number;
    readonly lines: readonly { readonly sku: string; readonly short: number }[];
  } | null>(null);
  const [shortReason, setShortReason] = React.useState('');

  const load = React.useCallback(
    async (id: string) => {
      const { data } = await apiRequest<ReturnDetail>(`/api/returns/${id}`);
      setRma(data);
      setCandidates(null);
      cap.reset(itemsFromRma(data.lines));
      beepOk();
      requestAnimationFrame(() => itemRef.current?.focus());
    },
    [cap],
  );

  const lookup = async (code: string) => {
    setLookupBusy(true);
    setLookupError(null);
    setElsewhere(null);
    try {
      const { data } = await apiRequest<readonly Candidate[]>('/api/returns/lookup', {
        query: { warehouseId: station.warehouseId, code },
      });
      if (data.length === 0) {
        // Not here: say where it is, so the operator can switch instead of hitting a dead end.
        const other = await apiRequest<readonly { warehouseId: string; warehouseCode: string }[]>(
          '/api/returns/lookup/elsewhere',
          { query: { code } },
        )
          .then((r) => r.data)
          .catch(() => []);
        const hit = other.find((o) => o.warehouseId !== station.warehouseId);
        if (hit) {
          setElsewhere({ warehouseId: hit.warehouseId, warehouseCode: hit.warehouseCode, code });
          throw new Error(`"${code}" is a return for warehouse ${hit.warehouseCode}, not this one.`);
        }
        throw new Error(`No return found for "${code}" in this warehouse.`);
      }
      const receivable = data.filter((c) => c.receivable);
      if (receivable.length === 1 && data.length === 1) await load(receivable[0]?.id ?? '');
      else if (receivable.length === 0) throw new Error(data[0]?.reason ?? "This return can't be received.");
      else setCandidates(data);
    } catch (e) {
      beepError();
      lookupRef.current?.flash('error');
      setLookupError(errorText(e));
    } finally {
      setLookupBusy(false);
    }
  };

  const ran = React.useRef(false);
  React.useEffect(() => {
    if (initialCode && !ran.current) {
      ran.current = true;
      void lookup(initialCode);
    }
  });

  const scanItem = async (code: string) => {
    if (!rma) return;
    let out = applyScan(cap.items, code);
    if (!out.ok) {
      // Show the miss at once; an alternate barcode resolved by the server below clears it.
      const firstError = out.error;
      beepError();
      itemRef.current?.flash('error');
      setItemError(firstError);
      toast.error('Wrong item', firstError);
      try {
        const { data } = await apiRequest<ResolvedProduct | null>('/api/returns/products', {
          query: { clientId: rma.clientId, code },
        });
        if (data) {
          const withCode = cap.items.map((i) =>
            i.productId === data.id ? { ...i, scanCodes: [...i.scanCodes, code.toLowerCase()] } : i,
          );
          const retry = applyScan(withCode, code);
          if (retry.ok || cap.items.some((i) => i.productId === data.id)) out = retry;
          else out = { ok: false, error: `${data.sku} is not on RMA ${rma.rmaCode}.` };
        }
      } catch {
        /* keep the first message */
      }
    }
    if (!out.ok) {
      setItemError(out.error);
      return;
    }
    beepOk();
    itemRef.current?.flash('ok');
    setItemError(null);
    cap.setItems(out.items);
    cap.setHighlight(out.key);
  };

  const submit = async (complete: boolean, shortClose = false) => {
    if (!rma) return;
    const v = validateItems(cap.items, rules);
    cap.setErrors(v.errors);
    if (v.message) {
      setSubmitError(v.message);
      beepError();
      return;
    }
    // Completing with units still expected closes them as short: never on one stray F9.
    const short = shortAfterReceive(cap.items);
    if (complete && !shortClose && short.total > 0) {
      setShortReason('');
      setShortConfirm(short);
      return;
    }
    setShortConfirm(null);
    setSaving(complete ? 'complete' : 'partial');
    setSubmitError(null);
    // Marked until the server answers: a reload in between shows "check this RMA" (a retry is safe,
    // the server rejects receiving more than is left).
    markInflight({ returnOrderId: rma.id, rmaCode: rma.rmaCode, at: new Date().toISOString() });
    try {
      const { data } = await apiRequest<ReceiveResult>('/api/returns/receive', {
        method: 'POST',
        body: {
          returnOrderId: rma.id,
          ...placement(station),
          items: itemsPayload(cap.items, true),
          complete,
          shortClose,
          shortCloseReason: shortClose ? shortReason.trim() || null : null,
        },
      });
      // The receipt is committed: show success now; photos upload in the background.
      const photos = cap.photos;
      const captured = cap.items;
      void uploadPhotos(rma.id, photos, captured).then((failedPhotos) => {
        if (failedPhotos)
          toast.warning(
            "Some photos weren't saved",
            `${failedPhotos} photo${failedPhotos === 1 ? '' : 's'} failed to upload. Add them from the RMA's Photos & documents tab.`,
          );
      });
      applyKpis(station.warehouseId, data.kpis);
      void invalidate();
      if (!complete && data.status !== 'Completed') {
        toast.success(
          'Progress saved',
          `${data.receivedQty} unit${data.receivedQty === 1 ? '' : 's'} received on ${data.rmaCode}. Status: ${data.status}.`,
        );
        await load(rma.id);
        return;
      }
      setResult(data);
    } catch (e) {
      beepError();
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length)
        cap.setErrors(mapServerItemErrors(cap.items, e.fieldErrors));
      if (e instanceof ApiError && e.fieldErrors.shortClose) {
        setShortReason('');
        setShortConfirm(shortAfterReceive(cap.items));
      }
      setSubmitError(errorText(e, 'The return could not be received.'));
    } finally {
      clearInflightReceive();
      setSaving(null);
    }
  };

  useShortcut(
    'F9',
    (e) => {
      e.preventDefault();
      if (rma && !saving && !shortConfirm) void submit(true);
    },
    {
      enabled: Boolean(rma) && !result,
      allowInInputs: true,
      description: 'Complete the return',
      group: 'Return station',
    },
  );

  useCommitGuard(Boolean(saving));

  const startOver = () => {
    setResult(null);
    setRma(null);
    setCandidates(null);
    cap.reset();
    setSubmitError(null);
    setItemError(null);
    requestAnimationFrame(() => lookupRef.current?.focus());
  };

  if (result)
    return <Done result={result} onNext={startOver} onExit={onExit} nextLabel="Receive next return" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Station
        </Button>
        <p className="text-xs text-secondary">
          Return with RMA · {station.stationCode}
          {station.targetCode ? ` → ${station.targetCode}` : ''}
        </p>
      </div>
      <Card className="p-4">
        <ScanField
          ref={lookupRef}
          id="rma-lookup"
          label="RMA, order code or tracking number"
          onScan={lookup}
          busy={lookupBusy}
          error={lookupError}
          autoFocus={!rma}
          hint="Scan the return label, the packing slip or type the RMA code."
          size={rma ? 'md' : 'lg'}
          onValueChange={() => {
            if (lookupError) setLookupError(null);
            if (elsewhere) setElsewhere(null);
          }}
        />
        {elsewhere && onSwitchWarehouse ? (
          <Callout
            variant="info"
            title={`Found in ${elsewhere.warehouseCode}`}
            className="mt-3"
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => onSwitchWarehouse(elsewhere.warehouseId, elsewhere.code)}
              >
                Switch to {elsewhere.warehouseCode}
              </Button>
            }
          >
            Switching changes the receiving warehouse and its return station, then loads this return.
          </Callout>
        ) : null}
        {candidates ? (
          <div className="mt-3 space-y-1.5" role="listbox" aria-label="Matching returns">
            <p className="text-xs font-medium text-body">{candidates.length} returns match. Choose one:</p>
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={false}
                disabled={!c.receivable}
                onClick={() => void load(c.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                title={c.reason ?? undefined}
              >
                <span>
                  <strong>{c.rmaCode}</strong> · {c.orderCode ?? 'Manual'} · {c.customerName ?? 'None'}
                </span>
                <span className="flex items-center gap-2 text-xs text-secondary">
                  {c.returnedQty}/{c.requestedQty}
                  <StatusPill status={c.status} domain="return" size="sm" />
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </Card>
      {rma ? (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="flex items-center gap-2 text-base font-semibold">
                RMA {rma.rmaCode}
                <StatusPill status={rma.status} domain="return" size="sm" />
              </p>
              <p className="text-xs text-secondary">
                {rma.order?.code ?? 'Manual'} · {rma.customerName ?? 'None'} · {rma.clientName}
                {rma.trackingNumber ? ` · ${rma.trackingNumber}` : ''}
              </p>
            </div>
            <Totals items={cap.items} />
          </Card>
          {cap.items.length === 0 ? (
            <Callout variant="info" title="Nothing left to receive">
              Every line of {rma.rmaCode} is already received. Complete it from the RMA page.
            </Callout>
          ) : (
            <>
              <Card className="p-4">
                <ScanField
                  ref={itemRef}
                  id="rma-item"
                  label="Scan item"
                  onScan={scanItem}
                  error={itemError}
                  hint={
                    <>
                      Each scan adds one unit. <Kbd>F9</Kbd> completes the return.
                    </>
                  }
                />
              </Card>
              <ReturnItemList
                items={cap.items}
                errors={cap.errors}
                highlightKey={cap.highlight}
                damageReasons={damage}
                returnReasons={reasons}
                photos={cap.photos}
                onPhoto={cap.onPhoto}
                onChange={cap.onChange}
                targetCode={station.targetCode}
                stationCode={station.stationCode}
              />
            </>
          )}
          {submitError ? (
            <Callout variant="error" title="Not received">
              {submitError}
            </Callout>
          ) : null}
          {saving ? (
            <CommitOverlay
              label={saving === 'complete' ? `Completing ${rma.rmaCode}…` : `Saving ${rma.rmaCode}…`}
            />
          ) : null}
          <ConfirmDialog
            open={Boolean(shortConfirm)}
            onOpenChange={(o) => {
              if (!o) setShortConfirm(null);
            }}
            variant="attention"
            title={shortConfirm ? `Close ${rma.rmaCode} as short?` : 'Close as short?'}
            description={
              shortConfirm ? (
                <>
                  {shortConfirm.total} unit{shortConfirm.total === 1 ? '' : 's'} not received will be closed
                  as short. The RMA moves to Completed; a supervisor can reopen it from the RMA to receive the
                  rest. To keep it open, choose <strong>Save progress</strong> instead.
                </>
              ) : null
            }
            records={
              shortConfirm
                ? {
                    columns: [
                      { key: 'sku', label: 'SKU' },
                      { key: 'short', label: 'Not received' },
                    ],
                    rows: shortConfirm.lines.map((l) => ({ sku: l.sku, short: l.short })),
                  }
                : undefined
            }
            confirmLabel="Close as short"
            cancelLabel="Keep receiving"
            onConfirm={() => submit(true, true)}
          >
            <label
              className="mt-1 flex flex-col gap-1 text-xs font-medium text-body"
              htmlFor="short-close-reason"
            >
              Reason (optional)
              <TextField
                id="short-close-reason"
                className="h-9 w-full"
                value={shortReason}
                maxLength={300}
                placeholder="e.g. Customer kept 2 units"
                onChange={(ev) => setShortReason(ev.target.value)}
              />
            </label>
          </ConfirmDialog>
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface py-3">
            <Button variant="ghost" onClick={startOver} disabled={Boolean(saving)}>
              Scan another RMA
            </Button>
            <Button
              variant="secondary"
              onClick={() => void submit(false)}
              disabled={Boolean(saving) || cap.items.length === 0}
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              {saving === 'partial' ? 'Saving…' : 'Save progress'}
            </Button>
            <Button
              variant="primary"
              onClick={() => void submit(true)}
              disabled={Boolean(saving) || cap.items.length === 0}
            >
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
              {saving === 'complete' ? 'Completing…' : 'Complete return'}
              <Kbd className="ml-1 border-white/30 bg-white/15 text-white shadow-none">F9</Kbd>
            </Button>
          </div>
        </>
      ) : !candidates ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center text-secondary">
          <Search className="h-8 w-8 text-faint" aria-hidden />
          <p className="text-sm">Scan a return to load its lines.</p>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- manual */

export function ReturnManually({
  station,
  onExit,
}: {
  readonly station: StationContext;
  readonly onExit: () => void;
}) {
  const me = useMe();
  const invalidate = useInvalidateReturns();
  const applyKpis = useApplyStationKpis();
  const clients = me.data?.data.contextOptions.clients ?? [];
  const [clientId, setClientId] = React.useState<string | null>(me.data?.data.context.clientId ?? null);
  const [order, setOrder] = React.useState<{ id: string; code: string } | null>(null);
  const [customerName, setCustomerName] = React.useState('');
  const [note, setNote] = React.useState('');
  const [picking, setPicking] = React.useState(false);
  const [itemError, setItemError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ReceiveResult | null>(null);
  const itemRef = React.useRef<ScanFieldHandle>(null);
  const cap = useCapture();
  const damage = useLookupOptions('damage_reason', clientId);
  const reasons = useLookupOptions('return_reason', clientId);

  const changeClient = (id: string | null) => {
    if (cap.items.length && id !== clientId) cap.reset();
    setClientId(id);
    setOrder(null);
    setClientError(null);
  };

  const scan = async (code: string) => {
    if (!clientId) {
      setClientError('Choose the client first');
      beepError();
      return;
    }
    setBusy(true);
    try {
      const { data } = await apiRequest<ResolvedProduct | null>('/api/returns/products', {
        query: { clientId, code },
      });
      if (!data) throw new Error(`No product of this client matches "${code}".`);
      const out = addManualProduct(cap.items, data, code);
      cap.setItems(out.items);
      cap.setHighlight(out.key);
      setItemError(null);
      beepOk();
      itemRef.current?.flash('ok');
    } catch (e) {
      beepError();
      itemRef.current?.flash('error');
      const msg = errorText(e);
      setItemError(msg);
      toast.error('Product not found', msg);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!clientId) {
      setClientError('Choose the client');
      return;
    }
    const v = validateItems(cap.items);
    cap.setErrors(v.errors);
    if (v.message) {
      setSubmitError(v.message === 'Scan at least one item' ? 'Scan at least one product' : v.message);
      beepError();
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const { data } = await apiRequest<ReceiveResult>('/api/returns/manual', {
        method: 'POST',
        body: {
          warehouseId: station.warehouseId,
          clientId,
          shipmentOrderId: order?.id ?? null,
          customerName: customerName.trim() || null,
          note: note.trim() || null,
          ...placement(station),
          items: itemsPayload(cap.items, false),
        },
      });
      const photos = cap.photos;
      void uploadPhotos(data.returnOrderId, photos, cap.items).then((failed) => {
        if (failed)
          toast.warning("Some photos weren't saved", "Add them from the RMA's Photos & documents tab.");
      });
      applyKpis(station.warehouseId, data.kpis);
      void invalidate();
      setResult(data);
    } catch (e) {
      beepError();
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length)
        cap.setErrors(mapServerItemErrors(cap.items, e.fieldErrors));
      setSubmitError(errorText(e, 'The manual return could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  useCommitGuard(saving);

  useShortcut(
    'F9',
    (e) => {
      e.preventDefault();
      if (!saving) void submit();
    },
    {
      enabled: cap.items.length > 0 && !result,
      allowInInputs: true,
      description: 'Complete the return',
      group: 'Return station',
    },
  );

  if (result) {
    return (
      <Done
        result={result}
        onExit={onExit}
        nextLabel="Start another manual return"
        onNext={() => {
          setResult(null);
          cap.reset();
          setOrder(null);
          setCustomerName('');
          setNote('');
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Station
        </Button>
        <p className="text-xs text-secondary">
          Return manually · {station.stationCode}
          {station.targetCode ? ` → ${station.targetCode}` : ''}
        </p>
      </div>
      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-client" className="text-xs font-semibold text-body">
            Client <span className="text-danger">*</span>
          </label>
          <Select
            id="manual-client"
            value={clientId}
            invalid={Boolean(clientError)}
            onChange={changeClient}
            options={clients.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))}
            placeholder="Choose the client"
          />
          {clientError ? <p className="text-2xs text-danger">{clientError}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-body">
            Shipment order <span className="font-normal text-secondary">(optional)</span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="flex-1 justify-start"
              disabled={!clientId}
              onClick={() => setPicking(true)}
              title={clientId ? undefined : 'Choose the client first'}
            >
              <PackageOpen className="h-3.5 w-3.5" aria-hidden />
              {order ? order.code : 'Link a shipped order'}
            </Button>
            {order ? (
              <Button variant="ghost" onClick={() => setOrder(null)}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-customer" className="text-xs font-semibold text-body">
            Customer name
          </label>
          <TextField
            id="manual-customer"
            value={customerName}
            maxLength={200}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder={order ? 'From the order' : 'Who sent it back'}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="manual-note" className="text-xs font-semibold text-body">
            Note
          </label>
          <TextField
            id="manual-note"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. No RMA in the box"
          />
        </div>
      </Card>
      <Card className={cn('p-4', !clientId && 'opacity-70')}>
        <ScanField
          ref={itemRef}
          id="manual-item"
          label="Scan product"
          onScan={scan}
          busy={busy}
          error={itemError}
          disabled={!clientId}
          autoFocus
          hint={
            clientId ? (
              <>
                SKU or barcode. Each scan adds one unit. <Kbd>F9</Kbd> completes.
              </>
            ) : (
              'Choose the client to start scanning.'
            )
          }
        />
      </Card>
      {cap.items.length ? (
        <>
          <div className="flex justify-end">
            <Totals items={cap.items} />
          </div>
          <ReturnItemList
            items={cap.items}
            errors={cap.errors}
            highlightKey={cap.highlight}
            damageReasons={damage}
            returnReasons={reasons}
            photos={cap.photos}
            onPhoto={cap.onPhoto}
            onChange={cap.onChange}
            onRemove={(key) => cap.setItems(cap.items.filter((i) => i.key !== key))}
            targetCode={station.targetCode}
            stationCode={station.stationCode}
          />
        </>
      ) : null}
      {submitError ? (
        <Callout variant="error" title="Not saved">
          {submitError}
        </Callout>
      ) : null}
      {saving ? <CommitOverlay label="Completing manual return…" /> : null}
      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-surface py-3">
        <Button variant="ghost" onClick={onExit} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving || cap.items.length === 0}>
          <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
          {saving ? 'Saving…' : 'Complete manual return'}
          <Kbd className="ml-1 border-white/30 bg-white/15 text-white shadow-none">F9</Kbd>
        </Button>
      </div>
      <ShippedOrderPicker
        open={picking}
        onOpenChange={setPicking}
        clientId={clientId}
        warehouseId={station.warehouseId}
        title="Link a shipped order"
        confirmLabel="Link order"
        onPick={async (id) => {
          if (id) {
            try {
              const { data } = await apiRequest<
                readonly { id: string; code: string; customerName?: string }[]
              >('/api/returns/shippable', { query: { orderIds: id } });
              const o = data[0];
              if (o?.code) {
                setOrder({ id: o.id, code: o.code });
                if (!customerName && o.customerName) setCustomerName(o.customerName);
              }
            } catch (e) {
              toast.error('Order not linked', errorText(e));
            }
          }
          setPicking(false);
        }}
      />
    </div>
  );
}
