/** Helpers shared by the foundation task handlers. */
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { DomainError } from '../errors';
import { stateMachines } from '../state-machines';
import { nowIso, type DomainCtx, type Tx } from '../types';
import type { TaskRow } from './types';

export function assertExecutable(task: TaskRow): void {
  if (task.status !== 'Pending' && task.status !== 'Started') {
    throw new DomainError('INVALID_STATE', `Task ${task.taskNo} is ${task.status.toLowerCase()}.`);
  }
}

export function assertQty(qty: number, max: number, what: string): void {
  if (!Number.isInteger(qty) || qty < 0 || qty > max)
    throw new DomainError('VALIDATION', `${what} quantity must be between 0 and ${max}.`);
}

export async function completeTask(
  tx: Tx,
  ctx: DomainCtx,
  task: TaskRow,
  patch: {
    doneQty: number;
    targetLocationId: string;
    targetLpId?: string | null;
    pickShort?: boolean;
    packShort?: boolean;
  },
): Promise<void> {
  const status = stateMachines.task.transition(task.status, 'Completed');
  const now = nowIso();
  await tx
    .update(schema.tasks)
    .set({
      status,
      actualQty: task.actualQty + patch.doneQty,
      targetLocationId: patch.targetLocationId,
      targetLpId: patch.targetLpId ?? task.targetLpId,
      executedByUserId: ctx.userId,
      startedAt: task.startedAt ?? now,
      finishedAt: now,
      updatedBy: ctx.userId,
      ...(patch.pickShort ? { pickShortStatus: 'Open' as const } : {}),
      ...(patch.packShort ? { packShortStatus: 'Open' as const } : {}),
    })
    .where(eq(schema.tasks.id, task.id));
}

export async function bumpLine(
  tx: Tx,
  ctx: DomainCtx,
  lineId: string,
  column: 'pickedQuantity' | 'packedQuantity' | 'sortedQuantity' | 'loadedQuantity',
  qty: number,
): Promise<void> {
  if (qty === 0) return;
  const col = schema.orderLines[column];
  await tx
    .update(schema.orderLines)
    .set({ [column]: sql`${col} + ${qty}`, updatedBy: ctx.userId })
    .where(eq(schema.orderLines.id, lineId));
}

export async function markOrderShort(
  tx: Tx,
  ctx: DomainCtx,
  orderId: string,
  kind: 'pick' | 'pack',
): Promise<void> {
  await tx
    .update(schema.shipmentOrders)
    .set(
      kind === 'pick'
        ? { pickShortStatus: 'Open', updatedBy: ctx.userId }
        : { packShortStatus: 'Open', updatedBy: ctx.userId },
    )
    .where(eq(schema.shipmentOrders.id, orderId));
}

/** Lowers the planned qty of the downstream (pack/sort) tasks of a line after a short pick. */
export async function reducePlanned(tx: Tx, orderLineId: string, qty: number): Promise<void> {
  if (qty <= 0) return;
  await tx
    .update(schema.tasks)
    .set({ plannedQty: sql`GREATEST(${schema.tasks.plannedQty} - ${qty}, 0)` })
    .where(
      and(
        eq(schema.tasks.orderLineId, orderLineId),
        eq(schema.tasks.status, 'Pending'),
        sql`${schema.tasks.taskType} IN ('Packing','Sorting')`,
      ),
    );
}
