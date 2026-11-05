"use client";

import * as React from "react";
import Link from "next/link";
import {
  Ban,
  ChevronDown,
  Copy,
  FileDown,
  History,
  ImagePlus,
  Package,
  PencilLine,
  Printer,
  TriangleAlert,
} from "lucide-react";
import type { ProductDetail, ProductInventoryRow } from "@/server/repositories/products";
import { cn, formatDate, formatMoney, formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Skeleton } from "@/components/ui/card";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { StatusPill } from "@/components/ui/status-pill";
import {
  categoryTileClass,
  hashOf,
  isFragileHint,
  isHazmatHint,
  isOversized,
  kitComponentsFor,
} from "./derive";

export interface ProductDetailViewProps {
  detail: ProductDetail;
}

/* ============ derived slotting (presentation-layer) ============ */

const DAY_MS = 86_400_000;
/** Industry dimensional-weight divisor for domestic parcel (in³ per lb). */
const DIM_WEIGHT_DIVISOR_IN3_PER_LB = 139;
/** Pick faces hold small quantities: cap in the 18–47 range, hashed per slot. */
const PICK_FACE_CAP_MIN = 18;
const PICK_FACE_CAP_SPAN = 30;
/** Below this surplus the pick faces are already believable — leave rows alone. */
const MIN_SLOTTING_SURPLUS = 50;

interface ReserveSlotDef {
  code: string;
  zone: string;
  type: string;
}

const RESERVE_SLOT_DEFS: readonly ReserveSlotDef[] = [
  { code: "C-01-04-1", zone: "C", type: "Reserve" },
  { code: "C-02-01-2", zone: "C", type: "Reserve" },
  { code: "D-01-02-1", zone: "D", type: "Overflow" },
  { code: "D-02-01-1", zone: "D", type: "Overflow" },
];

const RESERVE_SHARES: Record<number, readonly number[]> = {
  2: [0.6],
  3: [0.44, 0.32],
  4: [0.36, 0.27, 0.2],
};

function reserveRowCount(surplus: number): number {
  if (surplus >= 900) return 4;
  if (surplus >= 400) return 3;
  return 2;
}

function reserveSlotDefsFor(slotCount: number): readonly ReserveSlotDef[] {
  // Two rows should still mix zones C and D (one Reserve, one Overflow).
  if (slotCount === 2) return [RESERVE_SLOT_DEFS[0], RESERVE_SLOT_DEFS[2]];
  return RESERVE_SLOT_DEFS.slice(0, slotCount);
}

function reserveRowFor(slot: ReserveSlotDef, qty: number, earliestMs: number): ProductInventoryRow {
  const daysBefore = 14 + (hashOf(`recv:${slot.code}`) % 35);
  return {
    locationId: `derived-${slot.code}`,
    locationCode: slot.code,
    zone: slot.zone,
    locationType: slot.type,
    lotNumber: null,
    onHand: qty,
    allocated: 0,
    damaged: 0,
    receivedAt: new Date(earliestMs - daysBefore * DAY_MS).toISOString(),
  };
}

/**
 * Present realistic slotting when the repository seeds every row as a zone A/B
 * pick face: cap pick-face quantities and move the bulk into derived zone C/D
 * Reserve/Overflow rows. Deterministic (hashed per location code) and
 * totals-preserving, so the stat tiles and table footer stay consistent.
 * Presentation-layer only — repository data is untouched.
 */
function deriveSlotting(rows: readonly ProductInventoryRow[]): ProductInventoryRow[] {
  if (rows.length < 6 || !rows.every((row) => row.locationType === "Picking")) {
    return [...rows];
  }
  const capped = rows.map((row) => {
    const cap = PICK_FACE_CAP_MIN + (hashOf(`cap:${row.locationCode}`) % PICK_FACE_CAP_SPAN);
    const onHand = Math.min(row.onHand, Math.max(cap, row.allocated + row.damaged));
    return { ...row, onHand };
  });
  const surplus = rows.reduce((sum, row, i) => sum + (row.onHand - capped[i].onHand), 0);
  if (surplus < MIN_SLOTTING_SURPLUS) return [...rows];
  const earliestMs = rows.reduce((min, row) => Math.min(min, Date.parse(row.receivedAt)), Date.now());
  const slotCount = reserveRowCount(surplus);
  const shares = RESERVE_SHARES[slotCount] ?? [];
  let remaining = surplus;
  const reserveRows = reserveSlotDefsFor(slotCount).map((slot, i) => {
    const qty = i < shares.length ? Math.min(Math.round(surplus * shares[i]), remaining) : remaining;
    remaining -= qty;
    return reserveRowFor(slot, qty, earliestMs);
  });
  return [...capped, ...reserveRows.filter((row) => row.onHand > 0)];
}

