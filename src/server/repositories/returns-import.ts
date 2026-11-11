/**
 * Returns-platform import (Logiwa "Loop Returns" channel, BJ2-2): an RMA that arrives from an
 * integration rather than being keyed in. `POST /api/returns/import` takes one external return or
 * a batch, resolves the shipped order (order code, store order # or channel order #), maps SKUs
 * to the order's lines and the reason name to the Return Reason lookup, and creates a Pending RMA
 * with `source = <platform>` through the same `insertRma` path as Create RMA (eligibility,
 * returnable quantities, change log).
 *
 * Idempotent per platform + external return id: a repeat delivery returns the existing RMA
 * (`duplicate: true`) instead of creating a second one. The external id is recorded in the RMA
 * note as `<platform> return #<externalId>`, which is also what the grid's Note column shows.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { validationError } from "@/server/api/errors";
import { idSchema } from "./platform-common";
import { insertRma, shippableOrder, type ScopedCtx } from "./returns";
import { dbAll, dbGet, mapSeq, withWriteTx } from "@/server/db/sql";

/** Platforms an RMA can be imported from (the `return_orders.source` values other than RMA / Manual). */
export const RETURN_PLATFORMS = ["Loop Returns"] as const;
export type ReturnPlatform = (typeof RETURN_PLATFORMS)[number];

const externalReturnSchema = z.object({
  externalId: z.string({ error: "Enter the platform's return id" }).trim().min(1, "Enter the platform's return id").max(80),
  /** Order code (SO…), store order # or the channel order reference. */
  order: z.string({ error: "Enter the order code or store order #" }).trim().min(1, "Enter the order code or store order #").max(120),
  lines: z.array(z.object({
    sku: z.string({ error: "Enter a SKU" }).trim().min(1, "Enter a SKU").max(120),
    quantity: z.number({ error: "Enter a quantity" }).int("Enter a whole number").min(1, "Quantity must be at least 1"),
    reason: z.string().trim().max(120).nullish(),
  })).min(1, "Add at least one line").max(200),
  trackingNumber: z.string().trim().max(120).nullish(),
  carrierCode: z.string().trim().max(40).nullish(),
  expectedReturnDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullish(),
  note: z.string().trim().max(500).nullish(),
});

export const importReturnsSchema = z.object({
  platform: z.enum(RETURN_PLATFORMS).default("Loop Returns"),
  /** Optional channel connection the returns came through (recorded in the note). */
  channelConnectionId: idSchema.nullish(),
  returns: z.array(externalReturnSchema).min(1, "Send at least one return").max(100),
});
export type ImportReturnsInput = z.output<typeof importReturnsSchema>;

export interface ImportedReturn {
  readonly externalId: string;
  readonly ok: boolean;
  readonly duplicate?: boolean;
  readonly id?: string;
  readonly rmaCode?: string;
  readonly orderCode?: string;
  readonly message?: string;
}

/** The note marker that makes imports idempotent. */
export function externalMarker(platform: string, externalId: string): string {
  return `${platform} return #${externalId}`;
}

async function findOrderId(tx: AppDb, ctx: ScopedCtx, ref: string): Promise<string> {
  const q = ref.trim().toLowerCase();
  const rows = await dbAll<{ id: string; warehouseId: string; clientId: string }>(tx, sql`SELECT id, warehouse_id AS "warehouseId", client_id AS "clientId" FROM shipment_orders
    WHERE deleted_at IS NULL AND (lower(code) = ${q} OR lower(store_order_number) = ${q} OR lower(COALESCE(client_reference_code, '')) = ${q})
    ORDER BY CASE WHEN lower(code) = ${q} THEN 0 ELSE 1 END, created_at DESC LIMIT 20`);
  const inScope = rows.filter((r) => ctx.scope.warehouseIds.includes(r.warehouseId) && (ctx.scope.clientIds === "all" || ctx.scope.clientIds.includes(r.clientId)));
  const hit = inScope[0];
  if (!hit) throw new DomainError("NOT_FOUND", `No shipped order found for "${ref}".`);
  return hit.id;
}

