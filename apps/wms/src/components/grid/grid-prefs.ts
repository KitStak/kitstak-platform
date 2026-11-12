/**
 * Per-user grid preferences (column visibility, order, widths, pins, density, page
 * size). PURE helpers: zod parsing of the stored/remote shape and reconciliation with
 * the grid's current column set (columns may be added or removed between releases).
 */
import { z } from "zod";
import {
  DEFAULT_DENSITY,
  GRID_DENSITIES,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  PAGE_SIZE_OPTIONS,
  type GridDensity,
  type GridPrefs,
} from "./grid-types";
import { DEFAULT_PAGE_SIZE } from "@/server/query/grid-query";

const MAX_COLUMNS = 200;

export const gridPrefsSchema = z.object({
  visible: z.array(z.string().max(120)).max(MAX_COLUMNS).default([]),
  order: z.array(z.string().max(120)).max(MAX_COLUMNS).default([]),
  widths: z.record(z.string().max(120), z.number().finite()).default({}),
  density: z.enum(GRID_DENSITIES as [GridDensity, ...GridDensity[]]).default(DEFAULT_DENSITY),
  pageSize: z.number().int().positive().default(DEFAULT_PAGE_SIZE),
  pinned: z.array(z.string().max(120)).max(MAX_COLUMNS).optional(),
});

/** Describes one configurable column (system columns such as select/kebab excluded). */
export interface PrefColumn {
  readonly id: string;
  readonly defaultVisible: boolean;
  readonly alwaysVisible: boolean;
  /** Pinned left until the user changes pins (column meta `defaultPinned`). */
  readonly defaultPinned?: boolean;
}

export function defaultGridPrefs(columns: readonly PrefColumn[]): GridPrefs {
  return {
    visible: columns.filter((c) => c.defaultVisible || c.alwaysVisible).map((c) => c.id),
    order: columns.map((c) => c.id),
    widths: {},
    density: DEFAULT_DENSITY,
    pageSize: DEFAULT_PAGE_SIZE,
    pinned: columns.filter((c) => c.defaultPinned).map((c) => c.id),
  };
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

function nearestPageSize(size: number): number {
  return PAGE_SIZE_OPTIONS.includes(size) ? size : DEFAULT_PAGE_SIZE;
}

/**
 * Parses an untrusted prefs payload (API or storage) and reconciles it with the
 * current columns: unknown ids are dropped, new columns are appended at their default
 * position/visibility, always-visible columns are forced on.
 */
export function reconcileGridPrefs(raw: unknown, columns: readonly PrefColumn[]): GridPrefs {
  const defaults = defaultGridPrefs(columns);
  const parsed = gridPrefsSchema.safeParse(raw);
  if (!parsed.success || raw === null || raw === undefined) return defaults;
  const stored = parsed.data;
  const known = new Set(columns.map((c) => c.id));
  const storedOrder = stored.order.filter((id) => known.has(id));
  const storedKnown = new Set([...storedOrder, ...stored.visible.filter((id) => known.has(id))]);
  const fresh = columns.filter((c) => !storedOrder.includes(c.id));
  const order = [...storedOrder, ...fresh.map((c) => c.id)];
  const visibleSet = new Set(stored.visible.filter((id) => known.has(id)));
  for (const c of columns) {
    if (c.alwaysVisible) visibleSet.add(c.id);
    else if (!storedKnown.has(c.id) && c.defaultVisible) visibleSet.add(c.id);
  }
  const widths = Object.fromEntries(
    Object.entries(stored.widths).filter(([id]) => known.has(id)).map(([id, w]) => [id, clampWidth(w)])
  );
  return {
    visible: order.filter((id) => visibleSet.has(id)),
    order,
    widths,
    density: stored.density,
    pageSize: nearestPageSize(stored.pageSize),
    // No stored pins yet: start from the columns pinned by default.
    pinned: stored.pinned === undefined ? defaults.pinned : stored.pinned.filter((id) => known.has(id)),
  };
}

export function visibilityMap(prefs: GridPrefs): Readonly<Record<string, boolean>> {
  const visible = new Set(prefs.visible);
  return Object.fromEntries(prefs.order.map((id) => [id, visible.has(id)]));
}

/** Moves `id` to sit before `targetId` (or to the end when target is null). */
export function moveColumn(order: readonly string[], id: string, targetId: string | null): readonly string[] {
  if (id === targetId || !order.includes(id)) return order;
  const without = order.filter((x) => x !== id);
  if (targetId === null) return [...without, id];
  const index = without.indexOf(targetId);
  if (index < 0) return order;
  return [...without.slice(0, index), id, ...without.slice(index)];
}

export function togglePinned(pinned: readonly string[], id: string): readonly string[] {
  return pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
}

export function prefsEqual(a: GridPrefs, b: GridPrefs): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
