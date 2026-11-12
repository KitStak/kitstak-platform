/**
 * Receiving against purchase orders (M05). Receipts post through `ledger.recordReceipt`
 * (inventory + receipt row + line received qty); this module validates the request
 * (tracking flags, screen config, over-receipt, location/LP) and then settles the PO
 * status: Started while lines are open, Completed (stamps Actual Receiving + Completed)
 * once every line is fully received.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  EXPIRED_LOT_MESSAGE,
  isExpired,
  todayIn,
  trackingIssues,
  type ReceiveApiBodyValues,
  type ReceiveBodyValues,
  type ReceiveLineValues,
} from '@/lib/grid-defs/receiving/po-schemas';
import type { PoStatus } from '@/lib/enums';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError } from '@/server/api/errors';
import { assertInScope, type Scope } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { changeLog, ledger, putaway, sequences, stateMachines, type DomainCtx } from '@/server/domain';
import { assertVersion } from './platform-common';
import { productInfo, receiveAllBlockers, receivingRequirements } from './purchase-orders';
import { logSnapshot, warehouseTimeZone } from './purchase-orders-log';
import { forEachSeq, mapSeq } from '@/server/db/sql';

const po = schema.purchaseOrders;
const line = schema.purchaseOrderLines;
type PoRow = typeof po.$inferSelect;
type LineRow = typeof line.$inferSelect;

export const RECEIVED_SUCCESS_MESSAGE = 'You have successfully received orders.';

async function loadOpenPo(tx: AppDb, scope: Scope, id: string): Promise<PoRow> {
  const row = (await tx.select().from(po).where(eq(po.id, id)).limit(1))[0];
  if (!row) throw notFoundError('Purchase order');
  assertInScope(scope, row, 'Purchase order');
  if (row.status === 'Completed' || row.status === 'Cancelled') {
    throw new AppError(
      'INVALID_STATE',
      `A purchase order in ${row.status.toLowerCase()} status can't be received.`,
    );
  }
  return row;
}

async function locationFor(
  tx: AppDb,
  warehouseId: string,
  locationId: string,
  field: string,
): Promise<typeof schema.locations.$inferSelect> {
  const loc = (
    await tx.select().from(schema.locations).where(eq(schema.locations.id, locationId)).limit(1)
  )[0];
  if (!loc || loc.warehouseId !== warehouseId)
    throw new AppError('VALIDATION', 'Choose a location in this warehouse.', {
      fieldErrors: { [field]: ['Choose a location in this warehouse.'] },
    });
  if (!loc.isActive)
    throw new AppError('VALIDATION', `${loc.code} is inactive.`, {
      fieldErrors: { [field]: [`${loc.code} is inactive.`] },
    });
  if (loc.isLocked)
    throw new AppError('RULE_VIOLATION', `${loc.code} is locked for counting.`, {
      fieldErrors: { [field]: [`${loc.code} is locked for counting.`] },
    });
  return loc;
}

/**
 * TEMP adapter (docs/requests/inbound-receiving.md REQ-2): creates an LP of the type with
 * the next auto number until foundation exposes `licensePlates.create`.
 */
async function createLicensePlate(
  tx: AppDb,
  ctx: DomainCtx,
  input: { warehouseId: string; lpTypeId: string; locationId: string; clientId: string },
): Promise<{ id: string; number: string }> {
  const type = (
    await tx.select().from(schema.lpTypes).where(eq(schema.lpTypes.id, input.lpTypeId)).limit(1)
  )[0];
  if (!type || type.warehouseId !== input.warehouseId)
    throw new AppError('VALIDATION', 'Choose an LP type of this warehouse.');
  const number = await sequences.nextLpNumber(tx, type.id);
  const row = (
    await tx
      .insert(schema.licensePlates)
      .values({
        number,
        warehouseId: input.warehouseId,
        lpTypeId: type.id,
        locationId: input.locationId,
        clientId: input.clientId,
        status: 'Empty',
        createdBy: ctx.userId,
      })
      .returning({ id: schema.licensePlates.id, number: schema.licensePlates.number })
  )[0];
  return row;
}

