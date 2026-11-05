import type { OrderRow } from "./orders-types";

/**
 * Deterministic mock-priority enrichment for the Shipment Orders list.
 *
 * The server-side mock seed leaves `priority` empty on almost every order, so
 * the Priority column rendered as a wall of em-dashes. The seed modules live
 * in read-only shared code, so we adapt locally: a stable hash of the order
 * code assigns Low / Medium / High to roughly {@link SEEDED_PRIORITY_PERCENT}%
 * of rows that carry no priority. Rows that already have a real priority pass
 * through untouched, and the same order always hashes to the same value, so
 * the column is stable across fetches, pagination, and refreshes.
 */
const SEEDED_PRIORITY_PERCENT = 35;
const SEEDED_PRIORITY_LEVELS: readonly string[] = ["Low", "Medium", "High"];
const DEFAULT_SEEDED_LEVEL = "Medium";

/** FNV-1a — tiny, stable, dependency-free string hash. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hasPriority(row: OrderRow): boolean {
  return row.priority.length > 0 && row.priority.toLowerCase() !== "none";
}

/** Returns a new row with a seeded priority, or the original row unchanged. */
export function withSeededPriority(row: OrderRow): OrderRow {
  if (hasPriority(row)) return row;
  const hash = hashString(row.code);
  if (hash % 100 >= SEEDED_PRIORITY_PERCENT) return row;
  const levelIndex = Math.floor(hash / 100) % SEEDED_PRIORITY_LEVELS.length;
  return { ...row, priority: SEEDED_PRIORITY_LEVELS[levelIndex] ?? DEFAULT_SEEDED_LEVEL };
}
