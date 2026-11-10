"use client";

/**
 * Per-item capture rows at the Return Station: scanned / expected quantity, disposition
 * (Restock / Damaged / Quarantine / Dispose), damage reason, actual return reason,
 * note and an optional photo. Shared by Return With RMA and Return Manually.
 */
import * as React from "react";
import { Camera, CheckCircle2, Minus, Plus, Trash2 } from "lucide-react";
import { ProductThumb } from "@/components/receiving/receiving-shared";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { RETURN_DISPOSITIONS } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { dispositionHint, type CaptureItem, type ItemErrors, type ReturnDisposition } from "./return-station-model";

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
  return (
    <ul className="flex flex-col gap-2" aria-label="Items to receive">
      {items.map((i) => {
        const e = errors[i.key];
        const done = i.remaining !== null && i.quantity >= i.remaining;
        const photo = photos[i.key];
        return (
          <li key={i.key} className={cn("rounded-lg border border-l-4 bg-surface p-3 transition-shadow", D_TONE[i.disposition], highlightKey === i.key && "shadow-[0_0_0_3px_rgba(23,135,77,.25)]", i.quantity === 0 && "opacity-80")}>
            <div className="flex flex-wrap items-start gap-3">
              <ProductThumb url={i.imageUrl} label={i.sku} size={44} />
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TextField aria-label={`Note for ${i.sku}`} className="min-w-[200px] flex-1" value={i.note} maxLength={500} placeholder="Note (optional)" onChange={(ev) => onChange(i.key, { note: ev.target.value })} />
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
