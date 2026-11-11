"use client";

/**
 * Disassemble Kit — Logiwa's 2-step drawer.
 *   1. Select Kit: (standalone) warehouse, client and kit; Source Location/LP (the kit stock
 *      bucket), kit quantity, Target Location/LP for the components.
 *   2. Summary: one card per component with Component SKU QTY / Component Total QTY / Stock QTY
 *      chips and a ••• Add Attribute action (lot, expiry, production date), Print Product
 *      Barcode, and the signed Inventory Transaction Summary (kit −n red, components +n green).
 * WO-scoped posts `/api/work-orders/disassemble`; standalone posts `/api/kits/disassemble`.
 */
import * as React from "react";
import { MoreHorizontal, PackageOpen, Pencil, Printer, RefreshCw, Tag } from "lucide-react";
import { PrintOptionsModal } from "@/components/shared";
import { ClientSelect, LocationPicker, LpPicker, WarehouseSelect } from "@/components/shared/entity-pickers";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DatePicker } from "@/components/ui/date-picker";
import { Drawer } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { WizardPills, type StepMeta } from "@/components/ui/wizard";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useMe } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import { disassembleDeltas } from "@/lib/grid-defs/work-orders/kit-steps";
import { componentStockAt, defaultKitBucket } from "@/lib/grid-defs/work-orders/source-suggest";
import { errorMessage, useInvalidateWorkOrders, type KitDetail, type StockBucket, type WorkOrderDetail } from "./wo-client";
import { Field, focusFirst, fromDateOnly, KitUnit, toDateOnly } from "./wo-ui";
import { KitDeltaTable, QtyChip } from "./kit-delta-table";

export interface DisassembleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workOrderId: string | null;
  readonly onDone?: () => void;
  /** Standalone mode only: start with this warehouse / client / kit picked (e.g. from Kit Inventory). */
  readonly stockPrefill?: DisassemblePrefill | null;
}

export interface DisassemblePrefill {
  readonly warehouseId: string;
  readonly clientId: string;
  readonly kitProductId: string;
  readonly kitLabel: string;
}

export function DisassembleDialog({ open, onOpenChange, workOrderId, onDone, stockPrefill }: DisassembleDialogProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Disassemble kit" width={60} bodyClassName="flex flex-col p-0">
      {open && workOrderId ? <WoBody key={workOrderId} workOrderId={workOrderId} onClose={() => onOpenChange(false)} onDone={onDone} /> : null}
      {open && !workOrderId ? <StockBody key={stockPrefill?.kitProductId ?? "blank"} prefill={stockPrefill ?? null} onClose={() => onOpenChange(false)} onDone={onDone} /> : null}
    </Drawer>
  );
}

export function bucketLabel(b: StockBucket): string {
  const bits = [b.locationCode, b.lpNumber ? `LP ${b.lpNumber}` : null, b.lotNumber ? `lot ${b.lotNumber}` : null, b.expiryDate ? `exp ${b.expiryDate.slice(0, 10)}` : null].filter(Boolean);
  return `${bits.join(" · ")} — ${b.freeQty} free${b.lockedBy ? ` · locked by ${b.lockedBy}` : ""}`;
}

type Key = "warehouseId" | "clientId" | "kitProductId" | "sourceInventoryId" | "qty" | "targetLocationId";
type Step = "select" | "summary";

interface Comp {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly packType: string;
  readonly perKit: number;
  /** Product barcode/UPC; labels fall back to the SKU when there is none. */
  readonly barcode?: string | null;
  readonly stockQty: number;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
}
interface Attr { lot: string; expiry: Date | null; production: Date | null }
/** Prefilled attributes (from the lots consumed at kitting), keyed by component product id. */
export type AttrSeed = Readonly<Record<string, { readonly lotNumber: string | null; readonly expiryDate: string | null; readonly productionDate: string | null }>>;
const EMPTY_ATTR: Attr = { lot: "", expiry: null, production: null };

function Footer({ children }: { readonly children: React.ReactNode }) {
  return <div className="sticky bottom-0 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">{children}</div>;
}

