/**
 * Auto Code Generation Preferences (M14 Data Setup): per sequence key (SO, PO, WO, RMA, SP,
 * CNT) choose "Auto generate as" (prefix + start number + length) or "Keep adding manually".
 * Writes `code_sequences` rows for the global scope ("*") and logs `change_log` ("code_sequence").
 */
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { peek } from "@/server/domain/sequences";
import { SEQUENCE_DEFS, sequencePreview, type sequenceSchema, type SequenceKey } from "@/lib/grid-defs/admin/lookups";
import { domainCtxOf, logUpdate, type Actor } from "./users-shared";

const c = s.codeSequences;
const GLOBAL = "*";
export const SEQUENCE_ENTITY = "code_sequence";

export interface SequenceRow {
  readonly key: SequenceKey;
  readonly label: string;
  readonly entity: string;
  readonly prefix: string;
  readonly nextValue: number;
  readonly padding: number;
  readonly autoGenerate: boolean;
  readonly nextCode: string;
}

function load(db: AppDb, key: SequenceKey): typeof c.$inferSelect | undefined {
  return db.select().from(c).where(and(eq(c.key, key), eq(c.warehouseId, GLOBAL))).get();
}

export function listSequences(db: AppDb): SequenceRow[] {
  return SEQUENCE_DEFS.map((d) => {
    const row = load(db, d.key);
    const prefix = row?.prefix ?? d.example;
    const padding = row?.padding ?? 6;
    // Without a row yet, the domain derives the next code from existing records.
    const nextCode = row ? sequencePreview(prefix, row.nextValue, padding) : peek(db, d.key as never);
    const nextValue = row?.nextValue ?? (Number(nextCode.slice(prefix.length)) || 1);
    return { key: d.key, label: d.label, entity: d.entity, prefix, nextValue, padding, autoGenerate: row?.autoGenerate ?? true, nextCode };
  });
}

export function updateSequence(tx: AppDb, auth: AuthContext, actor: Actor, input: z.output<typeof sequenceSchema>): SequenceRow {
  const def = SEQUENCE_DEFS.find((d) => d.key === input.key);
  if (!def) throw new AppError("VALIDATION", "Unknown sequence");
  const before = load(tx, input.key);
  const prefix = input.prefix.toUpperCase();
  if (before && input.autoGenerate && prefix === before.prefix && input.nextValue < before.nextValue) {
    throw new AppError("VALIDATION", `Codes up to ${sequencePreview(before.prefix, before.nextValue - 1, before.padding)} already exist. Start at ${before.nextValue} or higher, or change the prefix.`, { fieldErrors: { nextValue: [`Use ${before.nextValue} or higher with prefix ${before.prefix}`] } });
  }
  const values = { prefix, nextValue: input.nextValue, padding: input.padding, autoGenerate: input.autoGenerate };
  if (before) tx.update(c).set(values).where(and(eq(c.key, input.key), eq(c.warehouseId, GLOBAL))).run();
  else tx.insert(c).values({ key: input.key, warehouseId: GLOBAL, ...values }).run();
  const view = (v: { prefix: string; nextValue: number; padding: number; autoGenerate: boolean }) => ({
    mode: v.autoGenerate ? "Auto generate" : "Keep adding manually", prefix: v.prefix, nextCode: sequencePreview(v.prefix, v.nextValue, v.padding),
  });
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: SEQUENCE_ENTITY, entityId: input.key, entityCode: def.label }, before ? view(before) : {}, view(values));
  return listSequences(tx).find((r) => r.key === input.key)!;
}
