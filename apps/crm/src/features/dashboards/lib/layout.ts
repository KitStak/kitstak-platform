/**
 * 12-column dashboard grid engine (pure). Widgets are rectangles in grid units; every change
 * re-packs the layout with vertical gravity so there are never gaps or overlaps.
 *
 * Ordering rule while dragging: items are packed in order of their vertical centre, so a dragged
 * widget swaps with a neighbour once its centre passes the neighbour's centre — the same feel as
 * mature grid libraries, without the dependency.
 */
export const GRID_COLUMNS = 12;
export const ROW_HEIGHT = 40;
export const GRID_GAP = 16;

export interface GridItem {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SizeLimits {
  readonly minW: number;
  readonly minH: number;
  readonly maxH?: number;
}

export function collides(a: GridItem, b: GridItem): boolean {
  if (a.id === b.id) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function clampItem(item: GridItem, limits: SizeLimits = { minW: 1, minH: 1 }, cols: number = GRID_COLUMNS): GridItem {
  const w = Math.min(Math.max(Math.round(item.w), Math.min(limits.minW, cols)), cols);
  const h = Math.min(Math.max(Math.round(item.h), limits.minH), limits.maxH ?? 48);
  const x = Math.min(Math.max(Math.round(item.x), 0), cols - w);
  const y = Math.max(Math.round(item.y), 0);
  return { ...item, x, y, w, h };
}

/** Lowest y at which `item` fits above nothing in `placed` (gravity). */
function settle(item: GridItem, placed: readonly GridItem[]): GridItem {
  let y = 0;
  for (;;) {
    const candidate = { ...item, y };
    const blocker = placed.find((other) => collides(candidate, other));
    if (!blocker) return candidate;
    y = blocker.y + blocker.h;
  }
}

/** Pack items in the given order, each falling as far up as it can. */
function pack(ordered: readonly GridItem[]): GridItem[] {
  const placed: GridItem[] = [];
  for (const item of ordered) placed.push(settle(item, placed));
  return placed;
}

function byPosition(a: GridItem, b: GridItem): number {
  return a.y - b.y || a.x - b.x;
}

/** Remove gaps/overlaps, keeping reading order (top to bottom, left to right). */
export function compact(layout: readonly GridItem[], cols: number = GRID_COLUMNS): GridItem[] {
  return pack([...layout].map((item) => clampItem(item, undefined, cols)).sort(byPosition));
}

/**
 * Move `id` to (x, y) and re-pack. Items are ordered by vertical centre; the moved item wins
 * ties when moving up and yields when moving down.
 */
export function moveItem(layout: readonly GridItem[], id: string, x: number, y: number, cols: number = GRID_COLUMNS): GridItem[] {
  const current = layout.find((item) => item.id === id);
  if (!current) return compact(layout, cols);
  const moved = clampItem({ ...current, x, y }, undefined, cols);
  // Dropping onto a same-sized widget swaps the two (KPI rows reorder sideways instead of the
  // dragged card falling below its neighbour).
  const blockers = layout.filter((item) => item.id !== id && collides(moved, item));
  const target = blockers[0];
  if (blockers.length === 1 && target && target.w === current.w && target.h === current.h && target.y === moved.y) {
    return compact(
      layout.map((item) =>
        item.id === id ? { ...moved, x: target.x, y: target.y } : item.id === target.id ? { ...target, x: current.x, y: current.y } : item,
      ),
      cols,
    );
  }
  const movingUp = moved.y < current.y;
  const centre = (item: GridItem) => item.y + item.h / 2;
  const others = layout.filter((item) => item.id !== id).map((item) => clampItem(item, undefined, cols));
  const ordered = [...others, moved].sort((a, b) => {
    const diff = centre(a) - centre(b);
    if (Math.abs(diff) > 1e-9) return diff;
    if (a.id === id) return movingUp ? -1 : 1;
    if (b.id === id) return movingUp ? 1 : -1;
    return a.x - b.x;
  });
  // The moved item keeps its column; others keep theirs. Pack the moved item first among its
  // centre-peers so it lands where the pointer is.
  return pack(ordered);
}

/** Resize `id` to (w, h) and re-pack; neighbours below are pushed down. */
export function resizeItem(
  layout: readonly GridItem[],
  id: string,
  w: number,
  h: number,
  limits: SizeLimits = { minW: 1, minH: 1 },
  cols: number = GRID_COLUMNS,
): GridItem[] {
  const ordered = [...layout]
    .map((item) => (item.id === id ? clampItem({ ...item, w, h }, limits, cols) : clampItem(item, undefined, cols)))
    .sort((a, b) => a.y - b.y || (a.id === id ? -1 : b.id === id ? 1 : a.x - b.x));
  return pack(ordered);
}

/** First top-left slot where a w×h widget fits without moving anything. */
export function firstFreeSlot(layout: readonly GridItem[], w: number, h: number): { x: number; y: number } {
  const width = Math.min(Math.max(w, 1), GRID_COLUMNS);
  const bottom = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + width <= GRID_COLUMNS; x += 1) {
      const probe = { id: '__probe__', x, y, w: width, h };
      if (!layout.some((item) => collides(probe, item))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

export function layoutHeight(layout: readonly GridItem[]): number {
  return layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/** Items whose geometry differs between two layouts (what needs saving). */
export function changedItems(before: readonly GridItem[], after: readonly GridItem[]): GridItem[] {
  return after.filter((item) => {
    const previous = before.find((entry) => entry.id === item.id);
    return !previous || previous.x !== item.x || previous.y !== item.y || previous.w !== item.w || previous.h !== item.h;
  });
}

/** Pixel geometry of a grid item for a container of `width` px. */
export function toPixels(
  item: GridItem,
  width: number,
  cols: number = GRID_COLUMNS,
): { left: number; top: number; width: number; height: number } {
  const colWidth = (width - GRID_GAP * (cols - 1)) / cols;
  return {
    left: item.x * (colWidth + GRID_GAP),
    top: item.y * (ROW_HEIGHT + GRID_GAP),
    width: item.w * colWidth + (item.w - 1) * GRID_GAP,
    height: item.h * ROW_HEIGHT + (item.h - 1) * GRID_GAP,
  };
}

/** Grid cell nearest to a pixel offset. */
export function toCell(left: number, top: number, width: number, cols: number = GRID_COLUMNS): { x: number; y: number } {
  const colWidth = (width - GRID_GAP * (cols - 1)) / cols;
  return { x: Math.round(left / (colWidth + GRID_GAP)), y: Math.round(top / (ROW_HEIGHT + GRID_GAP)) };
}

/** Grid size nearest to a pixel size. */
export function toSpan(widthPx: number, heightPx: number, width: number, cols: number = GRID_COLUMNS): { w: number; h: number } {
  const colWidth = (width - GRID_GAP * (cols - 1)) / cols;
  return {
    w: Math.max(1, Math.round((widthPx + GRID_GAP) / (colWidth + GRID_GAP))),
    h: Math.max(1, Math.round((heightPx + GRID_GAP) / (ROW_HEIGHT + GRID_GAP))),
  };
}

/** Phones (viewport) stack; narrow containers use a 6-column remap; everything else is 12. */
export const STACK_VIEWPORT = 480;
export const FULL_GRID_MIN_WIDTH = 640;

export function columnsFor(containerWidth: number, viewportWidth: number): 1 | 6 | 12 {
  if (viewportWidth > 0 && viewportWidth < STACK_VIEWPORT) return 1;
  if (containerWidth > 0 && containerWidth < FULL_GRID_MIN_WIDTH) return 6;
  return 12;
}

/** Map a 12-column layout onto `cols` columns (halving positions and widths), then compact. */
export function remapLayout(layout: readonly GridItem[], cols: number): GridItem[] {
  if (cols >= GRID_COLUMNS) return compact(layout);
  const ratio = GRID_COLUMNS / cols;
  return compact(
    layout.map((item) => ({ ...item, x: Math.floor(item.x / ratio), w: Math.max(1, Math.ceil(item.w / ratio)) })),
    cols,
  );
}

/** Map items edited on a `cols` grid back to 12-column geometry for saving. */
export function toFullColumns(layout: readonly GridItem[], cols: number): GridItem[] {
  if (cols >= GRID_COLUMNS) return [...layout];
  const ratio = GRID_COLUMNS / cols;
  return layout.map((item) => {
    const w = Math.min(item.w * ratio, GRID_COLUMNS);
    return { ...item, w, x: Math.min(item.x * ratio, GRID_COLUMNS - w) };
  });
}

/**
 * Re-pack in reading order filling holes left to right ("Tidy up"): each widget takes the first
 * top-left slot where it fits, so gaps beside short widgets close up.
 */
export function tidyLayout(layout: readonly GridItem[]): GridItem[] {
  const placed: GridItem[] = [];
  for (const item of [...layout].map((entry) => clampItem(entry)).sort(byPosition)) {
    const slot = firstFreeSlot(placed, item.w, item.h);
    placed.push({ ...item, ...slot });
  }
  return placed;
}
