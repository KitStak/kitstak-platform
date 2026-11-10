"use client";

/**
 * Editors shared by the wave-rule and job-type wizards:
 *   ConditionsEditor — "Add filter" → field list → typed editor → chip (edit / remove);
 *   SortableList     — numbered, drag-sortable rows (pointer + keyboard);
 *   OrderByEditor    — "Search and select … + Add", sortable rows with Ascending / Descending.
 */
import * as React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterPopover, type FilterFieldDef } from "@/components/grid";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FilterCondition, OrderByClause } from "@/lib/domain-types";
import { fromCondition, moveItem, toCondition, upsertCondition } from "@/lib/grid-defs/jobs/condition-codec";
import type { OrderByOption } from "@/lib/grid-defs/jobs/conditions";
import type { GridFilter } from "@/server/query/grid-query";

/* ------------------------------------------------------------- conditions */

export interface ConditionsEditorProps {
  readonly fields: readonly FilterFieldDef[];
  readonly value: readonly FilterCondition[];
  readonly onChange: (next: FilterCondition[]) => void;
  /** Key for pinned fields in the field list. */
  readonly scope: string;
  readonly emptyText?: string;
  readonly addLabel?: string;
  readonly disabled?: boolean;
}

const stopSubmit = (event: React.FormEvent): void => event.stopPropagation();

export function ConditionsEditor({ fields, value, onChange, scope, emptyText = "No filters have been added yet.", addLabel = "Add filter", disabled }: ConditionsEditorProps) {
  const defOf = (field: string) => fields.find((f) => f.field === field);
  const filters = value.map(fromCondition).filter((f): f is GridFilter => f !== null);
  const apply = (filter: GridFilter) => onChange(upsertCondition(value, toCondition(filter, defOf(filter.field))));
  return (
    // The filter popover's editor is its own <form>, portalled out of the DOM but not out of
    // the React tree: its submit would bubble to the wizard form and advance the step.
    <div className="flex flex-col gap-2" onSubmit={stopSubmit}>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((c) => (
          <span key={c.field} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary-soft py-0.5 pl-1 pr-1 text-[12px] text-primary">
            <FilterPopover
              gridKey={scope}
              fields={fields}
              filters={filters}
              onApply={apply}
              initialField={c.field}
              trigger={
                <button type="button" disabled={disabled} className="max-w-[360px] truncate rounded-full px-1.5 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" title={`Edit ${c.label}`}>
                  {c.label}
                </button>
              }
            />
            <button type="button" disabled={disabled} aria-label={`Remove ${c.label}`} onClick={() => onChange(value.filter((x) => x.field !== c.field))} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <FilterPopover
          gridKey={scope}
          fields={fields}
          filters={filters}
          onApply={apply}
          trigger={
            <Button variant="secondary" size="sm" disabled={disabled}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {addLabel}
            </Button>
          }
        />
      </div>
      {value.length === 0 ? <p className="text-[12px] text-faint">{emptyText}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------- sortable list */

function SortableRow({ id, index, count, onMove, children }: { readonly id: string; readonly index: number; readonly count: number; readonly onMove: (from: number, to: number) => void; readonly children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5", isDragging && "z-10 shadow-lg ring-2 ring-primary/30")}
    >
      <button type="button" {...attributes} {...listeners} aria-label="Drag to reorder" className="flex h-7 w-6 cursor-grab items-center justify-center rounded text-faint hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 active:cursor-grabbing">
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <span className="w-6 shrink-0 text-right text-[12px] font-semibold tabular-nums text-secondary">{index + 1}.</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <span className="flex shrink-0">
        <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index, index - 1)} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-surface-sunken hover:text-secondary disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden /></button>
        <button type="button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-surface-sunken hover:text-secondary disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" aria-hidden /></button>
      </span>
    </li>
  );
}

export function SortableList<T>({ items, getId, onReorder, renderItem, ariaLabel }: { readonly items: readonly T[]; readonly getId: (item: T) => string; readonly onReorder: (next: T[]) => void; readonly renderItem: (item: T, index: number) => React.ReactNode; readonly ariaLabel: string }) {
  const dndId = React.useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = items.map(getId);
  const move = (from: number, to: number) => onReorder(moveItem(items, from, to));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
  };
  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol aria-label={ariaLabel} className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <SortableRow key={ids[i]} id={ids[i] as string} index={i} count={items.length} onMove={move}>
              {renderItem(item, i)}
            </SortableRow>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

/* --------------------------------------------------------------- order by */

export function OrderByEditor({ options, value, onChange, placeholder, emptyText, invalid, id }: { readonly options: readonly OrderByOption[]; readonly value: readonly OrderByClause[]; readonly onChange: (next: OrderByClause[]) => void; readonly placeholder: string; readonly emptyText: string; readonly invalid?: boolean; readonly id?: string }) {
  const [pick, setPick] = React.useState<string | null>(null);
  const free = options.filter((o) => !value.some((v) => v.field === o.value));
  const labelOf = (field: string) => options.find((o) => o.value === field)?.label ?? field;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select id={id} options={free.map((o) => ({ value: o.value, label: o.label }))} value={pick} onChange={setPick} placeholder={placeholder} invalid={invalid} aria-label={placeholder} />
        </div>
        <Button variant="secondary" disabled={!pick} onClick={() => { if (pick) onChange([...value, { field: pick, dir: "asc" }]); setPick(null); }}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="text-[12px] text-faint">{emptyText}</p>
      ) : (
        <SortableList
          ariaLabel="Order by"
          items={value}
          getId={(c) => c.field}
          onReorder={onChange}
          renderItem={(c, i) => (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{labelOf(c.field)}</span>
              <SegmentedControl
                size="sm"
                ariaLabel={`${labelOf(c.field)} direction`}
                value={c.dir}
                onChange={(dir) => onChange(value.map((x, j) => (j === i ? { ...x, dir } : x)))}
                options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]}
              />
              <button type="button" aria-label={`Remove ${labelOf(c.field)}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-danger-soft hover:text-danger"><X className="h-3.5 w-3.5" aria-hidden /></button>
            </>
          )}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ form bridge */

/**
 * Hands the wizard's form instance to its owner after render (server field errors, watched
 * values), without touching refs during render.
 */
export function FormBridge<T extends import("react-hook-form").FieldValues>({ form, onForm }: { readonly form: import("react-hook-form").UseFormReturn<T>; readonly onForm: (form: import("react-hook-form").UseFormReturn<T>) => void | (() => void) }) {
  React.useEffect(() => onForm(form), [form, onForm]);
  return null;
}
