/**
 * INTERIM ADAPTER (docs/requests/shipping.md REQ-1, REQ-2, R7-2).
 *
 * `end_of_day_manifests` and `shipments.end_of_day_manifest_id` are foundation-owned. The
 * foundation keys open manifests by (warehouse, carrier setup, day) only, so a carrier setup
 * that ships with two carriers (a USPS service on a UPS connection) puts both carriers' labels
 * on one manifest. End Of The Day keys manifests by carrier too: closing a manifest moves every
 * other carrier's labels off it first, and a carrier without an open manifest of its own gets a
 * new one with the next sequence (the unique index is warehouse + setup + day + sequence).
 */
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { DomainCtx, Tx } from "@/server/domain/types";

type ManifestRow = typeof schema.endOfDayManifests.$inferSelect;

/** Open manifest for (warehouse, setup, carrier, day), created with the next sequence when missing. */
export function ensureOpenManifest(tx: Tx, ctx: DomainCtx, input: { warehouseId: string; carrierConnectionId: string; shipDate: string; carrierCode: string }): ManifestRow {
  const m = schema.endOfDayManifests;
  const day = and(eq(m.warehouseId, input.warehouseId), eq(m.carrierConnectionId, input.carrierConnectionId), eq(m.shipDate, input.shipDate));
  const open = tx.select().from(m).where(and(day, eq(m.status, "Open"), eq(m.carrierCode, input.carrierCode))).get();
  if (open) return open;
  const last = tx.select().from(m).where(day).orderBy(desc(m.sequence)).get();
  const conn = tx.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, input.carrierConnectionId)).get();
  return tx.insert(m).values({
    warehouseId: input.warehouseId, carrierConnectionId: input.carrierConnectionId, carrierPrefix: conn?.accountPrefix ?? "",
    carrierCode: input.carrierCode, shipDate: input.shipDate, sequence: (last?.sequence ?? 0) + 1, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
}

/** Labels of other carriers leave an open manifest before it closes (they wait for their own carrier's manifest). */
export function detachOtherCarriers(tx: Tx, manifestId: string, carrierCode: string): void {
  const s = schema.shipments;
  tx.update(s).set({ endOfDayManifestId: null }).where(and(eq(s.endOfDayManifestId, manifestId), ne(s.carrierCode, carrierCode))).run();
}

/** Attaches labels that are on no manifest or on another (still open) manifest. Closed manifests keep theirs. */
export function attachLabels(tx: Tx, manifestId: string, shipmentIds: readonly string[]): void {
  if (shipmentIds.length === 0) return;
  const s = schema.shipments;
  const openIds = tx.select({ id: schema.endOfDayManifests.id }).from(schema.endOfDayManifests).where(eq(schema.endOfDayManifests.status, "Open"));
  tx.update(s).set({ endOfDayManifestId: manifestId })
    .where(and(inArray(s.id, [...shipmentIds]), or(isNull(s.endOfDayManifestId), inArray(s.endOfDayManifestId, openIds)))).run();
}

/** Stores the live package count, the printed flag and the report file on the manifest. */
export function markPrinted(tx: Tx, ctx: DomainCtx, manifestId: string, totals: { totalPackages: number; reportFileId?: string | null }): void {
  const m = schema.endOfDayManifests;
  tx.update(m).set({
    isPrinted: true, totalPackages: totals.totalPackages, updatedBy: ctx.userId, version: sql`${m.version} + 1`,
    ...(totals.reportFileId ? { reportFileId: totals.reportFileId } : {}),
  }).where(eq(m.id, manifestId)).run();
}
