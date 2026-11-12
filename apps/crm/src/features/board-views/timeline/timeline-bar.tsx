'use client';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn, labelColorStyle, type LabelColor } from '@/components/ui';
import { formatSpan, type IsoDate } from '../lib/dates';
import { dragRange, xToDayOffset, type DragMode } from '../lib/timeline';

export interface TimelineBarProps {
  readonly itemId: string;
  readonly name: string;
  readonly start: IsoDate;
  readonly end: IsoDate;
  readonly left: number;
  readonly width: number;
  readonly pxPerDay: number;
  readonly color: LabelColor;
  readonly milestone: boolean;
  readonly editable: boolean;
  readonly resizable: boolean;
  readonly onOpen: (itemId: string) => void;
  readonly onCommit: (itemId: string, range: { start: IsoDate; end: IsoDate }) => void;
}

const EDGE = 7;

/** A draggable / resizable bar (or milestone diamond) with a live snap tooltip. */
export function TimelineBar({ itemId, name, start, end, left, width, pxPerDay, color, milestone, editable, resizable, onOpen, onCommit }: TimelineBarProps) {
  const [drag, setDrag] = useState<{ mode: DragMode; originX: number; delta: number } | null>(null);
  const moved = useRef(false);
  const preview = drag ? dragRange({ start, end }, drag.mode, drag.delta) : { start, end };
  const previewLeft = left + diff(start, preview.start) * pxPerDay;
  const previewWidth = drag ? (diff(preview.start, preview.end) + 1) * pxPerDay : width;

  const onPointerDown = (event: PointerEvent<HTMLElement>, mode: DragMode) => {
    if (!editable || event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    moved.current = false;
    setDrag({ mode, originX: event.clientX, delta: 0 });
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const delta = xToDayOffset(event.clientX - drag.originX, pxPerDay);
    if (Math.abs(event.clientX - drag.originX) > 3) moved.current = true;
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const next = dragRange({ start, end }, drag.mode, drag.delta);
    setDrag(null);
    if (next.start !== start || next.end !== end) onCommit(itemId, next);
    else if (!moved.current) onOpen(itemId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(itemId);
      return;
    }
    if (!editable || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    onCommit(itemId, dragRange({ start, end }, event.shiftKey && resizable ? 'end' : 'move', delta));
  };

  const label = formatSpan(preview.start, preview.end);
  const inside = previewWidth > name.length * 7 + 24;
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2"
      style={{ left: previewLeft, width: milestone ? 16 : Math.max(previewWidth, 6), ...labelColorStyle(color) }}
    >
      {drag ? (
        <div role="status" className="pointer-events-none absolute bottom-full left-0 z-[var(--z-popover)] mb-1.5 rounded-sm bg-inverse px-2 py-1 text-xs whitespace-nowrap text-fg-inverse shadow-md tabular-nums">
          {label}
        </div>
      ) : null}
      <button
        type="button"
        data-testid="timeline-bar"
        data-item-id={itemId}
        aria-label={`${name}, ${label}${editable ? '. Arrow keys move, Shift plus arrows resize' : ''}`}
        onPointerDown={(event) => onPointerDown(event, 'move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onKeyDown}
        onClick={(event) => event.preventDefault()}
        className={cn(
          'group/bar relative flex items-center text-xs font-medium text-[var(--lc-fg)] outline-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          milestone
            ? 'size-4 rotate-45 rounded-xs bg-[var(--lc-bg)] shadow-xs hover:brightness-95'
            : 'h-7 w-full rounded-sm bg-[var(--lc-bg)] shadow-xs transition-[filter,box-shadow] duration-[var(--duration-fast)] hover:shadow-md hover:brightness-[0.97]',
          editable ? (drag ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer',
          drag && 'shadow-lg ring-2 ring-focus/40',
        )}
      >
        {!milestone && inside ? <span className="truncate px-2">{name}</span> : null}
        {!milestone && resizable && editable ? (
          <>
            <span
              aria-hidden
              onPointerDown={(event) => onPointerDown(event, 'start')}
              className="absolute inset-y-0 left-0 cursor-ew-resize rounded-l-sm opacity-0 group-hover/bar:opacity-100 after:absolute after:inset-y-1.5 after:left-1 after:w-0.5 after:rounded-full after:bg-[var(--lc-fg)]/60"
              style={{ width: EDGE }}
            />
            <span
              aria-hidden
              onPointerDown={(event) => onPointerDown(event, 'end')}
              className="absolute inset-y-0 right-0 cursor-ew-resize rounded-r-sm opacity-0 group-hover/bar:opacity-100 after:absolute after:inset-y-1.5 after:right-1 after:w-0.5 after:rounded-full after:bg-[var(--lc-fg)]/60"
              style={{ width: EDGE }}
            />
          </>
        ) : null}
      </button>
      {milestone || !inside ? (
        <span className="pointer-events-none absolute top-1/2 left-full ml-2 -translate-y-1/2 truncate text-xs font-medium whitespace-nowrap text-fg" style={{ maxWidth: 220 }}>
          {name}
        </span>
      ) : null}
    </div>
  );
}

function diff(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
