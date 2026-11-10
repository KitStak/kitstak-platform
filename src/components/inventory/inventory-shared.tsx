"use client";

/**
 * Shared pieces of the inventory pages: filter fields with runtime options (scope +
 * damage reasons), the reasons query, the inventory status pill, product thumbnails
 * and quantity cells.
 */
import * as React from "react";
import { ExternalLink, Package } from "lucide-react";
import { openOrdersHref } from "./inventory-links";
import { useApiQuery } from "@/lib/query-client";
import { useMe } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import type { FilterFieldDef } from "@/components/grid";
import type { InventoryGridField } from "@/lib/grid-defs/inventory/fields";

export interface ReasonOption {
  readonly id: string;
  readonly name: string;
}

export interface InventoryReasons {
  readonly adjustmentReasons: readonly ReasonOption[];
  readonly damageReasons: readonly ReasonOption[];
  readonly mandatoryReason: Readonly<Record<string, boolean>>;
}

export const REASONS_KEY = ["inventory", "reasons"] as const;

export function useInventoryReasons(enabled = true): InventoryReasons | null {
  const q = useApiQuery<InventoryReasons>(REASONS_KEY, enabled ? "/api/inventory/reasons" : null, { staleTime: 5 * 60_000 });
  return q.data?.data ?? null;
}

/** Grid-def fields → filter-builder fields, filling Warehouse / Client / Damage Reason choices. */
export function useInventoryFilterFields(fields: readonly InventoryGridField[]): readonly FilterFieldDef[] {
  const me = useMe();
  const needsReasons = fields.some((f) => f.dynamicOptions === "damageReason");
  const reasons = useInventoryReasons(needsReasons);
  const options = me.data?.data.contextOptions;
  return React.useMemo(() => fields.map((f): FilterFieldDef => {
    let choices: readonly { value: string; label: string }[] | undefined;
    if (f.dynamicOptions === "warehouse") choices = (options?.warehouses ?? []).map((w) => ({ value: w.id, label: w.code && !w.name.startsWith(w.code) ? `${w.code} - ${w.name}` : w.name }));
    else if (f.dynamicOptions === "client") choices = (options?.clients ?? []).map((c) => ({ value: c.id, label: c.name }));
    else if (f.dynamicOptions === "damageReason") choices = (reasons?.damageReasons ?? []).map((r) => ({ value: r.name, label: r.name }));
    else if (f.options) choices = f.options.map((v) => ({ value: v, label: v }));
    return {
      field: f.field,
      label: f.label,
      type: f.type,
      ...(choices ? { options: choices } : {}),
      ...(f.allowEmpty ? { allowEmpty: true } : {}),
    };
  }), [fields, options, reasons]);
}

/* ---------------- status pill ---------------- */

const STATUS_TONE: Readonly<Record<string, { bg: string; fg: string }>> = {
  Stock: { bg: "#D3F0E3", fg: "#17874D" },
  Allocated: { bg: "#D5E5F2", fg: "#0D36A3" },
  Picked: { bg: "#D5E5F2", fg: "#0D36A3" },
  Sorted: { bg: "#D5E5F2", fg: "#0D36A3" },
  Packed: { bg: "#DFCEF5", fg: "#621DB8" },
  Loaded: { bg: "#DFCEF5", fg: "#621DB8" },
};

export function InventoryStatusPill({ status, className }: { readonly status: string; readonly className?: string }) {
  const tone = STATUS_TONE[status] ?? { bg: "#E3E6E8", fg: "#50575C" };
  return (
    <span data-status={status} style={{ backgroundColor: tone.bg, color: tone.fg }} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap", className)}>
      {status}
    </span>
  );
}

export function DamagePill({ reason }: { readonly reason: string | null }) {
  if (!reason) return <span className="text-faint">—</span>;
  return <span className="inline-flex items-center rounded-full bg-[#F7E9E4] px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap text-[#A13406]">{reason}</span>;
}

/* ---------------- product thumb ---------------- */

export function ProductThumb({ src, alt, size = 28 }: { readonly src: string | null | undefined; readonly alt: string; readonly size?: number }) {
  const [failed, setFailed] = React.useState(false);
  const box = { width: size, height: size };
  if (!src || failed) {
    return (
      <span style={box} className="inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-sunken text-faint" aria-hidden>
        <Package className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote catalog thumbnails of unknown origin
    <img src={src} alt={alt} width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={box} className="shrink-0 rounded-md border border-border object-cover" />
  );
}

/* ---------------- quantities ---------------- */

const nf = new Intl.NumberFormat("en-US");

export function Qty({ value, tone = "default", muteZero = true }: { readonly value: number | null | undefined; readonly tone?: "default" | "danger" | "warning" | "success"; readonly muteZero?: boolean }) {
  if (value === null || value === undefined) return <span className="text-faint">—</span>;
  const color = value < 0 ? "text-danger" : value === 0 && muteZero ? "text-faint" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-[#A13406]" : tone === "success" ? "text-success" : "text-body";
  return <span className={cn("block text-right tabular-nums", color)}>{nf.format(value)}</span>;
}

export const formatQty = (value: number): string => nf.format(value);

/** Header with a `?` tip — keeps tips consistent across the three grids. */
export function TipHeader({ label, tip }: { readonly label: string; readonly tip?: string }) {
  if (!tip) return <>{label}</>;
  return (
    <Tooltip content={tip}>
      <span className="cursor-help underline decoration-dotted decoration-faint underline-offset-4">{label}</span>
    </Tooltip>
  );
}

/** Open SO Qty cell: opens Orders filtered to exactly the open orders (new tab). */
export function OpenSoLink({ productId, warehouseId, sku, qty }: { readonly productId: string; readonly warehouseId: string | null; readonly sku: string; readonly qty: number }) {
  if (qty <= 0) return <Qty value={0} />;
  return (
    <span className="flex justify-end">
      <a
        href={openOrdersHref(productId, warehouseId)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Open orders for ${sku} (opens in a new tab)`}
        className="inline-flex items-center gap-1 font-medium tabular-nums text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {nf.format(qty)}
        <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
      </a>
    </span>
  );
}

/** Column width that fits an uppercase header label plus its `?` tip icon without overlap. */
export function headerWidth(label: string, min = 110, hasTip = false): number {
  return Math.max(min, Math.ceil(label.length * 7.8) + (hasTip ? 52 : 32));
}
