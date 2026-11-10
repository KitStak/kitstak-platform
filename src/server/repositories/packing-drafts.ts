/**
 * In-progress pack state per order (the packer's scanned units, open / closed packages, captures,
 * the chosen carrier and the last rate quote), kept on the server so reopening an order after a
 * reload, on another device or at another station resumes where packing stopped (Logiwa keeps
 * the packed quantities of a "Packing Started" order).
 *
 * Storage: table `pack_drafts` (one row per order). It is created on first use with
 * `CREATE TABLE IF NOT EXISTS`, so a database without the foundation migration still works.
 * The draft is cleared when packing completes or an issue is reported.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { DomainError } from "@/server/domain/errors";
import type { DomainCtx } from "@/server/domain/types";
import { idSchema } from "./platform-common";

const ensured = new WeakSet<object>();

/** Creates `pack_drafts` when the database does not have it yet (idempotent, cheap). */
export function ensurePackDraftTable(db: AppDb): void {
  if (ensured.has(db)) return;
  db.run(sql`CREATE TABLE IF NOT EXISTS pack_drafts (
    order_id TEXT PRIMARY KEY NOT NULL,
    station_id TEXT,
    state TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL
  )`);
  ensured.add(db);
}

const num = z.number().finite();
const boxSchema = z.object({
  seq: z.number().int().min(1).max(50),
  shipmentPackageId: z.string().max(64).nullable(),
  length: num.nullable(),
  width: num.nullable(),
  height: num.nullable(),
  weightLb: num.nullable(),
  weightOz: num.nullable(),
  items: z.record(z.string().max(64), z.number().int().min(0).max(100_000)),
  closed: z.boolean(),
});
const quoteSchema = z.object({
  carrierServiceId: z.string().max(64),
  serviceName: z.string().max(200),
  carrierCode: z.string().max(64),
  price: num,
  amount: num,
  currency: z.string().max(8),
  transitDays: num,
  carrierConnectionId: z.string().max(64),
});

export const packDraftStateSchema = z.object({
  boxes: z.array(boxSchema).min(1).max(50),
  active: z.number().int().min(0).max(49),
  captures: z.record(z.string().max(64), z.object({
    serials: z.array(z.string().max(120)).max(10_000),
    lotNumber: z.string().max(120),
    expiryDate: z.string().max(40),
  })),
  choice: z.object({ carrierKey: z.string().max(200).nullable(), carrierServiceId: z.string().max(64).nullable() }).nullable(),
  /** Last quote and the package/service signature it was fetched for. */
  rate: z.object({ sig: z.string().max(4000), quote: quoteSchema }).nullable(),
});
export type PackDraftState = z.output<typeof packDraftStateSchema>;

export const saveDraftSchema = z.object({ stationId: idSchema.nullish(), state: packDraftStateSchema });

export interface PackDraft {
  readonly state: PackDraftState;
  readonly stationId: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
  readonly updatedByName: string | null;
}

interface DraftRow { readonly state: string; readonly stationId: string | null; readonly updatedAt: string; readonly updatedBy: string | null; readonly updatedByName: string | null }

/** The saved draft of an order, or null (missing, or unreadable JSON). */
export function readPackDraft(db: AppDb, orderId: string): PackDraft | null {
  ensurePackDraftTable(db);
  const row = db.get<DraftRow>(sql`SELECT d.state, d.station_id AS stationId, d.updated_at AS updatedAt, d.updated_by AS updatedBy, u.name AS updatedByName
    FROM pack_drafts d LEFT JOIN users u ON u.id = d.updated_by WHERE d.order_id = ${orderId}`);
  if (!row) return null;
  try {
    const parsed = packDraftStateSchema.safeParse(JSON.parse(row.state));
    return parsed.success ? { state: parsed.data, stationId: row.stationId, updatedAt: row.updatedAt, updatedBy: row.updatedBy, updatedByName: row.updatedByName ?? null } : null;
  } catch {
    return null;
  }
}

/** Pure: drop a draft that no longer fits the order (a line vanished or more is packed than is left to pack). */
export function draftFits(state: PackDraftState, lines: readonly { readonly orderLineId: string; readonly toPack: number }[]): boolean {
  const toPack = new Map(lines.map((l) => [l.orderLineId, l.toPack]));
  const packed = new Map<string, number>();
  for (const b of state.boxes) for (const [id, q] of Object.entries(b.items)) packed.set(id, (packed.get(id) ?? 0) + q);
  for (const [id, q] of packed) {
    if (q === 0) continue;
    const max = toPack.get(id);
    if (max === undefined || q > max) return false;
  }
  return state.active < state.boxes.length;
}

export function savePackDraft(db: AppDb, ctx: DomainCtx & { readonly scope: Scope }, orderId: string, input: z.output<typeof saveDraftSchema>, packable: { readonly status: string; readonly lines: readonly { readonly orderLineId: string; readonly toPack: number }[] }): { readonly savedAt: string } {
  if (!["Ready to Pack", "Packing Started"].includes(packable.status)) throw new DomainError("INVALID_STATE", `The order is ${packable.status}; its packing progress is no longer kept.`);
  if (!draftFits(input.state, packable.lines)) throw new DomainError("VALIDATION", "The packed quantities do not match the order any more. Reload the order.");
  ensurePackDraftTable(db);
  const now = new Date().toISOString();
  const json = JSON.stringify(input.state);
  if (json.length > 400_000) throw new DomainError("VALIDATION", "Packing progress is too large to save.");
  db.run(sql`INSERT INTO pack_drafts (order_id, station_id, state, updated_by, updated_at) VALUES (${orderId}, ${input.stationId ?? null}, ${json}, ${ctx.userId}, ${now})
    ON CONFLICT(order_id) DO UPDATE SET station_id = excluded.station_id, state = excluded.state, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
  return { savedAt: now };
}

export function clearPackDraft(db: AppDb, orderId: string): void {
  ensurePackDraftTable(db);
  db.run(sql`DELETE FROM pack_drafts WHERE order_id = ${orderId}`);
}
