"use client";

/**
 * Shared pieces of the inventory pages: filter fields with runtime options (scope +
 * damage reasons), the reasons query, the inventory status pill, product thumbnails
 * and quantity cells.
 */
import * as React from "react";
import { ExternalLink, Package } from "lucide-react";
import { byLocationFilters, openOrdersHref, openPurchaseOrdersLinkHref, productFilters } from "./inventory-links";
import { filteredListHref } from "@/components/grid/cells";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/lib/query-client";
import { useMe } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";
import { pillStyle } from "@/lib/status-colors";
import { Tooltip } from "@/components/ui/tooltip";
import type { FilterFieldDef } from "@/components/grid";
import type { InventoryGridField } from "@/lib/grid-defs/inventory/fields";
import type { ReasonDirection } from "@/lib/grid-defs/inventory/reason-direction";

export interface ReasonOption {
  readonly id: string;
  readonly name: string;
  /** Adjustment reasons: increase / decrease / both (reason-direction.ts). */
  readonly direction?: ReasonDirection;
}

export interface InventoryReasons {
  readonly adjustmentReasons: readonly ReasonOption[];
  readonly damageReasons: readonly ReasonOption[];
  readonly mandatoryReason: Readonly<Record<string, boolean>>;
}

/**
 * Refresh the inventory grids in the background after a save. Passing `invalidate` to
 * useApiMutation awaits the refetch before onSuccess runs, which kept drawers open for
 * the full grid reload under load. Drawers close (and toast) as soon as the POST resolves.
 */
export function useInventoryRefresh(): () => void {
  const qc = useQueryClient();
  return React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["grid"] });
    void qc.invalidateQueries({ queryKey: ["inventory"] });
  }, [qc]);
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
    <span data-status={status} style={pillStyle(tone)} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap", className)}>
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

/**
 * SKU cell link to Products (new tab). The text truncates before the icon, so a long SKU reads
 * "APX-PKG-POLY-10… ↗" and the external-link icon always stays visible; full SKU in the title.
 */
