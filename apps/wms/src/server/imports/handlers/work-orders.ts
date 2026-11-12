/**
 * Import handler "work-orders" (M08; replaces the 0.6 stub). Each row creates one Open
 * kitting work order through the work order repository (validation, change log, codes).
 *
 * Template columns are foundation-owned (`columns/operations.ts`): Type "Kit" creates a
 * "Work Order with Picking" (components are allocated later by Picking/Job Operations);
 * "Disassemble" rows are refused because disassembly runs against built kits from the grid.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { AppError } from '@/server/api/errors';
import { workOrderInputSchema } from '@/lib/grid-defs/work-orders/work-order-model';
import { createWorkOrder } from '@/server/repositories/work-orders';
import type { ImportHandler } from '../types';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export const handler: ImportHandler = {
  configured: true,
  owner: 'M08',
  async apply({ db, auth, actor }, row) {
    if (str(row.type).toLowerCase() === 'disassemble') {
      throw new AppError(
        'VALIDATION',
        'Disassemble rows are not imported; use Disassemble Kit on a completed work order.',
      );
    }
    const warehouse = (
      await db
        .select()
        .from(schema.warehouses)
        .where(eq(schema.warehouses.code, str(row.warehouseCode)))
        .limit(1)
    )[0];
    if (!warehouse) throw new AppError('VALIDATION', `Warehouse ${str(row.warehouseCode)} was not found.`);
    const client = (
      await db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.code, str(row.clientCode)))
        .limit(1)
    )[0];
    if (!client) throw new AppError('VALIDATION', `Client ${str(row.clientCode)} was not found.`);
    const kit = (
      await db
        .select()
        .from(schema.products)
        .where(and(eq(schema.products.sku, str(row.kitSku)), eq(schema.products.clientId, client.id)))
        .limit(1)
    )[0];
    if (!kit)
      throw new AppError('VALIDATION', `Kit ${str(row.kitSku)} was not found for client ${client.code}.`);
    const due = str(row.dueDate);
    const parsed = workOrderInputSchema.safeParse({
      warehouseId: warehouse.id,
      clientId: client.id,
      code: str(row.workOrderCode),
      type: 'Work Order with Picking',
      buildFor: 'Stock',
      kitProductId: kit.id,
      requestedQty: Number(row.quantity),
      extraNote: str(row.notes) || null,
      plannedFinishAt: due ? new Date(`${due.slice(0, 10)}T17:00:00`).toISOString() : null,
      components: [],
      customFields: {},
    });
    if (!parsed.success) throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid row');
    const record = await createWorkOrder(
      db,
      { userId: actor.userId, source: actor.source, scope: auth.scope },
      parsed.data,
    );
    return { entityId: record.id, message: `Work order ${record.code} created` };
  },
};
