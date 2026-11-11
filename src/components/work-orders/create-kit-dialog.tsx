"use client";

/**
 * Create Kit — Logiwa's 3-step drawer for one work order:
 *   1. Confirmation: scan the source location / LP (required) and review component cards
 *      with Component QTY / Total QTY chips.
 *   2. Information: kit qty (≤ requested − processed), target location / LP, attribute
 *      selection (lot, expiry, production date) and the kitting task time range.
 *   3. Summary: Inventory Transaction Summary (SKU, LOCATION, CURRENT QTY, signed QTY CHANGE:
 *      kit +n green, components −n red) before Save.
 * Posts `/api/work-orders/create-kit` (ledger Kitting + Kitting receipt), then shows a Kit summary.
 */
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Boxes, CheckCircle2, Lock, Pencil, Printer, RefreshCw, ScanLine } from "lucide-react";
import { PrintOptionsModal } from "@/components/shared";
import { LocationPicker, LpPicker } from "@/components/shared/entity-pickers";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Drawer } from "@/components/ui/drawer";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { DisabledReason } from "@/components/ui/tooltip";
import { WizardPills, type StepMeta } from "@/components/ui/wizard";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { formatInZone } from "@/lib/grid-defs/work-orders/wo-time";
import { remainingQty } from "@/lib/grid-defs/work-orders/work-order-model";
import { codeList, createKitDeltas, fefoScanCodes, groupOfScan, matchSourceScan, newIdempotencyKey, NO_PICK_TASKS_REASON, pickBlockReason, pickProgress, sourceScanCodes, sourceScanGroups } from "@/lib/grid-defs/work-orders/kit-steps";
import { Checkbox } from "@/components/ui/checkbox";
import { useCan } from "@/lib/permissions-client";
import { errorMessage, useInvalidateWorkOrders, useWoPlanner, WO_P, type StockBucket, type WorkOrderDetail } from "./wo-client";
import { Field, focusFirst, KitUnit, fromDateOnly, toDateOnly } from "./wo-ui";
import { KitDeltaTable, QtyChip } from "./kit-delta-table";

export interface CreateKitDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workOrderId: string | null;
  readonly onDone?: () => void;
}

export function CreateKitDialog({ open, onOpenChange, workOrderId, onDone }: CreateKitDialogProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Create kit" width={60} bodyClassName="flex flex-col p-0">
      {open && workOrderId ? <Body key={workOrderId} workOrderId={workOrderId} onClose={() => onOpenChange(false)} onDone={onDone} /> : null}
    </Drawer>
  );
}

type Step = "confirm" | "info" | "summary";
/**
 * Stock the build can draw on for one component. With picking: what is actually in the kitting
 * area for this work order (picked, not consumed); when the supervisor confirmed "Complete pending
 * picks and build", the still-unpicked reservation counts too. Without picking: the chosen source
 * bucket, or free stock across bins for FEFO.
 */
function componentAvailable(c: WorkOrderDetail["components"][number], withPicking: boolean, forcePicks = false): number {
  if (withPicking) return forcePicks ? c.allocatedQty : (c.inKittingAreaQty ?? 0);
  // Lock-aware (server): the chosen source's free qty, 0 while a count plan locks it, else usable FEFO stock.
  if (c.availableQty !== undefined) return c.availableQty;
  if (c.sourceLockedBy) return 0;
  const atSource = c.locationId && c.sourceFreeQty !== null && c.sourceFreeQty !== undefined;
  return atSource ? (c.sourceFreeQty ?? 0) : c.freeQty;
}

/** After this long without an answer the kit row stops spinning and reads "n/a". */
const KIT_STOCK_TIMEOUT_MS = 8_000;

/** Kit on hand at the target location (and LP when one is chosen); 0 when there is none. */
function kitOnHand(buckets: readonly StockBucket[], locationId: string | null, lpId: string | null): number {
  return buckets.filter((b) => (!locationId || b.locationId === locationId) && (!lpId || b.lpId === lpId)).reduce((sum, b) => sum + b.onHand, 0);
}

interface Snapshot { readonly at: Date; readonly avail: Readonly<Record<string, number>>; readonly kit: number | null }

const STEPS: readonly { key: Step; label: string }[] = [{ key: "confirm", label: "Confirmation" }, { key: "info", label: "Information" }, { key: "summary", label: "Summary" }];
type Key = "scan" | "qty" | "locationId" | "lotNumber" | "expiryDate" | "productionDate" | "actualFinishAt";

/** Per-component scan check on Create Kit step 1 (one scan per source location). */
function ScanChip({ code, expected }: { readonly code: string | null; readonly expected: string | null }) {
  if (!expected) return null;
  return code
    ? <span className="inline-flex w-fit items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-2xs font-semibold text-success"><CheckCircle2 className="h-3 w-3" aria-hidden />Scanned {code}</span>
    : <span className="inline-flex w-fit items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-2xs text-secondary"><ScanLine className="h-3 w-3" aria-hidden />Scan {expected}</span>;
}

function Footer({ children }: { readonly children: React.ReactNode }) {
  return <div className="sticky bottom-0 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">{children}</div>;
}

