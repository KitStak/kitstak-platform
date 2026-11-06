'use client';
import './cells.css';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Popover, PopoverAnchor, PopoverContent, cn, toast } from '@/components/ui';
import type { CellBehavior, CellRenderContext } from './cell-context';
import { cellToText, rememberCopiedCell, textToCell } from './lib/clipboard';
import { focusEdgeCell, focusSiblingCell } from './lib/navigation';
import { discardUndo, popUndo, pushUndo, type UndoEntry } from './lib/undo-stack';
import { CellSheet } from './parts/cell-sheet';
import { SHEET_QUERY, useMediaQuery } from './parts/use-media';
import { isCellEmpty, rawCellValue } from './lib/values';
import { RENDERERS } from './renderers';
import { useCellServices } from './services';
import type { CellCommitValue, CellNavDirection, CellProps } from './types';

function isPrintable(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/** Focus moved inside the picker / cell, or into a nested layer (portal) opened from the picker. */
function isInNestedLayer(target: EventTarget | null, content: HTMLElement | null, cell: HTMLElement | null): boolean {
  if (!(target instanceof Element)) return false;
  if (content?.contains(target) || cell?.contains(target)) return true;
  return Boolean(
    target.closest(
      '[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [data-sonner-toaster]',
    ),
  );
}

const POPUP_ROLE: Record<NonNullable<CellBehavior['popup']>, 'listbox' | 'dialog'> = { listbox: 'listbox', dialog: 'dialog' };

/**
 * One board cell: display + editor for every column type.
 *
 * Keyboard (cell focused): Enter / F2 edit · Space toggles checkboxes / opens pickers ·
 * Delete / Backspace clear (Undo toast) · printable keys start editing text-ish cells ·
 * arrows are left to the grid. While editing: Enter saves (moves down for inline editors),
 * Tab saves and moves next, Esc cancels; focus always returns to the cell.
 */
export const Cell = forwardRef<HTMLDivElement, CellProps>(function Cell(props, forwardedRef) {
  const {
    column,
    item,
    board,
    users,
    onCommit,
    readOnly: readOnlyProp = false,
    density = 'default',
    onNavigate,
    tabIndex = 0,
    className,
    editing: editingProp,
    onEditingChange,
    forceHover = false,
    reportsErrors = false,
  } = props;
  const services = useCellServices();
  const sheet = useMediaQuery(SHEET_QUERY);
  const renderer = RENDERERS[column.type];
  const behavior = renderer.behavior;
  const readOnly = readOnlyProp || behavior.mode === 'readonly' || board?.canEdit === false;
  const rootRef = useRef<HTMLDivElement>(null);
  /** The undo entry recorded by the most recent successful commit from this cell. */
  const lastUndo = useRef<UndoEntry | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Direction to move after the editor closes itself (set while Tab submits a form). */
  const pendingNav = useRef<CellNavDirection | null>(null);
  /** Editors with an uncommitted draft register a flush (returns false when the draft is invalid). */
  const flushRef = useRef<(() => boolean) | null>(null);
  const registerFlush = useCallback((fn: (() => boolean) | null) => {
    flushRef.current = fn;
  }, []);
  const dismissGuardRef = useRef<((reason: 'escape' | 'outside') => boolean) | null>(null);
  const registerDismissGuard = useCallback((guard: ((reason: 'escape' | 'outside') => boolean) | null) => {
    dismissGuardRef.current = guard;
  }, []);
  /** Ask the editor whether it wants to intercept this dismissal. */
  const guardDismiss = (reason: 'escape' | 'outside', event: { preventDefault: () => void }) => {
    if (dismissGuardRef.current?.(reason)) event.preventDefault();
  };
  useImperativeHandle(forwardedRef, () => rootRef.current as HTMLDivElement);

  const [editingState, setEditingState] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const editing = !readOnly && (editingProp ?? editingState);

  const setEditing = useCallback(
    (next: boolean) => {
      setEditingState(next);
      onEditingChange?.(next);
    },
    [onEditingChange],
  );

  const value = rawCellValue(column, item);
  const empty = isCellEmpty(column.type, value);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const now = services.now ? services.now() : new Date();

  const navigate = useCallback(
    (direction: CellNavDirection) => {
      if (onNavigate) onNavigate(direction);
      else if (rootRef.current) focusSiblingCell(rootRef.current, direction);
    },
    [onNavigate],
  );

  const startEdit = useCallback(
    (nextSeed?: string) => {
      if (readOnly || behavior.mode === 'toggle') return;
      setSeed(nextSeed ?? null);
      setEditing(true);
    },
    [behavior.mode, readOnly, setEditing],
  );

  const endEdit = useCallback(
    (explicit?: CellNavDirection) => {
      const direction = explicit ?? pendingNav.current ?? undefined;
      pendingNav.current = null;
      flushRef.current = null;
      dismissGuardRef.current = null;
      setEditing(false);
      setSeed(null);
      // Wait a frame so popovers unmount before focus moves.
      requestAnimationFrame(() => {
        if (direction) navigate(direction);
        else rootRef.current?.focus({ preventScroll: true });
      });
    },
    [navigate, setEditing],
  );

  /** Persist through the host. Resolves true on success; failures are reported, never thrown. */
  const commitAsync = useCallback(
    async (next: CellCommitValue, options: { undoable?: boolean } = {}): Promise<boolean> => {
      if (readOnly) return false;
      const previous = (value ?? null) as CellCommitValue;
      try {
        await onCommit(next);
        // Every successful edit is undoable with Ctrl/Cmd+Z on a focused cell.
        if (options.undoable !== false) {
          const entry: UndoEntry = {
            label: column.title,
            undo: async () => {
              await onCommit(previous);
            },
          };
          lastUndo.current = entry;
          pushUndo(entry);
        }
        return true;
      } catch (error) {
        if (!reportsErrors) {
          toast.error(`Couldn't update ${column.title}`, error instanceof Error && error.message ? error.message : 'Please try again.');
        }
        return false;
      }
    },
    [column.title, onCommit, readOnly, reportsErrors, value],
  );

  const commit = useCallback(
    (next: CellCommitValue) => {
      void commitAsync(next);
    },
    [commitAsync],
  );

  /** Commit, then offer an Undo toast once the save actually landed (failures already rolled back). */
  const commitWithUndoToast = useCallback(
    async (next: CellCommitValue, message: string) => {
      const ok = await commitAsync(next);
      const entry = lastUndo.current;
      if (!ok || !entry) return;
      toast.undo(message, {
        onUndo: async () => {
          discardUndo(entry);
          await entry.undo();
        },
      });
    },
    [commitAsync],
  );

  const clearWithUndo = useCallback(async () => {
    if (column.type === 'name') return;
    await commitWithUndoToast(column.type === 'checkbox' ? false : null, `Cleared ${column.title}`);
  }, [column, commitWithUndoToast]);

  const undoLast = useCallback(() => {
    const entry = popUndo();
    if (!entry) {
      toast.info('Nothing to undo');
      return;
    }
    void Promise.resolve()
      .then(entry.undo)
      .then(() => toast.success(`Undid change to ${entry.label}`))
      .catch((error: unknown) => toast.error("Couldn't undo", error instanceof Error ? error.message : 'Please try again.'));
  }, []);

  const clipboardCtx = { users, now };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || editing) return;
    const text = cellToText(column, value, clipboardCtx);
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
    rememberCopiedCell({ type: column.type, text, value });
    toast.success(`Copied ${column.title}`);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || editing || readOnly) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    const next = textToCell(column, text, clipboardCtx);
    if (next === undefined) {
      toast.error(`Can't paste that into ${column.title}`, text ? `"${text.slice(0, 40)}" isn't a valid ${column.title} value.` : undefined);
      return;
    }
    void commitWithUndoToast(next, `Pasted into ${column.title}`);
  };

  const ctx: CellRenderContext = {
    column,
    item,
    board,
    users,
    usersById,
    services,
    value,
    empty,
    readOnly,
    density,
    editing,
    seed,
    forceHover,
    now,
    rootRef,
    startEdit,
    endEdit,
    commit,
    registerFlush,
    registerDismissGuard,
  };

  const toggle = () => {
    if (!readOnly) commit(!(value === true));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || editing) return;
    const mode = behavior.mode;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undoLast();
      return;
    }
    // Home / End: row edges (Ctrl/Cmd: grid edges). Hosts passing onNavigate own their grid keys.
    if (!onNavigate && (event.key === 'Home' || event.key === 'End') && rootRef.current) {
      event.preventDefault();
      focusEdgeCell(rootRef.current, event.key === 'Home' ? 'start' : 'end', mod);
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2' || (event.key === ' ' && mode !== 'direct')) {
      event.preventDefault();
      if (mode === 'toggle') toggle();
      else if (mode === 'direct') rootRef.current?.querySelector<HTMLElement>('[data-cell-action]')?.click();
      else startEdit();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly && behavior.clearable && !empty) {
      event.preventDefault();
      void clearWithUndo();
      return;
    }
    if (mode === 'direct' && column.type === 'rating' && /^\d$/.test(event.key) && !readOnly) {
      event.preventDefault();
      const max = (column.settings as { max?: number }).max ?? 5;
      const next = Math.min(max, Number(event.key));
      commit(next === 0 ? null : next);
      return;
    }
    if (behavior.typeToEdit && isPrintable(event) && !readOnly) {
      event.preventDefault();
      startEdit(event.key);
    }
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || readOnly) return;
    const mode = behavior.mode;
    if (mode === 'toggle') toggle();
    else if (mode === 'popover' || mode === 'inline') {
      if (editing && mode === 'popover') endEdit();
      else startEdit();
    }
  };

  /**
   * Tab in a popover editor: commit the draft and move to the next / previous cell. Forms and
   * the label editor keep normal Tab between their fields until focus would leave them.
   */
  const handlePopoverTab = (event: KeyboardEvent<HTMLDivElement>, content: HTMLElement) => {
    const direction: CellNavDirection = event.shiftKey ? 'prev' : 'next';
    const target = event.target as HTMLElement;
    const trap = target.closest<HTMLElement>('form, [data-tab-trap]');
    if (trap && content.contains(trap)) {
      const focusables = focusableIn(content);
      const atEdge = event.shiftKey ? focusables[0] === target : focusables[focusables.length - 1] === target;
      if (!atEdge) return;
      if (trap.tagName === 'FORM') {
        event.preventDefault();
        pendingNav.current = direction;
        (trap as HTMLFormElement).requestSubmit();
        // An invalid form stays open; forget the pending move.
        pendingNav.current = null;
        return;
      }
      // Label editor: unsaved edits would be lost, so focus wraps inside it instead.
      event.preventDefault();
      (event.shiftKey ? focusables[focusables.length - 1] : focusables[0])?.focus();
      return;
    }
    event.preventDefault();
    const flush = flushRef.current;
    if (flush && !flush()) return;
    endEdit(direction);
  };

  const Display = renderer.Display;
  const Editor = renderer.Editor;
  const interactive = !readOnly;
  const popup = behavior.mode === 'popover' ? POPUP_ROLE[behavior.popup ?? 'dialog'] : undefined;

  const root = (
    <div
      ref={rootRef}
      role="gridcell"
      tabIndex={tabIndex}
      data-ks-cell=""
      data-testid={column.type === 'status' ? 'status-cell' : `cell-${column.type}`}
      data-column-key={column.key}
      data-column-type={column.type}
      data-item-id={item.id}
      data-density={density}
      data-editing={editing ? 'true' : undefined}
      data-empty={empty ? 'true' : undefined}
      data-interactive={interactive ? 'true' : 'false'}
      data-force-hover={forceHover ? 'true' : undefined}
      aria-readonly={readOnly || undefined}
      aria-haspopup={popup}
      aria-expanded={popup ? editing : undefined}
      aria-colindex={props['aria-colindex']}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      onClick={onClick}
      className={cn('ks-cell group/cell', interactive && 'cursor-pointer', className)}
    >
      <Display ctx={ctx} />
      {editing && behavior.mode === 'inline' && Editor ? <Editor ctx={ctx} /> : null}
    </div>
  );

  if (behavior.mode !== 'popover' || !Editor) return root;

  const onEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const content = contentRef.current;
    if (!content || !content.contains(event.target as Node)) return; // a nested layer owns Tab
    handlePopoverTab(event, content);
  };

  // Narrow screens: a bottom sheet, so the editor never flips over sticky headers / toolbars.
  if (sheet) {
    return (
      <>
        {root}
        <CellSheet
          ref={contentRef}
          open={editing}
          onClose={() => endEdit()}
          title={`${column.title} · ${item.name}`}
          testId={`cell-editor-${column.type}`}
          onKeyDown={onEditorKeyDown}
          onDismiss={(reason, event) => guardDismiss(reason, event)}
        >
          {editing ? <Editor ctx={ctx} /> : null}
        </CellSheet>
      </>
    );
  }

  return (
    <Popover
      open={editing}
      onOpenChange={(open) => {
        if (!open) endEdit();
      }}
    >
      <PopoverAnchor asChild>{root}</PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        align={behavior.align ?? 'center'}
        side="bottom"
        sideOffset={4}
        // Leave room for sticky page headers so pickers prefer staying attached below the cell.
        collisionPadding={{ top: 96, bottom: 12, left: 12, right: 12 }}
        style={{ minWidth: behavior.width ?? 240 }}
        className="max-w-[calc(100vw-24px)]"
        data-testid={`cell-editor-${column.type}`}
        aria-label={`Edit ${column.title}`}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => guardDismiss('escape', event)}
        onPointerDownOutside={(event) => {
          if (rootRef.current?.contains(event.target as Node)) event.preventDefault();
          else guardDismiss('outside', event);
        }}
        // Nested layers (color swatches, selects, the expand dialog) take focus; keep the picker
        // open only for those. Focus moving anywhere else closes it.
        onFocusOutside={(event) => {
          if (isInNestedLayer(event.target, contentRef.current, rootRef.current)) event.preventDefault();
          else guardDismiss('outside', event);
        }}
        onKeyDown={onEditorKeyDown}
      >
        {editing ? <Editor ctx={ctx} /> : null}
      </PopoverContent>
    </Popover>
  );
});