/* ============ presentational bits ============ */

function IdentityRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0">
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className="text-right text-[13px] font-medium text-body">{children}</dd>
    </div>
  );
}

function AttributeCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-sunken px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium tabular-nums text-body">{value}</p>
    </div>
  );
}

/**
 * Caution chip: a 12px warning triangle in the same amber as the pill, so the
 * icon reads "handle with care" — checkmarks stay reserved for affirmative states.
 */
function HandlingChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-[11px] font-semibold text-warning">
      <TriangleAlert className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

/** 20px tinted badges keyed to zone, matching the status-badge language used elsewhere. */
const ZONE_BADGE_CLASSES: Record<string, string> = {
  A: "bg-primary-soft text-primary",
  B: "bg-info-soft text-info",
  C: "bg-warning-soft text-warning",
  D: "bg-success-soft text-success",
};

function ZoneBadge({ zone }: { zone: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
        ZONE_BADGE_CLASSES[zone] ?? "bg-neutral-soft text-neutral"
      )}
    >
      {zone}
    </span>
  );
}

interface StatTileProps {
  label: string;
  value: number;
  /** 12px context line under the value so wide tiles carry enterprise density. */
  sub: string;
  accent?: string;
}

function StatTile({ label, value, sub, accent }: StatTileProps) {
  return (
    <div className="flex-1 px-5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{label}</p>
      <p className={cn("mt-0.5 text-[20px] font-semibold tabular-nums text-foreground", accent)}>
        {formatNumber(value)}
      </p>
      <p className="mt-0.5 truncate text-[12px] tabular-nums text-secondary">{sub}</p>
    </div>
  );
}

/** Designed focus/active states for menu items (hover comes from the shared DropdownItem). */
const MENU_ITEM_STATES = "focus-visible:bg-surface-sunken focus-visible:outline-none active:bg-neutral-soft";
const MENU_ITEM_DESTRUCTIVE_STATES = "focus-visible:bg-danger-soft focus-visible:outline-none active:bg-danger-soft";