function Body({ workOrderId, onClose, onDone }: { readonly workOrderId: string; readonly onClose: () => void; readonly onDone?: () => void }) {
  const detail = useApiQuery<WorkOrderDetail>(["work-order", workOrderId], `/api/work-orders/${encodeURIComponent(workOrderId)}`, { staleTime: 0, timeoutMs: 20_000 });
  const invalidate = useInvalidateWorkOrders();
  const planner = useWoPlanner();
  const canPick = useCan(WO_P.picking).allowed;
  const canForcePicks = planner && canPick;
  const [forcePicks, setForcePicks] = React.useState(false);
  const d = detail.data?.data;
  const [step, setStep] = React.useState<Step>("confirm");
  const [scan, setScan] = React.useState("");
  // All-FEFO: the one confirmed scan. Chosen sources: one scan per source location (label -> scanned code).
  const [fefoConfirmed, setFefoConfirmed] = React.useState<string | null>(null);
  const [scanned, setScanned] = React.useState<Readonly<Record<string, string>>>({});
  const [scanNote, setScanNote] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState<number | null>(null);
  const [locationId, setLocationId] = React.useState<string | null>(null);
  const [locationLabel, setLocationLabel] = React.useState<string | undefined>(undefined);
  const [lpId, setLpId] = React.useState<string | null>(null);
  const [lpLabel, setLpLabel] = React.useState<string | undefined>(undefined);
  const [lot, setLot] = React.useState("");
  const [expiry, setExpiry] = React.useState<Date | null>(null);
  const [production, setProduction] = React.useState<Date | null>(null);
  const [startAt, setStartAt] = React.useState<Date | null>(null);
  const [finishAt, setFinishAt] = React.useState<Date | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<Key, string>>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [summary, setSummary] = React.useState<{ qty: number; status: string; processedQty: number; location: string | null; lot: string | null } | null>(null);
  const [printing, setPrinting] = React.useState(false);
  // One idempotency key per build attempt: a retry after a lost response replays, never re-consumes.
  const idemKey = React.useRef<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const seeded = React.useRef(false);
  // Summary quantities are read once when the step opens, so the preview never shifts under the
  // operator; a later refetch that differs raises a "stock changed" notice instead.
  const [snap, setSnap] = React.useState<Snapshot | null>(null);

  React.useEffect(() => {
    if (!d || seeded.current) return;
    seeded.current = true;
    setQty(remainingQty(d.workOrder));
    setLocationId(d.workOrder.outputLocationId);
    setLocationLabel(d.outputLocationCode ?? undefined);
    setLot(d.workOrder.outputLot ?? "");
    setExpiry(fromDateOnly(d.workOrder.outputExpiry));
    setStartAt(d.workOrder.actualStartAt ? new Date(d.workOrder.actualStartAt) : new Date());
    setFinishAt(new Date());
  }, [d]);
  const kitStock = useApiQuery<StockBucket[]>(["kit-stock", d?.workOrder.kitProductId ?? "", d?.workOrder.warehouseId ?? "", "summary"], d ? "/api/kits/stock" : null, {
    query: d ? { productId: d.workOrder.kitProductId, warehouseId: d.workOrder.warehouseId, clientId: d.workOrder.clientId } : undefined, staleTime: 0,
  });

  // All-FEFO without picking: the scan is still required (Logiwa step 1); valid codes are the bins / LPs
  // holding usable stock of a component. If this lookup fails, any scan passes here and the server checks it.
  const fefoIds = d && d.workOrder.type !== "Work Order with Picking" && d.components.every((c) => !c.locationId && !c.lpNumber)
    ? d.components.map((c) => c.componentProductId).join(",") : "";
  const fefoStock = useApiQuery<Record<string, StockBucket[]>>(["kit-sources", fefoIds, d?.workOrder.warehouseId ?? "", d?.workOrder.clientId ?? "", "create-kit"], fefoIds && d ? "/api/kits/sources" : null, {
    query: fefoIds && d ? { productIds: fefoIds, warehouseId: d.workOrder.warehouseId, clientId: d.workOrder.clientId } : undefined, staleTime: 0, timeoutMs: 20_000,
  });

  // The kit row never spins without end: after a timeout it settles as "n/a" (Save still checks server-side).
  const [kitTimedOut, setKitTimedOut] = React.useState(false);
  React.useEffect(() => {
    if (kitStock.data || kitStock.error) return;
    const t = window.setTimeout(() => setKitTimedOut(true), KIT_STOCK_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [kitStock.data, kitStock.error]);
  const kitSettled = Boolean(kitStock.data || kitStock.error || kitTimedOut);
  React.useEffect(() => {
    if (step !== "summary" || snap || !d || !kitSettled) return;
    const wp = d.workOrder.type === "Work Order with Picking";
    setSnap({ at: new Date(), avail: Object.fromEntries(d.components.map((c) => [c.id, componentAvailable(c, wp, forcePicks)])), kit: kitStock.data ? kitOnHand(kitStock.data.data ?? [], locationId, lpId) : null });
  }, [step, snap, d, kitSettled, kitStock.data, locationId, lpId, forcePicks]);

  if (!d) {
    return (
      <div className="px-5 py-4">
        {detail.error ? <Callout variant="error" title="Work order not available" action={<Button type="button" size="sm" variant="secondary" disabled={detail.isFetching} onClick={() => void detail.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Retry</Button>}>{detail.error.message}</Callout> : (
          <div role="status" aria-live="polite" className="flex flex-col gap-3">
            <span className="flex items-center gap-2 text-xs text-secondary"><Spinner className="h-3.5 w-3.5" label="Loading" />Loading work order and component stock…</span>
            <Skeleton className="h-7 w-72" /><Skeleton className="h-10 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" />
          </div>
        )}
      </div>
    );
  }

  const wo = d.workOrder;
  const remaining = remainingQty(wo);
  const withPicking = wo.type === "Work Order with Picking";
  const build = qty ?? 0;
  const chosenCodes = sourceScanCodes(d.components, withPicking, d.outputLocationCode);
  const fefo = !withPicking && chosenCodes.length === 0;
  const fefoCodes = fefo && fefoStock.data ? fefoScanCodes(fefoStock.data.data ?? {}) : [];
  // Codes the scan must match: chosen sources, the kitting area, or (FEFO) any usable bin / LP.
  const codes = chosenCodes.length ? chosenCodes : fefoCodes;
  // One group per source location (with picking: the kitting area); each must be scanned once.
  const groups = sourceScanGroups(d.components.map((c) => ({ id: c.id, locationCode: c.locationCode, lpNumber: c.lpNumber })), withPicking, d.outputLocationCode);
  const groupOf = (componentId: string) => groups.find((g) => g.componentIds.includes(componentId)) ?? null;
  const allScanned = groups.length ? groups.every((g) => scanned[g.label]) : Boolean(fefoConfirmed);
  const confirmed = allScanned ? (groups.length ? groups.map((g) => scanned[g.label] ?? g.label).join(", ") : fefoConfirmed) : null;
  const scannedCount = groups.filter((g) => scanned[g.label]).length;
  const resetScans = () => { setScanned({}); setFefoConfirmed(null); setScanNote(null); };
  const picks = pickProgress(d.tasks);
  // A picking job with no Picking tasks never moved anything to the kitting area: nothing to kit from.
  const noPickTasks = withPicking && picks.total === 0 && d.components.every((c) => (c.inKittingAreaQty ?? 0) <= 0);
  const pickReason = withPicking ? pickBlockReason(picks) : null;
  const pendingPicks = d.tasks.filter((t) => t.taskType === "Picking" && (t.status === "Pending" || t.status === "Started"));
  // Next is held while picks are open, unless a supervisor explicitly confirmed completing them.
  const pickHold = noPickTasks ? `${NO_PICK_TASKS_REASON}. Run Picking/Job Operations so the components are picked to ${d.outputLocationCode ?? "the kitting area"} first.` : pickReason && !forcePicks ? (canForcePicks ? `${pickReason}. Confirm "Complete pending picks and build" to continue.` : `${pickReason}. Finish the picking tasks first.`) : null;
  const inSummary = step === "summary";
  const lines = d.components.map((c) => {
    const need = c.componentQty * build;
    const live = componentAvailable(c, withPicking, forcePicks);
    const available = inSummary && snap ? (snap.avail[c.id] ?? live) : live;
    return { ...c, need, available, live, short: Math.max(0, need - available) };
  });
  const anyShort = lines.some((l) => l.short > 0);
  const locked = withPicking ? [] : lines.filter((l) => l.sourceLockedBy);
  // FEFO components whose only free stock sits in count-locked locations.
  const fefoLocked = withPicking ? [] : lines.filter((l) => !l.locationId && l.short > 0 && (l.lockedQty ?? 0) > 0);
  const lockPlans = [...new Set([...locked.map((l) => l.sourceLockedBy ?? ""), ...fefoLocked.flatMap((l) => l.lockedBy ?? [])].filter(Boolean))].sort();
  const lockHold = locked.length || fefoLocked.length
    ? `${[...locked.map((l) => `${l.sku} at ${l.locationCode ?? "its source"}`), ...fefoLocked.map((l) => `${l.sku} (all free stock)`)].join(", ")} ${locked.length + fefoLocked.length === 1 ? "is" : "are"} locked by count plan ${lockPlans.join(", ")}. Finish, update or cancel the count first${wo.status === "Open" && locked.length ? ", or edit the work order to choose another source" : ""}`
    : null;
  // Kit on hand at the target location (and LP when one is chosen); 0 when there is none.
  const kitLive = kitStock.data ? kitOnHand(kitStock.data.data ?? [], locationId, lpId) : null;
  const kitCurrent = inSummary ? (snap ? snap.kit : null) : kitLive;
  const kitUnavailable = (inSummary ? snap !== null && snap.kit === null : kitStock.error !== null || kitTimedOut) ? new Set(["kit"]) : undefined;
  const stockChanged = inSummary && snap !== null && (lines.some((l) => l.live !== l.available) || (kitLive !== null && snap.kit !== null && kitLive !== snap.kit));
  const sourceText = confirmed ? (fefo ? `${confirmed} (FEFO)` : confirmed) : chosenCodes.length ? chosenCodes.join(", ") : "FEFO (all bins)";
  const fefoComponents = withPicking ? 0 : d.components.filter((c) => !c.locationCode && !c.lpNumber).length;
  const targetText = [locationLabel ?? "—", lpLabel ? `LP ${lpLabel}` : null].filter(Boolean).join(" · ");
  const qtyError = qty === null || !Number.isInteger(qty) || qty < 1 ? "Enter how many kits to build (at least 1)" : qty > remaining ? `At most ${remaining} (requested − processed)` : null;
  const totalNeed = lines.reduce((sum, l) => sum + l.need, 0);
  const deltas = createKitDeltas(
    { sku: d.kit.sku, location: [locationLabel ?? "—", lpLabel].filter(Boolean).join(" · "), current: kitCurrent },
    lines.map((l) => ({ id: l.id, sku: l.sku, location: `${l.locationCode ?? (withPicking ? d.outputLocationCode ?? "Kitting area" : "FEFO (all bins)")}${l.lpNumber ? ` · ${l.lpNumber}` : ""}${l.lotNumber ? ` · lot ${l.lotNumber}` : ""}`, current: l.available, perKit: l.componentQty })),
    build,
  );
  const flags = Object.fromEntries(lines.map((l) => [l.id, l.short > 0 ? <AlertTriangle key="s" className="h-3 w-3 text-danger" aria-label="Short" /> : l.sourceLockedBy && !withPicking ? <Lock key="l" className="h-3 w-3 text-danger" aria-label={`Locked by ${l.sourceLockedBy}`} /> : <CheckCircle2 key="ok" className="h-3 w-3 text-success" aria-hidden />]));

  const setErr = (k: Key) => setErrors((e) => ({ ...e, [k]: undefined }));

  const confirmScan = (): boolean => {
    if (pickHold) {
      setErrors({ scan: pickHold });
      return false;
    }
    const scanCode = scan.trim().toUpperCase();
    const lockedScan = scanCode ? locked.find((l) => (l.locationCode ?? "").toUpperCase() === scanCode || (l.lpNumber ?? "").toUpperCase() === scanCode) : undefined;
    if (lockedScan) {
      setErrors({ scan: `${scan.trim()} is locked by count plan ${lockedScan.sourceLockedBy}; stock can't leave it until the count is finished or cancelled` });
      focusFirst(rootRef.current, ["scan"]);
      return false;
    }
    if (lockHold) {
      setErrors({ scan: lockHold });
      return false;
    }
    if (groups.length) {
      // One scan per source location: each scan checks off its group; Next moves on once all are scanned.
      const next: Record<string, string> = { ...scanned };
      if (scan.trim()) {
        const g = groupOfScan(groups, scan);
        if (!g) {
          const left = groups.filter((x) => !next[x.label]).map((x) => x.label);
          setErrors({ scan: `${scan.trim()} is not a source of this work order (expected ${codeList(left.length ? left : groups.map((x) => x.label))})` });
          focusFirst(rootRef.current, ["scan"]);
          return false;
        }
        next[g.label] = scanned[g.label] ?? scan.trim().toUpperCase();
        setScanned(next);
        setScan("");
      }
      const left = groups.filter((x) => !next[x.label]);
      if (left.length) {
        const done = groups.length - left.length;
        if (scan.trim()) {
          setErrors({});
          setScanNote(`${done} of ${groups.length} sources scanned. Still to scan: ${left.map((x) => x.label).join(", ")}`);
        } else setErrors({ scan: `Scan each source location: ${left.map((x) => x.label).join(", ")} ${left.length === 1 ? "is" : "are"} still to scan (${done} of ${groups.length} scanned)` });
        focusFirst(rootRef.current, ["scan"]);
        return false;
      }
      setScanNote(null);
      setErrors({});
      return true;
    }
    if (fefoConfirmed && !scan.trim()) return true;
    const res = matchSourceScan(codes, scan);
    if (!res.ok) {
      setErrors({ scan: res.message });
      focusFirst(rootRef.current, ["scan"]);
      return false;
    }
    setFefoConfirmed(res.code);
    setErrors({});
    return true;
  };

  const validateInfo = (): boolean => {
    const next: Partial<Record<Key, string>> = {};
    if (qtyError) next.qty = qtyError;
    if (!locationId) next.locationId = "Select a target location";
    if (d.kit.trackLot && !lot.trim()) next.lotNumber = `${d.kit.sku} is lot tracked; enter a lot number`;
    if (d.kit.trackExpiry && !expiry) next.expiryDate = `${d.kit.sku} is expiry tracked; enter an expiry date`;
    if (d.kit.trackProductionDate && !production) next.productionDate = "Enter the production date";
    if (qty !== null && qty >= remaining && startAt && finishAt && finishAt.getTime() < startAt.getTime()) next.actualFinishAt = "Actual finish must be after actual start";
    setErrors(next);
    const keys = (["qty", "locationId", "lotNumber", "expiryDate", "productionDate", "actualFinishAt"] as const).filter((k) => next[k]);
    focusFirst(rootRef.current, keys);
    return keys.length === 0;
  };

  const goTo = (target: Step) => {
    const order = STEPS.findIndex((s) => s.key === target);
    if (order >= 1 && (!confirmed || (step === "confirm" && scan.trim() !== "" && groups.length > 0)) && !confirmScan()) return setStep("confirm");
    if (order >= 2 && !validateInfo()) return setStep("info");
    if (target !== "summary") setSnap(null);
    setStep(target);
  };

  const submit = async () => {
    if (!confirmed) return goTo("confirm");
    if (!validateInfo()) return setStep("info");
    setSaving(true);
    setServerError(null);
    idemKey.current ??= newIdempotencyKey();
    try {
      const res = await apiFetch<{ status: string; processedQty: number }>("/api/work-orders/create-kit", {
        method: "POST",
        body: { workOrderId: wo.id, version: wo.version, qty, locationId, lpId, lotNumber: lot.trim() || null, expiryDate: toDateOnly(expiry), productionDate: toDateOnly(production),
          actualStartAt: startAt?.toISOString() ?? null, actualFinishAt: qty !== null && qty >= remaining ? finishAt?.toISOString() ?? null : null,
          sourceScan: confirmed, idempotencyKey: idemKey.current,
          completePendingPicks: withPicking && pickReason && forcePicks ? true : undefined },
      });
      // No toast here: the drawer's success card says the same, and a toast would cover it (judge R1).
      setSummary({ qty: qty ?? 0, status: res.status, processedQty: res.processedQty, location: locationLabel ?? null, lot: lot.trim() || null });
      idemKey.current = null;
      void invalidate();
      onDone?.();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      else setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (summary) {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 ks-scroll">
          <div className="flex flex-col gap-3" role="status" aria-live="polite">
            <h3 className="text-base font-semibold text-foreground">Kit summary</h3>
            <div className="flex items-start gap-3 rounded-lg border border-success/40 bg-success-soft/50 p-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-base font-semibold text-foreground">{summary.qty} {d.kit.sku} {summary.qty === 1 ? "kit" : "kits"} built</span>
                <span className="text-xs text-secondary">{d.kit.name} · {wo.code} is {summary.status}</span>
                <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div><dt className="text-faint">Location</dt><dd className="font-semibold text-foreground">{summary.location ?? "—"}</dd></div>
                  <div><dt className="text-faint">Lot</dt><dd className="font-semibold text-foreground">{summary.lot ?? "—"}</dd></div>
                  <div><dt className="text-faint">Processed / requested</dt><dd className="font-semibold tabular-nums text-foreground">{summary.processedQty} / {wo.requestedQty}</dd></div>
                  <div><dt className="text-faint">Components used</dt><dd className="font-semibold tabular-nums text-foreground">{d.components.reduce((n, c) => n + c.componentQty * summary.qty, 0)}</dd></div>
                </dl>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => setPrinting(true)}><Printer className="h-3.5 w-3.5" aria-hidden />Print kit barcode</Button>
            </div>
          </div>
        </div>
        <Footer>
          <Link href={`/work-orders/${wo.id}`} onClick={onClose} className="mr-auto text-sm font-semibold text-primary hover:underline">Open work order</Link>
          <Button type="button" variant="primary" onClick={onClose}>Done</Button>
        </Footer>
        <PrintOptionsModal open={printing} onOpenChange={setPrinting} typeKeys={["product-label"]} title="Print kit barcode" clientId={wo.clientId}
          records={[{ sku: d.kit.sku, barcode: d.kit.barcode || d.kit.sku, name: d.kit.name, packType: d.kit.packType, copies: summary.qty }]} />
      </>
    );
  }

  const index = STEPS.findIndex((s) => s.key === step);
  const pills: StepMeta[] = STEPS.map((s, i) => ({
    key: s.key, label: s.label, clickable: i <= index || (i === 1 && Boolean(confirmed)) || (i === 2 && Boolean(confirmed)),
    status: i === index ? "active" : i < index ? "complete" : (s.key === "confirm" && errors.scan) ? "attention" : "upcoming",
  }));
  const saveReason = saving ? "Building…" : inSummary && !snap ? "Loading current quantities…" : locked.length ? "A component source is locked by a count plan" : anyShort ? "Some components are short for this quantity" : null;

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (step === "summary") { if (!saveReason) void submit(); } else goTo(STEPS[index + 1]!.key); }} className="flex min-h-0 flex-1 flex-col">
      <div ref={rootRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 ks-scroll">
        <div className="flex flex-col gap-4">
          <WizardPills steps={pills} onSelect={(k) => goTo(k as Step)} />
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-sunken/60 px-3 py-2.5 text-xs">
            <span className="flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" aria-hidden /><span className="font-semibold text-foreground">{d.kit.sku}</span><span className="text-secondary">{d.kit.name}</span></span>
            <span className="ml-auto flex items-center gap-4 tabular-nums text-secondary">
              <span>{wo.code}</span>
              <span>Requested <strong className="text-foreground">{wo.requestedQty}</strong></span>
              <span>Processed <strong className="text-foreground">{wo.processedQty}</strong></span>
              <span>Left <strong className="text-foreground">{remaining}</strong></span>
            </span>
          </div>
          {conflict ? (
            <Callout variant="attention" title="This record changed since you opened it" action={<Button type="button" size="sm" variant="secondary" onClick={() => { setConflict(false); seeded.current = false; void detail.refetch(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reload</Button>}>
              Someone else updated this work order. Reload and check the quantities again.
            </Callout>
          ) : null}
          {serverError ? <Callout variant="error" title="Kits not built">{serverError}</Callout> : null}

          {step === "confirm" ? (
            <>
              <Field id="scan" label="Source location / LP" required error={errors.scan}
                info={chosenCodes.length ? `Scan the location or LP the components come from (${chosenCodes.join(", ")}).` : fefoCodes.length ? `Every component is FEFO-picked. Scan a bin or LP that holds one of them (${codeList(fefoCodes)}).` : fefoStock.isPending ? "Every component is FEFO-picked. Loading the bins that hold them…" : "Every component is FEFO-picked. Scan the bin or LP you are taking components from."}>
                <TextField id="scan" value={scan} autoFocus placeholder="Scan location or LP" invalid={Boolean(errors.scan)}
                  // The brand primary is red, so the autofocused scan field would read as an error on open.
                  // Until Next is pressed it takes a neutral focus ring (red only after validation).
                  className={errors.scan ? undefined : "focus-within:border-focus focus-within:ring-focus/25"}
                  leading={<ScanLine className="h-3.5 w-3.5 text-faint" aria-hidden />}
                  onChange={(e) => { setScan(e.target.value); if (!groups.length) setFefoConfirmed(null); setErr("scan"); }} />
              </Field>
              {pickReason ? (
                <Callout variant={forcePicks ? "info" : "attention"} title={pickReason}>
                  <div className="flex flex-col gap-2">
                    <span>Pick the components to {d.outputLocationCode ?? "the kitting area"} first, then kit. Open picking tasks:</span>
                    <ul className="list-disc pl-5 text-xs">
                      {pendingPicks.map((t) => <li key={t.id}>Task #{t.taskNo} · {t.sku ?? "—"} · {t.plannedQty} from {t.sourceLocationCode ?? "—"} to {t.targetLocationCode ?? d.outputLocationCode ?? "kitting area"} · {t.status}</li>)}
                    </ul>
                    {canForcePicks ? (
                      <Checkbox id="forcePicks" checked={forcePicks} onCheckedChange={(v) => { setForcePicks(v === true); resetScans(); setErr("scan"); setSnap(null); }}
                        label={<strong>Complete pending picks and build</strong>}
                        description={`Posts Picking moves for ${pendingPicks.map((t) => `Task #${t.taskNo}`).join(", ")} to ${d.outputLocationCode ?? "the kitting area"} under your name, then builds. Use only when the components are physically there.`} />
                    ) : <span className="text-xs text-secondary">Only a supervisor with Picking/Job Operations permission can complete pending picks from here.</span>}
                  </div>
                </Callout>
              ) : null}
              {lockHold ? (
                <Callout variant="attention" title={`Source locked by count plan ${lockPlans.join(", ")}`}>
                  {lockHold}.
                </Callout>
              ) : null}
              {groups.length > 1 ? (
                <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={allScanned ? "font-semibold text-success" : "font-semibold text-foreground"}>{scannedCount} of {groups.length} sources scanned</span>
                  {groups.map((g) => (
                    <span key={g.label} className={scanned[g.label] ? "inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success" : "inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-secondary"}>
                      {scanned[g.label] ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <ScanLine className="h-3 w-3" aria-hidden />}{g.label}
                    </span>
                  ))}
                  {fefoComponents ? <span className="text-secondary">· {fefoComponents} FEFO component{fefoComponents === 1 ? "" : "s"} (no scan)</span> : null}
                  {scanNote && !allScanned ? <span className="basis-full text-secondary">{scanNote}</span> : null}
                </div>
              ) : confirmed ? <span className="flex items-center gap-1.5 text-xs font-semibold text-success" role="status"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Source confirmed{codes.length ? `: ${confirmed}` : ""}</span> : null}
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2" aria-label="Components">
                {lines.map((l) => (
                  <li key={l.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3">
                    <span className="flex min-w-0 items-center gap-2"><span className="shrink-0 whitespace-nowrap font-semibold text-foreground">{l.sku}</span><span className="min-w-0 truncate text-xs text-secondary" title={l.name}>{l.name}</span></span>
                    <span className="flex flex-wrap items-center gap-1.5 text-2xs text-faint">{l.locationCode ?? (withPicking ? d.outputLocationCode ?? "Kitting area" : "FEFO")}{l.lpNumber ? ` · ${l.lpNumber}` : ""}{l.lotNumber ? ` · lot ${l.lotNumber}` : ""}
                      {!withPicking && l.sourceLockedBy ? <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-2xs font-semibold text-warning"><Lock className="h-2.5 w-2.5" aria-hidden />Locked · {l.sourceLockedBy}</span> : null}
                      {!withPicking && !l.locationId && (l.lockedQty ?? 0) > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-2xs font-semibold text-warning" title={`Free stock in locations locked by ${(l.lockedBy ?? []).join(", ")}`}><Lock className="h-2.5 w-2.5" aria-hidden />{l.lockedQty} locked · {(l.lockedBy ?? []).join(", ")}</span> : null}
                    </span>
                    <ScanChip code={groupOf(l.id) ? scanned[groupOf(l.id)?.label ?? ""] ?? null : null} expected={groupOf(l.id)?.label ?? null} />
                    <span className="flex flex-wrap gap-1.5"><QtyChip label="Component qty" value={l.componentQty} /><QtyChip label="Total qty" value={l.need} /><QtyChip label={withPicking ? (forcePicks ? "Reserved for this WO" : "In kitting area") : l.locationId ? (l.sourceLockedBy ? "Usable at source (locked)" : "Available at source") : "Usable (unlocked bins)"} value={l.available} /></span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {step === "info" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* No min/max on the input: a posting quantity is never silently rewritten; out-of-range values show an error and hold Next. */}
              <Field id="qty" label="Kit quantity" required error={errors.qty ?? qtyError ?? undefined} info={`Up to ${remaining} (requested − processed).`}>
                <NumberInput id="qty" value={qty} onChange={(v) => { setQty(v); setErr("qty"); }} invalid={Boolean(qtyError)} suffix={<KitUnit qty={qty} />} aria-describedby={qtyError ? "qty-err" : undefined} />
              </Field>
              <Field id="locationId" label="Target location" required error={errors.locationId} info="Where the built kits are received. Defaults to the kitting area.">
                <LocationPicker id="locationId" warehouseId={wo.warehouseId} value={locationId} selectedLabel={locationLabel} onChange={(v, o) => { setLocationId(v); setLocationLabel(o?.label); setErr("locationId"); }} invalid={Boolean(errors.locationId)} />
              </Field>
              <Field id="lpId" label="Target LP">
                <LpPicker id="lpId" warehouseId={wo.warehouseId} value={lpId} onChange={(v, o) => { setLpId(v); setLpLabel(o?.label); }} />
              </Field>
              <div className="md:col-span-2"><h3 className="text-xs font-semibold text-faint">Attribute selection</h3></div>
              <Field id="lotNumber" label="Lot number" required={d.kit.trackLot} error={errors.lotNumber}>
                <TextField id="lotNumber" value={lot} maxLength={120} placeholder={d.kit.trackLot ? "Enter lot number" : "Optional"} invalid={Boolean(errors.lotNumber)} onChange={(e) => { setLot(e.target.value); setErr("lotNumber"); }} />
              </Field>
              <Field id="expiryDate" label="Expiry date" required={d.kit.trackExpiry} error={errors.expiryDate}>
                <DatePicker id="expiryDate" value={expiry} onChange={(v) => { setExpiry(v); setErr("expiryDate"); }} invalid={Boolean(errors.expiryDate)} />
              </Field>
              <Field id="productionDate" label="Production date" required={d.kit.trackProductionDate} error={errors.productionDate}>
                <DatePicker id="productionDate" value={production} onChange={(v) => { setProduction(v); setErr("productionDate"); }} invalid={Boolean(errors.productionDate)} />
              </Field>
              <div className="md:col-span-2"><h3 className="text-xs font-semibold text-faint">Kitting task time range</h3></div>
              <Field id="actualStartAt" label="Actual start" info="Kept from the first build once the work order has started.">
                <DateTimePicker id="actualStartAt" value={startAt} disabled={Boolean(wo.actualStartAt)} onChange={(v) => { setStartAt(v); setErr("actualFinishAt"); }} />
              </Field>
              <Field id="actualFinishAt" label="Actual finish" error={errors.actualFinishAt}
                info={build >= remaining ? "Stamped on the work order, which this build completes." : `A partial build (${build} of ${remaining} left) keeps the work order Open.`}>
                <DateTimePicker id="actualFinishAt" value={build >= remaining ? finishAt : null} disabled={build < remaining} onChange={(v) => { setFinishAt(v); setErr("actualFinishAt"); }} invalid={Boolean(errors.actualFinishAt)} />
              </Field>
            </div>
          ) : null}

          {step === "summary" ? (
            <div className="flex flex-col gap-2">
              <section aria-label="Kit summary" className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
                <Boxes className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-2xs font-semibold text-faint">Kit summary</span>
                  <span className="text-base font-semibold text-foreground">{build} × {d.kit.sku}</span>
                  <span className="text-xs text-secondary">{d.kit.name}{lot.trim() ? ` · lot ${lot.trim()}` : ""}{expiry ? ` · exp ${toDateOnly(expiry)}` : ""}</span>
                </div>
                <Button type="button" size="sm" variant="ghost" aria-label="Print kit barcode" title="Print kit barcode" onClick={() => setPrinting(true)}><Printer className="h-3.5 w-3.5" aria-hidden /></Button>
                <Button type="button" size="sm" variant="ghost" aria-label="Edit kit quantity and attributes" title="Edit" onClick={() => goTo("info")}><Pencil className="h-3.5 w-3.5" aria-hidden /></Button>
              </section>
              <section aria-label="Kitting process summary" className="rounded-lg border border-border bg-surface-sunken/50 p-3">
                <h3 className="mb-2 text-2xs font-semibold text-faint">Kitting process summary</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-4">
                  {groups.length > 1 ? (
                    <div className="col-span-2"><dt className="text-faint">Source locations ({groups.length}, each scanned)</dt>
                      <dd className="flex flex-col gap-0.5 pt-0.5">{groups.map((g) => (
                        <span key={g.label} className="inline-flex items-center gap-1 font-semibold text-foreground">
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-success" aria-label="Scanned" />{scanned[g.label] ?? g.label}
                          <span className="font-normal text-secondary">· {lines.filter((l) => g.componentIds.includes(l.id)).map((l) => l.sku).join(", ")}</span>
                        </span>
                      ))}{fefoComponents ? <span className="text-2xs text-secondary">+ {fefoComponents} FEFO component{fefoComponents === 1 ? "" : "s"}</span> : null}</dd>
                    </div>
                  ) : <div><dt className="text-faint">Source location</dt><dd className="font-semibold text-foreground">{sourceText}</dd></div>}
                  <div><dt className="text-faint">Target location</dt><dd className="font-semibold text-foreground">{targetText}</dd></div>
                  <div><dt className="text-faint">Actual start</dt><dd className="font-semibold tabular-nums text-foreground">{formatInZone(wo.actualStartAt ?? startAt, d.warehouseTimeZone)}</dd></div>
                  <div><dt className="text-faint">Actual finish</dt><dd className="font-semibold tabular-nums text-foreground">{build >= remaining ? formatInZone(finishAt, d.warehouseTimeZone) : "– (partial build)"}</dd></div>
                </dl>
              </section>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Inventory transaction summary</h3>
                <span className="flex items-center gap-2"><QtyChip label="Component SKU qty" value={lines.length} /><QtyChip label="Component total qty" value={totalNeed} /></span>
              </div>
              {stockChanged ? (
                <Callout variant="attention" title="Stock changed since this summary opened" action={<Button type="button" size="sm" variant="secondary" onClick={() => setSnap(null)}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Use latest</Button>}>
                  Another transaction moved component or kit stock. Review the latest quantities before you save.
                </Callout>
              ) : snap ? <p className="text-2xs text-faint">Quantities as of {formatInZone(snap.at, d.warehouseTimeZone)}.</p> : <p className="flex items-center gap-1.5 text-2xs text-secondary" role="status"><Spinner className="h-3 w-3" label="Loading" />Loading current quantities…</p>}
              <KitDeltaTable lines={deltas} flags={flags} caption="Inventory transaction summary: current stock and the change this build posts" currentLabel={withPicking ? (pickReason && forcePicks ? "Reserved (picked on save)" : "Current qty in kitting area") : "Current qty"} unavailable={kitUnavailable} />
              {pickReason && forcePicks ? <Callout variant="attention" title="Save completes the pending picks first">{pendingPicks.map((t) => `Task #${t.taskNo}`).join(", ")} will post Picking moves to {d.outputLocationCode ?? "the kitting area"} under your name, recorded on this work order, then the kits are built.</Callout> : null}
              {build < remaining ? <p className="text-xs text-secondary">Partial build: {wo.code} stays {wo.status} with {wo.processedQty + build} of {wo.requestedQty} processed.</p> : <p className="text-xs text-secondary">This build completes {wo.code}.</p>}
              {locked.length ? (
                <Callout variant="attention" title="Source location locked by a count">
                  {locked.map((l) => `${l.sku} at ${l.locationCode ?? "its source"} is locked by count plan ${l.sourceLockedBy}`).join(" · ")}. Finish, update or cancel the count first{wo.status === "Open" ? ", or edit the work order to choose another source" : ""}.
                </Callout>
              ) : null}
              {anyShort ? <Callout variant="attention" title="Not enough components">Lower the kit quantity, or move stock to the chosen source locations first.</Callout> : null}
            </div>
          ) : null}
        </div>
      </div>
      <Footer>
        <Button type="button" variant="ghost" className="mr-auto" onClick={onClose} disabled={saving}>Cancel</Button>
        {index > 0 ? <Button type="button" variant="secondary" onClick={() => { setSnap(null); setStep(STEPS[index - 1]!.key); }} disabled={saving}>Back</Button> : null}
        {step === "summary" ? (
          <DisabledReason reason={saveReason}>
            <Button type="submit" variant="primary" disabled={Boolean(saveReason)} aria-busy={saving}>
              {saving ? <Spinner className="h-3.5 w-3.5" label="Building" /> : null}
              Save
            </Button>
          </DisabledReason>
        ) : (
          <DisabledReason reason={step === "info" && qtyError ? qtyError : step === "confirm" ? pickHold ?? lockHold : null}>
            <Button type="submit" variant="primary" disabled={(step === "info" && Boolean(qtyError)) || (step === "confirm" && Boolean(pickHold ?? lockHold))}>Next</Button>
          </DisabledReason>
        )}
      </Footer>
      <PrintOptionsModal open={printing} onOpenChange={setPrinting} typeKeys={["product-label"]} title="Print kit barcode" clientId={wo.clientId}
        records={[{ sku: d.kit.sku, barcode: d.kit.barcode || d.kit.sku, name: d.kit.name, packType: d.kit.packType, copies: Math.max(1, build) }]} />
    </form>
  );
}
