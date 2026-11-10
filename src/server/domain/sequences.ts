/**
 * Code sequences (BUILD_PLAN 0.4 #4): `next(tx, key, warehouseId?)` hands out
 * `SO000123`, `PO000045`, `Job000201`, ... from `code_sequences`.
 *
 * A missing sequence row is created on first use. Its start value is bootstrapped
 * from the highest existing code in the owning table, so codes written before the
 * sequence existed (legacy seed, imports) never collide.
 */
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { DomainError } from "./errors";
import type { Tx } from "./types";

export const GLOBAL_WAREHOUSE = "*";

interface SequenceDefault {
  readonly prefix: string;
  readonly padding: number;
  /** Table/column scanned to bootstrap the first value. */
  readonly source?: { readonly table: string; readonly column: string };
}

export const SEQUENCE_DEFAULTS = {
  so: { prefix: "SO", padding: 6, source: { table: "shipment_orders", column: "code" } },
  po: { prefix: "PO", padding: 6, source: { table: "purchase_orders", column: "code" } },
  job: { prefix: "Job", padding: 6, source: { table: "jobs", column: "code" } },
  rma: { prefix: "RMA", padding: 6, source: { table: "return_orders", column: "rma_code" } },
  count: { prefix: "CNT", padding: 6, source: { table: "count_plans", column: "code" } },
  workOrder: { prefix: "WO", padding: 6, source: { table: "work_orders", column: "code" } },
  shipmentPlan: { prefix: "SP", padding: 6, source: { table: "shipment_plans", column: "code" } },
  bill: { prefix: "", padding: 3 },
} as const satisfies Record<string, SequenceDefault>;

export type SequenceKey = keyof typeof SEQUENCE_DEFAULTS | (string & {});

const IDENT_RE = /^[a-z_]+$/;

function defaultsFor(key: string): SequenceDefault {
  return (SEQUENCE_DEFAULTS as Record<string, SequenceDefault>)[key] ?? { prefix: key.toUpperCase(), padding: 6 };
}

export function formatCode(prefix: string, value: number, padding: number): string {
  return `${prefix}${String(value).padStart(padding, "0")}`;
}

function maxExistingSuffix(tx: Tx, def: SequenceDefault): number {
  if (!def.source || !IDENT_RE.test(def.source.table) || !IDENT_RE.test(def.source.column)) return 0;
  const { table, column } = def.source;
  const prefixLen = def.prefix.length;
  const row = tx.get<{ maxValue: number | null }>(sql`
    SELECT MAX(CAST(SUBSTR(${sql.raw(column)}, ${prefixLen + 1}) AS INTEGER)) AS maxValue
    FROM ${sql.raw(table)}
    WHERE ${sql.raw(column)} LIKE ${`${def.prefix}%`}
      AND SUBSTR(${sql.raw(column)}, ${prefixLen + 1}) GLOB '[0-9]*'
      AND SUBSTR(${sql.raw(column)}, ${prefixLen + 1}) NOT GLOB '*[^0-9]*'`);
  return row?.maxValue ?? 0;
}

function ensureRow(tx: Tx, key: string, warehouseId: string): typeof schema.codeSequences.$inferSelect {
  const existing = tx.select().from(schema.codeSequences)
    .where(and(eq(schema.codeSequences.key, key), eq(schema.codeSequences.warehouseId, warehouseId))).get();
  if (existing) return existing;
  const def = defaultsFor(key);
  const row = { key, warehouseId, prefix: def.prefix, padding: def.padding, nextValue: maxExistingSuffix(tx, def) + 1, autoGenerate: true };
  tx.insert(schema.codeSequences).values(row).onConflictDoNothing().run();
  return tx.select().from(schema.codeSequences)
    .where(and(eq(schema.codeSequences.key, key), eq(schema.codeSequences.warehouseId, warehouseId))).get() ?? row;
}

/** Consumes and returns the next numeric value for `key`. */
export function nextValue(tx: Tx, key: SequenceKey, warehouseId: string = GLOBAL_WAREHOUSE): number {
  ensureRow(tx, key, warehouseId);
  const updated = tx.update(schema.codeSequences)
    .set({ nextValue: sql`${schema.codeSequences.nextValue} + 1` })
    .where(and(eq(schema.codeSequences.key, key), eq(schema.codeSequences.warehouseId, warehouseId)))
    .returning({ value: schema.codeSequences.nextValue }).get();
  if (!updated) throw new DomainError("CONFLICT", `Sequence ${key} could not be advanced`);
  return updated.value - 1;
}

/** Consumes and returns the next formatted code, e.g. `SO000124`. */
export function next(tx: Tx, key: SequenceKey, warehouseId: string = GLOBAL_WAREHOUSE): string {
  const row = ensureRow(tx, key, warehouseId);
  return formatCode(row.prefix, nextValue(tx, key, warehouseId), row.padding);
}

/** The code `next()` would return, without consuming it (wizard "auto generated" link). */
export function peek(tx: Tx, key: SequenceKey, warehouseId: string = GLOBAL_WAREHOUSE): string {
  const row = tx.select().from(schema.codeSequences)
    .where(and(eq(schema.codeSequences.key, key), eq(schema.codeSequences.warehouseId, warehouseId))).get();
  if (row) return formatCode(row.prefix, row.nextValue, row.padding);
  const def = defaultsFor(key);
  return formatCode(def.prefix, maxExistingSuffix(tx, def) + 1, def.padding);
}

/** Wave number `<ruleSeq>-<runCount>`. */
export const waveNumber = (ruleSeq: number, runCount: number): string => `${ruleSeq}-${runCount}`;

/** Instant count code `IC<yyyyMMddHHmmssfff>` (UTC). */
export function instantCountCode(at: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `IC${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}${p(at.getUTCMilliseconds(), 3)}`;
}

/** Bill number `YYMMDD<seq>`; the sequence restarts every day. */
export function billNumber(tx: Tx, at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${p(at.getUTCFullYear() % 100)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}`;
  const value = nextValue(tx, `bill:${day}`);
  return `${day}${String(value).padStart(SEQUENCE_DEFAULTS.bill.padding, "0")}`;
}

/** Next LP number for an LP type: `<numberPrefix><zero-pad numberLength>`. */
export function nextLpNumber(tx: Tx, lpTypeId: string): string {
  const updated = tx.update(schema.lpTypes)
    .set({ nextSequence: sql`${schema.lpTypes.nextSequence} + 1` })
    .where(eq(schema.lpTypes.id, lpTypeId))
    .returning({ next: schema.lpTypes.nextSequence, prefix: schema.lpTypes.numberPrefix, length: schema.lpTypes.numberLength })
    .get();
  if (!updated) throw new DomainError("NOT_FOUND", "LP type not found");
  return formatCode(updated.prefix, updated.next - 1, updated.length);
}

/** Integer-only sequences (e.g. receipt master ids). */
export const nextInteger = (tx: Tx, key: string): number => nextValue(tx, key);

