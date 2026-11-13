/**
 * Pure helpers behind the view cursor (j/k in List and Board). Kept DOM free so they are unit
 * tested; `view-cursor.tsx` feeds them element indexes and bounding boxes.
 */

/** Next row index for a j/k (delta ±1) step. No cursor yet (-1) lands on the first row. */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}

export interface CellBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** How many cards the cell holds (empty cells are skipped). */
  readonly count: number;
}

/**
 * Board column move (h/l or ←/→ with no card focused): the nearest cell to the left or right
 * that shares the current cell's row (swimlane) and has cards. -1 when there is none.
 */
export function neighbourCell(cells: readonly CellBox[], current: number, direction: 1 | -1): number {
  const from = cells[current];
  if (!from) return -1;
  const centre = (from.left + from.right) / 2;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  cells.forEach((cell, index) => {
    if (index === current || cell.count === 0) return;
    const overlaps = cell.top < from.bottom && cell.bottom > from.top;
    if (!overlaps) return;
    const distance = ((cell.left + cell.right) / 2 - centre) * direction;
    if (distance <= 0) return;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

export type CursorField = 'status' | 'assignee' | 'priority' | 'labels' | 'due';

/** Single-key property hotkeys on the cursor task (Linear style). `L` (shift) also opens labels. */
export function fieldForKey(key: string, mode: 'list' | 'board'): CursorField | null {
  switch (key) {
    case 's':
      return 'status';
    case 'a':
      return 'assignee';
    case 'p':
      return 'priority';
    case 'd':
      return 'due';
    case 'L':
      return 'labels';
    case 'l':
      // On a board, l moves right a column (h/l), so labels live on Shift+L there.
      return mode === 'list' ? 'labels' : null;
    default:
      return null;
  }
}
