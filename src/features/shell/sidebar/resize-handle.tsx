'use client';
import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/components/ui/cn';
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, clampSidebarWidth } from '../store';

const KEY_STEP = 16;

export interface ResizeHandleProps {
  readonly width: number;
  /** Live width while dragging (not persisted). */
  readonly onPreview: (width: number) => void;
  /** Final width (persisted). */
  readonly onCommit: (width: number) => void;
}

/** Vertical splitter on the sidebar edge: drag, arrow keys, double-click to reset. */
export function ResizeHandle({ width, onPreview, onCommit }: ResizeHandleProps) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(width);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { x: event.clientX, width };
      latest.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!start.current) return;
      latest.current = clampSidebarWidth(start.current.width + event.clientX - start.current.x);
      onPreview(latest.current);
    },
    [onPreview],
  );

  const end = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!start.current) return;
      start.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onCommit(latest.current);
    },
    [onCommit],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = width - KEY_STEP;
    if (event.key === 'ArrowRight') next = width + KEY_STEP;
    if (event.key === 'Home') next = SIDEBAR_WIDTH_MIN;
    if (event.key === 'End') next = SIDEBAR_WIDTH_MAX;
    if (next === null) return;
    event.preventDefault();
    onCommit(clampSidebarWidth(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onCommit(SIDEBAR_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
      className={cn(
        'group/resize absolute top-0 -right-1.5 bottom-0 z-[var(--z-raised)] w-3 cursor-col-resize outline-none',
        'after:absolute after:inset-y-2 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-transparent',
        'after:transition-colors after:duration-[var(--duration-fast)] hover:after:bg-primary focus-visible:after:bg-primary active:after:bg-primary',
      )}
    />
  );
}
