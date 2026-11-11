/** Set Priority / Set Order Type / Add Note / Add Tag / Set Warehouse / Notify Users (M12). */
import { and, eq } from "drizzle-orm";
import { PRIORITIES, isOneOf } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { notify } from "@/server/domain/notify";
import { changeWarehouse } from "@/server/domain/orders/commands";
import type { WorkflowActionExecutor } from "./types";
import { loadOrder, patchOrder, str } from "./order-patch";

export const setPriority: WorkflowActionExecutor = async (tx, ctx, input) => {
  const order = await loadOrder(tx, input);
  const priority = str(input.params.priority);
  if (!priority || !isOneOf(PRIORITIES, priority)) throw new DomainError("VALIDATION", "Choose a priority");
  return { applied: await patchOrder(tx, ctx, order, { priority }, input.workflowName) };
};

export const setOrderType: WorkflowActionExecutor = async (tx, ctx, input) => {
  const order = await loadOrder(tx, input);
  const id = str(input.params.orderTypeId);
  if (!id) throw new DomainError("VALIDATION", "Choose an order type");
  const lv = (await tx.select().from(schema.lookupValues).where(and(eq(schema.lookupValues.id, id), eq(schema.lookupValues.type, "so_type"))).limit(1))[0];
  if (!lv) throw new DomainError("VALIDATION", "The order type no longer exists");
  return { applied: await patchOrder(tx, ctx, order, { orderTypeId: lv.id }, input.workflowName, { orderTypeId: { from: null, to: lv.name } }) };
};

export const addNote: WorkflowActionExecutor = async (tx, ctx, input) => {
  const order = await loadOrder(tx, input);
  const note = str(input.params.note);
  if (!note) throw new DomainError("VALIDATION", "Enter the note text");
  if ((order.note ?? "").includes(note)) return { applied: false, message: "Note already present" };
  const next = order.note ? `${order.note}\n${note}` : note;
  return { applied: await patchOrder(tx, ctx, order, { note: next.slice(0, 2000) }, input.workflowName) };
};

export const addTag: WorkflowActionExecutor = async (tx, _ctx, input) => {
  const order = await loadOrder(tx, input);
  const name = str(input.params.tag);
  if (!name) throw new DomainError("VALIDATION", "Enter a tag");
  const t = schema.tags;
  const tag = (await tx.select().from(t).where(and(eq(t.name, name), eq(t.scope, "shipment_order"))).limit(1))[0]
    ?? (await tx.select().from(t).where(and(eq(t.name, name), eq(t.scope, "any"))).limit(1))[0]
    ?? (await tx.insert(t).values({ name, color: "#2E6BE6", scope: "shipment_order" }).returning())[0];
  const et = schema.entityTags;
  const exists = (await tx.select().from(et).where(and(eq(et.tagId, tag.id), eq(et.entityType, "shipment_order"), eq(et.entityId, order.id))).limit(1))[0];
  if (exists) return { applied: false, message: `Tag ${name} already on the order` };
  await tx.insert(et).values({ tagId: tag.id, entityType: "shipment_order", entityId: order.id });
  return { applied: true };
};

export const setWarehouse: WorkflowActionExecutor = async (tx, ctx, input) => {
  const order = await loadOrder(tx, input);
  const id = str(input.params.warehouseId);
  if (!id) throw new DomainError("VALIDATION", "Choose a warehouse");
  if (order.warehouseId === id) return { applied: false, message: "Order is already in that warehouse" };
  const result = await changeWarehouse(tx, { ...ctx, scope: undefined, source: `Workflow · ${input.workflowName}` }, { ids: [order.id], warehouseId: id });
  const failure = result.failed[0];
  if (failure) throw new DomainError("INVALID_STATE", failure.message);
  return { applied: true };
};

/** Shipment orders link to the order; purchase orders (Purchase Order Created) to the PO. */
async function notifyTarget(tx: Parameters<WorkflowActionExecutor>[0], input: Parameters<WorkflowActionExecutor>[2]): Promise<{ noun: string; code: string; href: string }> {
  if (input.entity.type === "purchase_order") {
    const po = (await tx.select({ id: schema.purchaseOrders.id, code: schema.purchaseOrders.code }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, input.entity.id)).limit(1))[0];
    if (!po) throw new DomainError("NOT_FOUND", "Purchase order not found");
    return { noun: "purchase order", code: po.code, href: `/receiving/${po.id}` };
  }
  const order = await loadOrder(tx, input);
  return { noun: "order", code: order.code, href: `/orders/${order.id}` };
}

export const notifyUsers: WorkflowActionExecutor = async (tx, _ctx, input) => {
  const target = await notifyTarget(tx, input);
  const ids = Array.isArray(input.params.userIds) ? input.params.userIds.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) throw new DomainError("VALIDATION", "Choose at least one user to notify");
  const message = str(input.params.message);
  const sent = await notify(tx, ids, {
    kind: "workflow", title: `${input.workflowName}: ${target.noun} ${target.code}`, body: message ?? `Workflow ${input.workflowName} matched ${target.noun} ${target.code}.`,
    href: target.href, severity: "info",
  });
  return { applied: sent > 0, message: sent > 0 ? undefined : "None of the selected users are active" };
};
