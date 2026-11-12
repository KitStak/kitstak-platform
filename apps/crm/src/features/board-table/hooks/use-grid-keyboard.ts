'use client';

/**
 * Spreadsheet-grade keyboard model for the virtualized grid: arrows / Tab / Home / End /
 * PageUp / PageDown move a roving focus (scrolling the row into view first), Shift+Space
 * selects the row, Ctrl/Cmd+A selects the group, Ctrl/Cmd+Enter opens the item, Esc clears
 * focus, Ctrl/Cmd+C / V copy and paste cell values. Cells handle Enter / typing / Delete.
 */
import { useCallback, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react';
import { toast } from '@/components/ui';
import type { ColumnDto } from '@/server/services/contracts/dto';
import { cellText, type UsersById } from '../lib/cell-text';
import { parsePaste } from '../lib/paste';
import type { TableLayout } from '../lib/columns';
import { isNavigableRow, type RowModel } from '../lib/rows';
import type { TableStore } from '../state/table-store';
import type { GridDirection, OpenItemOptions } from '../table-context';
import type { TableActions } from './use-table-actions';

const PAGE = 10;

interface GridInput {
  readonly model: RowModel;
  readonly layout: TableLayout;
  readonly subLayout: TableLayout;
  readonly store: TableStore;
  readonly scrollerRef: RefObject<HTMLDivElement | null>;
  readonly scrollToIndex: (index: number) => void;
  readonly visibleIdsByGroup: ReadonlyMap<string, readonly string[]>;
  readonly actions: TableActions;
  readonly users: UsersById;
  readonly onOpenItem: (itemId: string, options?: OpenItemOptions) => void;
}

function isEditable(target: HTMLElement): boolean {
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [data-editing="true"], [role="dialog"], [role="menu"], [role="listbox"]',
    ),
  );
}

