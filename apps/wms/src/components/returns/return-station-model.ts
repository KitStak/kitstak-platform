/**
 * Return Station capture model (PURE, unit tested). Items being received, scan
 * application (increment the matching line, block over-receiving), validation and the
 * `/api/returns/receive` and `/api/returns/manual` item payloads.
 */
import type { RETURN_DISPOSITIONS } from "@/lib/enums";
import type { ReturnRules } from "@/lib/grid-defs/admin/return-rules";
import type { ShippedAttributes } from "./return-types";

export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

export interface CaptureItem {
  readonly key: string;
  readonly returnOrderLineId: string | null;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly scanCodes: readonly string[];
  /** Units still expected on the RMA line (null for manual returns: no cap). */
  readonly remaining: number | null;
  readonly quantity: number;
  readonly disposition: ReturnDisposition;
  readonly damageReasonId: string | null;
  readonly actualReturnReasonId: string | null;
  readonly note: string;
  /** Tracking of the SKU: lot / expiry / production date / serial capture rows show when set. */
  readonly trackLot?: boolean;
  readonly trackExpiry?: boolean;
  readonly trackProductionDate?: boolean;
  readonly trackSerial?: boolean;
  readonly lotNumber?: string;
  readonly expiryDate?: string;
  readonly productionDate?: string;
  /** Serials scanned for this item, one per unit. */
  readonly serials?: readonly string[];
  /** What shipped on the order for this SKU (choices + the Return Process match). */
  readonly shipped?: ShippedAttributes | null;
}

export type ItemErrorField = "quantity" | "damageReasonId" | "lotNumber" | "expiryDate" | "productionDate" | "serials" | "disposition" | "packType" | "productId";
export type ItemErrors = Readonly<Record<string, Partial<Record<ItemErrorField, string>>>>;

export interface RmaLineInput {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly requestedQty: number;
  readonly returnedQty: number;
  readonly customerReturnReasonId?: string | null;
  readonly trackLot?: boolean;
  readonly trackExpiry?: boolean;
  readonly trackProductionDate?: boolean;
  readonly trackSerial?: boolean;
  readonly shipped?: ShippedAttributes | null;
}

/** Tracking + shipped fields copied onto a capture row. */
function trackingOf(l: { readonly trackLot?: boolean; readonly trackExpiry?: boolean; readonly trackProductionDate?: boolean; readonly trackSerial?: boolean; readonly shipped?: ShippedAttributes | null }) {
  const shipped = l.shipped ?? null;
  return {
    trackLot: Boolean(l.trackLot), trackExpiry: Boolean(l.trackExpiry), trackProductionDate: Boolean(l.trackProductionDate), trackSerial: Boolean(l.trackSerial),
    // A single shipped lot / date is prefilled; the operator confirms it against the unit.
    lotNumber: shipped?.lots.length === 1 ? shipped.lots[0] : "", expiryDate: shipped?.expiryDates.length === 1 ? shipped.expiryDates[0] : "",
    productionDate: shipped?.productionDates.length === 1 ? shipped.productionDates[0] : "", serials: [] as string[], shipped,
  };
}

/** Capture rows for the open lines of an RMA (quantity starts at 0 until scanned). */
export function itemsFromRma(lines: readonly RmaLineInput[]): CaptureItem[] {
  return lines.filter((l) => l.requestedQty - l.returnedQty > 0).map((l) => ({
    key: l.id, returnOrderLineId: l.id, productId: l.productId, sku: l.sku, name: l.name, imageUrl: l.imageUrl,
    scanCodes: [l.sku.toLowerCase()], remaining: l.requestedQty - l.returnedQty, quantity: 0, disposition: "Restock",
    damageReasonId: null, actualReturnReasonId: null, note: "", ...trackingOf(l),
  }));
}

export type ScanOutcome =
  | { readonly ok: true; readonly items: CaptureItem[]; readonly key: string; readonly sku: string }
  | { readonly ok: false; readonly error: string };

/** Applies a product scan to RMA rows: +1 on the first matching row with room left. */
export function applyScan(items: readonly CaptureItem[], code: string): ScanOutcome {
  const lc = code.trim().toLowerCase();
  if (!lc) return { ok: false, error: "Scan or enter a product barcode" };
  const matches = items.filter((i) => i.scanCodes.includes(lc) || i.sku.toLowerCase() === lc);
  if (matches.length === 0) return { ok: false, error: `${code} is not on this return.` };
  const target = matches.find((i) => i.remaining === null || i.quantity < i.remaining);
  if (!target) return { ok: false, error: `${matches[0]?.sku ?? code}: all expected units are already scanned.` };
  return { ok: true, key: target.key, sku: target.sku, items: items.map((i) => (i.key === target.key ? { ...i, quantity: i.quantity + 1 } : i)) };
}