async function lpFor(
  tx: AppDb,
  ctx: DomainCtx,
  p: PoRow,
  l: ReceiveLineValues,
  i: number,
): Promise<string | null> {
  if (l.lpMode === 'none') return null;
  if (l.lpMode === 'new') {
    if (!l.lpTypeId)
      throw new AppError('VALIDATION', 'Choose an LP type.', {
        fieldErrors: { [`lines.${i}.lpTypeId`]: ['Choose an LP type.'] },
      });
    return (
      await createLicensePlate(tx, ctx, {
        warehouseId: p.warehouseId,
        lpTypeId: l.lpTypeId,
        locationId: l.locationId,
        clientId: p.clientId,
      })
    ).id;
  }
  if (!l.lpId)
    throw new AppError('VALIDATION', 'Scan or choose an LP.', {
      fieldErrors: { [`lines.${i}.lpId`]: ['Scan or choose an LP.'] },
    });
  const lp = (
    await tx.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, l.lpId)).limit(1)
  )[0];
  if (!lp || lp.warehouseId !== p.warehouseId)
    throw new AppError('VALIDATION', 'LP not found in this warehouse.', {
      fieldErrors: { [`lines.${i}.lpId`]: ['LP not found in this warehouse.'] },
    });
  if (lp.status === 'Shipped' || lp.status === 'Removed')
    throw new AppError('RULE_VIOLATION', `LP ${lp.number} is ${lp.status.toLowerCase()}.`, {
      fieldErrors: { [`lines.${i}.lpId`]: [`LP ${lp.number} is ${lp.status.toLowerCase()}.`] },
    });
  if (lp.locationId && lp.locationId !== l.locationId) {
    throw new AppError('RULE_VIOLATION', `LP ${lp.number} is in another location.`, {
      fieldErrors: { [`lines.${i}.lpId`]: [`LP ${lp.number} is in another location.`] },
    });
  }
  return lp.id;
}

/** Date-only attributes are stored as YYYY-MM-DD (never an instant: no timezone drift). */
export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? (m[1] as string) : value;
}

/**
 * TEMP adapter (REQ-R2-19): `RecordReceiptInput` has no putaway algorithm fields. The server
 * re-runs the putaway algorithm (the client never supplies the algorithm name) and, when the
 * posted location is one the algorithm directs to, stamps the algorithm and rule on the
 * Receiving ledger row (Logiwa Transaction History: Algorithm Name / Rule Name).
 *
 * The drawer may have fetched its suggestion before the lot / expiry was typed or while the
 * quantity was still changing, so the check runs against the posted attributes first, then the
 * basis the drawer's suggestion used (`suggestBasis`), then the posted line without lot / expiry.
 * Every run is computed from server data; the basis only picks which inputs to re-run with.
 */
