"use client";

/**
 * Test Algorithm modal (spec 06 §3, beyond Logiwa): Product Putaway and LP Putaway tabs run
 * the real `putaway.suggestLocations` (saved algorithm or the unsaved draft in a rolled-back
 * savepoint) and show ranked suggestions plus the If / If-else rule trace.
 */
import * as React from "react";
import { CheckCircle2, CircleSlash, FlaskConical, MapPin, XCircle } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AlgorithmRuleInput } from "@/lib/grid-defs/integrations/algorithms";
import { LocationPicker, LpPicker, searchPicker, toOption } from "@/components/shared/entity-pickers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedTabs } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { DateTimeText, Muted, useClientOptions, useModuleDates } from "@/components/integrations/shared/shared";
import { useApiQuery } from "@/lib/query-client";
import type { PutawayInventoryRow, PutawayTestResult } from "@/server/repositories/algorithms";

/** Condition fields that read the CURRENT (source) location: without one they cannot match. */
const LOCATION_FACTS = new Set(["abcCode", "aisle", "areaType", "column", "level", "location", "locationGroup", "locationType", "locationZone", "replenishmentType", "isPreventAllocation"]);
const usesLocationFacts = (rules: readonly AlgorithmRuleInput[] | undefined): boolean =>
  (rules ?? []).some((r) => (r.conditions ?? []).some((c) => LOCATION_FACTS.has(c.field) || c.field.startsWith("locationCustomField.")));

export interface PutawayTestTarget {
  readonly algorithmId: string | null;
  readonly name: string;
  readonly warehouseId: string;
  /** Unsaved rules (editor): tested in a rolled-back savepoint. */
  readonly draftRules?: readonly AlgorithmRuleInput[];
}

function Label({ htmlFor, children, required }: { readonly htmlFor: string; readonly children: React.ReactNode; readonly required?: boolean }) {
  return <label htmlFor={htmlFor} className="text-xs font-medium text-body">{children}{required ? <span className="text-danger"> *</span> : null}</label>;
}

