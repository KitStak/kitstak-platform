/**
 * `inventory_transactions` writer.
 *
 * Balance convention (used by `verify.ts` and `db:verify`): a bucket's on-hand equals
 * Σ uomQty where it is `to_inventory_id` minus Σ uomQty where it is `from_inventory_id`.
 * - add / receipt: to = bucket, qty > 0
 * - remove / consume / shipment: from = bucket, qty > 0
 * - move: from = source, to = target, qty > 0
 * - adjustment / count: to = bucket, qty = signed delta
 * - allocation / allocation cancel: from = to = bucket (net 0)
 */
import { sql } from 'drizzle-orm';
import type { TxnType } from '@/lib/enums';
import * as schema from '@/server/db/schema';
import type { DomainCtx, Tx } from '../types';
import type { InventoryRow } from './bucket';
import { dbGet } from '@/server/db/sql';

export type TxnRow = typeof schema.inventoryTransactions.$inferSelect;

/** Document references a transaction can carry. */
export interface TxnRefs {
  readonly adjustmentReasonId?: string | null;
  readonly orderId?: string | null;
  readonly orderLineId?: string | null;
  readonly purchaseOrderId?: string | null;
  readonly receiptId?: string | null;
  readonly workOrderId?: string | null;
  readonly countPlanId?: string | null;
  readonly returnOrderId?: string | null;
  readonly jobId?: string | null;
  readonly taskId?: string | null;
  readonly shipmentId?: string | null;
  readonly algorithmName?: string | null;
  readonly algorithmRuleName?: string | null;
  readonly note?: string | null;
}

export interface TxnInput {
  readonly type: TxnType;
  readonly from: InventoryRow | null;
  readonly to: InventoryRow | null;
  readonly uomQty: number;
  readonly packQty: number;
  readonly refs?: TxnRefs;
}

/** Safe without a lock of its own: every writer holds the app write lock (`takeWriteLock`). */
async function nextSeq(tx: Tx): Promise<number> {
  const row = await dbGet<{ seq: number | null }>(
    tx,
    sql`SELECT MAX(seq) AS seq FROM inventory_transactions`,
  );
  return Number(row?.seq ?? 0) + 1;
}

export async function writeTxn(tx: Tx, ctx: DomainCtx, input: TxnInput): Promise<TxnRow> {
  const base = input.to ?? input.from;
  if (!base) throw new Error('writeTxn requires a source or target bucket');
  const { from, to } = input;
  const refs = input.refs ?? {};
  const [row] = await tx
    .insert(schema.inventoryTransactions)
    .values({
      seq: await nextSeq(tx),
      type: input.type,
      warehouseId: base.warehouseId,
      clientId: base.clientId ?? '',
      productId: base.productId,
      fromInventoryId: from?.id ?? null,
      toInventoryId: to?.id ?? null,
      fromLocationId: from?.locationId ?? null,
      toLocationId: to?.locationId ?? null,
      fromLpId: from?.lpId ?? null,
      toLpId: to?.lpId ?? null,
      fromStatus: from?.status ?? null,
      toStatus: to?.status ?? null,
      fromPackType: from?.packType ?? null,
      toPackType: to?.packType ?? null,
      fromLot: from?.lotNumber ?? null,
      toLot: to?.lotNumber ?? null,
      fromExpiry: from?.expiryDate ?? null,
      toExpiry: to?.expiryDate ?? null,
      fromProductionDate: from?.productionDate ?? null,
      toProductionDate: to?.productionDate ?? null,
      fromDamageReason: from?.damageReason ?? null,
      toDamageReason: to?.damageReason ?? null,
      uomQty: input.uomQty,
      packQty: input.packQty,
      adjustmentReasonId: refs.adjustmentReasonId ?? null,
      orderId: refs.orderId ?? null,
      orderLineId: refs.orderLineId ?? null,
      purchaseOrderId: refs.purchaseOrderId ?? null,
      receiptId: refs.receiptId ?? null,
      workOrderId: refs.workOrderId ?? null,
      countPlanId: refs.countPlanId ?? null,
      returnOrderId: refs.returnOrderId ?? null,
      jobId: refs.jobId ?? null,
      taskId: refs.taskId ?? null,
      shipmentId: refs.shipmentId ?? null,
      algorithmName: refs.algorithmName ?? null,
      algorithmRuleName: refs.algorithmRuleName ?? null,
      note: refs.note ?? null,
      userId: ctx.userId,
      source: ctx.source,
    })
    .returning();
  if (!row) throw new Error('inventory_transactions insert returned no row');
  return row;
}
