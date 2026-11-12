/**
 * Server multi-sort helpers: grid-grammar `SortSpec[]` ↔ column clicks. PURE.
 *   click        asc → desc → off (replaces the other sorts)
 *   shift-click  same cycle, but keeps the other sorts (multi-sort, max MAX_SORTS)
 */
import { MAX_SORTS, type SortSpec } from "@/server/query/grid-query";

export function nextSort(current: readonly SortSpec[], field: string, additive: boolean): readonly SortSpec[] {
  const existing = current.find((s) => s.field === field);
  const cycled: SortSpec | null = !existing ? { field, dir: "asc" } : existing.dir === "asc" ? { field, dir: "desc" } : null;
  if (!additive) return cycled ? [cycled] : [];
  const others = current.filter((s) => s.field !== field);
  if (!cycled) return others;
  const index = current.findIndex((s) => s.field === field);
  const next = index >= 0 ? [...current.slice(0, index), cycled, ...current.slice(index + 1)] : [...others, cycled];
  return next.slice(0, MAX_SORTS);
}

export interface SortIndicator {
  readonly dir: "asc" | "desc";
  /** 1-based position when more than one sort is active. */
  readonly position: number | null;
}

export function sortIndicator(sort: readonly SortSpec[], field: string): SortIndicator | null {
  const index = sort.findIndex((s) => s.field === field);
  if (index < 0) return null;
  const spec = sort[index];
  return spec ? { dir: spec.dir, position: sort.length > 1 ? index + 1 : null } : null;
}