async function reasonId(tx: AppDb, clientId: string, name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const lv = schema.lookupValues;
  const rows = await tx.select({ id: lv.id, clientId: lv.clientId }).from(lv)
    .where(and(eq(lv.type, "return_reason"), eq(lv.isActive, true), sql`lower(${lv.name}) = ${name.trim().toLowerCase()}`));
  return (rows.find((r) => r.clientId === clientId) ?? rows.find((r) => !r.clientId))?.id ?? null;
}

/** Imports one external return in the caller's transaction. Throws on any problem (the caller reports it per return). */
export async function importOneReturn(tx: AppDb, ctx: ScopedCtx, platform: ReturnPlatform, r: ImportReturnsInput["returns"][number], channelName: string | null): Promise<ImportedReturn> {
  const marker = externalMarker(platform, r.externalId);
  const dup = await dbGet<{ id: string; rmaCode: string }>(tx, sql`SELECT id, rma_code AS "rmaCode" FROM return_orders WHERE source = ${platform} AND strpos(COALESCE(note, ''), ${marker}) > 0 LIMIT 1`);
  if (dup) return { externalId: r.externalId, ok: true, duplicate: true, id: dup.id, rmaCode: dup.rmaCode, message: `Already imported as ${dup.rmaCode}` };
  const order = await shippableOrder(tx, ctx.scope, await findOrderId(tx, ctx, r.order));
  const fieldErrors: Record<string, string[]> = {};
  const lines = await mapSeq(r.lines, async (l, i) => {
    const line = order.lines.find((x) => x.sku.toLowerCase() === l.sku.trim().toLowerCase() && x.returnable > 0) ?? order.lines.find((x) => x.sku.toLowerCase() === l.sku.trim().toLowerCase());
    if (!line) { fieldErrors[`lines.${i}.sku`] = [`${l.sku} is not on ${order.code}`]; return null; }
    return { orderLineId: line.orderLineId, quantity: l.quantity, customerReturnReasonId: await reasonId(tx, order.clientId, l.reason) };
  });
  if (Object.keys(fieldErrors).length) throw validationError(Object.values(fieldErrors)[0]?.[0] ?? "Unknown SKU", fieldErrors);
  const note = [`Imported from ${platform}${channelName ? ` (${channelName})` : ""} · ${marker}`, r.note].filter(Boolean).join("\n");
  const created = await insertRma(tx, ctx, {
    shipmentOrderId: order.id,
    lines: lines.filter((l): l is NonNullable<typeof l> => Boolean(l)),
    expectedReturnDate: r.expectedReturnDate ?? null,
    note,
    label: null,
    returnAddressId: null,
    returnInfo: r.trackingNumber || r.carrierCode ? { carrierCode: r.carrierCode ?? null, carrierServiceName: null, trackingNumbers: r.trackingNumber ? [r.trackingNumber] : [], shippingCost: null } : null,
  } as never, { source: platform });
  return { externalId: r.externalId, ok: true, id: created.id, rmaCode: created.rmaCode, orderCode: order.code };
}

/** Batch import: each return in its own savepoint, so one bad return does not block the rest. */
export async function importReturns(tx: AppDb, ctx: ScopedCtx, input: ImportReturnsInput): Promise<{ readonly results: readonly ImportedReturn[]; readonly created: number; readonly duplicates: number; readonly failed: number }> {
  const channel = input.channelConnectionId
    ? (await tx.select({ name: schema.channelConnections.storeName }).from(schema.channelConnections).where(eq(schema.channelConnections.id, input.channelConnectionId)).limit(1))[0]
    : undefined;
  if (input.channelConnectionId && !channel) throw validationError("Channel connection not found", { channelConnectionId: ["Not found"] });
  const results: ImportedReturn[] = [];
  for (const r of input.returns) {
    try {
      results.push(await withWriteTx(tx, async (t) => await importOneReturn(t, ctx, input.platform, r, channel?.name ?? null)));
    } catch (error) {
      results.push({ externalId: r.externalId, ok: false, message: error instanceof Error ? error.message : "Import failed" });
    }
  }
  return {
    results,
    created: results.filter((r) => r.ok && !r.duplicate).length,
    duplicates: results.filter((r) => r.duplicate).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