export function PutawayTestDialog({ target, onOpenChange }: { readonly target: PutawayTestTarget | null; readonly onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = React.useState<"product" | "lp">("product");
  const clients = useClientOptions();
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [fromLabel, setFromLabel] = React.useState<string | null>(null);
  const [productId, setProductId] = React.useState<string | null>(null);
  const [productLabel, setProductLabel] = React.useState<string | null>(null);
  const [fromLocationId, setFromLocationId] = React.useState<string | null>(null);
  const [lpId, setLpId] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState<number | null>(1);
  const [isReceiving, setIsReceiving] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<PutawayTestResult | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [bucket, setBucket] = React.useState<PutawayInventoryRow | null>(null);
  const inv = useApiQuery<PutawayInventoryRow[]>(["putaway-test-inventory", target?.warehouseId ?? "", productId ?? ""], target && productId && tab === "product" ? "/api/algorithms/test/inventory" : null, { query: { warehouseId: target?.warehouseId, productId: productId ?? undefined }, staleTime: 10_000 });
  const pickBucket = (b: PutawayInventoryRow | null) => {
    setBucket(b);
    setResult(null);
    if (!b) return;
    setFromLocationId(b.locationId);
    setFromLabel(b.locationCode);
    setQty(Math.max(1, b.onHand));
    setIsReceiving(false);
  };
  const loadProducts = React.useCallback(async (q: string, signal: AbortSignal) => (await searchPicker("products", q, clientId ? { clientId } : {}, signal)).map(toOption), [clientId]);

  React.useEffect(() => {
    if (!target) { setResult(null); setFailure(null); setErrors({}); return; }
    // Pre-fill a Receiving location (the usual putaway source) so location-based conditions can match.
    const controller = new AbortController();
    void searchPicker("locations", "", { warehouseId: target.warehouseId, areaType: "Receiving" }, controller.signal)
      .then((items) => { const first = items[0]; if (first) { setFromLocationId((cur) => cur ?? first.id); setFromLabel((cur) => cur ?? String(toOption(first).label)); } })
      .catch(() => undefined);
    return () => controller.abort();
  }, [target]);
  const needsLocation = !fromLocationId && usesLocationFacts(target?.draftRules);

  const run = async () => {
    if (!target) return;
    const next: Record<string, string> = {};
    if (!productId) next.product = "Choose the product to put away";
    if (tab === "lp" && !lpId) next.lp = "Choose the LP to put away";
    if (!qty || qty < 1) next.qty = "Quantity must be at least 1";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      document.getElementById(next.product ? "pt-product" : next.lp ? "pt-lp" : "pt-qty")?.focus();
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const body = {
        productId, qty, fromLocationId: fromLocationId ?? null, lpId: tab === "lp" ? lpId : bucket?.lpId ?? null, isReceiving,
        ...(tab === "product" && bucket ? { lot: bucket.lotNumber, expiry: bucket.expiryDate, damageReason: bucket.damageReason, packType: bucket.packType, productionDate: bucket.productionDate, receivedAt: bucket.receivedAt, allocatedQty: Math.min(bucket.allocated, qty ?? 0) } : {}),
        ...(target.draftRules ? { draft: { warehouseId: target.warehouseId, rules: target.draftRules } } : {}),
      };
      const { data } = await apiRequest<PutawayTestResult>(target.algorithmId && !target.draftRules ? `/api/algorithms/${target.algorithmId}/test` : "/api/algorithms/test", { method: "POST", body });
      setResult(data);
    } catch (error) {
      setResult(null);
      setFailure(isApiError(error) ? error.message : "The test could not run");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="Test Algorithm" description={target ? `${target.name}${target.draftRules ? " · unsaved changes included" : ""}` : undefined} />
        <DialogBody className="flex flex-col gap-4">
          <SegmentedTabs ariaLabel="Test type" tabs={[{ key: "product", label: "Product Putaway" }, { key: "lp", label: "LP Putaway" }]} active={tab} onChange={(k) => { setTab(k as "product" | "lp"); setResult(null); }} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-client">Client</Label>
              <Combobox id="pt-client" aria-label="Client" options={clients} value={clientId} placeholder="Select client" clearable
                onChange={(v) => { setClientId(v); setProductId(null); setProductLabel(null); setResult(null); }} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-product" required>Product</Label>
              <Combobox id="pt-product" aria-label="Product" loadOptions={loadProducts} minChars={0} value={productId}
                selectedOptions={productId && productLabel ? [{ value: productId, label: productLabel }] : undefined}
                onChange={(v, o) => { setProductId(v); setProductLabel(o ? String(o.label) : null); setBucket(null); setErrors((e) => ({ ...e, product: "" })); }}
                placeholder="Search SKU or name" invalid={Boolean(errors.product)} clearable />
              {errors.product ? <p role="alert" className="text-xs text-danger">{errors.product}</p> : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-qty" required>Quantity</Label>
              <NumberInput id="pt-qty" value={qty} onChange={setQty} min={1} invalid={Boolean(errors.qty)} />
              {errors.qty ? <p role="alert" className="text-xs text-danger">{errors.qty}</p> : null}
            </div>
            {tab === "lp" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="pt-lp" required>LP or parent LP</Label>
                <LpPicker id="pt-lp" warehouseId={target?.warehouseId} value={lpId} onChange={(v) => { setLpId(v); setErrors((e) => ({ ...e, lp: "" })); }} invalid={Boolean(errors.lp)} placeholder="Search or scan LP" clearable />
                {errors.lp ? <p role="alert" className="text-xs text-danger">{errors.lp}</p> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-from">Current location</Label>
              <LocationPicker id="pt-from" warehouseId={target?.warehouseId} value={fromLocationId} selectedLabel={fromLabel ?? undefined} onChange={(v, o) => { setFromLocationId(v); setFromLabel(o ? String(o.label) : null); }} placeholder="e.g. a receiving dock" clearable />
            </div>
            <div className="flex items-end pb-1">
              <Checkbox checked={isReceiving} onCheckedChange={(v) => setIsReceiving(v === true)} label="Receiving process" description="Evaluates rules as a PO receipt putaway" />
            </div>
          </div>
          {tab === "product" && productId ? <InventoryRows rows={inv.data?.data ?? []} loading={inv.isPending} selected={bucket?.id ?? null} onPick={pickBucket} /> : null}
          {needsLocation ? <Callout variant="attention" title="Choose a current location">This algorithm has conditions on the current location (area type, zone, aisle…). Without one those rules cannot match.</Callout> : null}
          {failure ? <Callout variant="error" title="Test failed">{failure}</Callout> : null}
          {pending ? <div className="flex items-center gap-2 py-6 text-sm text-secondary"><Spinner className="h-4 w-4" />Running the rule chain…</div> : result ? <TestResult result={result} hasCurrentLocation={fromLocationId !== null} /> : (
            <EmptyState compact icon={FlaskConical} title="No test run yet" description="Pick a product and quantity, then press Test to see the suggested locations and which rule chose them." />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void run()} disabled={pending}>{pending ? <Spinner className="h-3.5 w-3.5" /> : <FlaskConical className="h-4 w-4" />}Test</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestResult({ result, hasCurrentLocation }: { readonly result: PutawayTestResult; readonly hasCurrentLocation: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_240px]">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-secondary">Suggested locations · {result.product.sku}</h3>
        {result.suggestions.length === 0 ? (
          <Callout variant="attention" title="No location found">No rule produced a location for this product. Check the trace for the rule that came closest.</Callout>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {result.suggestions.map((sug, i) => (
              <li key={sug.locationId} className={cn("flex items-start gap-3 px-3 py-2", i === 0 && "bg-success-soft/40")}>
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold", i === 0 ? "bg-success text-white" : "bg-neutral-soft text-secondary")}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><MapPin className="h-3.5 w-3.5 text-faint" aria-hidden />{sug.code}
                    {sug.areaType ? <Badge size="sm" tone="info" shape="pill">{sug.areaType}</Badge> : null}
                    {sug.zone ? <span className="text-2xs font-normal text-faint">Zone {sug.zone}</span> : null}
                    <span className="ml-auto text-2xs font-normal tabular-nums text-secondary">{sug.onHand.toLocaleString("en-US")} on hand</span></p>
                  <p className="mt-0.5 truncate text-2xs text-faint" title={sug.reasons.join(" · ")}>{sug.reasons.join(" · ")}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-secondary">Rule trace</h3>
        <p className="text-xs text-secondary">{result.algorithm}{result.rule ? <> · chose <span className="font-semibold text-foreground">{result.rule}</span></> : null}</p>
        <ol className="flex flex-col gap-1.5">
          {result.trace.map((t, i) => {
            const won = t.rule === result.rule && t.candidates > 0;
            const Icon = won ? CheckCircle2 : t.matched ? XCircle : CircleSlash;
            return (
              <li key={`${t.rule}-${i}`} className={cn("rounded-md border px-2.5 py-1.5", won ? "border-success/40 bg-success-soft/40" : "border-border")}>
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Icon className={cn("h-3.5 w-3.5", won ? "text-success" : t.matched ? "text-danger" : "text-faint")} aria-hidden />
                  <span className="text-faint">{i === 0 ? "If" : `${i}. If else`}</span>{t.rule}</p>
                <p className="mt-0.5 text-2xs text-secondary">{t.message}</p>
              </li>
            );
          })}
        </ol>
        {!hasCurrentLocation && result.trace.some((t) => !t.matched) ? (
          <p className="text-2xs text-faint">Location conditions (area type, zone, aisle…) check the current location. Pick one above to test rules that use them.</p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Product Putaway › the product's inventory rows (Logiwa parity): pick one to test moving it
 * from where it sits, with its status, pack type, LP, lot, dates, PO, damage and quantities.
 */
function InventoryRows({ rows, loading, selected, onPick }: {
  readonly rows: readonly PutawayInventoryRow[]; readonly loading: boolean; readonly selected: string | null; readonly onPick: (row: PutawayInventoryRow | null) => void;
}) {
  const dates = useModuleDates();
  return (
    <section aria-labelledby="pt-inventory" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 id="pt-inventory" className="text-xs font-semibold text-secondary">Inventory to put away</h3>
        <span className="text-2xs text-faint">Optional · pick a row to test moving that stock; leave empty to test a new receipt</span>
        {selected ? <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onPick(null)}>Clear</Button> : null}
      </div>
      <div className="max-h-48 overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-sunken text-2xs text-secondary">
            <tr>{["", "Location", "Status", "Pack type", "LP", "Lot", "Expiry", "Production", "Received", "PO", "Damage", "Allocated", "Qty"].map((h, i) => <th key={i} className={cn("px-2 py-1.5 text-left font-semibold", i >= 11 && "text-right")}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? <tr><td colSpan={13} className="px-2 py-4 text-center text-faint"><Spinner className="mx-auto h-4 w-4" /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={13} className="px-2 py-4 text-center text-faint">No stock of this product in the warehouse. The test runs as a new receipt.</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className={cn("cursor-pointer hover:bg-surface-sunken", selected === r.id && "bg-primary-soft/50")} onClick={() => onPick(r)}>
                  <td className="px-2 py-1.5"><input type="radio" name="pt-bucket" aria-label={`Use ${r.locationCode}${r.lotNumber ? ` lot ${r.lotNumber}` : ""}`} checked={selected === r.id} onChange={() => onPick(r)} /></td>
                  <td className="px-2 py-1.5 font-medium">{r.locationCode}</td>
                  <td className="px-2 py-1.5">{r.status}</td>
                  <td className="px-2 py-1.5">{r.packType}</td>
                  <td className="px-2 py-1.5">{r.lpNumber ?? <Muted />}</td>
                  <td className="px-2 py-1.5">{r.lotNumber ?? <Muted />}</td>
                  <td className="px-2 py-1.5 tabular-nums">{r.expiryDate ? dates.date(r.expiryDate) : <Muted />}</td>
                  <td className="px-2 py-1.5 tabular-nums">{r.productionDate ? dates.date(r.productionDate) : <Muted />}</td>
                  <td className="px-2 py-1.5"><DateTimeText value={r.receivedAt} /></td>
                  <td className="px-2 py-1.5">{r.poNumber ?? <Muted />}</td>
                  <td className="px-2 py-1.5">{r.damageReason ?? <Muted />}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.allocated}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.onHand}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
