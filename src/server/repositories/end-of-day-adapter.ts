/**
 * INTERIM ADAPTER (docs/requests/shipping.md REQ-1, REQ-2).
 *
 * `end_of_day_manifests` and `shipments.end_of_day_manifest_id` are foundation-owned. Until
 * foundation maintains manifests at label time (REQ-1) and exposes an "ensure open manifest"
 * command, closing a pending manifest needs these three writes. They are isolated here so the
 * swap is one file: each function prefers the foundation export when it exists.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { shipping } from "@/server/domain";
import { DomainError } from "@/server/domain/errors";
import type { DomainCtx, Tx } from "@/server/domain/types";

type ManifestRow = typeof schema.endOfDayManifests.$inferSelect;

interface FoundationEod {
  ensureOpenManifest?: (tx: Tx, ctx: DomainCtx, input: { warehouseId: string; carrierConnectionId: string; shipDate: string }) => ManifestRow;
}

const foundation = shipping as unknown as FoundationEod;

/** Open manifest for (warehouse, connection, day), created when missing. */
export function ensureOpenManifest(tx: Tx, ctx: DomainCtx, input: { warehouseId: string; carrierConnectionId: string; shipDate: string; carrierCode: string }): ManifestRow {
  if (foundation.ensureOpenManifest) return foundation.ensureOpenManifest(tx, ctx, input);
  const m = schema.endOfDayManifests;
  const existing = tx.select().from(m).where(and(eq(m.warehouseId, input.warehouseId), eq(m.carrierConnectionId, input.carrierConnectionId), eq(m.shipDate, input.shipDate))).get();
  if (existing?.status === "Open") return existing;
  if (existing) {
    throw new DomainError("INVALID_STATE", `The ${input.shipDate} manifest for this carrier is already closed. A second manifest for the same day needs foundation REQ-2.`);
  }
  const conn = tx.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, input.carrierConnectionId)).get();
  return tx.insert(m).values({
    warehouseId: input.warehouseId, carrierConnectionId: input.carrierConnectionId, carrierPrefix: conn?.accountPrefix ?? "",
    carrierCode: input.carrierCode, shipDate: input.shipDate, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
}

/** Attaches unlinked labels to the manifest. */
export function attachLabels(tx: Tx, manifestId: string, shipmentIds: readonly string[]): void {
  if (shipmentIds.length === 0) return;
  tx.update(schema.shipments).set({ endOfDayManifestId: manifestId })
    .where(and(inArray(schema.shipments.id, [...shipmentIds]), isNull(schema.shipments.endOfDayManifestId))).run();
}

/** Stores the live package count, the printed flag and the report file on the manifest. */
export function markPrinted(tx: Tx, ctx: DomainCtx, manifestId: string, totals: { totalPackages: number; reportFileId?: string | null }): void {
  const m = schema.endOfDayManifests;
  tx.update(m).set({
    isPrinted: true, totalPackages: totals.totalPackages, updatedBy: ctx.userId, version: sql`${m.version} + 1`,
    ...(totals.reportFileId ? { reportFileId: totals.reportFileId } : {}),
  }).where(eq(m.id, manifestId)).run();
}
