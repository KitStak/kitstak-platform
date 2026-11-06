/**
 * Session-wide undo for cell edits (Ctrl/Cmd+Z on a focused cell, and the Undo toast). Each
 * entry restores the previous value through the cell's own onCommit.
 */
export interface UndoEntry {
  readonly label: string;
  readonly undo: () => Promise<void> | void;
}

const MAX_ENTRIES = 20;
let stack: readonly UndoEntry[] = [];

export function pushUndo(entry: UndoEntry): void {
  stack = [...stack, entry].slice(-MAX_ENTRIES);
}

/** Remove and return the most recent entry (null when there is nothing to undo). */
export function popUndo(): UndoEntry | null {
  const entry = stack[stack.length - 1];
  if (!entry) return null;
  stack = stack.slice(0, -1);
  return entry;
}

/** Drop a specific entry (its Undo toast action already ran). */
export function discardUndo(entry: UndoEntry): void {
  stack = stack.filter((candidate) => candidate !== entry);
}

export function undoDepth(): number {
  return stack.length;
}

export function clearUndo(): void {
  stack = [];
}
