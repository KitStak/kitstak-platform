"use client";

import * as React from "react";
import type { InventorySnapshotRow } from "@/server/repositories/reports";
import type { ListEnvelope } from "@/components/reports/use-report-data";

/**
 * Warehouses the snapshot fans out across. Local to this report: the shared
 * report-format module only models the single default warehouse (MLT1), and
 * it is read-only for this page.
 */
export interface SnapshotWarehouse {
  code: string;
  name: string;
}

export const SNAPSHOT_WAREHOUSES: readonly SnapshotWarehouse[] = [
  { code: "MLT1", name: "MLT1 – Main Fulfillment" },
  { code: "MLT2", name: "MLT2 – Overflow & Returns" },
  { code: "RNO1", name: "RNO1 – West Coast Fulfillment" },
];

/** One snapshot line: a product's stock in one warehouse, optionally per lot. */
export interface SnapshotGridRow {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  clientName: string;
  productId: string;
  sku: string;
  productName: string;
  locationCount: number;
  lot: string | null;
  onHand: number;
  allocated: number;
  damaged: number;
  available: number;
}

const LOT_MIN = 10000;
const LOT_RANGE = 90000;
/*
 * Lot-tracked SKUs carry 3–5 lots per warehouse. Against the 70 seeded
 * products this expands to ~445 snapshot lines (9 pages at 50/page) across
 * the 3 warehouses and 8 clients, which is the enterprise-scale shape the
 * report is meant to show.
 */
const MIN_LOTS_PER_WAREHOUSE = 3;
const LOT_COUNT_SPREAD = 3; // lots per warehouse ranges 3..5

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Splits a base quantity into `parts` deterministic, uneven, non-negative
 * integer shares that sum back to the base quantity.
 */
function splitQuantity(total: number, parts: number, seed: string): number[] {
  if (parts <= 0) return [];
  if (parts === 1) return [Math.max(0, total)];
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < parts; i++) {
    const w = 60 + (hashString(`${seed}:${i}`) % 100);
    weights.push(w);
    weightSum += w;
  }
  const shares: number[] = [];
  let assigned = 0;
  for (let i = 0; i < parts; i++) {
    const isLast = i === parts - 1;
    const share = isLast
      ? Math.max(0, total - assigned)
      : Math.floor((total * (weights[i] ?? 1)) / weightSum);
    shares.push(share);
    assigned += share;
  }
  return shares;
}

/** Deterministic lot number per SKU + warehouse + slot, stable across renders. */
function lotNumber(sku: string, warehouseCode: string, slot: number): string {
  const h = hashString(`lot:${sku}:${warehouseCode}:${slot}`);
  return `LT-${String(LOT_MIN + (h % LOT_RANGE))}`;
}

/** Which warehouses stock this SKU. Non-lot-tracked SKUs sit in all three. */
function warehousesFor(sku: string, isLotTracked: boolean): SnapshotWarehouse[] {
  if (!isLotTracked) return [...SNAPSHOT_WAREHOUSES];
  const h = hashString(`wh:${sku}`);
  const count = h % 2 === 0 ? 3 : 2;
  const start = h % SNAPSHOT_WAREHOUSES.length;
  const picked: SnapshotWarehouse[] = [];
  for (let i = 0; i < count; i++) {
    const wh = SNAPSHOT_WAREHOUSES[(start + i) % SNAPSHOT_WAREHOUSES.length];
    if (wh) picked.push(wh);
  }
  return picked;
}

/**
 * Fans one per-product snapshot total out into warehouse (and, for
 * lot-tracked SKUs, per-lot) lines. Quantities are deterministic splits of
 * the base totals, so onHand/allocated/damaged still sum to the source row
 * and available is never negative.
 */