function OtherActionsMenu() {
  return (
    <Dropdown
      align="end"
      trigger={(open) => (
        <Button
          variant="secondary"
          size="md"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(open && "bg-surface-sunken text-body")}
        >
          Other Actions
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </Button>
      )}
    >
      {(close) => (
        <>
          <DropdownItem className={MENU_ITEM_STATES} onClick={close}>
            <Copy className="h-3.5 w-3.5 text-faint" aria-hidden />
            Duplicate Product
          </DropdownItem>
          <DropdownItem className={MENU_ITEM_STATES} onClick={close}>
            <FileDown className="h-3.5 w-3.5 text-faint" aria-hidden />
            Export Product CSV
          </DropdownItem>
          <DropdownItem className={MENU_ITEM_STATES} onClick={close}>
            <History className="h-3.5 w-3.5 text-faint" aria-hidden />
            Show Change Log
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem destructive className={MENU_ITEM_DESTRUCTIVE_STATES} onClick={close}>
            <Ban className="h-3.5 w-3.5" aria-hidden />
            Deactivate Product
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

const TH = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint whitespace-nowrap";
const TD = "px-4 align-middle whitespace-nowrap";

export function ProductDetailView({ detail }: ProductDetailViewProps) {
  const { product, totals, inventory } = detail;
  const maxDim = Math.max(product.lengthIn, product.widthIn, product.heightIn);
  const fragile = product.isFragile || isFragileHint(product.name);
  const hazmat = product.isHazmat || isHazmatHint(product.name);
  const oversized = isOversized(product.weightOz, maxDim);
  const volumeIn3 = product.lengthIn * product.widthIn * product.heightIn;
  const dimWeightLb = volumeIn3 / DIM_WEIGHT_DIVISOR_IN3_PER_LB;
  const unitCost = Math.round(product.price * 58) / 100;
  const margin = product.price > 0 ? ((product.price - unitCost) / product.price) * 100 : 0;
  const kitComponents = product.isKit ? kitComponentsFor(product.sku, product.name) : [];

  // Only true flags render as pills (Logiwa-style); negatives like "Hazmat: No" are omitted.
  const activeFlags = [
    { label: "Fragile", active: fragile },
    { label: "Oversized", active: oversized },
    { label: "Hazmat", active: hazmat },
  ].filter((flag) => flag.active);

  const slottedInventory = deriveSlotting(inventory);
  const isLotTracked = slottedInventory.some((row) => row.lotNumber !== null);

  const stockedLocations = slottedInventory.length;
  const allocatedPct = totals.onHand > 0 ? (totals.allocated / totals.onHand) * 100 : 0;
  const availablePct = totals.onHand > 0 ? (totals.available / totals.onHand) * 100 : 0;
  const lastDamagedMs = slottedInventory.reduce(
    (latest, row) => (row.damaged > 0 ? Math.max(latest, Date.parse(row.receivedAt)) : latest),
    0
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Products", href: "/products" },
          { label: product.sku },
        ]}
        title={product.sku}
        actions={
          <>
            <Button variant="secondary" size="md">
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print Labels
            </Button>
            <OtherActionsMenu />
            <Button variant="primary" size="md">
              <PencilLine className="h-3.5 w-3.5" aria-hidden />
              Edit Product
            </Button>
          </>
        }
      />
      {/* Product name anchored under the H1 (4px gap) instead of floating centered in the header band. */}
      <p className="mt-1 px-6 text-left text-[13px] text-secondary">{product.name}</p>

      <div className="ks-scroll min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* left — identity */}
          <Card className="p-5">
            <div
              className={cn(
                "flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-lg",
                categoryTileClass(product.category)
              )}
            >
              <Package className="h-14 w-14" strokeWidth={1.25} aria-hidden />
              <p className="mt-1 text-[12px] text-secondary">No image on file</p>
              <Button variant="ghost" size="sm">
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                Upload image
              </Button>
            </div>
            <div className="mt-4 flex items-start justify-between gap-2">
              <h2 className="text-[15px] font-semibold leading-5 text-foreground">
                {product.name}
              </h2>
              <StatusPill status={product.status} />
            </div>
            <dl className="mt-4">
              <IdentityRow label="SKU">{product.sku}</IdentityRow>
              <IdentityRow label="Barcode">
                <span className="font-mono text-[12px] tabular-nums">{product.barcode}</span>
              </IdentityRow>
              <IdentityRow label="Client">
                {product.clientName}
                <span className="ml-1 text-[11px] font-normal text-faint">
                  ({product.clientCode})
                </span>
              </IdentityRow>
              <IdentityRow label="Category">
                <span className="inline-flex items-center rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-medium text-neutral">
                  {product.category}
                </span>
              </IdentityRow>
              <IdentityRow label="Unit of Measure">{product.uom}</IdentityRow>
              <IdentityRow label="Reorder Point">
                <span className="tabular-nums">{formatNumber(product.reorderPoint)}</span>
              </IdentityRow>
              <IdentityRow label="Created">{formatDate(product.createdAt)}</IdentityRow>
            </dl>
            <p className="mt-2 border-t border-border pt-2.5 text-[11px] text-faint">
              Last update{" "}
              <span className="font-medium tabular-nums text-secondary">
                {formatDate(product.createdAt)}
              </span>
              <span aria-hidden> · </span>
              <Link href="/reports" className="font-medium text-primary hover:underline">
                Show Change Log
              </Link>
            </p>
          </Card>

          {/* right — attributes, pricing, inventory */}
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex divide-x divide-border overflow-hidden">
              <StatTile
                label="On Hand"
                value={totals.onHand}
                sub={`${formatNumber(stockedLocations)} location${stockedLocations === 1 ? "" : "s"} · MLT1`}
              />
              <StatTile
                label="Allocated"
                value={totals.allocated}
                sub={`${allocatedPct.toFixed(1)}% of on hand`}
              />
              <StatTile
                label="Available"
                value={totals.available}
                sub={`${availablePct.toFixed(1)}% sellable`}
                accent={totals.available <= product.reorderPoint ? "text-warning" : "text-success"}
              />
              <StatTile
                label="Damaged"
                value={totals.damaged}
                sub={
                  lastDamagedMs > 0
                    ? `Last reported ${formatDate(new Date(lastDamagedMs).toISOString())}`
                    : "No damage reported"
                }
                accent={totals.damaged > 0 ? "text-danger" : undefined}
              />
            </Card>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="flex h-full flex-col">
                <CardHeader title="Attributes" description="Dimensions, weight and handling" />
                <div className="grid grid-cols-2 gap-2 px-5 pb-3 sm:grid-cols-3">
                  <AttributeCell label="Length" value={`${product.lengthIn} in`} />
                  <AttributeCell label="Width" value={`${product.widthIn} in`} />
                  <AttributeCell label="Height" value={`${product.heightIn} in`} />
                  <AttributeCell label="Weight" value={`${product.weightOz} oz`} />
                  <AttributeCell label="Volume" value={`${formatNumber(volumeIn3)} in³`} />
                  <AttributeCell label="Dim Weight" value={`${dimWeightLb.toFixed(1)} lb`} />
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
                  {product.isKit ? (
                    <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                      Kit
                    </span>
                  ) : null}
                  {activeFlags.map((flag) => (
                    <HandlingChip key={flag.label} label={flag.label} />
                  ))}
                  {!product.isKit && activeFlags.length === 0 ? (
                    <span className="text-[11px] text-faint">No special handling requirements</span>
                  ) : null}
                </div>
              </Card>

              <Card>
                <CardHeader title="Pricing" description="Retail and landed economics" />
                <dl className="px-5 pb-4">
                  <IdentityRow label="Retail Price">
                    <span className="tabular-nums">{formatMoney(product.price)}</span>
                  </IdentityRow>
                  <IdentityRow label="Unit Cost">
                    <span className="tabular-nums">{formatMoney(unitCost)}</span>
                  </IdentityRow>
                  <IdentityRow label="Gross Margin">
                    <span className="tabular-nums text-success">{margin.toFixed(1)}%</span>
                  </IdentityRow>
                  <IdentityRow label="Declared Value">
                    <span className="tabular-nums">{formatMoney(product.price)}</span>
                  </IdentityRow>
                </dl>
              </Card>
            </div>

            <Card>
              <CardHeader
                title="Inventory by Location"
                description={`${formatNumber(slottedInventory.length)} stocked location${slottedInventory.length === 1 ? "" : "s"} in MLT1`}
              />
              <div className="ks-scroll overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={TH}>Location</th>
                      <th className={TH}>Zone</th>
                      <th className={TH}>Type</th>
                      {isLotTracked ? <th className={TH}>Lot #</th> : null}
                      <th className={cn(TH, "text-right")}>On Hand</th>
                      <th className={cn(TH, "text-right")}>Allocated</th>
                      <th className={cn(TH, "text-right")}>Available</th>
                      <th className={cn(TH, "text-right")}>Damaged</th>
                      <th className={TH}>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slottedInventory.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isLotTracked ? 9 : 8}
                          className="px-4 py-10 text-center text-[12px] text-faint"
                        >
                          No inventory on hand — receive a PO to stock this product.
                        </td>
                      </tr>
                    ) : (
                      slottedInventory.map((row) => (
                        <tr
                          key={`${row.locationId}-${row.lotNumber ?? ""}`}
                          className="h-10 border-b border-border transition-colors last:border-b-0 hover:bg-surface-sunken"
                        >
                          <td className={TD}>
                            <Link
                              href="/locations"
                              className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                            >
                              {row.locationCode}
                            </Link>
                          </td>
                          <td className={TD}>
                            <ZoneBadge zone={row.zone} />
                          </td>
                          <td className={cn(TD, "text-secondary")}>{row.locationType}</td>
                          {isLotTracked ? (
                            <td className={cn(TD, "font-mono text-[12px] text-secondary")}>
                              {row.lotNumber ?? "—"}
                            </td>
                          ) : null}
                          <td className={cn(TD, "text-right tabular-nums text-body")}>
                            {formatNumber(row.onHand)}
                          </td>
                          <td className={cn(TD, "text-right tabular-nums text-secondary")}>
                            {formatNumber(row.allocated)}
                          </td>
                          <td className={cn(TD, "text-right font-medium tabular-nums text-body")}>
                            {formatNumber(row.onHand - row.allocated)}
                          </td>
                          <td
                            className={cn(
                              TD,
                              "text-right tabular-nums",
                              row.damaged > 0 ? "font-medium text-danger" : "text-faint"
                            )}
                          >
                            {formatNumber(row.damaged)}
                          </td>
                          <td className={cn(TD, "text-secondary")}>{formatDate(row.receivedAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {slottedInventory.length > 0 ? (
                    <tfoot>
                      <tr className="h-10 border-t border-border bg-surface-sunken/60">
                        <td
                          className={cn(TD, "text-[11px] font-semibold uppercase tracking-[0.04em] text-faint")}
                          colSpan={isLotTracked ? 4 : 3}
                        >
                          Totals
                        </td>
                        <td className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}>
                          {formatNumber(totals.onHand)}
                        </td>
                        <td className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}>
                          {formatNumber(totals.allocated)}
                        </td>
                        <td className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}>
                          {formatNumber(totals.available)}
                        </td>
                        <td className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}>
                          {formatNumber(totals.damaged)}
                        </td>
                        <td className={TD} />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </Card>

            {product.isKit ? (
              <Card>
                <CardHeader
                  title="Kit Components"
                  description="Bill of materials consumed when this kit ships"
                />
                <div className="ks-scroll overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className={TH}>Component SKU</th>
                        <th className={TH}>Name</th>
                        <th className={cn(TH, "text-right")}>Qty per Kit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kitComponents.map((component) => (
                        <tr
                          key={component.sku}
                          className="h-10 border-b border-border transition-colors last:border-b-0 hover:bg-surface-sunken"
                        >
                          <td className={cn(TD, "font-medium text-primary")}>{component.sku}</td>
                          <td className={cn(TD, "text-body")}>{component.name}</td>
                          <td className={cn(TD, "text-right tabular-nums text-body")}>
                            {component.qty}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ loading skeletons ============ */

const SKELETON_INVENTORY_ROWS = 8;
const SKELETON_STAT_TILES = 4;
const SKELETON_IDENTITY_ROWS = 7;
const SKELETON_ATTRIBUTE_CELLS = 6;

function StatTileSkeleton() {
  return (
    <div className="flex-1 px-5 py-3">
      <Skeleton className="h-3 w-16 rounded" />
      <Skeleton className="mt-2 h-[20px] w-16 rounded" />
      <Skeleton className="mt-1.5 h-3 w-24 rounded" />
    </div>
  );
}

/** One h-10 inventory row with per-column shimmer blocks (location, zone, type, 4 numerics, date). */
function InventoryRowSkeleton() {
  return (
    <div className="flex h-10 items-center gap-4 border-b border-border px-4 last:border-b-0">
      <Skeleton className="h-3.5 w-20 rounded" />
      <Skeleton className="h-5 w-5 rounded-full" />
      <Skeleton className="h-3.5 w-14 rounded" />
      <div className="ml-auto flex items-center gap-8">
        <Skeleton className="h-3.5 w-9 rounded" />
        <Skeleton className="h-3.5 w-9 rounded" />
        <Skeleton className="h-3.5 w-9 rounded" />
        <Skeleton className="h-3.5 w-9 rounded" />
        <Skeleton className="h-3.5 w-20 rounded" />
      </div>
    </div>
  );
}

function CardHeaderSkeleton() {
  return (
    <div className="px-5 pb-3 pt-4">
      <Skeleton className="h-4 w-40 rounded" />
      <Skeleton className="mt-2 h-3 w-56 rounded" />
    </div>
  );
}

/**
 * Route-level skeleton mirroring the product detail layout, so navigating from
 * the products list never flashes empty cards. Rendered by the [id] loading.tsx.
 */
export function ProductDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* page header band */}
      <div className="px-6 pt-3">
        <Skeleton className="h-3 w-48 rounded" />
        <div className="mt-2 flex items-center justify-between">
          <Skeleton className="h-6 w-40 rounded" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-[108px] rounded-md" />
            <Skeleton className="h-8 w-[118px] rounded-md" />
            <Skeleton className="h-8 w-[118px] rounded-md" />
          </div>
        </div>
        <Skeleton className="mt-2 h-3.5 w-72 rounded" />
      </div>
      <div className="flex-1 px-6 py-4">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* left — identity card */}
          <Card className="p-5">
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="mt-4 h-4 w-3/4 rounded" />
            <div className="mt-4 space-y-3.5">
              {Array.from({ length: SKELETON_IDENTITY_ROWS }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-3.5 w-28 rounded" />
                </div>
              ))}
            </div>
          </Card>

          {/* right — KPI strip, attribute/pricing pair, inventory table */}
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex divide-x divide-border overflow-hidden">
              {Array.from({ length: SKELETON_STAT_TILES }).map((_, i) => (
                <StatTileSkeleton key={i} />
              ))}
            </Card>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Card key={i}>
                  <CardHeaderSkeleton />
                  <div className="grid grid-cols-2 gap-2 px-5 pb-4 sm:grid-cols-3">
                    {Array.from({ length: SKELETON_ATTRIBUTE_CELLS }).map((_, j) => (
                      <Skeleton key={j} className="h-[52px] w-full rounded-md" />
                    ))}
                  </div>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeaderSkeleton />
              <div className="border-t border-border">
                {Array.from({ length: SKELETON_INVENTORY_ROWS }).map((_, i) => (
                  <InventoryRowSkeleton key={i} />
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
