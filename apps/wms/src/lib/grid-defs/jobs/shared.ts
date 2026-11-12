/**
 * Shared helpers for the M03 grid definitions (pure TS: imported by the client filter
 * builder and by the server SQL compilers in `src/server/repositories/jobs-grid.ts`).
 */
import type { FilterFieldDef, FilterOptionDef } from "@/components/grid/grid-types";
import type { GridFilter } from "@/server/query/grid-query";

export const opts = (values: readonly string[]): readonly FilterOptionDef[] => values.map((value) => ({ value, label: value }));

export const BOOL_OPTIONS = opts(["Yes", "No"]);

/** Field list helper: keeps the definition terse while staying a plain FilterFieldDef. */
export function field(field: string, label: string, type: FilterFieldDef["type"], extra: Partial<FilterFieldDef> = {}): FilterFieldDef {
  return { field, label, type, ...extra };
}

/** "Job Status in Pending, Started" — the Logiwa default chip on jobs and task details. */
export const OPEN_WORK_FILTER = (field: string): GridFilter => ({ field, op: "in", values: ["Pending", "Started"] });

export interface GridSpec {
  readonly gridKey: string;
  readonly fields: readonly FilterFieldDef[];
  /** Server sort keys (grid column id = sort key). */
  readonly sortKeys: readonly string[];
  /** Quick search targets (Equal / Starts With). */
  readonly searchFields: readonly string[];
  readonly searchPlaceholder: string;
}
