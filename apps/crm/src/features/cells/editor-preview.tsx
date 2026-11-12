'use client';
import { useMemo, useRef } from 'react';
import { cn } from '@/components/ui';
import type { CellRenderContext } from './cell-context';
import { isCellEmpty, rawCellValue } from './lib/values';
import { RENDERERS } from './renderers';
import { useCellServices } from './services';
import type { CellProps } from './types';

/**
 * Renders a column type's editor statically on a popover surface (galleries, docs, visual
 * tests). Production code uses <Cell>, which anchors the same editor to the cell.
 */
export function CellEditorPreview({
  column,
  item,
  board,
  users,
  onCommit,
  className,
}: Pick<CellProps, 'column' | 'item' | 'board' | 'users' | 'onCommit'> & { readonly className?: string }) {
  const services = useCellServices();
  const rootRef = useRef<HTMLDivElement>(null);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const renderer = RENDERERS[column.type];
  const value = rawCellValue(column, item);
  const ctx: CellRenderContext = {
    column,
    item,
    board,
    users,
    usersById,
    services,
    value,
    empty: isCellEmpty(column.type, value),
    readOnly: false,
    density: 'default',
    editing: true,
    seed: null,
    forceHover: false,
    preview: true,
    now: services.now ? services.now() : new Date(),
    rootRef,
    startEdit: () => undefined,
    endEdit: () => undefined,
    commit: (next) => void onCommit(next),
  };
  const Editor = renderer.Editor;
  if (!Editor) return null;
  if (renderer.behavior.mode === 'inline') {
    const Display = renderer.Display;
    return (
      <div
        ref={rootRef}
        className={cn('ks-cell group/cell max-w-full rounded-sm border border-border-subtle bg-panel', className)}
        style={{ width: column.width }}
        data-editing="true"
        data-testid={`editor-preview-${column.type}`}
      >
        <Display ctx={ctx} />
        <Editor ctx={ctx} />
      </div>
    );
  }
  if (renderer.behavior.mode !== 'popover') return null;
  return (
    <div ref={rootRef} className={cn('ks-popover-surface inline-block max-w-full p-3', className)} data-testid={`editor-preview-${column.type}`}>
      <Editor ctx={ctx} />
    </div>
  );
}