export function SkuLink({ sku, clientId }: { readonly sku: string; readonly clientId: string | null }) {
  return (
    <a
      href={filteredListHref("/products", productFilters(sku, clientId))}
      target="_blank"
      rel="noopener noreferrer"
      title={sku}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Product ${sku} (opens in a new tab)`}
      className="flex min-w-0 max-w-full items-center gap-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span className="min-w-0 truncate">{sku}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
    </a>
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
        aria-label={`${nf.format(qty)} open orders for ${sku} (opens in a new tab)`}
        className="inline-flex items-center gap-1 font-medium tabular-nums text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {nf.format(qty)}
        <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
      </a>
    </span>
  );
}

/** Open PO Qty cell: opens Purchase Orders filtered to exactly the open POs (new tab). */
export function OpenPoLink({ productId, warehouseId, sku, qty }: { readonly productId: string; readonly warehouseId: string | null; readonly sku: string; readonly qty: number }) {
  if (qty <= 0) return <Qty value={0} />;
  return (
    <span className="flex justify-end">
      <a
        href={openPurchaseOrdersLinkHref(productId, warehouseId)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={`${nf.format(qty)} on open purchase orders for ${sku} (opens in a new tab)`}
        className="inline-flex items-center gap-1 font-medium tabular-nums text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {nf.format(qty)}
        <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
      </a>
    </span>
  );
}

/** Column width that fits an uppercase header label plus its `?` tip icon without overlap. */
/**
 * Column width that fits the whole uppercase, letter-spaced header (≈8.6 px a character at 11 px
 * semibold) plus cell padding, the sort arrow and, when present, the (i) tip, so headers such as
 * "UOM QUANTITY (i)" or "ALLOCATED UOM QTY" are never cut to an ellipsis at their default width.
 */
export function headerWidth(label: string, min = 110, hasTip = false): number {
  return Math.max(min, Math.ceil(label.length * 8.6) + (hasTip ? 64 : 40));
}

/**
 * Column meta for a right-aligned quantity header. The shared header reverses right-aligned
 * content, which put the (i) tip on the label's left, visually attached to the previous column;
 * `flex-row` keeps it right after the label ("CURRENT ATP (i)").
 */
export function rightMeta(label: string, headerTip?: string): { label: string; align: "right"; headerTip?: string; headerClassName?: string } {
  return headerTip ? { label, align: "right", headerTip, headerClassName: "flex-row" } : { label, align: "right" };
}

/** Total Inventory drilldown: By Location filtered to this SKU (same tab, like Logiwa's SKU link). */
export function ByLocationLink({ sku, warehouseId, count }: { readonly sku: string; readonly warehouseId: string | null; readonly count?: number }) {
  if (count === 0) return <span className="text-[12px] text-faint">No stock</span>;
  const label = count === undefined ? "Locations" : `${count} location${count === 1 ? "" : "s"}`;
  return (
    <a
      href={filteredListHref("/inventory/by-location", byLocationFilters(sku, warehouseId))}
      onClick={(e) => e.stopPropagation()}
      aria-label={`${label} for ${sku} by location`}
      className="inline-flex items-center gap-1 text-[12px] font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      {label}
    </a>
  );
}

/** Neutral (info-blue) focus ring for free-text notes, so a focused Note never reads as an error; red stays for validation. */
export const NOTE_FOCUS =
  "focus-visible:border-info focus-visible:ring-info/25 focus-within:border-info focus-within:ring-info/25 aria-[invalid=true]:focus-visible:border-danger";

/**
 * "Shortage" quick filter: toggles `field ≤ -1` (open demand exceeds stock). It writes an ordinary
 * range filter, so the chip, Clear, saved views and export all treat it like any other filter.
 */
export function ShortageToggle({ grid, field, label = "Shortage" }: {
  readonly grid: { readonly query: { readonly filters: readonly { readonly field: string; readonly op: string; readonly max?: string }[] }; readonly upsertFilter: (f: { field: string; op: "rng"; max: string }) => void; readonly removeFilter: (field: string) => void };
  readonly field: string;
  readonly label?: string;
}) {
  const active = grid.query.filters.some((f) => f.field === field && f.op === "rng" && f.max === "-1");
  return (
    <Tooltip content={active ? "Show every row" : `Only rows where ${label === "Shortage" ? "the value" : label} is below 0`}>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => (active ? grid.removeFilter(field) : grid.upsertFilter({ field, op: "rng", max: "-1" }))}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
          active ? "border-danger/40 bg-danger/10 text-danger" : "border-border bg-surface text-body hover:bg-muted",
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", active ? "bg-danger" : "bg-danger/50")} aria-hidden />
        Shortage
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------ stalled-grid notice */

/** After this long on skeleton rows, a CSS-only "still loading" notice appears (works before hydration). */
export const GRID_SLOW_MS = 12_000;
/** After this long (hydrated), the notice turns into an error with Retry, whatever stage hung. */
export const GRID_STALL_MS = 30_000;

/** "slow" from GRID_SLOW_MS, "stalled" from GRID_STALL_MS while the grid is still loading. */
export function gridStallPhase(loading: boolean, elapsedMs: number): "ok" | "slow" | "stalled" {
  if (!loading) return "ok";
  if (elapsedMs >= GRID_STALL_MS) return "stalled";
  return elapsedMs >= GRID_SLOW_MS ? "slow" : "ok";
}

const STALL_KEYFRAMES = "@keyframes ks-inv-stall-reveal{from{opacity:0;visibility:hidden}to{opacity:1;visibility:visible}}";

/**
 * Shown above an inventory grid while its first page is loading. Two layers, so no stage can
 * leave a buyer on skeleton rows with no explanation:
 *   - server-rendered markup revealed by a CSS animation after 12 s, with a plain Reload link.
 *     It needs no JavaScript, so it also covers a page whose client bundle never arrived (the
 *     grid then never sends its request and the list timeout cannot arm);
 *   - after hydration, a 30 s timer that turns it into an alert with Retry (refetches the list)
 *     and Reload, whether /api/me, the scope context or the list itself is the stage that hung.
 * The list request also has its own 30 s timeout (useGrid), which shows the grid's error state.
 */
export function GridStallNotice({ loading, onRetry, noun = "inventory" }: { readonly loading: boolean; readonly onRetry: () => void; readonly noun?: string }) {
  const [started, setStarted] = React.useState(() => Date.now());
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!loading) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [loading]);
  if (!loading) return null;
  const phase = now === null ? "ok" : gridStallPhase(loading, now - started);
  const stalled = phase === "stalled";
  const linkCls = "shrink-0 rounded border border-current px-2 py-0.5 text-xs font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40";
  return (
    <div className="px-4 pb-2" data-testid="grid-stall-notice" data-phase={phase}>
      <style>{STALL_KEYFRAMES}</style>
      <div
        role={stalled ? "alert" : "status"}
        style={phase === "ok" ? { opacity: 0, visibility: "hidden", animation: `ks-inv-stall-reveal 200ms ease-out ${GRID_SLOW_MS}ms forwards` } : undefined}
        className={cn(
          "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
          stalled ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-foreground",
        )}
      >
        <span>
          {stalled
            ? `The server hasn't returned ${noun} in ${GRID_STALL_MS / 1000} seconds. It may be busy or unreachable.`
            : `Still loading ${noun}. This is taking longer than usual.`}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {stalled ? <button type="button" onClick={() => { setStarted(Date.now()); onRetry(); }} className={linkCls}>Retry</button> : null}
          {/* A plain link: reloads the same URL (filters included) even before the page hydrates. */}
          <a href="" className={linkCls}>Reload page</a>
        </span>
      </div>
    </div>
  );
}
