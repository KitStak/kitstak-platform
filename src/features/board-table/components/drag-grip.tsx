'use client';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';

export interface DragGripProps {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * The 6-dot grip that starts a row / group drag. It is the only component subscribed to
 * dnd-kit, so drag-context updates re-render grips, not whole rows.
 */
export function DragGrip({ id, data, label, disabled }: DragGripProps) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes } = useDraggable({ id, data, disabled });
  if (disabled) return null;
  return (
    <button
      type="button"
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
      }}
      aria-label={label}
      data-testid="drag-grip"
      className="bt-reveal -mr-1 inline-flex h-6 w-3.5 cursor-grab items-center justify-center rounded-xs text-icon hover:bg-hover active:cursor-grabbing"
      {...attributes}
      {...listeners}
      tabIndex={-1}
    >
      <GripVertical aria-hidden className="size-3.5" />
    </button>
  );
}
