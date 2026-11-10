/**
 * Receiving against purchase orders (M05). Receipts post through `ledger.recordReceipt`
 * (inventory + receipt row + line received qty); this module validates the request
 * (tracking flags, screen config, over-receipt, location/LP) and then settles the PO
 * status: Started while lines are open, Completed (stamps Actual Receiving + Completed)
 * once every line is fully received.
 */
import { and, eq, sql } from "drizzle-orm";
import { trackingIssues, type ReceiveBodyValues, type ReceiveLineValues } from "@/lib/grid-defs/receiving/po-schemas";
import type { PoStatus } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import { assertInScope, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, putaway, sequences, stateMachines, type DomainCtx } from "@/server/domain";
import { assertVersion } from "./platform-common";
import { productInfo, receivingRequirements } from "./purchase-orders";

const po = schema.purchaseOrders;
const line = schema.purchaseOrderLines;
type PoRow = typeof po.$inferSelect;
type LineRow = typeof line.$inferSelect;

export const RECEIVED_SUCCESS_MESSAGE = "You have successfully received orders.";

function loadOpenPo(tx: AppDb, scope: Scope, id: string): PoRow {
  const row = tx.select().from(po).where(eq(po.id, id)).get();
  if (!row) throw notFoundError("Purchase order");
  assertInScope(scope, row, "Purchase order");
  if (row.status === "Completed" || row.status === "Cancelled") {
    throw new AppError("INVALID_STATE", `A purchase order in ${row.status.toLowerCase()} status can't be received.`);
  }
  return row;
}

function locationFor(tx: AppDb, warehouseId: string, locationId: string, field: string): typeof schema.locations.$inferSelect {
  const loc = tx.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
  if (!loc || loc.warehouseId !== warehouseId) throw new AppError("VALIDATION", "Choose a location in this warehouse.", { fieldErrors: { [field]: ["Choose a location in this warehouse."] } });
  if (!loc.isActive) throw new AppError("VALIDATION", `${loc.code} is inactive.`, { fieldErrors: { [field]: [`${loc.code} is inactive.`] } });
  if (loc.isLocked) throw new AppError("RULE_VIOLATION", `${loc.code} is locked for counting.`, { fieldErrors: { [field]: [`${loc.code} is locked for counting.`] } });
  return loc;
}

/**
 * TEMP adapter (docs/requests/inbound-receiving.md REQ-2): creates an LP of the type with
 * the next auto number until foundation exposes `licensePlates.create`.
 */
function createLicensePlate(tx: AppDb, ctx: DomainCtx, input: { warehouseId: string; lpTypeId: string; locationId: string; clientId: string }): { id: string; number: string } {
  const type = tx.select().from(schema.lpTypes).where(eq(schema.lpTypes.id, input.lpTypeId)).get();
  if (!type || type.warehouseId !== input.warehouseId) throw new AppError("VALIDATION", "Choose an LP type of this warehouse.");
  const number = sequences.nextLpNumber(tx, type.id);
  const row = tx.insert(schema.licensePlates).values({
    number, warehouseId: input.warehouseId, lpTypeId: type.id, locationId: input.locationId, clientId: input.clientId, status: "Empty", createdBy: ctx.userId,
  }).returning({ id: schema.licensePlates.id, number: schema.licensePlates.number }).get();
  return row;
}

function lpFor(tx: AppDb, ctx: DomainCtx, p: PoRow, l: ReceiveLineValues, i: number): string | null {
  if (l.lpMode === "none") return null;
  if (l.lpMode === "new") {
    if (!l.lpTypeId) throw new AppError("VALIDATION", "Choose an LP type.", { fieldErrors: { [`lines.${i}.lpTypeId`]: ["Choose an LP type."] } });
    return createLicensePlate(tx, ctx, { warehouseId: p.warehouseId, lpTypeId: l.lpTypeId, locationId: l.locationId, clientId: p.clientId }).id;
  }
  if (!l.lpId) throw new AppError("VALIDATION", "Scan or choose an LP.", { fieldErrors: { [`lines.${i}.lpId`]: ["Scan or choose an LP."] } });
  const lp = tx.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, l.lpId)).get();
  if (!lp || lp.warehouseId !== p.warehouseId) throw new AppError("VALIDATION", "LP not found in this warehouse.", { fieldErrors: { [`lines.${i}.lpId`]: ["LP not found in this warehouse."] } });
  if (lp.status === "Shipped" || lp.status === "Removed") throw new AppError("RULE_VIOLATION", `LP ${lp.number} is ${lp.status.toLowerCase()}.`, { fieldErrors: { [`lines.${i}.lpId`]: [`LP ${lp.number} is ${lp.status.toLowerCase()}.`] } });
  if (lp.locationId && lp.locationId !== l.locationId) {
    throw new AppError("RULE_VIOLATION", `LP ${lp.number} is in another location.`, { fieldErrors: { [`lines.${i}.lpId`]: [`LP ${lp.number} is in another location.`] } });
  }
  return lp.id;
}