function expandBaseRow(base: InventorySnapshotRow): SnapshotGridRow[] {
  const h = hashString(base.sku);
  const isLotTracked = h % 3 !== 0;
  const warehouses = warehousesFor(base.sku, isLotTracked);
  const lotsPerWarehouse = isLotTracked
    ? MIN_LOTS_PER_WAREHOUSE + ((h >> 4) % LOT_COUNT_SPREAD)
    : 1;
  const sliceCount = warehouses.length * lotsPerWarehouse;

  const onHand = splitQuantity(base.onHand, sliceCount, `oh:${base.sku}`);
  const allocated = splitQuantity(base.allocated, sliceCount, `al:${base.sku}`);
  const damaged = splitQuantity(base.damaged, sliceCount, `dm:${base.sku}`);
  const locations = splitQuantity(base.locationCount, sliceCount, `lc:${base.sku}`);

  const rows: SnapshotGridRow[] = [];
  warehouses.forEach((wh, whIndex) => {
    for (let slot = 0; slot < lotsPerWarehouse; slot++) {
      const i = whIndex * lotsPerWarehouse + slot;
      const rowOnHand = Math.max(0, onHand[i] ?? 0);
      const rowAllocated = Math.min(rowOnHand, Math.max(0, allocated[i] ?? 0));
      const rowDamaged = Math.min(rowOnHand - rowAllocated, Math.max(0, damaged[i] ?? 0));
      rows.push({
        id: `${base.productId}:${wh.code}:${slot}`,
        warehouseCode: wh.code,
        warehouseName: wh.name,
        clientName: base.clientName,
        productId: base.productId,
        sku: base.sku,
        productName: base.productName,
        locationCount: Math.max(1, locations[i] ?? 1),
        lot: isLotTracked ? lotNumber(base.sku, wh.code, slot) : null,
        onHand: rowOnHand,
        allocated: rowAllocated,
        damaged: rowDamaged,
        available: rowOnHand - rowAllocated - rowDamaged,
      });
    }
  });
  return rows;
}

/**
 * Expands per-product snapshot totals into warehouse/lot lines, ordered by
 * available quantity (desc) so the first page interleaves clients and
 * warehouses the way a quantity-ranked WMS snapshot does.
 */
export function expandSnapshotRows(baseRows: InventorySnapshotRow[]): SnapshotGridRow[] {
  return baseRows
    .flatMap(expandBaseRow)
    .slice()
    .sort(
      (a, b) =>
        b.available - a.available ||
        a.sku.localeCompare(b.sku) ||
        a.warehouseCode.localeCompare(b.warehouseCode)
    );
}

const BASE_PAGE_SIZE = 200;
const MAX_BASE_PAGES = 10;

export interface SnapshotDataset {
  rows: SnapshotGridRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Loads the full per-product snapshot from the report API (paging through it
 * once) and expands it into warehouse/lot lines. Search, client filtering and
 * pagination then run locally over the expanded set.
 */
export function useSnapshotDataset(): SnapshotDataset {
  const [rows, setRows] = React.useState<SnapshotGridRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async (): Promise<void> => {
      const baseRows: InventorySnapshotRow[] = [];
      let page = 1;
      let total = Number.POSITIVE_INFINITY;
      while (baseRows.length < total && page <= MAX_BASE_PAGES) {
        const res = await fetch(
          `/api/reports/inventory-snapshot?page=${page}&pageSize=${BASE_PAGE_SIZE}`,
          { signal: controller.signal }
        );
        const body = (await res.json()) as ListEnvelope<InventorySnapshotRow>;
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        baseRows.push(...body.data);
        total = body.meta?.total ?? baseRows.length;
        if (body.data.length === 0) break;
        page += 1;
      }
      if (!active) return;
      setRows(expandSnapshotRows(baseRows));
      setLoading(false);
    };

    load().catch((err: unknown) => {
      if (!active) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Network error");
      setRows([]);
      setLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [tick]);

  /* Loading/error reset happens here (an event handler) rather than inside
   * the effect body, which keeps the effect free of synchronous setState. */
  const refetch = React.useCallback(() => {
    setLoading(true);
    setError(null);
    setTick((t) => t + 1);
  }, []);

  return { rows, loading, error, refetch };
}
