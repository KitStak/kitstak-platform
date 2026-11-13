'use client';
/** "Columns" toolbar control: show/hide every column (custom fields included) and drag to reorder. */
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Columns3, GripVertical, Lock } from 'lucide-react';
import { Button, Switch, cn } from '@/components/ui';
import type { ViewColumn } from '@/lib/view-config';
import { ToolbarPopover } from '@/features/views/toolbar-button';
import { TITLE_KEY, type ColumnDef } from './table-columns';

function ColumnRow({ column, def, onToggle }: { readonly column: ViewColumn; readonly def: ColumnDef; readonly onToggle: (on: boolean) => void }) {
  const locked = column.key === TITLE_KEY;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: column.key, disabled: locked });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('flex h-9 items-center gap-2 rounded-sm px-1.5 hover:bg-hover', isDragging && 'z-10 bg-panel shadow-md')}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={locked}
        aria-label={locked ? `${def.label} stays first` : `Drag to move ${def.label}`}
        className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-xs text-icon outline-none focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default"
      >
        {locked ? <Lock aria-hidden className="size-3.5" /> : <GripVertical aria-hidden className="size-3.5" />}
      </button>
      <span className="flex size-4 shrink-0 items-center justify-center text-icon [&_svg]:size-4">{def.icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{def.label}</span>
      {def.field ? <span className="shrink-0 text-2xs text-fg-muted">Custom</span> : null}
      <Switch size="sm" checked={!column.hidden} disabled={locked} onCheckedChange={(checked) => onToggle(checked)} aria-label={`Show ${def.label}`} />
    </div>
  );
}

export function ColumnsMenu({
  columns,
  defs,
  onChange,
  onReset,
  iconOnly,
}: {
  readonly columns: readonly ViewColumn[];
  readonly defs: ReadonlyMap<string, ColumnDef>;
  readonly onChange: (columns: ViewColumn[]) => void;
  readonly onReset: () => void;
  readonly iconOnly: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const hidden = columns.filter((column) => column.hidden).length;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = columns.findIndex((column) => column.key === active.id);
    const to = columns.findIndex((column) => column.key === over.id);
    if (from < 0 || to < 1) return;
    onChange(arrayMove([...columns], from, to));
  };
  return (
    <ToolbarPopover icon={<Columns3 aria-hidden />} label={hidden ? `Columns, ${hidden} hidden` : 'Columns'} text="Columns" iconOnly={iconOnly} width={320} testId="columns-menu">
      <div className="flex max-h-[420px] flex-col">
        <div className="border-b border-border-subtle px-3 py-2 text-xs text-fg-muted">Turn columns on or off. Drag to change their order.</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={columns.map((column) => column.key)} strategy={verticalListSortingStrategy}>
              {columns.map((column) => {
                const def = defs.get(column.key);
                if (!def) return null;
                return <ColumnRow key={column.key} column={column} def={def} onToggle={(on) => onChange(columns.map((entry) => (entry.key === column.key ? { ...entry, hidden: !on } : entry)))} />;
              })}
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex justify-between gap-2 border-t border-border-subtle p-1.5">
          <Button variant="ghost" size="xs" onClick={() => onChange(columns.map((column) => ({ ...column, hidden: false })))}>
            Show all
          </Button>
          <Button variant="ghost" size="xs" onClick={onReset}>
            Reset columns
          </Button>
        </div>
      </div>
    </ToolbarPopover>
  );
}