/** Adds a scanned product to a manual return (merges into an existing Restock row of the same product). */
export function addManualProduct(items: readonly CaptureItem[], p: { readonly id: string; readonly sku: string; readonly name: string; readonly imageUrl: string | null; readonly trackLot?: boolean; readonly trackExpiry?: boolean; readonly trackProductionDate?: boolean; readonly trackSerial?: boolean }, code: string): { items: CaptureItem[]; key: string } {
  const existing = items.find((i) => i.productId === p.id);
  if (existing) return { key: existing.key, items: items.map((i) => (i.key === existing.key ? { ...i, quantity: i.quantity + 1 } : i)) };
  const key = `m-${p.id}`;
  return {
    key,
    items: [...items, {
      key, returnOrderLineId: null, productId: p.id, sku: p.sku, name: p.name, imageUrl: p.imageUrl,
      scanCodes: [...new Set([p.sku.toLowerCase(), code.trim().toLowerCase()])], remaining: null, quantity: 1,
      disposition: "Restock", damageReasonId: null, actualReturnReasonId: null, note: "", ...trackingOf(p),
    }],
  };
}

export function updateItem(items: readonly CaptureItem[], key: string, patch: Partial<CaptureItem>): CaptureItem[] {
  return items.map((i) => (i.key === key ? { ...i, ...patch } : i));
}

/** Splits a pasted / scanned serial list ("SN1, SN2\nSN3") into trimmed, unique values. */
export function parseSerials(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
}

/**
 * Client-side mirror of the server checks. With `rules` (Return Process) it also requires the lot /
 * expiry / production date of a tracked SKU when its match rule is on and the order shipped one,
 * and flags a value that did not ship. Serials, when scanned, must be one per unit and have shipped.
 */
export function validateItems(items: readonly CaptureItem[], rules?: ReturnRules | null): { readonly errors: ItemErrors; readonly message: string | null } {
  const errors: Record<string, Partial<Record<ItemErrorField, string>>> = {};
  const set = (key: string, field: ItemErrorField, msg: string) => { errors[key] = { ...errors[key], [field]: msg }; };
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const i of items) {
    if (i.quantity < 0 || !Number.isInteger(i.quantity)) set(i.key, "quantity", "Enter a whole number");
    else if (i.remaining !== null && i.quantity > i.remaining) set(i.key, "quantity", `Max ${i.remaining} left to receive`);
    if (i.quantity <= 0) continue;
    if (i.disposition === "Damaged" && !i.damageReasonId) set(i.key, "damageReasonId", "Choose a damage reason");
    const sh = i.shipped;
    const attr = (on: boolean | undefined, tracked: boolean | undefined, value: string | undefined, shippedValues: readonly string[] | undefined, field: ItemErrorField, label: string) => {
      if (!rules || !on || !tracked || !shippedValues?.length) return;
      const v = (value ?? "").trim();
      if (!v) set(i.key, field, `Enter the ${label} (Return Process: ${label} match)`);
      else if (!shippedValues.some((x) => same(x, v))) set(i.key, field, `${v} was not shipped on the order`);
    };
    attr(rules?.lotNumberMatch, i.trackLot, i.lotNumber, sh?.lots, "lotNumber", "lot number");
    attr(rules?.expiryDateMatch, i.trackExpiry, i.expiryDate, sh?.expiryDates, "expiryDate", "expiry date");
    attr(rules?.productionDateMatch, i.trackProductionDate, i.productionDate, sh?.productionDates, "productionDate", "production date");
    const serials = i.serials ?? [];
    if (i.trackSerial && serials.length > 0 && serials.length !== i.quantity) set(i.key, "serials", `Scan ${i.quantity} serial${i.quantity === 1 ? "" : "s"} (one per unit); ${serials.length} entered`);
    else if (rules?.serialNumberMatch && serials.length && sh?.serials.length) {
      const unknown = serials.filter((x) => !sh.serials.some((y) => same(x, y)));
      if (unknown.length) set(i.key, "serials", `${unknown.slice(0, 3).join(", ")} ${unknown.length === 1 ? "was" : "were"} not shipped on the order`);
    }
  }
  const receiving = items.filter((i) => i.quantity > 0);
  const message = receiving.length === 0 ? "Scan at least one item" : Object.keys(errors).length ? "Fix the highlighted items" : null;
  return { errors, message };
}

