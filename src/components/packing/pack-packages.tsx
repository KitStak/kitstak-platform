"use client";

/**
 * Pack screen right pane: package boxes (type auto-fills L/W/H, weight lb/oz, contents
 * grid with label column, add / close / remove package), serial and lot/expiry
 * captures, and Carrier* / Service* with Get Rate and pre-generated label upload.
 */
import * as React from "react";
import { BadgeDollarSign, Box, CheckCircle2, Lock, Minus, PackagePlus, Scale, Trash2, Unlock, Upload } from "lucide-react";
import { ProductThumb } from "@/components/receiving/receiving-shared";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { boxErrors, boxWeightOz, choosePackage, packedQty, removeBox, removeOne, setCapture, suggestedWeightOz, updateBox, type PackLine, type PackPackageType, type PackState } from "./pack-model";
import type { PackContext, RateQuote } from "./pack-types";

export interface CarrierChoice {
  readonly carrierKey: string | null;
  readonly carrierServiceId: string | null;
}

export function PackageBoxes({ lines, packages, state, onState, showErrors }: { readonly lines: readonly PackLine[]; readonly packages: readonly PackPackageType[]; readonly state: PackState; readonly onState: (s: PackState) => void; readonly showErrors: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {state.boxes.map((b, i) => {
        const pkg = packages.find((p) => p.id === b.shipmentPackageId) ?? null;
        const active = i === state.active && !b.closed;
        const e = boxErrors(b);
        const entries = Object.entries(b.items);
        const suggest = suggestedWeightOz(lines, b, pkg);
        return (
          <Card key={b.seq} className={cn("overflow-hidden p-0 transition-shadow", active && "ring-2 ring-primary/50", b.closed && "bg-surface-sunken/40")}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <button type="button" onClick={() => onState({ ...state, active: i, boxes: state.boxes.map((x, j) => (j === i ? { ...x, closed: false } : x)) })} className="flex items-center gap-2 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
                <Box className="h-4 w-4 text-secondary" aria-hidden />Package {b.seq}
                {b.closed ? <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] text-success"><Lock className="h-3 w-3" aria-hidden />Closed</span> : active ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary">Packing</span> : <span className="inline-flex items-center gap-1 text-[11px] text-secondary"><Unlock className="h-3 w-3" aria-hidden />Open</span>}
              </button>
              <span className="text-[12px] tabular-nums text-secondary">{entries.reduce((s, [, q]) => s + q, 0)} units</span>
              {state.boxes.length > 1 && entries.length === 0 ? <Button size="sm" variant="ghost" aria-label={`Remove package ${b.seq}`} onClick={() => onState(removeBox(state, i))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button> : null}
            </div>
            <div className="grid gap-3 p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.6fr))]">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary" htmlFor={`pkg-${b.seq}`}>Package type <span className="text-danger">*</span></label>
                  <Select id={`pkg-${b.seq}`} value={b.shipmentPackageId} disabled={b.closed} clearable invalid={showErrors && Boolean(e.dims) && !b.shipmentPackageId}
                    options={packages.map((p) => ({ value: p.id, label: p.code, description: `${p.length} × ${p.width} × ${p.height} in${p.description ? ` · ${p.description}` : ""}${p.tracksInventory && !/tracked/i.test(p.description ?? "") ? " · tracked" : ""}` }))}
                    onChange={(id) => onState(choosePackage(state, i, packages.find((p) => p.id === id) ?? null))} placeholder="Choose a package" />
                </div>
                {(["length", "width", "height"] as const).map((k) => (
                  <div key={k} className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">{k[0]?.toUpperCase()} (in)</span>
                    <NumberInput aria-label={`Package ${b.seq} ${k}`} value={b[k]} decimals={1} min={0} disabled={b.closed} invalid={showErrors && Boolean(e.dims) && !b[k]} hideStepper onChange={(n) => onState(updateBox(state, i, { [k]: n }))} />
                  </div>
                ))}
              </div>
              {showErrors && e.dims ? <p className="-mt-1 text-[11px] text-danger">{e.dims}</p> : null}
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Weight <span className="text-danger">*</span></span>
                  <div className="flex items-center gap-1.5">
                    <NumberInput aria-label={`Package ${b.seq} weight pounds`} className="w-[84px]" value={b.weightLb} min={0} max={150} disabled={b.closed} invalid={showErrors && Boolean(e.weight)} hideStepper suffix={<span className="text-[11px] text-secondary">lb</span>} onChange={(n) => onState(updateBox(state, i, { weightLb: n }))} />
                    <NumberInput aria-label={`Package ${b.seq} weight ounces`} className="w-[84px]" value={b.weightOz} min={0} max={15.99} decimals={2} disabled={b.closed} invalid={showErrors && Boolean(e.weight)} hideStepper suffix={<span className="text-[11px] text-secondary">oz</span>} onChange={(n) => onState(updateBox(state, i, { weightOz: n }))} />
                  </div>
                </div>
                {suggest > 0 && !b.closed ? (
                  <Button size="sm" variant="ghost" onClick={() => onState(updateBox(state, i, { weightLb: Math.floor(suggest / 16), weightOz: Math.round((suggest % 16) * 100) / 100 }))}>
                    <Scale className="h-3.5 w-3.5" aria-hidden />Use {Math.floor(suggest / 16)} lb {Math.round((suggest % 16) * 10) / 10} oz
                  </Button>
                ) : null}
                <span className="ml-auto text-[12px] text-secondary tabular-nums">{boxWeightOz(b) > 0 ? `${(boxWeightOz(b) / 16).toFixed(2)} lb total` : ""}</span>
              </div>
              {showErrors && e.weight ? <p className="-mt-1 text-[11px] text-danger">{e.weight}</p> : null}
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-[12px]">
                  <thead className="bg-surface-sunken text-[10px] font-semibold uppercase tracking-[0.04em] text-secondary">
                    <tr><th className="px-2 py-1.5 text-left">Product</th><th className="px-2 py-1.5 text-left">Label</th><th className="px-2 py-1.5 text-right">Qty</th><th className="w-8" /></tr>
                  </thead>
                  <tbody>
                    {entries.length === 0 ? (
                      <tr><td colSpan={4} className="px-2 py-4 text-center text-secondary">{b.closed ? "Empty" : "Scan products into this package"}</td></tr>
                    ) : entries.map(([lineId, q]) => {
                      const l = lines.find((x) => x.orderLineId === lineId);
                      return (
                        <tr key={lineId} className={cn("border-t border-border", state.lastLineId === lineId && active && "bg-success-soft/60")}>
                          <td className="px-2 py-1.5"><span className="font-medium">{l?.sku}</span><span className="ml-1 text-secondary">{l?.packType}</span></td>
                          <td className="px-2 py-1.5 text-secondary">PKG {b.seq} / {state.boxes.length}</td>
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{q}</td>
                          <td className="px-1"><Button size="sm" variant="ghost" aria-label={`Remove one ${l?.sku ?? "item"}`} disabled={b.closed} onClick={() => onState(removeOne(lines, state, i, lineId))}><Minus className="h-3 w-3" aria-hidden /></Button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function Captures({ lines, state, onState }: { readonly lines: readonly PackLine[]; readonly state: PackState; readonly onState: (s: PackState) => void }) {
  const tracked = lines.filter((l) => l.toPack > 0 && (l.trackSerial || l.captureLot || l.captureExpiry));
  if (tracked.length === 0) return null;
  return (
    <Card className="space-y-3 p-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-secondary">Tracking capture</h3>
      {tracked.map((l) => {
        const c = state.captures[l.orderLineId] ?? { serials: [], lotNumber: "", expiryDate: "" };
        return (
          <div key={l.orderLineId} className="grid gap-2 border-t border-border pt-2 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex items-center gap-2"><ProductThumb url={l.imageUrl} label={l.sku} size={28} /><span className="text-[13px] font-medium">{l.sku}</span></div>
            {l.trackSerial ? (
              <div className="sm:col-span-2">
                <p className="text-[11px] text-secondary">Serials {c.serials.length}/{l.toPack}</p>
                <p className="font-mono text-[12px]">{c.serials.length ? c.serials.join(", ") : "Scan the product, then its serial"}</p>
              </div>
            ) : null}
            {l.captureLot ? <TextField aria-label={`Lot number of ${l.sku}`} placeholder="Lot number *" value={c.lotNumber} onChange={(e) => onState(setCapture(state, l.orderLineId, { lotNumber: e.target.value }))} /> : null}
            {l.captureExpiry ? <TextField aria-label={`Expiry date of ${l.sku}`} type="date" value={c.expiryDate} onChange={(e) => onState(setCapture(state, l.orderLineId, { expiryDate: e.target.value }))} /> : null}
          </div>
        );
      })}
    </Card>
  );
}

export function CarrierPanel({ context, choice, onChoice, rate, rating, rateError, onGetRate, onUpload, uploading, uploadedName, withLabelDisabled }: {
  readonly context: PackContext; readonly choice: CarrierChoice; readonly onChoice: (c: CarrierChoice) => void; readonly rate: RateQuote | null; readonly rating: boolean;
  readonly rateError: string | null; readonly onGetRate: () => void; readonly onUpload: (file: File) => void; readonly uploading: boolean; readonly uploadedName: string | null; readonly withLabelDisabled: boolean;
}) {
  const fmt = useFormat();
  const carrier = context.carriers.find((c) => c.key === choice.carrierKey);
  if (context.carriers.length === 0) return <Callout variant="attention" title="No carrier available">This warehouse has no active carrier connection. Pack without a label or upload a pre-generated label.</Callout>;
  return (
    <Card className="space-y-3 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="pk-carrier" className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Carrier <span className="text-danger">*</span></label>
          <Select id="pk-carrier" value={choice.carrierKey} options={context.carriers.map((c) => ({ value: c.key, label: `${c.carrierCode} · ${c.connectionName}`, textValue: `${c.carrierCode} · ${c.connectionName}` }))}
            onChange={(k) => onChoice({ carrierKey: k, carrierServiceId: context.carriers.find((c) => c.key === k)?.services[0]?.id ?? null })} placeholder="Choose a carrier" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pk-service" className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Shipping service <span className="text-danger">*</span></label>
          <Select id="pk-service" value={choice.carrierServiceId} disabled={!carrier} options={(carrier?.services ?? []).map((s) => ({ value: s.id, label: s.name, description: s.transitDays ? `${s.transitDays} day${s.transitDays === 1 ? "" : "s"}` : undefined }))}
            onChange={(id) => onChoice({ ...choice, carrierServiceId: id })} placeholder={carrier ? "Choose a service" : "Choose a carrier first"} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={onGetRate} disabled={rating || !choice.carrierServiceId}>
          {rating ? <Spinner className="h-3.5 w-3.5" label="Rating" /> : <BadgeDollarSign className="h-3.5 w-3.5" aria-hidden />}Get rate
        </Button>
        {rate ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-success-soft px-2.5 py-1 text-[12px] font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{rate.carrierCode} {rate.serviceName}: {fmt.money(rate.price, rate.currency, "summary")} · {rate.transitDays} day{rate.transitDays === 1 ? "" : "s"}
          </span>
        ) : rateError ? <span className="text-[12px] text-danger">{rateError}</span> : <span className="text-[12px] text-secondary">Rates use the closed package sizes and weights.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium hover:bg-surface-sunken focus-within:ring-2 focus-within:ring-primary/40", withLabelDisabled && "cursor-not-allowed opacity-60")}
          title={withLabelDisabled ? "Packing without a KitStaks label is disabled for this client" : undefined}>
          {uploading ? <Spinner className="h-3.5 w-3.5" label="Uploading" /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
          {uploadedName ? "Replace pre-generated label" : "Upload pre-generated label"}
          <input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg,.zpl" disabled={withLabelDisabled || uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }} />
        </label>
        {uploadedName ? <span className="text-[12px] text-secondary">Attached: <strong>{uploadedName}</strong>. Completing packs without buying a label.</span> : <span className="text-[11px] text-secondary">Use when the marketplace already printed the label.</span>}
      </div>
    </Card>
  );
}

export function ContentsSummary({ lines, state }: { readonly lines: readonly PackLine[]; readonly state: PackState }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Order items">
      {lines.filter((l) => l.toPack > 0).map((l) => {
        const q = packedQty(state, l.orderLineId);
        const done = q >= l.toPack;
        return (
          <li key={l.orderLineId} className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors", done ? "border-success/40 bg-success-soft/50" : state.awaitingSerialFor === l.orderLineId ? "border-warning bg-warning-soft/50" : "border-border", state.lastLineId === l.orderLineId && "ring-2 ring-success/40")}>
            <ProductThumb url={l.imageUrl} label={l.sku} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{l.sku}{l.trackSerial ? <span className="ml-1 rounded bg-neutral-soft px-1 text-[10px] font-medium text-secondary">Serial</span> : null}</p>
              <p className="truncate text-[11px] text-secondary">{l.name}</p>
              {l.packingInstructions ? <p className="truncate text-[11px] text-warning">{l.packingInstructions}</p> : null}
            </div>
            <span className={cn("text-[15px] font-semibold tabular-nums", done ? "text-success" : "text-foreground")}>{q}<span className="text-[12px] font-normal text-secondary">/{l.toPack}</span></span>
          </li>
        );
      })}
    </ul>
  );
}

export function PackHints() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-secondary">
      <span><Kbd>Enter</Kbd> submit scan</span><span><Kbd>F2</Kbd> close package</span><span><Kbd>F9</Kbd> complete</span>
      <span className="inline-flex items-center gap-1"><PackagePlus className="h-3 w-3" aria-hidden />Close a package to start the next box</span>
    </p>
  );
}