/** Shared two-step flow; the bodies supply the kit context and the POST. */
function Steps({ head, selectFields, kit, comps, warehouseId, clientId, buckets, bucketsPending, max, maxInfo, blockReason, post, extraErrors, validateExtra, onClose, notice, preferLocationId, attrSeed }: {
  readonly head?: React.ReactNode;
  readonly selectFields?: React.ReactNode;
  readonly kit: { readonly sku: string; readonly name: string } | null;
  readonly comps: readonly Comp[];
  readonly warehouseId: string | null;
  readonly clientId: string | null;
  readonly buckets: readonly StockBucket[];
  readonly bucketsPending: boolean;
  readonly max: number;
  readonly maxInfo?: string;
  readonly blockReason: string | null;
  readonly post: (body: Record<string, unknown>) => Promise<{ receiptIds: readonly string[] }>;
  readonly extraErrors?: Partial<Record<Key, string>>;
  readonly validateExtra?: () => Partial<Record<Key, string>>;
  readonly onClose: () => void;
  readonly notice?: React.ReactNode;
  /** Default the source to kit stock here (the work order's output location). */
  readonly preferLocationId?: string | null;
  /** Component attributes to prefill (kitting consumption); still editable. */
  readonly attrSeed?: AttrSeed;
}) {
  const [step, setStep] = React.useState<Step>("select");
  const [pickedBucket, setBucketId] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState<number | null>(1);
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [targetLabel, setTargetLabel] = React.useState<string | undefined>(undefined);
  const [targetLp, setTargetLp] = React.useState<string | null>(null);
  const [targetLpLabel, setTargetLpLabel] = React.useState<string | undefined>(undefined);
  const [attrs, setAttrs] = React.useState<Record<string, Attr>>({});
  const [openAttr, setOpenAttr] = React.useState<Record<string, boolean>>({});
  // Traceability: seed each component's lot/expiry/production from what kitting consumed, once.
  const seededAttrs = React.useRef(false);
  React.useEffect(() => {
    if (seededAttrs.current || !attrSeed || Object.keys(attrSeed).length === 0) return;
    seededAttrs.current = true;
    setAttrs((prev) => ({ ...Object.fromEntries(Object.entries(attrSeed).map(([id, a]) => [id, { lot: a.lotNumber ?? "", expiry: fromDateOnly(a.expiryDate), production: fromDateOnly(a.productionDate) }])), ...prev }));
    setOpenAttr((prev) => ({ ...Object.fromEntries(Object.keys(attrSeed).map((id) => [id, true])), ...prev }));
  }, [attrSeed]);
  // Component on-hand at the chosen target location/LP (the CURRENT QTY the summary previews).
  const compIds = comps.map((c) => c.productId).join(",");
  const compStock = useApiQuery<Record<string, StockBucket[]>>(["kit-sources", compIds, warehouseId ?? "", clientId ?? "", "disassemble"], compIds && warehouseId ? "/api/kits/sources" : null, {
    query: compIds && warehouseId ? { productIds: compIds, warehouseId, ...(clientId ? { clientId } : {}) } : undefined, staleTime: 0,
  });
  const [errors, setErrors] = React.useState<Partial<Record<Key, string>>>({});
  const [attrErrors, setAttrErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);
  // Print one component's barcode from its card or its summary row (null: every component).
  const [printOnly, setPrintOnly] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const bucketId = buckets.some((b) => b.id === pickedBucket) ? pickedBucket : defaultKitBucket(buckets, preferLocationId ?? null)?.id ?? null;
  const bucket = buckets.find((b) => b.id === bucketId) ?? null;
  const cap = Math.min(max, bucket?.freeQty ?? max);
  const n = qty ?? 0;
  // Live, never clamped: a posting quantity the user typed is never silently rewritten.
  const qtyError = qty === null || !Number.isInteger(qty) || qty < 1 ? "Enter how many kits to disassemble (at least 1)" : bucket && qty > cap ? `At most ${cap} kits can be disassembled from this stock` : null;
  const allErrors = { ...errors, ...extraErrors };
  const clear = (k: Key) => setErrors((e) => ({ ...e, [k]: undefined }));

  const validateSelect = (): boolean => {
    const next: Partial<Record<Key, string>> = { ...validateExtra?.() };
    if (!bucketId) next.sourceInventoryId = "Select the kit stock to disassemble";
    if (qtyError) next.qty = qtyError;
    if (!targetId) next.targetLocationId = "Select a target location for the components";
    setErrors(next);
    const keys = (["warehouseId", "clientId", "kitProductId", "sourceInventoryId", "qty", "targetLocationId"] as const).filter((k) => next[k]);
    focusFirst(rootRef.current, keys);
    return keys.length === 0;
  };

  const validateAttrs = (): boolean => {
    const next: Record<string, string> = {};
    for (const c of comps) {
      const a = attrs[c.productId] ?? EMPTY_ATTR;
      const missing = [c.trackLot && !a.lot.trim() ? "lot" : null, c.trackExpiry && !a.expiry ? "expiry date" : null, c.trackProductionDate && !a.production ? "production date" : null].filter(Boolean);
      if (missing.length) next[c.productId] = `${c.sku} is tracked; add its ${missing.join(", ")}`;
    }
    setAttrErrors(next);
    if (Object.keys(next).length) setOpenAttr((o) => ({ ...o, ...Object.fromEntries(Object.keys(next).map((k) => [k, true])) }));
    return Object.keys(next).length === 0;
  };

  const goTo = (s: Step) => {
    if (s === "summary" && !validateSelect()) return;
    setStep(s);
  };

  const submit = async () => {
    if (!validateSelect()) return setStep("select");
    if (!validateAttrs()) return;
    setSaving(true);
    setServerError(null);
    try {
      const componentAttributes = comps.map((c) => {
        const a = attrs[c.productId] ?? EMPTY_ATTR;
        return { productId: c.productId, lotNumber: a.lot.trim() || null, expiryDate: toDateOnly(a.expiry), productionDate: toDateOnly(a.production) };
      }).filter((a) => a.lotNumber || a.expiryDate || a.productionDate);
      const res = await post({ qty, sourceInventoryId: bucketId, targetLocationId: targetId, targetLpId: targetLp, componentAttributes });
      toast.success("Kit disassembled", `${qty} ${kit?.sku ?? "kit"} kit${qty === 1 ? "" : "s"} disassembled. ${res.receiptIds.length} DisassembleKit receipt${res.receiptIds.length === 1 ? "" : "s"} created.`);
      onClose();
    } catch (error) {
      setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const pills: StepMeta[] = [
    { key: "select", label: "Select kit", status: step === "select" ? "active" : "complete", clickable: true },
    { key: "summary", label: "Summary", status: step === "summary" ? "active" : Object.keys(attrErrors).length ? "attention" : "upcoming", clickable: true },
  ];
  const deltas = kit ? disassembleDeltas(
    { sku: kit.sku, location: bucket ? bucketLabel(bucket).split(" — ")[0]! : "—", current: bucket?.onHand ?? null },
    comps.map((c) => ({ id: c.productId, sku: c.sku, location: [targetLabel ?? "—", targetLpLabel].filter(Boolean).join(" · "),
      current: !targetId ? 0 : compStock.data ? componentStockAt(compStock.data.data?.[c.productId] ?? [], targetId, targetLp) : null, perKit: c.perKit })),
    n,
  ) : [];
  const saveReason = saving ? "Disassembling…" : blockReason ?? (bucket?.lockedBy ? `${bucket.locationCode} is locked by count plan ${bucket.lockedBy}; choose other kit stock` : null);

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (step === "select") goTo("summary"); else if (!saveReason) void submit(); }} className="flex min-h-0 flex-1 flex-col">
      <div ref={rootRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 ks-scroll">
        <div className="flex flex-col gap-4">
          <WizardPills steps={pills} onSelect={(k) => goTo(k as Step)} />
          {head}
          {notice}
          {serverError ? <Callout variant="error" title="Not disassembled">{serverError}</Callout> : null}
          {step === "select" ? (
            <>
              {selectFields}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field id="sourceInventoryId" label="Source location / LP" required error={allErrors.sourceInventoryId} info="Free, undamaged kit stock to break down.">
                  {bucketsPending ? <span role="status" className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2.5 text-xs text-secondary"><Spinner className="h-3.5 w-3.5" label="Loading" />Loading kit stock…</span> : (
                    <Select id="sourceInventoryId" value={bucketId} onChange={(v) => { setBucketId(v); clear("sourceInventoryId"); }} invalid={Boolean(allErrors.sourceInventoryId)}
                      placeholder={!kit ? "Select a kit first" : buckets.length ? "Select kit stock" : "No free kit stock"} disabled={buckets.length === 0}
                      options={buckets.map((b) => ({ value: b.id, label: bucketLabel(b), textValue: b.locationCode }))} />
                  )}
                </Field>
                <Field id="qty" label="Kit quantity" required error={allErrors.qty ?? qtyError ?? undefined} info={maxInfo ?? (bucket ? `Up to ${cap}.` : undefined)}>
                  <NumberInput id="qty" value={qty} onChange={(v) => { setQty(v); clear("qty"); }} invalid={Boolean(allErrors.qty) || Boolean(qtyError)} suffix={<KitUnit qty={qty} />} />
                </Field>
                <Field id="targetLocationId" label="Target location" required error={allErrors.targetLocationId} info="Where the components are received.">
                  <LocationPicker id="targetLocationId" warehouseId={warehouseId} disabled={!warehouseId} value={targetId} selectedLabel={targetLabel} onChange={(v, o) => { setTargetId(v); setTargetLabel(o?.label); clear("targetLocationId"); }} invalid={Boolean(allErrors.targetLocationId)} />
                </Field>
                <Field id="targetLpId" label="Target LP">
                  <LpPicker id="targetLpId" warehouseId={warehouseId} disabled={!warehouseId} value={targetLp} onChange={(v, o) => { setTargetLp(v); setTargetLpLabel(o?.label); }} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Components</h3>
                <Button type="button" size="sm" variant="secondary" disabled={comps.length === 0} onClick={() => { setPrintOnly(null); setPrinting(true); }}><Printer className="h-3.5 w-3.5" aria-hidden />Print product barcode</Button>
              </div>
              <ul className="flex flex-col gap-2" aria-label="Components returned to stock">
                {comps.map((c) => {
                  const a = attrs[c.productId] ?? EMPTY_ATTR;
                  const set = (patch: Partial<Attr>) => { setAttrs((s) => ({ ...s, [c.productId]: { ...(s[c.productId] ?? EMPTY_ATTR), ...patch } })); setAttrErrors((e) => ({ ...e, [c.productId]: "" })); };
                  const tracked = c.trackLot || c.trackExpiry || c.trackProductionDate;
                  return (
                    <li key={c.productId} id={`dis-comp-${c.productId}`} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-center gap-2"><span className="font-semibold text-foreground">{c.sku}</span><span className="truncate text-xs text-secondary">{c.name}</span>{tracked ? <span className="rounded-full bg-primary-soft px-1.5 text-2xs font-semibold text-primary">Tracked</span> : null}</span>
                          <span className="flex flex-wrap gap-1.5"><QtyChip label="Component SKU qty" value={c.perKit} /><QtyChip label="Component total qty" value={c.perKit * n} /><QtyChip label={targetId ? "Stock qty at target" : "Stock qty (all bins)"} value={targetId && compStock.data ? componentStockAt(compStock.data.data?.[c.productId] ?? [], targetId, targetLp) : c.stockQty} />{attrSeed?.[c.productId] ? <span className="text-2xs text-faint">Attributes prefilled from kitting</span> : null}</span>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" aria-label={`Actions for ${c.sku}`}><MoreHorizontal className="h-4 w-4" aria-hidden /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end"><DropdownMenuItem icon={Tag} onSelect={() => setOpenAttr((o) => ({ ...o, [c.productId]: true }))}>Add attribute</DropdownMenuItem><DropdownMenuItem icon={Printer} onSelect={() => { setPrintOnly(c.productId); setPrinting(true); }}>Print barcode</DropdownMenuItem></DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {openAttr[c.productId] ? (
                        <div className="grid grid-cols-1 gap-3 border-t border-border pt-2 md:grid-cols-3">
                          <Field id={`lot-${c.productId}`} label="Lot number" required={c.trackLot}><TextField id={`lot-${c.productId}`} value={a.lot} maxLength={120} placeholder={c.trackLot ? "Enter lot" : "Optional"} onChange={(e) => set({ lot: e.target.value })} /></Field>
                          <Field id={`exp-${c.productId}`} label="Expiry date" required={c.trackExpiry}><DatePicker id={`exp-${c.productId}`} value={a.expiry} onChange={(v) => set({ expiry: v })} /></Field>
                          <Field id={`prod-${c.productId}`} label="Production date" required={c.trackProductionDate}><DatePicker id={`prod-${c.productId}`} value={a.production} onChange={(v) => set({ production: v })} /></Field>
                        </div>
                      ) : null}
                      {attrErrors[c.productId] ? <p role="alert" className="text-xs text-danger">{attrErrors[c.productId]}</p> : null}
                    </li>
                  );
                })}
              </ul>
              <h3 className="text-sm font-semibold text-foreground">Inventory transaction summary</h3>
              <KitDeltaTable lines={deltas} caption="Inventory transaction summary: current stock and the change this disassembly posts" currentLabel="Current qty at location"
                unavailable={compStock.error ? new Set(comps.map((c) => c.productId)) : undefined}
                actions={Object.fromEntries(comps.map((c) => [c.productId, (
                  <React.Fragment key={c.productId}>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Print ${c.sku} barcode`} title={`Print ${c.sku} barcode`} onClick={() => { setPrintOnly(c.productId); setPrinting(true); }}><Printer className="h-3.5 w-3.5" aria-hidden /></Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Edit ${c.sku} attributes`} title={`Edit ${c.sku} lot / expiry / production date`}
                      onClick={() => { setOpenAttr((o) => ({ ...o, [c.productId]: true })); window.setTimeout(() => { const el = document.getElementById(`dis-comp-${c.productId}`); el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true }); }, 50); }}><Pencil className="h-3.5 w-3.5" aria-hidden /></Button>
                  </React.Fragment>
                )]))} />
            </>
          )}
        </div>
      </div>
      <Footer>
        <Button type="button" variant="ghost" className="mr-auto" onClick={onClose} disabled={saving}>Cancel</Button>
        {step === "summary" ? <Button type="button" variant="secondary" onClick={() => setStep("select")} disabled={saving}>Back</Button> : null}
        {step === "select" ? <Button type="submit" variant="primary">Next</Button> : (
          <DisabledReason reason={saveReason}>
            <Button type="submit" variant="primary" disabled={Boolean(saveReason)} aria-busy={saving}>{saving ? <Spinner className="h-3.5 w-3.5" label="Disassembling" /> : null}Save</Button>
          </DisabledReason>
        )}
      </Footer>
      <PrintOptionsModal open={printing} onOpenChange={setPrinting} typeKeys={["product-label"]} title="Print product barcode" clientId={clientId ?? undefined}
        records={comps.filter((c) => !printOnly || c.productId === printOnly).map((c) => ({ sku: c.sku, barcode: c.barcode || c.sku, name: c.name, packType: c.packType, copies: Math.max(1, c.perKit * n) }))} />
    </form>
  );
}