/** Validates all lines up front so the drawer gets every inline error at once. */
function validateLines(tx: AppDb, p: PoRow, body: ReceiveBodyValues, lines: Map<string, LineRow>, scope: Scope): void {
  const fieldErrors: Record<string, string[]> = {};
  const infos = new Map(productInfo(tx, scope, [...lines.values()].map((l) => l.productId)).map((x) => [x.id, x]));
  const seen = new Map<string, number>();
  body.lines.forEach((l, i) => {
    const row = lines.get(l.lineId);
    if (!row) {
      fieldErrors[`lines.${i}.lineId`] = ["This line is not on the purchase order."];
      return;
    }
    const info = infos.get(row.productId);
    if (!info) return;
    const req = receivingRequirements(tx, p.warehouseId, info.tracking);
    for (const [key, message] of Object.entries(trackingIssues({ ...l, uomRatio: row.uomQuantity }, req, info.sku))) fieldErrors[`lines.${i}.${key}`] = [message];
    const already = (seen.get(row.id) ?? 0) + l.quantity;
    seen.set(row.id, already);
    const remaining = row.orderedQuantity - row.receivedQuantity;
    if (already > remaining && !body.allowOverReceipt) {
      fieldErrors[`lines.${i}.quantity`] = [`Only ${Math.max(0, remaining)} remaining on this line. Confirm the over-receipt to receive ${already - Math.max(0, remaining)} more.`];
    }
  });
  const first = Object.values(fieldErrors)[0]?.[0];
  if (first) throw new AppError("VALIDATION", first, { fieldErrors });
}

/** Moves the PO to Started / Completed after receipts (status machine validated against the pre-receipt status). */
export function settleStatus(tx: AppDb, ctx: DomainCtx, poId: string, preStatus: PoStatus): PoRow {
  const row = tx.select().from(po).where(eq(po.id, poId)).get() as PoRow;
  const lines = tx.select({ ordered: line.orderedQuantity, received: line.receivedQuantity }).from(line).where(eq(line.purchaseOrderId, poId)).all();
  const complete = lines.length > 0 && lines.every((l) => l.received >= l.ordered);
  const now = new Date().toISOString();
  // The ledger marks the PO "Receiving" inside this transaction; the persisted outcome is
  // validated as preStatus -> Started / Completed (REQ-1 formalises the edge).
  const target: PoStatus = complete ? "Completed" : "Started";
  const from = preStatus === "Receiving" ? "Started" : preStatus;
  if (from !== target) stateMachines.purchaseOrder.transition(from, target);
  const next = {
    status: target,
    receivedAt: complete ? now : row.receivedAt ?? now,
    completedAt: complete ? now : null,
    version: row.version + 1,
    updatedBy: ctx.userId,
  };
  tx.update(po).set(next).where(eq(po.id, poId)).run();
  const statusBefore = preStatus === "Receiving" ? "Started" : preStatus;
  changeLog.recordUpdate(tx, ctx, {
    entityType: "purchase_order", entityId: poId, entityCode: row.code,
    before: { status: statusBefore, completedAt: null, receivedAt: preStatus === "Pending" ? null : row.receivedAt },
    after: { status: target, completedAt: next.completedAt, receivedAt: next.receivedAt },
  });
  return tx.select().from(po).where(eq(po.id, poId)).get() as PoRow;
}

export interface ReceiveResult {
  readonly purchaseOrderId: string;
  readonly code: string;
  readonly status: string;
  readonly receiptIds: readonly string[];
  readonly receivedUnits: number;
}

export function receivePurchaseOrder(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, body: ReceiveBodyValues): ReceiveResult {
  const p = loadOpenPo(tx, scope, id);
  assertVersion(p.version, body.version);
  const lines = new Map(tx.select().from(line).where(eq(line.purchaseOrderId, id)).all().map((l) => [l.id, l]));
  validateLines(tx, p, body, lines, scope);
  const receiptIds: string[] = [];
  let units = 0;
  body.lines.forEach((l, i) => {
    const row = lines.get(l.lineId) as LineRow;
    locationFor(tx, p.warehouseId, l.locationId, `lines.${i}.locationId`);
    const lpId = lpFor(tx, ctx, p, l, i);
    const { receipt } = ledger.recordReceipt(tx, ctx, {
      type: "Purchase Order", warehouseId: p.warehouseId, clientId: p.clientId, productId: row.productId, packType: row.packType,
      quantity: l.quantity, locationId: l.locationId, lpId, lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate,
      damageReason: l.damageReason, purchaseOrderId: p.id, purchaseOrderLineId: row.id, note: l.note, lineNote: row.note,
      serials: l.serials.length > 0 ? l.serials.map((s) => ({ primary: s })) : undefined,
    });
    if (l.damageImageFileId) {
      // TEMP adapter (REQ-3): RecordReceiptInput has no damage image yet.
      tx.update(schema.receipts).set({ damageImageFileId: l.damageImageFileId }).where(eq(schema.receipts.id, receipt.id)).run();
    }
    if (l.damageReason) {
      tx.update(line).set({ damagedQuantity: sql`${line.damagedQuantity} + ${l.quantity}` }).where(eq(line.id, row.id)).run();
    }
    receiptIds.push(receipt.id);
    units += receipt.uomQuantity;
  });
  const settled = settleStatus(tx, ctx, id, p.status);
  return { purchaseOrderId: id, code: settled.code, status: settled.status, receiptIds, receivedUnits: units };
}