export async function putawayAlgorithmFor(
  tx: AppDb,
  p: Pick<PoRow, 'warehouseId'>,
  row: Pick<LineRow, 'productId' | 'uomQuantity' | 'packType'>,
  l: Pick<ReceiveLineValues, 'quantity' | 'locationId' | 'lotNumber' | 'expiryDate' | 'damageReason'> & {
    readonly suggestBasis?: ReceiveLineValues['suggestBasis'];
  },
): Promise<{ algorithmName: string; algorithmRuleName: string | null } | null> {
  const inputs: { qty: number; lot: string | null; expiry: string | null; damageReason: string | null }[] = [
    {
      qty: l.quantity,
      lot: l.lotNumber ?? null,
      expiry: l.expiryDate ?? null,
      damageReason: l.damageReason ?? null,
    },
  ];
  const b = l.suggestBasis;
  if (b)
    inputs.push({
      qty: b.qty ?? l.quantity,
      lot: b.lot ?? null,
      expiry: b.expiry ?? null,
      damageReason: b.damageReason ?? null,
    });
  inputs.push({ qty: l.quantity, lot: null, expiry: null, damageReason: l.damageReason ?? null });
  const tried = new Set<string>();
  for (const input of inputs) {
    const key = JSON.stringify(input);
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      // Runs before this line's receipt posts, so it sees the stock the drawer's suggestion saw.
      const result = await putaway.suggestLocations(tx, {
        warehouseId: p.warehouseId,
        productId: row.productId,
        qty: Math.max(1, input.qty) * row.uomQuantity,
        packType: row.packType,
        isReceiving: true,
        lot: input.lot,
        expiry: input.expiry,
        damageReason: input.damageReason,
        limit: 10,
      });
      if (result.suggestions.some((s) => s.locationId === l.locationId))
        return { algorithmName: result.algorithm, algorithmRuleName: result.rule ?? null };
    } catch {
      // A suggestion failure never blocks the receipt; the row just carries no algorithm.
    }
  }
  return null;
}

/** Validates all lines up front so the drawer gets every inline error at once. */
async function validateLines(
  tx: AppDb,
  p: PoRow,
  body: ReceiveBodyValues,
  lines: Map<string, LineRow>,
  scope: Scope,
): Promise<void> {
  const fieldErrors: Record<string, string[]> = {};
  const infos = new Map(
    (
      await productInfo(
        tx,
        scope,
        [...lines.values()].map((l) => l.productId),
      )
    ).map((x) => [x.id, x]),
  );
  const seen = new Map<string, number>();
  const today = todayIn(await warehouseTimeZone(tx, p.warehouseId));
  await forEachSeq(body.lines, async (l, i) => {
    const row = lines.get(l.lineId);
    if (!row) {
      fieldErrors[`lines.${i}.lineId`] = ['This line is not on the purchase order.'];
      return;
    }
    const info = infos.get(row.productId);
    if (!info) return;
    const req = await receivingRequirements(tx, p.warehouseId, info.tracking);
    for (const [key, message] of Object.entries(
      trackingIssues({ ...l, uomRatio: row.uomQuantity }, req, info.sku),
    ))
      fieldErrors[`lines.${i}.${key}`] = [message];
    // Already-expired stock never lands in a location silently: it needs an explicit confirm.
    if (
      info.tracking.expiry &&
      isExpired(l.expiryDate, today) &&
      !body.allowExpired &&
      !fieldErrors[`lines.${i}.expiryDate`]
    ) {
      fieldErrors[`lines.${i}.expiryDate`] = [
        `${EXPIRED_LOT_MESSAGE} Confirm receiving expired stock to continue.`,
      ];
    }
    const already = (seen.get(row.id) ?? 0) + l.quantity;
    seen.set(row.id, already);
    const remaining = row.orderedQuantity - row.receivedQuantity;
    if (already > remaining && !body.allowOverReceipt) {
      fieldErrors[`lines.${i}.quantity`] = [
        `Only ${Math.max(0, remaining)} remaining on this line. Confirm the over-receipt to receive ${already - Math.max(0, remaining)} more.`,
      ];
    }
  });
  const first = Object.values(fieldErrors)[0]?.[0];
  if (first) throw new AppError('VALIDATION', first, { fieldErrors });
}