/** Standalone Disassemble Kit (Logiwa: always enabled, no work order needed). */
function StockBody({ onClose, onDone, prefill = null }: { readonly onClose: () => void; readonly onDone?: () => void; readonly prefill?: DisassemblePrefill | null }) {
  const me = useMe();
  const ctxWarehouses = me.data?.data.contextOptions.warehouses ?? [];
  const defaultWarehouse = me.data?.data.context.warehouseId ?? (ctxWarehouses.length === 1 ? ctxWarehouses[0]?.id ?? null : null);
  const [pickedWarehouse, setWarehouseId] = React.useState<string | null | undefined>(prefill?.warehouseId);
  const warehouseId = pickedWarehouse === undefined ? defaultWarehouse : pickedWarehouse;
  const [clientId, setClientId] = React.useState<string | null>(prefill?.clientId ?? null);
  const [kitId, setKitId] = React.useState<string | null>(prefill?.kitProductId ?? null);
  const [errors, setErrors] = React.useState<Partial<Record<Key, string>>>({});
  const invalidate = useInvalidateWorkOrders();
  const ready = Boolean(kitId && warehouseId);
  const kit = useApiQuery<KitDetail>(["kit", kitId ?? "", warehouseId ?? ""], ready ? `/api/kits/${encodeURIComponent(kitId ?? "")}` : null, { query: { warehouseId: warehouseId ?? "" }, staleTime: 0 });
  const stock = useApiQuery<StockBucket[]>(["kit-stock", kitId ?? "", warehouseId ?? ""], ready ? "/api/kits/stock" : null, {
    query: ready ? { productId: kitId ?? "", warehouseId: warehouseId ?? "", clientId: clientId ?? "" } : undefined, staleTime: 0,
  });
  const buckets = (stock.data?.data ?? []).filter((b) => b.freeQty > 0);
  const k = kit.data?.data ?? null;
  const loadKits = React.useCallback(async (q: string, signal: AbortSignal) => {
    if (!clientId) return [];
    const rows = await apiFetch<readonly { id: string; label: string; description: string }[]>("/api/kits/search", { query: { clientId, q, limit: 50 }, signal });
    return rows.map((r) => ({ value: r.id, label: r.label, description: r.description }));
  }, [clientId]);
  const clear = (key: Key) => setErrors((e) => ({ ...e, [key]: undefined }));

  return (
    <Steps
      kit={k}
      comps={(k?.components ?? []).map((c) => ({ productId: c.productId, sku: c.sku, barcode: c.barcode ?? null, name: c.name, packType: c.packType, perKit: c.bomQty, stockQty: c.onHandQty, trackLot: c.trackLot, trackExpiry: c.trackExpiry, trackProductionDate: c.trackProductionDate }))}
      warehouseId={warehouseId} clientId={clientId} buckets={buckets} bucketsPending={ready && stock.isPending}
      max={buckets.reduce((m, b) => Math.max(m, b.freeQty), 0)}
      blockReason={ready && !stock.isPending && buckets.length === 0 ? "No free stock of this kit in the warehouse" : null}
      extraErrors={errors}
      validateExtra={() => {
        const next = { ...(!warehouseId ? { warehouseId: "Select a warehouse" } : {}), ...(!clientId ? { clientId: "Select a client" } : {}), ...(!kitId ? { kitProductId: "Select a kit" } : {}) };
        setErrors(next);
        return next;
      }}
      onClose={onClose}
      post={async (body) => {
        const res = await apiFetch<{ receiptIds: readonly string[] }>("/api/kits/disassemble", { method: "POST", body: { kitProductId: kitId, ...body } });
        await invalidate();
        onDone?.();
        return res;
      }}
      selectFields={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field id="warehouseId" label="Warehouse" required error={errors.warehouseId}>
            <WarehouseSelect id="warehouseId" value={warehouseId} onChange={(v) => { setWarehouseId(v); setClientId(null); setKitId(null); clear("warehouseId"); }} invalid={Boolean(errors.warehouseId)} />
          </Field>
          <Field id="clientId" label="Client" required error={errors.clientId}>
            <ClientSelect id="clientId" warehouseId={warehouseId} value={clientId} disabled={!warehouseId} onChange={(v) => { setClientId(v); setKitId(null); clear("clientId"); }} invalid={Boolean(errors.clientId)} />
          </Field>
          <Field id="kitProductId" label="Kit" required error={errors.kitProductId}>
            <Combobox key={clientId ?? "none"} id="kitProductId" aria-label="Kit SKU" loadOptions={loadKits} minChars={0} value={kitId} disabled={!clientId}
              selectedOptions={prefill && kitId === prefill.kitProductId ? [{ value: prefill.kitProductId, label: prefill.kitLabel }] : undefined}
              placeholder="Search and select the kit" onChange={(v) => { setKitId(v); clear("kitProductId"); }} invalid={Boolean(errors.kitProductId)} />
          </Field>
        </div>
      }
    />
  );
}

