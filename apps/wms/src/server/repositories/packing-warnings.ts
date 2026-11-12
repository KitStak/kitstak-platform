/**
 * Packing Warnings at the pack screen (Logiwa parity). An order carries
 * `shipment_orders.packing_warning_type_id`; the Packing Warning Type (Data Setup) defines the
 * warning text, when it shows (Order is displayed on packing / Close pack is triggered / Product
 * is scanned), media links and "Skip confirmation from packer". When confirmation is required
 * the packer must acknowledge it; each acknowledgement is written to the order's change log.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { packingTriggerLabel, PACKING_WARNING_TRIGGERS, type PackingWarningTrigger } from "@/lib/grid-defs/admin/lookups";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { assertInScope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import type { DomainCtx } from "@/server/domain/types";
import { idSchema } from "./platform-common";

export interface PackingWarning {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly trigger: PackingWarningTrigger;
  readonly triggerLabel: string;
  readonly skipConfirmation: boolean;
  readonly mediaLinks: readonly string[];
}

const TRIGGERS = PACKING_WARNING_TRIGGERS.map((t) => t.value) as readonly string[];

/** Lookup row meta → warning (PURE). Unknown / missing trigger defaults to "Order is displayed on packing". */
export function toPackingWarning(row: { readonly id: string; readonly name: string; readonly meta: Record<string, unknown> | null }): PackingWarning {
  const m = row.meta ?? {};
  const trigger = (typeof m.showWhen === "string" && TRIGGERS.includes(m.showWhen) ? m.showWhen : "order_displayed") as PackingWarningTrigger;
  // No text set in Data Setup: an instruction line, not the name repeated under the title.
  const text = typeof m.warningText === "string" && m.warningText.trim() ? m.warningText.trim() : `This order is marked "${row.name}". Pack it accordingly.`;
  const links = Array.isArray(m.mediaLinks) ? m.mediaLinks.filter((x): x is string => typeof x === "string" && /^https?:\/\//i.test(x.trim())).map((x) => x.trim()) : [];
  return { id: row.id, name: row.name, text, trigger, triggerLabel: packingTriggerLabel(trigger) ?? trigger, skipConfirmation: m.skipConfirmation === true, mediaLinks: links };
}

/** The active warning of an order, or null. */
export async function packingWarningOf(db: AppDb, warningTypeId: string | null | undefined): Promise<PackingWarning | null> {
  if (!warningTypeId) return null;
  const row = (await db.select({ id: schema.lookupValues.id, name: schema.lookupValues.name, meta: schema.lookupValues.meta, isActive: schema.lookupValues.isActive, type: schema.lookupValues.type })
    .from(schema.lookupValues).where(and(eq(schema.lookupValues.id, warningTypeId), eq(schema.lookupValues.type, "packing_warning_type"))).limit(1))[0];
  if (!row || !row.isActive) return null;
  return toPackingWarning(row);
}

export const ackWarningSchema = z.object({
  orderId: idSchema,
  warningTypeId: idSchema,
  trigger: z.enum(PACKING_WARNING_TRIGGERS.map((t) => t.value) as [PackingWarningTrigger, ...PackingWarningTrigger[]]),
  stationId: idSchema.nullish(),
});

/** Records the packer's acknowledgement on the order's change log. */
export async function acknowledgeWarning(tx: AppDb, ctx: DomainCtx & { readonly scope: Scope }, input: z.output<typeof ackWarningSchema>): Promise<{ readonly orderId: string; readonly acknowledgedAt: string }> {
  const o = (await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, input.orderId)).limit(1))[0];
  assertInScope(ctx.scope, o, "Shipment order");
  if (!o) throw new DomainError("NOT_FOUND", "Shipment order not found");
  if (o.packingWarningTypeId !== input.warningTypeId) throw new DomainError("INVALID_STATE", `The packing warning of ${o.code} has changed. Reload the order.`);
  const w = await packingWarningOf(tx, input.warningTypeId);
  if (!w) throw new DomainError("NOT_FOUND", "Packing warning not found");
  const station = input.stationId ? (await tx.select({ code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, input.stationId)).limit(1))[0]?.code : null;
  const at = new Date().toISOString();
  const value = `${w.name} · ${packingTriggerLabel(input.trigger) ?? input.trigger}${station ? ` · ${station}` : ""}`;
  await tx.insert(schema.changeLog).values({
    entityType: "shipment_order", entityId: o.id, entityCode: o.code, type: "Update", field: "packingWarningAcknowledged", fieldLabel: "Packing Warning Acknowledged",
    fromValue: null, toValue: value, message: `Packing warning "${w.name}" is acknowledged by the packer (${packingTriggerLabel(input.trigger) ?? input.trigger}${station ? ` at ${station}` : ""}).`,
    userId: ctx.userId, source: ctx.source, at,
  });
  return { orderId: o.id, acknowledgedAt: at };
}