export interface ReceiveItemPayload {
  readonly returnOrderLineId?: string | null;
  readonly productId: string;
  readonly quantity: number;
  readonly disposition: ReturnDisposition;
  readonly damageReasonId: string | null;
  readonly actualReturnReasonId: string | null;
  readonly note: string | null;
  readonly lotNumber?: string | null;
  readonly expiryDate?: string | null;
  readonly productionDate?: string | null;
  readonly serials?: readonly string[];
}

export function itemsPayload(items: readonly CaptureItem[], withLine: boolean): ReceiveItemPayload[] {
  return items.filter((i) => i.quantity > 0).map((i) => ({
    ...(withLine ? { returnOrderLineId: i.returnOrderLineId } : {}),
    productId: i.productId, quantity: i.quantity, disposition: i.disposition,
    damageReasonId: i.disposition === "Damaged" ? i.damageReasonId : null, actualReturnReasonId: i.actualReturnReasonId, note: i.note.trim() || null,
    ...(i.lotNumber?.trim() ? { lotNumber: i.lotNumber.trim() } : {}),
    ...(i.expiryDate?.trim() ? { expiryDate: i.expiryDate.trim() } : {}),
    ...(i.productionDate?.trim() ? { productionDate: i.productionDate.trim() } : {}),
    ...(i.serials?.length ? { serials: [...i.serials] } : {}),
  }));
}

/** Units the RMA still expects after this receive: > 0 means Complete closes the rest as short. */
export function shortAfterReceive(items: readonly CaptureItem[]): { readonly total: number; readonly lines: readonly { readonly sku: string; readonly short: number }[] } {
  const lines = items.filter((i) => i.remaining !== null).map((i) => ({ sku: i.sku, short: Math.max(0, (i.remaining ?? 0) - i.quantity) })).filter((l) => l.short > 0);
  return { total: lines.reduce((s, l) => s + l.short, 0), lines };
}

export function totals(items: readonly CaptureItem[]): { readonly scanned: number; readonly expected: number | null } {
  const scanned = items.reduce((s, i) => s + i.quantity, 0);
  const expected = items.every((i) => i.remaining !== null) ? items.reduce((s, i) => s + (i.remaining ?? 0), 0) : null;
  return { scanned, expected };
}

/** Where a disposition puts the stock (shown under the disposition picker). */
export function dispositionHint(d: ReturnDisposition, targetCode: string | null, stationCode: string | null): string {
  switch (d) {
    case "Restock": return `Received as sellable stock into ${targetCode ?? stationCode ?? "the target"}.`;
    case "Damaged": return `Received as damaged stock into ${targetCode ?? stationCode ?? "the target"} (not allocatable).`;
    case "Quarantine": return `Held at the station ${stationCode ?? ""} for inspection.`.replace("  ", " ");
    case "Dispose": return "Received, then written off with an inventory adjustment.";
  }
}

/**
 * Why the Return Station start cards are disabled. Missing inputs come first; the
 * permission message only shows once permissions have loaded and the user really lacks
 * inventory.return_station.receive_return (admins never see it).
 */
export function stationStartReason(s: { readonly permLoading: boolean; readonly canReceive: boolean; readonly warehouseId: string | null; readonly stationId: string | null; readonly stationsLoading: boolean; readonly lockReason?: string | null }): string | null {
  if (!s.warehouseId) return "Choose a receiving warehouse and return station";
  if (!s.stationId) return s.stationsLoading ? "Loading return stations…" : "Choose a return station";
  if (s.lockReason) return s.lockReason;
  if (s.permLoading) return "Checking your permissions…";
  if (!s.canReceive) return "You need the Return Station › Receive Return permission to receive returns";
  return null;
}

/** Default pick when nothing is remembered: the remembered/context id if valid, else the first option (Logiwa preselects). */
export function defaultPick<T extends { readonly id: string }>(options: readonly T[], ...preferred: readonly (string | null | undefined)[]): T | null {
  for (const id of preferred) {
    const hit = id ? options.find((o) => o.id === id) : undefined;
    if (hit) return hit;
  }
  return options[0] ?? null;
}

/**
 * Return station pick: the remembered station unless it is count-locked, else the first unlocked
 * station; only when every station is locked is a locked one returned (Start then shows the lock).
 */
export function pickStation<T extends { readonly id: string; readonly countLockPlan?: string | null }>(options: readonly T[], remembered: string | null | undefined): T | null {
  const open = options.filter((o) => !o.countLockPlan);
  return defaultPick(open, remembered) ?? defaultPick(options, remembered);
}
