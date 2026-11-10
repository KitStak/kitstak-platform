"use client";

/**
 * Per-item capture rows at the Return Station: scanned / expected quantity, disposition
 * (Restock / Damaged / Quarantine / Dispose), damage reason, actual return reason,
 * note and an optional photo. Shared by Return With RMA and Return Manually.
 */
import * as React from "react";
import { Camera, CheckCircle2, Minus, Package as PackageIcon, Plus, Trash2, X } from "lucide-react";
import type { ReturnRules } from "@/lib/grid-defs/admin/return-rules";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { RETURN_DISPOSITIONS } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { dispositionHint, parseSerials, type CaptureItem, type ItemErrors, type ReturnDisposition } from "./return-station-model";

export interface ItemListProps {
  readonly items: readonly CaptureItem[];
  readonly errors: ItemErrors;
  readonly highlightKey: string | null;
  readonly damageReasons: readonly { value: string; label: string }[];
  readonly returnReasons: readonly { value: string; label: string }[];
  readonly photos: Readonly<Record<string, File>>;
  readonly onPhoto: (key: string, file: File | null) => void;
  readonly onChange: (key: string, patch: Partial<CaptureItem>) => void;
  readonly onRemove?: (key: string) => void;
  readonly targetCode: string | null;
  readonly stationCode: string | null;
}

const D_TONE: Record<ReturnDisposition, string> = {
  Restock: "border-l-success", Damaged: "border-l-danger", Quarantine: "border-l-warning", Dispose: "border-l-border-strong",
};