/** Moves the PO to Started / Completed after receipts (status machine validated against the pre-receipt status). */
export async function settleStatus(
  tx: AppDb,
  ctx: DomainCtx,
  poId: string,
  preStatus: PoStatus,
  at?: string,
): Promise<PoRow> {
  const row = (await tx.select().from(po).where(eq(po.id, poId)).limit(1))[0] as PoRow;
  const lines = await tx
    .select({ ordered: line.orderedQuantity, received: line.receivedQuantity })
    .from(line)
    .where(eq(line.purchaseOrderId, poId));
  const complete = lines.length > 0 && lines.every((l) => l.received >= l.ordered);
  const now = at ?? new Date().toISOString();
  // The ledger marks the PO "Receiving" inside this transaction; the persisted outcome is
  // validated as preStatus -> Started / Completed (REQ-1 formalises the edge).
  const target: PoStatus = complete ? 'Completed' : 'Started';
  const from = preStatus === 'Receiving' ? 'Started' : preStatus;
  if (from !== target) stateMachines.purchaseOrder.transition(from, target);
  // Actual Receiving Date is stamped when the PO is fully received (Logiwa parity), not on
  // the first partial receipt.
  const next = {
    status: target,
    receivedAt: complete ? now : null,
    completedAt: complete ? now : null,
    version: row.version + 1,
    updatedBy: ctx.userId,
  };
  await tx.update(po).set(next).where(eq(po.id, poId));
  const statusBefore = preStatus === 'Receiving' ? 'Started' : preStatus;
  const tz = await warehouseTimeZone(tx, row.warehouseId);
  await changeLog.recordUpdate(tx, ctx, {
    entityType: 'purchase_order',
    entityId: poId,
    entityCode: row.code,
    // A receivable PO (Pending / Started) never carries an Actual Receiving Date before this
    // receipt (it is a completion stamp), so the pre-receipt value is always empty. The value
    // on `row` may be the ledger's transient stamp from inside this transaction (REQ-R2-14).
    before: logSnapshot(
      {
        status: statusBefore,
        completedAt: row.completedAt,
        receivedAt: preStatus === 'Completed' ? row.receivedAt : null,
      },
      tz,
    ),
    after: logSnapshot({ status: target, completedAt: next.completedAt, receivedAt: next.receivedAt }, tz),
  });
  return (await tx.select().from(po).where(eq(po.id, poId)).limit(1))[0] as PoRow;
}

export interface ReceiveResult {
  readonly purchaseOrderId: string;
  readonly code: string;
  readonly status: string;
  readonly receiptIds: readonly string[];
  readonly receivedUnits: number;
}

export async function receivePurchaseOrder(
  tx: AppDb,
  ctx: DomainCtx,
  scope: Scope,
  id: string,
  body: ReceiveBodyValues,
): Promise<ReceiveResult> {
  const p = await loadOpenPo(tx, scope, id);
  assertVersion(p.version, body.version);
  const lines = new Map(
    (await tx.select().from(line).where(eq(line.purchaseOrderId, id))).map((l) => [l.id, l]),
  );
  await validateLines(tx, p, body, lines, scope);
  const receiptIds: string[] = [];
  let units = 0;
  await forEachSeq(body.lines, async (l, i) => {
    const row = lines.get(l.lineId) as LineRow;
    await locationFor(tx, p.warehouseId, l.locationId, `lines.${i}.locationId`);
    const lpId = await lpFor(tx, ctx, p, l, i);
    // Directed putaway: the line followed the suggestion and the algorithm still directs there.
    // Omitted flag (API callers): stamp it whenever the algorithm directs to the posted location.
    const algorithm = l.fromSuggestion !== false ? await putawayAlgorithmFor(tx, p, row, l) : null;
    const { receipt, txn } = await ledger.recordReceipt(tx, ctx, {
      type: 'Purchase Order',
      warehouseId: p.warehouseId,
      clientId: p.clientId,
      productId: row.productId,
      packType: row.packType,
      quantity: l.quantity,
      locationId: l.locationId,
      lpId,
      lotNumber: l.lotNumber,
      expiryDate: dateOnly(l.expiryDate),
      productionDate: dateOnly(l.productionDate),
      damageReason: l.damageReason,
      purchaseOrderId: p.id,
      purchaseOrderLineId: row.id,
      note: l.note,
      lineNote: row.note,
      serials: l.serials.length > 0 ? l.serials.map((s) => ({ primary: s })) : undefined,
    });
    if (algorithm)
      await tx
        .update(schema.inventoryTransactions)
        .set(algorithm)
        .where(eq(schema.inventoryTransactions.id, txn.id));
    if (l.damageImageFileId) {
      // TEMP adapter (REQ-3): RecordReceiptInput has no damage image yet.
      await tx
        .update(schema.receipts)
        .set({ damageImageFileId: l.damageImageFileId })
        .where(eq(schema.receipts.id, receipt.id));
    }
    if (l.damageReason) {
      await tx
        .update(line)
        .set({ damagedQuantity: sql`${line.damagedQuantity} + ${l.quantity}` })
        .where(eq(line.id, row.id));
    }
    receiptIds.push(receipt.id);
    units += receipt.uomQuantity;
  });
  const settled = await settleStatus(tx, ctx, id, p.status);
  return {
    purchaseOrderId: id,
    code: settled.code,
    status: settled.status,
    receiptIds,
    receivedUnits: units,
  };
}

