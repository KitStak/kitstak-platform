/**
 * `GET /api/work-orders/:id` (id or code): header, components with live free qty, job and
 * tasks, receipts, transactions, allocation exceptions and timeline.
 * `PATCH { version, data }`: edit (409 CONFLICT on a stale version). `DELETE`: Open only.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { workOrderUpdateSchema } from '@/lib/grid-defs/work-orders/work-order-model';
import {
  deleteWorkOrder,
  getWorkOrderDetail,
  getWorkOrderRow,
  updateWorkOrder,
} from '@/server/repositories/work-orders';
import { canReopenInProcess } from '@/server/repositories/work-orders-adapters';
import { assertPlanner, plannerBody, WO_PERMISSIONS, woCtx } from '@/server/repositories/work-orders-api';
import { disassembledQty } from '@/server/repositories/work-orders-commands';

const params = z.object({ id: z.string().trim().min(1).max(64) });

export const GET = defineRoute({
  permission: WO_PERMISSIONS.view,
  params,
  handler: async ({ db, auth, params: p }) => {
    const detail = await getWorkOrderDetail(db, auth.scope, p.id);
    return {
      ...detail,
      disassembledQty: await disassembledQty(db, detail.workOrder.id, detail.workOrder.kitProductId),
      canReopenInProcess: canReopenInProcess(),
    };
  },
});

export const PATCH = defineRoute({
  permission: WO_PERMISSIONS.edit,
  params,
  body: z.unknown(),
  handler: async ({ db, auth, actor, params: p, body: raw }) => {
    const body = plannerBody(auth, workOrderUpdateSchema, raw);
    const record = await updateWorkOrder(db, woCtx(actor, auth), p.id, body.version, body.data);
    return await getWorkOrderRow(db, auth.scope, record.id);
  },
});

export const DELETE = defineRoute({
  permission: WO_PERMISSIONS.delete,
  params,
  handler: async ({ db, auth, actor, params: p }) => {
    assertPlanner(auth);
    const record = await deleteWorkOrder(db, woCtx(actor, auth), p.id);
    return { id: record.id, code: record.code };
  },
});