export function defaultReceivingLocation(tx: AppDb, warehouseId: string): typeof schema.locations.$inferSelect {
  const wh = tx.select({ recv: schema.warehouses.defaultReceivingLocationId, code: schema.warehouses.code }).from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).get();
  const loc = wh?.recv ? tx.select().from(schema.locations).where(eq(schema.locations.id, wh.recv)).get() : undefined;
  const fallback = loc ?? tx.select().from(schema.locations)
    .where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.areaType, "Receiving"), eq(schema.locations.isActive, true))).orderBy(schema.locations.code).get();
  if (!fallback) throw new AppError("INVALID_STATE", `Warehouse ${wh?.code ?? ""} has no default receiving location. Set one in Warehouses.`);
  return fallback;
}

/** Full receive of every open line into the warehouse's default receiving location. */
export function receiveAll(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string): ReceiveResult {
  const p = loadOpenPo(tx, scope, id);
  const location = defaultReceivingLocation(tx, p.warehouseId);
  const open = tx.select().from(line).where(eq(line.purchaseOrderId, id)).all().filter((l) => l.receivedQuantity < l.orderedQuantity);
  if (open.length === 0) {
    const settled = settleStatus(tx, ctx, id, p.status);
    return { purchaseOrderId: id, code: p.code, status: settled.status, receiptIds: [], receivedUnits: 0 };
  }
  const infos = new Map(productInfo(tx, scope, open.map((l) => l.productId)).map((x) => [x.id, x]));
  for (const l of open) {
    const info = infos.get(l.productId);
    if (!info) continue;
    const req = receivingRequirements(tx, p.warehouseId, info.tracking);
    const issues = trackingIssues({ quantity: l.orderedQuantity - l.receivedQuantity, lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate, serials: [], uomRatio: l.uomQuantity }, req, info.sku);
    const first = Object.values(issues)[0];
    if (first) throw new AppError("VALIDATION", `${first} Use Receive items on ${p.code} to enter it.`);
  }
  return receivePurchaseOrder(tx, ctx, scope, id, {
    allowOverReceipt: false,
    lines: open.map((l) => ({
      lineId: l.id, quantity: l.orderedQuantity - l.receivedQuantity, locationId: location.id, lpMode: "none" as const, lpId: null, lpTypeId: null,
      lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate, damageReason: null, damageImageFileId: null, serials: [], note: null,
    })),
  });
}

export interface PutawaySuggestion {
  readonly algorithm: string;
  readonly rule: string | null;
  readonly suggestions: readonly { readonly locationId: string; readonly code: string; readonly reasons: readonly string[] }[];
  readonly defaultLocation: { readonly id: string; readonly code: string } | null;
}

/** Putaway suggestion for one PO line (foundation `putaway.suggestLocations`). */
export function suggestForLine(tx: AppDb, scope: Scope, poId: string, lineId: string, qty: number, attrs: { lot?: string | null; expiry?: string | null; damageReason?: string | null }): PutawaySuggestion {
  const row = tx.select().from(po).where(eq(po.id, poId)).get();
  if (!row) throw notFoundError("Purchase order");
  assertInScope(scope, row, "Purchase order");
  const l = tx.select().from(line).where(and(eq(line.id, lineId), eq(line.purchaseOrderId, poId))).get();
  if (!l) throw notFoundError("Purchase order line");
  let defaultLocation: { id: string; code: string } | null = null;
  try {
    const d = defaultReceivingLocation(tx, row.warehouseId);
    defaultLocation = { id: d.id, code: d.code };
  } catch {
    defaultLocation = null;
  }
  const result = putaway.suggestLocations(tx, {
    warehouseId: row.warehouseId, productId: l.productId, qty: Math.max(1, qty) * l.uomQuantity, packType: l.packType, isReceiving: true,
    lot: attrs.lot ?? null, expiry: attrs.expiry ?? null, damageReason: attrs.damageReason ?? null, limit: 5,
  });
  return {
    algorithm: result.algorithm, rule: result.rule, defaultLocation,
    suggestions: result.suggestions.map((s) => ({ locationId: s.locationId, code: s.code, reasons: s.reasons })),
  };
}
