"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import Image from "next/image";
import { Coffee, Cpu, Package, Shirt } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

const THUMB_SIZE_PX = 28;

/** SKUs whose product-type segment is headwear (dad caps, headbands). */
const HEADWEAR_SKU_PATTERN = /-(CAP|BND)-/;
/** SKUs whose product-type segment is worn apparel (tees, hoodies, jackets, socks). */
const APPAREL_SKU_PATTERN = /-(TEE|HOOD|JKT|SOCK)-/;

const TILE_GLYPH_CLASS = "h-3.5 w-3.5";

/** Minimal dad-cap glyph (lucide has no cap icon): crown dome + curved brim,
 *  stroke-styled to sit next to lucide's Shirt at 14px. */
function CapGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 14a7 7 0 0 1 14 0" />
      <path d="M5 14h14" />
      <path d="M19 14c2 0 3.2 1.1 3.2 2.6" />
    </svg>
  );
}

/** Glyph mirrors the product type encoded in the SKU, so a cap row never
 *  shows a tee icon; category is the fallback when the SKU doesn't say.
 *  Returns a rendered element (not a component) so render stays static. */
function deriveTileGlyph(
  sku: string | undefined,
  category: string | undefined
): ReactElement {
  if (sku && HEADWEAR_SKU_PATTERN.test(sku)) return <CapGlyph className={TILE_GLYPH_CLASS} />;
  if (sku && APPAREL_SKU_PATTERN.test(sku)) return <Shirt className={TILE_GLYPH_CLASS} />;
  if (category === "Apparel") return <Shirt className={TILE_GLYPH_CLASS} />;
  if (category === "Coffee") return <Coffee className={TILE_GLYPH_CLASS} />;
  if (category === "Electronics") return <Cpu className={TILE_GLYPH_CLASS} />;
  return <Package className={TILE_GLYPH_CLASS} />;
}

/** Muted neutral thumbnail treatment (per design critique): the glyph carries
 *  the product type; the tile itself stays quiet so the IMAGE column never
 *  reads as a repeated accent stripe. Values match the slate ramp in
 *  docs/DESIGN_SPEC.md: bg slate-50, 1px slate-200 border, slate-400 icon. */
const TILE_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] text-[#94A3B8]";

/**
 * 28x28 product thumbnail (6px radius) when the product has an image;
 * otherwise a neutral placeholder whose glyph is mapped from the SKU's
 * product type (tee icon for *-TEE-*, cap icon for *-CAP-*, …).
 */
export function ImageTile({
  imageUrl,
  alt,
  sku,
  category,
}: {
  imageUrl?: string | null;
  alt?: string;
  sku?: string;
  category?: string;
}) {
  if (imageUrl) {
    return (
      <Image
        src={imageUrl}
        alt={alt ?? ""}
        width={THUMB_SIZE_PX}
        height={THUMB_SIZE_PX}
        unoptimized
        className="h-7 w-7 rounded-[6px] border border-border object-cover"
      />
    );
  }
  return (
    <span className={TILE_CLASS} aria-hidden>
      {deriveTileGlyph(sku, category)}
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

/** Available = on hand − allocated − damaged (see deriveAvailable).
 *  Emphasis comes from weight, not color:
 *  default text color at 600 so blue stays reserved for interactive SKU
 *  links; subtle danger text at or below zero. */
export function AvailableCell({ value }: { value: number }) {
  return (
    <div
      className={cn(
        "text-right tabular-nums font-semibold",
        value <= 0 ? "text-danger" : "text-foreground"
      )}
    >
      {formatNumber(value)}
    </div>
  );
}

/** Below-reorder signal: an amber "Low" pill (amber-100 bg / amber-800 text,
 *  11px/16px, fully rounded — the spec'd pair, which reads on the row hover
 *  tint in both themes) when available stock has fallen below the reorder
 *  point; a quiet em-dash otherwise. */
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
    <span className="inline-flex items-center rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-semibold leading-4 text-[#92400E] whitespace-nowrap">
      Low
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
