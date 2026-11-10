/** Set Priority / Set Order Type / Add Note / Add Tag / Set Warehouse / Notify Users (M12). */
import { and, eq } from "drizzle-orm";
import { PRIORITIES, isOneOf } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { notify } from "@/server/domain/notify";
import { changeWarehouse } from "@/server/domain/orders/commands";
import type { WorkflowActionExecutor } from "./types";
import { loadOrder, patchOrder, str } from "./order-patch";

export const setPriority: WorkflowActionExecutor = (tx, ctx, input) => {
  const order = loadOrder(tx, input);
  const priority = str(input.params.priority);
  if (!priority || !isOneOf(PRIORITIES, priority)) throw new DomainError("VALIDATION", "Choose a priority");
  return { applied: patchOrder(tx, ctx, order, { priority }, input.workflowName) };
};

export const setOrderType: WorkflowActionExecutor = (tx, ctx, input) => {
  const order = loadOrder(tx, input);
  const id = str(input.params.orderTypeId);
  if (!id) throw new DomainError("VALIDATION", "Choose an order type");
  const lv = tx.select().from(schema.lookupValues).where(and(eq(schema.lookupValues.id, id), eq(schema.lookupValues.type, "so_type"))).get();
  if (!lv) throw new DomainError("VALIDATION", "The order type no longer exists");
  return { applied: patchOrder(tx, ctx, order, { orderTypeId: lv.id }, input.workflowName, { orderTypeId: { from: null, to: lv.name } }) };
};

export const addNote: WorkflowActionExecutor = (tx, ctx, input) => {
  const order = loadOrder(tx, input);
  const note = str(input.params.note);
  if (!note) throw new DomainError("VALIDATION", "Enter the note text");
  if ((order.note ?? "").includes(note)) return { applied: false, message: "Note already present" };
  const next = order.note ? `${order.note}\n${note}` : note;
  return { applied: patchOrder(tx, ctx, order, { note: next.slice(0, 2000) }, input.workflowName) };
};

export const addTag: WorkflowActionExecutor = (tx, _ctx, input) => {
  const order = loadOrder(tx, input);
  const name = str(input.params.tag);
  if (!name) throw new DomainError("VALIDATION", "Enter a tag");
  const t = schema.tags;
  const tag = tx.select().from(t).where(and(eq(t.name, name), eq(t.scope, "shipment_order"))).get()
    ?? tx.select().from(t).where(and(eq(t.name, name), eq(t.scope, "any"))).get()
    ?? tx.insert(t).values({ name, color: "#2E6BE6", scope: "shipment_order" }).returning().get();
  const et = schema.entityTags;
  const exists = tx.select().from(et).where(and(eq(et.tagId, tag.id), eq(et.entityType, "shipment_order"), eq(et.entityId, order.id))).get();
  if (exists) return { applied: false, message: `Tag ${name} already on the order` };
  tx.insert(et).values({ tagId: tag.id, entityType: "shipment_order", entityId: order.id }).run();
  return { applied: true };
};

export const setWarehouse: WorkflowActionExecutor = (tx, ctx, input) => {
  const order = loadOrder(tx, input);
  const id = str(input.params.warehouseId);
  if (!id) throw new DomainError("VALIDATION", "Choose a warehouse");
  if (order.warehouseId === id) return { applied: false, message: "Order is already in that warehouse" };
  const result = changeWarehouse(tx, { ...ctx, scope: undefined, source: `Workflow · ${input.workflowName}` }, { ids: [order.id], warehouseId: id });
  const failure = result.failed[0];
  if (failure) throw new DomainError("INVALID_STATE", failure.message);
  return { applied: true };
};

export const notifyUsers: WorkflowActionExecutor = (tx, _ctx, input) => {
  const order = loadOrder(tx, input);
  const ids = Array.isArray(input.params.userIds) ? input.params.userIds.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) throw new DomainError("VALIDATION", "Choose at least one user to notify");
  const message = str(input.params.message);
  const sent = notify(tx, ids, {
    kind: "workflow", title: `${input.workflowName}: order ${order.code}`, body: message ?? `Workflow ${input.workflowName} matched order ${order.code}.`,
    href: `/orders/${order.id}`, severity: "info",
  });
  return { applied: sent > 0, message: sent > 0 ? undefined : "None of the selected users are active" };
};