export async function defaultReceivingLocation(
  tx: AppDb,
  warehouseId: string,
): Promise<typeof schema.locations.$inferSelect> {
  const wh = (
    await tx
      .select({ recv: schema.warehouses.defaultReceivingLocationId, code: schema.warehouses.code })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, warehouseId))
      .limit(1)
  )[0];
  const loc = wh?.recv
    ? (await tx.select().from(schema.locations).where(eq(schema.locations.id, wh.recv)).limit(1))[0]
    : undefined;
  const fallback =
    loc ??
    (
      await tx
        .select()
        .from(schema.locations)
        .where(
          and(
            eq(schema.locations.warehouseId, warehouseId),
            eq(schema.locations.areaType, 'Receiving'),
            eq(schema.locations.isActive, true),
          ),
        )
        .orderBy(schema.locations.code)
        .limit(1)
    )[0];
  if (!fallback)
    throw new AppError(
      'INVALID_STATE',
      `Warehouse ${wh?.code ?? ''} has no default receiving location. Set one in Warehouses.`,
    );
  return fallback;
}

/**
 * API receive: `{ all: true }` is a full receive; otherwise lines without a location are
 * received into the warehouse's default receiving location (Logiwa parity).
 */
export async function receiveFromApi(
  tx: AppDb,
  ctx: DomainCtx,
  scope: Scope,
  id: string,
  input: ReceiveApiBodyValues,
): Promise<ReceiveResult> {
  if (input.all) return await receiveAll(tx, ctx, scope, id);
  const lines = input.lines ?? [];
  let fallback: string | null = null;
  const resolved = await mapSeq(lines, async (l) => {
    if (l.locationId) return { ...l, locationId: l.locationId };
    if (!fallback) {
      const p = await loadOpenPo(tx, scope, id);
      fallback = (await defaultReceivingLocation(tx, p.warehouseId)).id;
    }
    return { ...l, locationId: fallback };
  });
  return await receivePurchaseOrder(tx, ctx, scope, id, {
    lines: resolved,
    allowOverReceipt: input.allowOverReceipt,
    allowExpired: input.allowExpired,
    version: input.version,
  });
}