export function ReturnItemList({ items, errors, highlightKey, damageReasons, returnReasons, photos, onPhoto, onChange, onRemove, targetCode, stationCode }: ItemListProps) {
  const rules = useReturnRules();
  return (
    <ul className="flex flex-col gap-2" aria-label="Items to receive">
      {items.map((i) => {
        const e = errors[i.key];
        const done = i.remaining !== null && i.quantity >= i.remaining;
        const photo = photos[i.key];
        return (
          <li key={i.key} className={cn("rounded-lg border border-l-4 bg-surface p-3 transition-shadow", D_TONE[i.disposition], highlightKey === i.key && "shadow-[0_0_0_3px_rgba(23,135,77,.25)]", i.quantity === 0 && "opacity-80")}>
            <div className="flex flex-wrap items-start gap-3">
              <ItemThumb url={i.imageUrl} size={44} />
              <div className="min-w-[160px] flex-1">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">{i.sku}{done ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="All expected units scanned" /> : null}</p>
                <p className="truncate text-[12px] text-secondary">{i.name}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" aria-label={`One less ${i.sku}`} disabled={i.quantity <= 0} onClick={() => onChange(i.key, { quantity: Math.max(0, i.quantity - 1) })}><Minus className="h-3.5 w-3.5" aria-hidden /></Button>
                  <NumberInput aria-label={`Quantity of ${i.sku}`} className="w-[76px]" value={i.quantity} min={0} max={i.remaining ?? undefined} invalid={Boolean(e?.quantity)} hideStepper onChange={(n) => onChange(i.key, { quantity: n ?? 0 })} />
                  <Button size="sm" variant="secondary" aria-label={`One more ${i.sku}`} disabled={i.remaining !== null && i.quantity >= i.remaining} onClick={() => onChange(i.key, { quantity: i.quantity + 1 })}><Plus className="h-3.5 w-3.5" aria-hidden /></Button>
                  {onRemove ? <Button size="sm" variant="ghost" aria-label={`Remove ${i.sku}`} onClick={() => onRemove(i.key)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button> : null}
                </div>
                <p className={cn("text-[11px] tabular-nums", e?.quantity ? "font-medium text-danger" : "text-secondary")}>{e?.quantity ?? (i.remaining !== null ? `${i.quantity} of ${i.remaining} expected` : `${i.quantity} scanned`)}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Condition</span>
                <SegmentedControl size="sm" ariaLabel={`Condition of ${i.sku}`} value={i.disposition} onChange={(d) => onChange(i.key, { disposition: d })} options={RETURN_DISPOSITIONS.map((d) => ({ value: d, label: d }))} />
                <span className="text-[11px] text-secondary">{dispositionHint(i.disposition, targetCode, stationCode)}</span>
              </div>
              {i.disposition === "Damaged" ? (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Damage reason <span className="text-danger">*</span></span>
                  <Select aria-label={`Damage reason for ${i.sku}`} value={i.damageReasonId} invalid={Boolean(e?.damageReasonId)} options={damageReasons} onChange={(v) => onChange(i.key, { damageReasonId: v })} placeholder="Choose a reason" />
                  {e?.damageReasonId ? <span className="text-[11px] text-danger">{e.damageReasonId}</span> : null}
                </div>
              ) : <div className="hidden lg:block" />}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Actual return reason</span>
                <Select aria-label={`Actual return reason for ${i.sku}`} value={i.actualReturnReasonId} clearable options={returnReasons} onChange={(v) => onChange(i.key, { actualReturnReasonId: v })} placeholder="Optional" />
              </div>
            </div>
            {e?.disposition ? <p role="alert" className="mt-2 text-[12px] font-medium text-danger">{e.disposition}</p> : null}
            <TrackingCapture item={i} errors={e} rules={rules} onChange={(patch) => onChange(i.key, patch)} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="min-w-[200px] flex-1"><TextField aria-label={`Note for ${i.sku}`} className="h-9 w-full" value={i.note} maxLength={500} placeholder="Note (optional)" onChange={(ev) => onChange(i.key, { note: ev.target.value })} /></div>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium text-body hover:bg-surface-sunken focus-within:ring-2 focus-within:ring-primary/40">
                <Camera className="h-3.5 w-3.5" aria-hidden />
                {photo ? <span className="max-w-[140px] truncate">{photo.name}</span> : "Add photo"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(ev) => onPhoto(i.key, ev.target.files?.[0] ?? null)} />
              </label>
              {photo ? <Button size="sm" variant="ghost" onClick={() => onPhoto(i.key, null)}>Remove photo</Button> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Return Process parameters (shared cache with the station's rules card). */
export function useReturnRules(): ReturnRules | null {
  const q = useApiQuery<ReturnRules>(["returns", "rules"], "/api/returns/rules", { staleTime: 60_000 });
  return q.data?.data ?? null;
}

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary";

/**
 * Lot / expiry / production date / serial capture for a tracked SKU. Required marks follow the
 * Return Process match rules; the values that shipped on the order are offered as choices.
 */
function TrackingCapture({ item: i, errors: e, rules, onChange }: {
  readonly item: CaptureItem; readonly errors: ItemErrors[string] | undefined; readonly rules: ReturnRules | null; readonly onChange: (patch: Partial<CaptureItem>) => void;
}) {
  const [serialDraft, setSerialDraft] = React.useState("");
  if (!i.trackLot && !i.trackExpiry && !i.trackProductionDate && !i.trackSerial) return null;
  const sh = i.shipped;
  const req = (on: boolean | undefined, values: readonly string[] | undefined) => Boolean(rules && on && values?.length);
  const listId = (f: string) => `ret-${f}-${i.key}`;
  const serials = i.serials ?? [];
  const addSerials = (raw: string) => {
    const next = [...new Set([...serials, ...parseSerials(raw)])];
    onChange({ serials: next, quantity: i.remaining !== null ? Math.min(Math.max(i.quantity, next.length), i.remaining) : Math.max(i.quantity, next.length) });
    setSerialDraft("");
  };
  const field = (label: string, required: boolean, error: string | undefined, input: React.ReactNode, hint?: string) => (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1">
      <span className={LABEL}>{label}{required ? <span className="text-danger"> *</span> : null}</span>
      {input}
      {error ? <span className="text-[11px] font-medium text-danger">{error}</span> : hint ? <span className="text-[11px] text-secondary">{hint}</span> : null}
    </div>
  );
  const shippedHint = (values: readonly string[] | undefined) => (values?.length ? `Shipped: ${values.slice(0, 3).join(", ")}${values.length > 3 ? ` +${values.length - 3}` : ""}` : undefined);
  return (
    <div className="mt-3 flex flex-wrap gap-3 rounded-md border border-dashed border-border bg-surface-sunken/40 p-2.5" data-testid={`return-tracking-${i.sku}`}>
      {i.trackLot ? field("Lot / batch", req(rules?.lotNumberMatch, sh?.lots), e?.lotNumber, (
        <>
          <TextField aria-label={`Lot number of ${i.sku}`} className="h-9 w-full" list={listId("lot")} value={i.lotNumber ?? ""} maxLength={120} invalid={Boolean(e?.lotNumber)} placeholder="Scan or type the lot" onChange={(ev) => onChange({ lotNumber: ev.target.value })} />
          {sh?.lots.length ? <datalist id={listId("lot")}>{sh.lots.map((v) => <option key={v} value={v} />)}</datalist> : null}
        </>
      ), shippedHint(sh?.lots)) : null}
      {i.trackExpiry ? field("Expiry date", req(rules?.expiryDateMatch, sh?.expiryDates), e?.expiryDate, (
        <TextField type="date" aria-label={`Expiry date of ${i.sku}`} className="h-9 w-full" value={i.expiryDate ?? ""} invalid={Boolean(e?.expiryDate)} onChange={(ev) => onChange({ expiryDate: ev.target.value })} />
      ), shippedHint(sh?.expiryDates)) : null}
      {i.trackProductionDate ? field("Production date", req(rules?.productionDateMatch, sh?.productionDates), e?.productionDate, (
        <TextField type="date" aria-label={`Production date of ${i.sku}`} className="h-9 w-full" value={i.productionDate ?? ""} invalid={Boolean(e?.productionDate)} onChange={(ev) => onChange({ productionDate: ev.target.value })} />
      ), shippedHint(sh?.productionDates)) : null}
      {i.trackSerial ? (
        <div className="flex min-w-[240px] flex-[2] flex-col gap-1">
          <span className={LABEL}>Serial numbers <span className="font-normal normal-case tracking-normal text-faint">{serials.length} / {i.quantity}</span></span>
          <TextField aria-label={`Scan serial of ${i.sku}`} className="h-9 w-full" value={serialDraft} maxLength={2000} invalid={Boolean(e?.serials)} placeholder="Scan a serial and press Enter"
            onChange={(ev) => setSerialDraft(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); if (serialDraft.trim()) addSerials(serialDraft); } }}
            onBlur={() => { if (serialDraft.trim()) addSerials(serialDraft); }} />
          {serials.length ? (
            <ul className="flex flex-wrap gap-1" aria-label={`Serials of ${i.sku}`}>
              {serials.map((s) => (
                <li key={s} className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px]">
                  {s}
                  <button type="button" className="rounded text-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`Remove serial ${s}`} onClick={() => onChange({ serials: serials.filter((x) => x !== s) })}><X className="h-3 w-3" aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
          {e?.serials ? <span className="text-[11px] font-medium text-danger">{e.serials}</span>
            : <span className="text-[11px] text-secondary">{serials.length ? "Each serial counts one unit." : "Optional: leave empty to bring back the serials that shipped on the order line."}</span>}
        </div>
      ) : null}
    </div>
  );
}

/** Product image, or a neutral package icon (initials read like words, e.g. "NO"). */
export function ItemThumb({ url, size }: { readonly url: string | null; readonly size: number }) {
  const icon = Math.max(12, Math.round(size * 0.55));
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken text-secondary" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary CDNs
        <img src={url} alt="" width={size} height={size} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <PackageIcon style={{ width: icon, height: icon }} aria-hidden />
      )}
    </span>
  );
}