function WoBody({ workOrderId, onClose, onDone }: { readonly workOrderId: string; readonly onClose: () => void; readonly onDone?: () => void }) {
  const detail = useApiQuery<WorkOrderDetail>(["work-order", workOrderId], `/api/work-orders/${encodeURIComponent(workOrderId)}`, { staleTime: 0, timeoutMs: 20_000 });
  const d = detail.data?.data;
  const wo = d?.workOrder;
  const stock = useApiQuery<StockBucket[]>(["kit-stock", wo?.kitProductId ?? "", wo?.warehouseId ?? ""], wo ? "/api/kits/stock" : null, {
    query: wo ? { productId: wo.kitProductId, warehouseId: wo.warehouseId, clientId: wo.clientId } : undefined, staleTime: 0,
  });
  const invalidate = useInvalidateWorkOrders();
  const [conflict, setConflict] = React.useState(false);

  if (!d || !wo) {
    return (
      <div className="px-5 py-4">
        {detail.error ? <Callout variant="error" title="Work order not available" action={<Button type="button" size="sm" variant="secondary" disabled={detail.isFetching} onClick={() => void detail.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Retry</Button>}>{detail.error.message}</Callout> : (
          <div role="status" aria-live="polite" className="flex flex-col gap-3"><span className="flex items-center gap-2 text-xs text-secondary"><Spinner className="h-3.5 w-3.5" label="Loading" />Loading work order and kit stock…</span><Skeleton className="h-7 w-56" /><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
        )}
      </div>
    );
  }

  const left = Math.max(0, wo.processedQty - d.disassembledQty);
  // Largest consumed lot per component (consumedAttributes is sorted by qty, largest first).
  const attrSeed: AttrSeed = {};
  for (const a of d.consumedAttributes ?? []) {
    if (!(a.productId in attrSeed) && (a.lotNumber || a.expiryDate || a.productionDate)) (attrSeed as Record<string, AttrSeed[string]>)[a.productId] = a;
  }
  const buckets = (stock.data?.data ?? []).filter((b) => b.freeQty > 0);
  return (
    <Steps
      kit={d.kit}
      comps={d.components.map((c) => ({ productId: c.componentProductId, sku: c.sku, barcode: c.barcode ?? null, name: c.name, packType: c.packType, perKit: c.componentQty, stockQty: c.freeQty, trackLot: c.trackLot, trackExpiry: c.trackExpiry, trackProductionDate: c.trackProductionDate }))}
      warehouseId={wo.warehouseId} clientId={wo.clientId} buckets={buckets} bucketsPending={stock.isPending}
      preferLocationId={wo.outputLocationId} attrSeed={attrSeed}
      max={left} maxInfo={`Up to ${left} (built − already disassembled), within the chosen stock.`}
      blockReason={left <= 0 ? "Every kit built by this work order was already disassembled" : !stock.isPending && buckets.length === 0 ? "No free kit stock in this warehouse" : null}
      onClose={onClose}
      notice={conflict ? (
        <Callout variant="attention" title="This record changed since you opened it" action={<Button type="button" size="sm" variant="secondary" onClick={() => { setConflict(false); void detail.refetch(); void stock.refetch(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reload</Button>}>
          Reload to see the latest quantities.
        </Callout>
      ) : null}
      post={async (body) => {
        try {
          const res = await apiFetch<{ receiptIds: readonly string[] }>("/api/work-orders/disassemble", { method: "POST", body: { workOrderId: wo.id, version: wo.version, ...body } });
          await invalidate();
          onDone?.();
          return res;
        } catch (error) {
          if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
          throw error;
        }
      }}
      head={
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-sunken/60 px-3 py-2.5 text-xs">
          <span className="flex items-center gap-2"><PackageOpen className="h-4 w-4 text-primary" aria-hidden /><span className="font-semibold text-foreground">{wo.code}</span><span className="text-secondary">{d.kit.sku}</span></span>
          <span className="ml-auto flex items-center gap-4 tabular-nums text-secondary">
            <span>Built <strong className="text-foreground">{wo.processedQty}</strong></span>
            <span>Disassembled <strong className="text-foreground">{d.disassembledQty}</strong></span>
            <span>Can disassemble <strong className="text-foreground">{left}</strong></span>
          </span>
        </div>
      }
    />
  );
}