/** Full receive of every open line into the warehouse's default receiving location. */
export async function receiveAll(
  tx: AppDb,
  ctx: DomainCtx,
  scope: Scope,
  id: string,
): Promise<ReceiveResult> {
  const p = await loadOpenPo(tx, scope, id);
  const location = await defaultReceivingLocation(tx, p.warehouseId);
  const open = (await tx.select().from(line).where(eq(line.purchaseOrderId, id))).filter(
    (l) => l.receivedQuantity < l.orderedQuantity,
  );
  if (open.length === 0) {
    const settled = await settleStatus(tx, ctx, id, p.status);
    return { purchaseOrderId: id, code: p.code, status: settled.status, receiptIds: [], receivedUnits: 0 };
  }
  const blocked = (await receiveAllBlockers(tx, [id])).get(id);
  if (blocked) throw new AppError('RULE_VIOLATION', `${blocked.replace(/\.$/, '')} on ${p.code}.`);
  return await receivePurchaseOrder(tx, ctx, scope, id, {
    allowOverReceipt: false,
    lines: open.map((l) => ({
      lineId: l.id,
      quantity: l.orderedQuantity - l.receivedQuantity,
      locationId: location.id,
      lpMode: 'none' as const,
      lpId: null,
      lpTypeId: null,
      lotNumber: l.lotNumber,
      expiryDate: l.expiryDate,
      productionDate: l.productionDate,
      damageReason: null,
      damageImageFileId: null,
      serials: [],
      note: null,
      fromSuggestion: false,
    })),
    allowExpired: false,
  });
}

export interface PutawaySuggestion {
  readonly algorithm: string;
  readonly rule: string | null;
  readonly suggestions: readonly {
    readonly locationId: string;
    readonly code: string;
    readonly reasons: readonly string[];
  }[];
  readonly defaultLocation: { readonly id: string; readonly code: string } | null;
}

/** Putaway suggestion for one PO line (foundation `putaway.suggestLocations`). */
export async function suggestForLine(
  tx: AppDb,
  scope: Scope,
  poId: string,
  lineId: string,
  qty: number,
  attrs: { lot?: string | null; expiry?: string | null; damageReason?: string | null },
): Promise<PutawaySuggestion> {
  const row = (await tx.select().from(po).where(eq(po.id, poId)).limit(1))[0];
  if (!row) throw notFoundError('Purchase order');
  assertInScope(scope, row, 'Purchase order');
  const l = (
    await tx
      .select()
      .from(line)
      .where(and(eq(line.id, lineId), eq(line.purchaseOrderId, poId)))
      .limit(1)
  )[0];
  if (!l) throw notFoundError('Purchase order line');
  let defaultLocation: { id: string; code: string } | null = null;
  try {
    const d = await defaultReceivingLocation(tx, row.warehouseId);
    defaultLocation = { id: d.id, code: d.code };
  } catch {
    defaultLocation = null;
  }
  const result = await putaway.suggestLocations(tx, {
    warehouseId: row.warehouseId,
    productId: l.productId,
    qty: Math.max(1, qty) * l.uomQuantity,
    packType: l.packType,
    isReceiving: true,
    lot: attrs.lot ?? null,
    expiry: attrs.expiry ?? null,
    damageReason: attrs.damageReason ?? null,
    limit: 5,
  });
  return {
    algorithm: result.algorithm,
    rule: result.rule,
    defaultLocation,
    suggestions: result.suggestions.map((s) => ({
      locationId: s.locationId,
      code: s.code,
      reasons: s.reasons,
    })),
  };
}

/** Suggestions for every open line (each sized to its remaining quantity), for clients that omit `lineId`. */
export async function suggestForOpenLines(
  tx: AppDb,
  scope: Scope,
  poId: string,
): Promise<{ lineId: string; remaining: number; suggestion: PutawaySuggestion }[]> {
  const row = (await tx.select().from(po).where(eq(po.id, poId)).limit(1))[0];
  if (!row) throw notFoundError('Purchase order');
  assertInScope(scope, row, 'Purchase order');
  return await mapSeq(
    (await tx.select().from(line).where(eq(line.purchaseOrderId, poId))).filter(
      (l) => l.receivedQuantity < l.orderedQuantity,
    ),
    async (l) => {
      const remaining = l.orderedQuantity - l.receivedQuantity;
      return {
        lineId: l.id,
        remaining,
        suggestion: await suggestForLine(tx, scope, poId, l.id, remaining, {
          lot: l.lotNumber,
          expiry: l.expiryDate,
        }),
      };
    },
  );
}
