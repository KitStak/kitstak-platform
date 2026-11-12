/**
 * Grid-grammar filter <-> stored `FilterCondition` (wave-rule filters, job-type conditions).
 * The stored value is what `domain/conditions.evaluateFilter` expects. PURE.
 */
import type { FilterFieldDef } from "@/components/grid/grid-types";
import { describeFilterValue } from "@/components/grid/filter-builder/filter-model";
import type { FilterCondition } from "@/lib/domain-types";
import { parseDateSpec, serializeDateSpec } from "@/server/query/date-presets";
import type { GridFilter } from "@/server/query/grid-query";

export function conditionLabel(filter: GridFilter, def?: FilterFieldDef): string {
  return `${def?.label ?? filter.field} ${describeFilterValue(filter, def)}`.trim();
}

export function toCondition(filter: GridFilter, def?: FilterFieldDef): FilterCondition {
  const label = conditionLabel(filter, def);
  switch (filter.op) {
    case "in":
    case "nin":
      return { field: filter.field, op: filter.op, value: [...filter.values], label };
    case "eq":
    case "ct":
    case "sw":
    case "ew":
      return { field: filter.field, op: filter.op, value: filter.value, label };
    case "ex":
      return { field: filter.field, op: "empty", value: false, label };
    case "empty":
      return { field: filter.field, op: "empty", value: true, label };
    case "rng":
      return { field: filter.field, op: "rng", value: `${filter.min ?? ""}..${filter.max ?? ""}`, label };
    case "bool":
      return { field: filter.field, op: "bool", value: filter.value, label };
    case "date":
      return { field: filter.field, op: "date", value: serializeDateSpec(filter.date), label };
  }
}

export function fromCondition(c: FilterCondition): GridFilter | null {
  const v = c.value;
  switch (c.op) {
    case "in":
    case "nin":
      return { field: c.field, op: c.op, values: (Array.isArray(v) ? v : [v]).filter((x) => x !== null).map(String) };
    case "eq":
    case "ct":
    case "sw":
    case "ew":
      return { field: c.field, op: c.op, value: String(v ?? "") };
    case "empty":
      return { field: c.field, op: v === false ? "ex" : "empty" };
    case "ex":
      return { field: c.field, op: "ex" };
    case "rng": {
      const [min, max] = typeof v === "string" ? v.split("..") : Array.isArray(v) ? v.map(String) : [];
      return { field: c.field, op: "rng", ...(min ? { min } : {}), ...(max ? { max } : {}) };
    }
    case "bool":
      return { field: c.field, op: "bool", value: v === true || v === "true" || v === 1 };
    case "date": {
      const spec = typeof v === "string" ? parseDateSpec(v) : null;
      return spec ? { field: c.field, op: "date", date: spec } : null;
    }
    default:
      return null;
  }
}

/** Replaces (same field) or appends a condition. */
export function upsertCondition(list: readonly FilterCondition[], next: FilterCondition): FilterCondition[] {
  const i = list.findIndex((c) => c.field === next.field);
  return i < 0 ? [...list, next] : list.map((c, j) => (j === i ? next : c));
}

/** Moves item `from` to index `to` (immutable). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
