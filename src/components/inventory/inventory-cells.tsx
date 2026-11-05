"use client";

import Link from "next/link";
import { Package } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

/** Gray rounded image placeholder tile, matching Logiwa's product thumbnails. */
export function ImageTile() {
  return (
    <span
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-sunken text-faint"
      aria-hidden
    >
      <Package className="h-3.5 w-3.5" />
    </span>
  );
}

/** Blue SKU link into the product master, with a small kit marker. */
export function SkuLink({
  sku,
  productId,
  isKit,
}: {
  sku: string;
  productId?: string | null;
  isKit?: boolean;
}) {
  const label = productId ? (
    <Link
      href={`/products/${productId}`}
      onClick={(e) => e.stopPropagation()}
      className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm"
    >
      {sku}
    </Link>
  ) : (
    <span className="font-medium text-body">{sku}</span>
  );
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {isKit ? (
        <span className="rounded border border-border px-1 py-px text-[9px] font-bold uppercase tracking-wider text-faint">
          Kit
        </span>
      ) : null}
    </span>
  );
}

/** Small neutral pill for warehouse zones ("Zone A", "RECV", …). */
export function ZoneChip({ zone }: { zone: string }) {
  const label = /^[A-Z]$/.test(zone) ? `Zone ${zone}` : zone;
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-medium text-neutral whitespace-nowrap">
      {label}
    </span>
  );
}

/** Right-aligned tabular quantity cell. */
export function QtyCell({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-right tabular-nums",
        value === 0 ? "text-faint" : "text-body",
        className
      )}
    >
      {formatNumber(value)}
    </div>
  );
}

/** Available = on hand − allocated; subtle danger text at or below zero. */
export function AvailableCell({ value }: { value: number }) {
  return (
    <div
      className={cn(
        "text-right tabular-nums",
        value <= 0 ? "font-medium text-danger" : "text-body"
      )}
    >
      {formatNumber(value)}
    </div>
  );
}

/** Warning pill when available stock has fallen below the reorder point. */
export function ReorderStatus({
  available,
  reorderPoint,
}: {
  available: number;
  reorderPoint: number;
}) {
  if (available >= reorderPoint) {
    return <span className="text-[12px] text-faint">—</span>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning whitespace-nowrap">
      Reorder
    </span>
  );
}

/** Inbound PO units; shown as +N in green when something is on the way. */
export function IncomingCell({ value }: { value: number }) {
  if (value <= 0) {
    return <div className="text-right tabular-nums text-faint">0</div>;
  }
  return (
    <div className="text-right tabular-nums font-medium text-success">
      +{formatNumber(value)}
    </div>
  );
}
