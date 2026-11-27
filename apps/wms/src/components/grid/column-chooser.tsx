'use client';

/**
 * Column chooser (BUILD_PLAN F4.3): gear icon → checkbox list with drag (or keyboard)
 * reordering and pin-left toggles, then Apply / Reset. Changes are drafted locally and
 * only reach the grid prefs on Apply.
 */
import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { GripVertical, Pin, Search, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TextField } from '@/components/ui/text-field';
import { Tooltip } from '@/components/ui/tooltip';
import type { GridPrefs } from './grid-types';

export interface ChooserColumn {
  readonly id: string;
  readonly label: string;
  readonly alwaysVisible: boolean;
}

interface Draft {
  readonly order: readonly string[];
  readonly visible: ReadonlySet<string>;
  readonly pinned: readonly string[];
}

function Row({
  column,
  draft,
  onToggle,
  onPin,
  dragDisabled,
}: {
  readonly column: ChooserColumn;
  readonly draft: Draft;
  readonly onToggle: (on: boolean) => void;
  readonly onPin: () => void;
  readonly dragDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    disabled: dragDisabled,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
  };
  const pinned = draft.pinned.includes(column.id);
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1.5 rounded-md bg-surface px-1 py-1',
        isDragging && 'relative z-10 shadow-md ring-1 ring-focus/30',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${column.label}`}
        className={cn(
          'flex h-6 w-5 items-center justify-center rounded text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30',
          dragDisabled ? 'cursor-not-allowed opacity-30' : 'cursor-grab hover:text-secondary',
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <Checkbox
          label={column.label}
          checked={draft.visible.has(column.id)}
          disabled={column.alwaysVisible}
          onCheckedChange={(c) => onToggle(c === true)}
        />
      </div>
      <Tooltip content={pinned ? 'Unpin column' : 'Pin to the left'}>
        <button
          type="button"
          aria-label={pinned ? `Unpin ${column.label}` : `Pin ${column.label}`}
          aria-pressed={pinned}
          onClick={onPin}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30',
            pinned ? 'text-primary' : 'text-faint hover:text-secondary',
          )}
        >
          <Pin className={cn('h-3.5 w-3.5', pinned && 'fill-current')} aria-hidden />
        </button>
      </Tooltip>
    </li>
  );
}

export interface ColumnChooserProps {
  readonly columns: readonly ChooserColumn[];
  readonly prefs: GridPrefs;
  readonly onApply: (patch: Pick<GridPrefs, 'order' | 'visible' | 'pinned'>) => void;
  readonly onReset: () => void;
  /** `sm` (28px) fits inside the grid header row; default 32px for toolbars. */
  readonly size?: 'sm' | 'md';
}

function toDraft(prefs: GridPrefs): Draft {
  return { order: prefs.order, visible: new Set(prefs.visible), pinned: prefs.pinned ?? [] };
}

export function ColumnChooser({ columns, prefs, onApply, onReset, size = 'md' }: ColumnChooserProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(prefs));
  const [query, setQuery] = React.useState('');
  const dndId = React.useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(columns.map((c) => [c.id, c]));
  const ordered = draft.order.map((id) => byId.get(id)).filter((c): c is ChooserColumn => Boolean(c));
  const q = query.trim().toLowerCase();
  const shown = q ? ordered.filter((c) => c.label.toLowerCase().includes(q)) : ordered;
  const visibleCount = ordered.filter((c) => draft.visible.has(c.id)).length;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = draft.order.indexOf(String(active.id));
    const to = draft.order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setDraft({ ...draft, order: arrayMove([...draft.order], from, to) });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(toDraft(prefs));
          setQuery('');
        }
        setOpen(next);
      }}
    >
      <Tooltip content="Columns">
        <PopoverTrigger asChild>
          <Button variant="ghost" size={size === 'sm' ? 'icon-sm' : 'icon'} aria-label="Choose columns">
            <Settings2 className="h-4 w-4" aria-hidden />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="flex w-[300px] flex-col gap-2 p-3" data-plan-read="">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Columns</p>
          <span className="text-2xs text-faint">
            {visibleCount} of {ordered.length} shown
          </span>
        </div>
        <TextField
          size="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search columns"
          aria-label="Search columns"
          leading={<Search className="h-3.5 w-3.5" aria-hidden />}
        />
        <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ul className="ks-scroll flex max-h-80 flex-col overflow-auto" aria-label="Columns">
              {shown.map((c) => (
                <Row
                  key={c.id}
                  column={c}
                  draft={draft}
                  dragDisabled={Boolean(q)}
                  onToggle={(on) => {
                    const visible = new Set(draft.visible);
                    if (on) visible.add(c.id);
                    else visible.delete(c.id);
                    setDraft({ ...draft, visible });
                  }}
                  onPin={() =>
                    setDraft({
                      ...draft,
                      pinned: draft.pinned.includes(c.id)
                        ? draft.pinned.filter((x) => x !== c.id)
                        : [...draft.pinned, c.id],
                    })
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="flex justify-between border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onReset();
              setOpen(false);
            }}
          >
            Reset
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={visibleCount === 0}
            onClick={() => {
              onApply({
                order: draft.order,
                visible: draft.order.filter((id) => draft.visible.has(id)),
                pinned: draft.pinned,
              });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
