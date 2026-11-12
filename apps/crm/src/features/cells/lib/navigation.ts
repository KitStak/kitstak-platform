/**
 * DOM fallback for cell-to-cell keyboard movement when the host grid does not pass
 * `onNavigate`: cells are found by `[data-ks-cell]` inside the nearest grid (or scope).
 */
import type { CellNavDirection } from '../types';

const CELL = '[data-ks-cell]';

function scopeOf(cell: HTMLElement): ParentNode {
  return cell.closest('[role="grid"], [data-cell-scope]') ?? cell.ownerDocument;
}

export function focusSiblingCell(cell: HTMLElement, direction: CellNavDirection): boolean {
  const cells = Array.from(scopeOf(cell).querySelectorAll<HTMLElement>(CELL));
  let target: HTMLElement | undefined;
  if (direction === 'next' || direction === 'prev') {
    const index = cells.indexOf(cell);
    target = cells[index + (direction === 'next' ? 1 : -1)];
  } else {
    const key = cell.dataset.columnKey;
    const column = cells.filter((entry) => entry.dataset.columnKey === key);
    const index = column.indexOf(cell);
    target = column[index + (direction === 'down' ? 1 : -1)];
  }
  (target ?? cell).focus({ preventScroll: false });
  return Boolean(target);
}

/**
 * Home / End: first / last cell of the row (`edge` within `[role="row"]`); with `wholeGrid`
 * (Ctrl/Cmd+Home / End) the first / last cell of the grid.
 */
export function focusEdgeCell(cell: HTMLElement, edge: 'start' | 'end', wholeGrid = false): boolean {
  const scope: ParentNode = wholeGrid ? scopeOf(cell) : (cell.closest('[role="row"]') ?? scopeOf(cell));
  const cells = Array.from(scope.querySelectorAll<HTMLElement>(CELL));
  const target = edge === 'start' ? cells[0] : cells[cells.length - 1];
  if (!target || target === cell) return false;
  target.focus({ preventScroll: false });
  return true;
}
