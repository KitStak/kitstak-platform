import type { FilterFieldDef } from "@/components/grid/grid-types";

/** Marks the list's benchmark filter fields (grid-defs `*_FILTER_PRESET`) so the filter builder pins them by default. */
export function withFilterPreset(fields: readonly FilterFieldDef[], preset: readonly string[]): readonly FilterFieldDef[] {
  const set = new Set(preset);
  return fields.map((f) => (set.has(f.field) ? { ...f, preset: true } : f));
}
