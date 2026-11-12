/**
 * Shared helper for workflow executors that patch shipment-order header columns.
 * Workflows are a sanctioned writer of `shipment_orders` (BUILD_PLAN C1); every patch writes
 * a field-level change log entry attributed to the workflow.
 */
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { recordUpdate } from '@/server/domain/change-log';
import { DomainError } from '@/server/domain/errors';
import type { DomainCtx, Tx } from '@/server/domain/types';
import type { WorkflowActionInput } from './types';

export type OrderRow = typeof schema.shipmentOrders.$inferSelect;
type Patch = Partial<
  Pick<
    OrderRow,
    | 'workflowBlocked'
    | 'carrierConnectionId'
    | 'carrierServiceId'
    | 'carrier'
    | 'shippingService'
    | 'rateShoppingPresetId'
    | 'priority'
    | 'shipmentPackageId'
    | 'orderTypeId'
    | 'note'
  >
>;

export async function loadOrder(tx: Tx, input: WorkflowActionInput): Promise<OrderRow> {
  if (input.entity.type !== 'shipment_order')
    throw new DomainError('VALIDATION', 'This action only applies to shipment orders');
  const order = (
    await tx
      .select()
      .from(schema.shipmentOrders)
      .where(eq(schema.shipmentOrders.id, input.entity.id))
      .limit(1)
  )[0];
  if (!order) throw new DomainError('NOT_FOUND', 'Shipment order not found');
  return order;
}

const EDITABLE: readonly OrderRow['status'][] = ['Open', 'Shortage', 'On Hold', 'Ready to Pick'];

/** `display` swaps id values for readable labels in the change log. */
export async function patchOrder(
  tx: Tx,
  ctx: DomainCtx,
  order: OrderRow,
  patch: Patch,
  workflowName: string,
  display: Readonly<Record<string, { from: unknown; to: unknown }>> = {},
): Promise<boolean> {
  if (!EDITABLE.includes(order.status))
    throw new DomainError(
      'INVALID_STATE',
      `Order ${order.code} is ${order.status}; workflows only change open orders.`,
    );
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const prev = (order as Record<string, unknown>)[k];
    if (prev !== v) {
      before[k] = display[k]?.from ?? prev ?? null;
      after[k] = display[k]?.to ?? v ?? null;
    }
  }
  if (Object.keys(after).length === 0) return false;
  await tx
    .update(schema.shipmentOrders)
    .set({ ...patch, version: sql`${schema.shipmentOrders.version} + 1` })
    .where(eq(schema.shipmentOrders.id, order.id));
  await recordUpdate(
    tx,
    { ...ctx, source: `Workflow · ${workflowName}` },
    { entityType: 'shipment_order', entityId: order.id, entityCode: order.code, before, after },
  );
  return true;
}

export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
