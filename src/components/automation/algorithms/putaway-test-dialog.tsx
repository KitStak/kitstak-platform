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
import type { PutawayTestResult } from "@/server/repositories/algorithms";

export interface PutawayTestTarget {
  readonly algorithmId: string | null;
  readonly name: string;
  readonly warehouseId: string;
  /** Unsaved rules (editor): tested in a rolled-back savepoint. */
  readonly draftRules?: readonly AlgorithmRuleInput[];
}

function Label({ htmlFor, children, required }: { readonly htmlFor: string; readonly children: React.ReactNode; readonly required?: boolean }) {
  return <label htmlFor={htmlFor} className="text-[12px] font-medium text-body">{children}{required ? <span className="text-danger"> *</span> : null}</label>;
}

export function PutawayTestDialog({ target, onOpenChange }: { readonly target: PutawayTestTarget | null; readonly onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = React.useState<"product" | "lp">("product");
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
  const loadProducts = React.useCallback(async (q: string, signal: AbortSignal) => (await searchPicker("products", q, {}, signal)).map(toOption), []);

  React.useEffect(() => {
    if (!target) { setResult(null); setFailure(null); setErrors({}); }
  }, [target]);

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
        productId, qty, fromLocationId: fromLocationId ?? null, lpId: tab === "lp" ? lpId : null, isReceiving,
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
              <Label htmlFor="pt-product" required>Product</Label>
              <Combobox id="pt-product" aria-label="Product" loadOptions={loadProducts} minChars={0} value={productId}
                selectedOptions={productId && productLabel ? [{ value: productId, label: productLabel }] : undefined}
                onChange={(v, o) => { setProductId(v); setProductLabel(o ? String(o.label) : null); setErrors((e) => ({ ...e, product: "" })); }}
                placeholder="Search SKU or name" invalid={Boolean(errors.product)} clearable />
              {errors.product ? <p role="alert" className="text-[12px] text-danger">{errors.product}</p> : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-qty" required>Quantity</Label>
              <NumberInput id="pt-qty" value={qty} onChange={setQty} min={1} invalid={Boolean(errors.qty)} />
              {errors.qty ? <p role="alert" className="text-[12px] text-danger">{errors.qty}</p> : null}
            </div>
            {tab === "lp" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="pt-lp" required>LP or parent LP</Label>
                <LpPicker id="pt-lp" warehouseId={target?.warehouseId} value={lpId} onChange={(v) => { setLpId(v); setErrors((e) => ({ ...e, lp: "" })); }} invalid={Boolean(errors.lp)} placeholder="Search or scan LP" clearable />
                {errors.lp ? <p role="alert" className="text-[12px] text-danger">{errors.lp}</p> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-from">Current location</Label>
              <LocationPicker id="pt-from" warehouseId={target?.warehouseId} value={fromLocationId} onChange={(v) => setFromLocationId(v)} placeholder="Optional · e.g. a receiving dock" clearable />
            </div>
            <div className="flex items-end pb-1">
              <Checkbox checked={isReceiving} onCheckedChange={(v) => setIsReceiving(v === true)} label="Receiving process" description="Evaluates rules as a PO receipt putaway" />
            </div>
          </div>
          {failure ? <Callout variant="error" title="Test failed">{failure}</Callout> : null}
          {pending ? <div className="flex items-center gap-2 py-6 text-[13px] text-secondary"><Spinner className="h-4 w-4" />Running the rule chain…</div> : result ? <TestResult result={result} hasCurrentLocation={fromLocationId !== null} /> : (
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
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Suggested locations · {result.product.sku}</h3>
        {result.suggestions.length === 0 ? (
          <Callout variant="attention" title="No location found">No rule produced a location for this product. Check the trace for the rule that came closest.</Callout>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {result.suggestions.map((sug, i) => (
              <li key={sug.locationId} className={cn("flex items-start gap-3 px-3 py-2", i === 0 && "bg-success-soft/40")}>
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", i === 0 ? "bg-success text-white" : "bg-neutral-soft text-secondary")}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground"><MapPin className="h-3.5 w-3.5 text-faint" aria-hidden />{sug.code}
                    {sug.areaType ? <Badge size="sm" tone="info" shape="pill">{sug.areaType}</Badge> : null}
                    {sug.zone ? <span className="text-[11px] font-normal text-faint">Zone {sug.zone}</span> : null}
                    <span className="ml-auto text-[11px] font-normal tabular-nums text-secondary">{sug.onHand.toLocaleString("en-US")} on hand</span></p>
                  <p className="mt-0.5 truncate text-[11px] text-faint" title={sug.reasons.join(" · ")}>{sug.reasons.join(" · ")}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Rule trace</h3>
        <p className="text-[12px] text-secondary">{result.algorithm}{result.rule ? <> · chose <span className="font-semibold text-foreground">{result.rule}</span></> : null}</p>
        <ol className="flex flex-col gap-1.5">
          {result.trace.map((t, i) => {
            const won = t.rule === result.rule && t.candidates > 0;
            const Icon = won ? CheckCircle2 : t.matched ? XCircle : CircleSlash;
            return (
              <li key={`${t.rule}-${i}`} className={cn("rounded-md border px-2.5 py-1.5", won ? "border-success/40 bg-success-soft/40" : "border-border")}>
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground"><Icon className={cn("h-3.5 w-3.5", won ? "text-success" : t.matched ? "text-danger" : "text-faint")} aria-hidden />
                  <span className="text-faint">{i === 0 ? "If" : `${i}. If else`}</span>{t.rule}</p>
                <p className="mt-0.5 text-[11px] text-secondary">{t.message}</p>
              </li>
            );
          })}
        </ol>
        {!hasCurrentLocation && result.trace.some((t) => !t.matched) ? (
          <p className="text-[11px] text-faint">Location conditions (area type, zone, aisle…) check the current location. Pick one above to test rules that use them.</p>
        ) : null}
      </section>
    </div>
  );
}