export function useGridKeyboard(input: GridInput) {
  const {
    model,
    layout,
    subLayout,
    store,
    scrollerRef,
    scrollToIndex,
    visibleIdsByGroup,
    actions,
    users,
    onOpenItem,
  } = input;

  const colCount = useCallback(
    (rowKey: string) => 2 + (rowKey.startsWith('sub:') ? subLayout.columns.length : layout.columns.length),
    [layout.columns.length, subLayout.columns.length],
  );

  const focusCell = useCallback(
    (rowKey: string, col: number) => {
      const index = model.indexByKey.get(rowKey);
      if (index === undefined) return;
      store.getState().setFocus({ rowKey, col });
      scrollToIndex(index);
      const scroller = scrollerRef.current;
      const rowLayout = rowKey.startsWith('sub:') ? subLayout : layout;
      if (scroller && col >= 2) {
        const entry = rowLayout.columns[col - 2];
        if (entry) {
          const left = rowLayout.stickyWidth + entry.left;
          const right = left + entry.width;
          if (left < scroller.scrollLeft + rowLayout.stickyWidth)
            scroller.scrollLeft = left - rowLayout.stickyWidth;
          else if (right > scroller.scrollLeft + scroller.clientWidth)
            scroller.scrollLeft = right - scroller.clientWidth + 8;
        }
      }
      let attempts = 0;
      const tryFocus = () => {
        const row = scrollerRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(rowKey)}"]`);
        const host = row?.querySelector<HTMLElement>(`[data-grid-col="${col}"]`);
        const target = host?.matches('[tabindex]') ? host : host?.querySelector<HTMLElement>('[tabindex]');
        if (target) target.focus({ preventScroll: true });
        else if (attempts++ < 4) requestAnimationFrame(tryFocus);
      };
      requestAnimationFrame(tryFocus);
    },
    [layout, model.indexByKey, scrollToIndex, scrollerRef, store, subLayout],
  );

  const navigate = useCallback(
    (rowKey: string, col: number, direction: GridDirection) => {
      const navigable = model.rows.filter(isNavigableRow).map((row) => row.key);
      const at = navigable.indexOf(rowKey);
      if (at < 0) return;
      let row = at;
      let next = col;
      const last = colCount(rowKey) - 1;
      if (direction === 'left') next = Math.max(0, col - 1);
      if (direction === 'right') next = Math.min(last, col + 1);
      if (direction === 'up') row = Math.max(0, at - 1);
      if (direction === 'down') row = Math.min(navigable.length - 1, at + 1);
      if (direction === 'next') {
        if (col < last) next = col + 1;
        else if (at < navigable.length - 1) {
          row = at + 1;
          next = 0;
        }
      }
      if (direction === 'prev') {
        if (col > 0) next = col - 1;
        else if (at > 0) {
          row = at - 1;
          next = colCount(navigable[row] ?? rowKey) - 1;
        }
      }
      const targetKey = navigable[row] ?? rowKey;
      focusCell(targetKey, Math.min(next, colCount(targetKey) - 1));
    },
    [colCount, focusCell, model.rows],
  );

  const locate = (target: HTMLElement) => {
    const rowEl = target.closest<HTMLElement>('[data-row-key]');
    const cellEl = target.closest<HTMLElement>('[data-grid-col]');
    if (!rowEl || !cellEl) return null;
    const rowKey = rowEl.dataset.rowKey ?? '';
    const index = model.indexByKey.get(rowKey);
    const row = index === undefined ? undefined : model.rows[index];
    if (!row || !isNavigableRow(row)) return null;
    return { rowKey, col: Number(cellEl.dataset.gridCol), item: row.item, groupId: row.groupId };
  };

  const columnAt = (rowKey: string, col: number): ColumnDto | null => {
    if (col === 1) return (rowKey.startsWith('sub:') ? subLayout.name : layout.name) ?? null;
    return (rowKey.startsWith('sub:') ? subLayout : layout).columns[col - 2]?.column ?? null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || isEditable(target)) return;
    const here = locate(target);
    if (!here) return;
    const mod = event.metaKey || event.ctrlKey;
    const move = (direction: GridDirection) => {
      event.preventDefault();
      navigate(here.rowKey, here.col, direction);
    };
    switch (event.key) {
      case 'ArrowUp':
        return move('up');
      case 'ArrowDown':
        return move('down');
      case 'ArrowLeft':
        return move('left');
      case 'ArrowRight':
        return move('right');
      case 'Tab':
        return move(event.shiftKey ? 'prev' : 'next');
      case 'Home':
        event.preventDefault();
        return focusCell(here.rowKey, 0);
      case 'End':
        event.preventDefault();
        return focusCell(here.rowKey, colCount(here.rowKey) - 1);
      case 'PageDown':
      case 'PageUp': {
        event.preventDefault();
        const navigable = model.rows.filter(isNavigableRow).map((row) => row.key);
        const at = navigable.indexOf(here.rowKey);
        const nextRow =
          navigable[
            Math.max(0, Math.min(navigable.length - 1, at + (event.key === 'PageDown' ? PAGE : -PAGE)))
          ];
        if (nextRow) focusCell(nextRow, here.col);
        return;
      }
      case 'Escape':
        event.preventDefault();
        store.getState().setFocus(null);
        target.blur();
        if (scrollerRef.current) {
          // Leave the grid focused without jumping back into a cell.
          scrollerRef.current.dataset.skipAutofocus = 'true';
          scrollerRef.current.focus({ preventScroll: true });
        }
        return;
      default:
        break;
    }
    if (mod && event.key.toLowerCase() === 'c') {
      const column = columnAt(here.rowKey, here.col);
      if (!column) return;
      event.preventDefault();
      const text = cellText(column, here.item, users);
      void navigator.clipboard?.writeText(text).then(
        () => toast.success('Copied', text ? `“${text.slice(0, 60)}”` : 'The cell is empty.'),
        () => toast.error("Couldn't copy", 'Your browser blocked clipboard access.'),
      );
    }
  };

  /**
   * Row-level shortcuts run in the capture phase so a focused cell (which would open its
   * editor on Space / Enter) never sees them: Shift+Space, Ctrl/Cmd+Enter, Ctrl/Cmd+A.
   */
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (isEditable(target)) return;
    const mod = event.metaKey || event.ctrlKey;
    const rowShortcut =
      (event.key === ' ' && event.shiftKey) ||
      (event.key === 'Enter' && mod) ||
      (mod && event.key.toLowerCase() === 'a');
    if (!rowShortcut) return;
    const here = locate(target);
    if (!here) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === ' ') store.getState().toggleSelect(here.item.id);
    else if (event.key === 'Enter') {
      if (!here.item.id.startsWith('temp-')) onOpenItem(here.item.id);
    } else store.getState().selectMany(visibleIdsByGroup.get(here.groupId) ?? []);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (isEditable(target)) return;
    const here = locate(target);
    if (!here || here.item.id.startsWith('temp-')) return;
    const column = columnAt(here.rowKey, here.col);
    const text = event.clipboardData.getData('text/plain');
    if (!column || !text) return;
    event.preventDefault();
    if (column.type === 'name') {
      actions.rename(here.item, text.split(/\r?\n/)[0] ?? '');
      return;
    }
    const parsed = parsePaste(column, text);
    if (!parsed.ok) {
      toast.warning(`Can't paste into ${column.title}`, 'Open the cell to pick a value instead.');
      return;
    }
    void actions.setCell(here.item, column, parsed.value);
  };

  return {
    onKeyDown,
    onKeyDownCapture,
    onPaste,
    navigate,
    focusCell,
    locate: (target: HTMLElement) => locate(target),
  };
}
