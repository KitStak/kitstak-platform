'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CircleCheck, GripVertical, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import {
  Button,
  ColorPicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Tooltip,
  cn,
  labelColorStyle,
  LABEL_COLOR_NAMES,
} from '@/components/ui';
import type { Label } from '@/server/db/schema/column-types';
import { LABEL_PALETTE_ORDER, moveLabel, newLabelId, nextLabelColor, normalizePositions, setDoneLabel, validateLabels } from './lib/labels';
import type { LabelChange } from './types';

export interface LabelEditorProps {
  readonly kind: 'status' | 'dropdown';
  readonly labels: readonly Label[];
  /** label id → number of items using it (drives the delete warning). */
  readonly usage?: ReadonlyMap<string, number>;
  readonly onApply: (change: LabelChange) => void | Promise<void>;
  readonly onCancel: () => void;
  readonly saving?: boolean;
  /** Compact = inside the cell popover; roomy = dialog. */
  readonly variant?: 'compact' | 'roomy';
  readonly itemNoun?: string;
  /**
   * Hosts that can be dismissed (the cell popover) register this guard: Esc / outside click on a
   * dirty editor first asks "Discard changes?"; a second Esc discards. Returns true when handled.
   */
  readonly registerDismissGuard?: (guard: ((reason: 'escape' | 'outside') => boolean) | null) => void;
}

interface PendingDelete {
  readonly id: string;
  readonly replacement: string | null;
}

/**
 * Edit labels: rename inline, recolor from the token palette, drag (or ⌥↑/↓ via keyboard
 * sensor) to reorder, mark the Done label, add, and delete — a label in use asks where its
 * items should go first. The default (blank) label can be renamed but never removed.
 */
export function LabelEditor({
  kind,
  labels: initial,
  usage,
  onApply,
  onCancel,
  saving,
  variant = 'compact',
  itemNoun = 'item',
  registerDismissGuard,
}: LabelEditorProps) {
  const [labels, setLabels] = useState<Label[]>(() => normalizePositions(initial));
  const [reassign, setReassign] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const validation = useMemo(() => validateLabels(labels, kind), [labels, kind]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const dirty = JSON.stringify(labels) !== JSON.stringify(normalizePositions(initial)) || reassign.size > 0;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  const guard = (reason: 'escape' | 'outside'): boolean => {
    if (saving) return true;
    if (!dirty) {
      // Clean: Esc steps back to the picker; an outside click may close everything.
      if (reason === 'escape') onCancel();
      return reason === 'escape';
    }
    if (confirmDiscard && reason === 'escape') {
      onCancel();
      return true;
    }
    setConfirmDiscard(true);
    return true;
  };
  const guardRef = useRef(guard);
  useEffect(() => {
    guardRef.current = guard;
  });
  useEffect(() => {
    if (!registerDismissGuard) return undefined;
    registerDismissGuard((reason) => guardRef.current(reason));
    return () => registerDismissGuard(null);
  }, [registerDismissGuard]);
  useEffect(() => {
    if (confirmDiscard) keepEditingRef.current?.focus();
  }, [confirmDiscard]);

  const update = (id: string, patch: Partial<Label>) =>
    setLabels((current) => current.map((label) => (label.id === id ? { ...label, ...patch } : label)));

  const add = () => {
    const id = newLabelId(labels);
    setFocusId(id);
    setLabels((current) => {
      const label: Label = { id, name: '', color: nextLabelColor(current), position: 0 };
      const blankIndex = current.findIndex((entry) => entry.isDefault);
      const next = [...current];
      next.splice(blankIndex >= 0 ? blankIndex : next.length, 0, label);
      return normalizePositions(next);
    });
  };

  const requestDelete = (id: string) => {
    const count = usage?.get(id) ?? 0;
    if (count > 0) {
      const fallback = labels.find((label) => label.id !== id && !label.isDefault)?.id ?? null;
      setPending({ id, replacement: fallback });
    } else remove(id, null);
  };

  const remove = (id: string, replacement: string | null) => {
    setLabels((current) => normalizePositions(current.filter((label) => label.id !== id)));
    setReassign((current) => {
      const next = new Map(current);
      // Labels that were themselves targets of earlier reassignments now point at the new target.
      for (const [from, to] of next) if (to === id) next.set(from, replacement);
      if ((usage?.get(id) ?? 0) > 0) next.set(id, replacement);
      return next;
    });
    setPending(null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = labels.findIndex((label) => label.id === active.id);
    const to = labels.findIndex((label) => label.id === over.id);
    setLabels((current) => moveLabel(current, from, to));
  };

  const apply = () => {
    if (!validation.ok) return;
    const cleaned = labels.map((label) => ({ ...label, name: label.name.trim() }));
    void onApply({ labels: cleaned, reassign });
  };

  const pendingLabel = pending ? labels.find((label) => label.id === pending.id) : undefined;
  const doneId = labels.find((label) => label.isDone)?.id ?? null;

  return (
    <div className={cn('flex flex-col', variant === 'compact' ? 'gap-2' : 'gap-3')} data-testid="label-editor" data-tab-trap="">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={labels.map((label) => label.id)} strategy={verticalListSortingStrategy}>
          <ul className={cn('flex flex-col gap-1 overflow-y-auto', variant === 'compact' ? 'max-h-72' : 'max-h-[55vh]')} aria-label="Labels">
            {labels.map((label) => (
              <SortableLabelRow
                key={label.id}
                label={label}
                kind={kind}
                isDone={doneId === label.id}
                error={validation.errors.get(label.id)}
                usage={usage?.get(label.id) ?? 0}
                autoFocus={focusId === label.id}
                onChange={(patch) => update(label.id, patch)}
                onToggleDone={() => setLabels((current) => setDoneLabel(current, doneId === label.id ? null : label.id))}
                onDelete={() => requestDelete(label.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {pending && pendingLabel ? (
        <DeleteWarning
          label={pendingLabel}
          count={usage?.get(pending.id) ?? 0}
          itemNoun={itemNoun}
          options={labels.filter((label) => label.id !== pending.id && !label.isDefault)}
          replacement={pending.replacement}
          onReplacementChange={(replacement) => setPending({ ...pending, replacement })}
          onConfirm={() => remove(pending.id, pending.replacement)}
          onCancel={() => setPending(null)}
        />
      ) : (
        <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} className="justify-start text-fg-secondary" onClick={add}>
          New label
        </Button>
      )}

      {confirmDiscard && dirty ? (
        <div
          role="alertdialog"
          aria-labelledby="ks-discard-labels-title"
          data-testid="label-discard-confirm"
          className="flex flex-col gap-2 rounded-md border border-warning bg-warning-subtle p-2.5 text-sm text-fg"
        >
          <p id="ks-discard-labels-title" className="flex items-start gap-2 font-medium">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
            Discard your unsaved label changes?
          </p>
          <p className="pl-6 text-xs text-fg-secondary">Press Esc again to discard, or apply them below.</p>
          <div className="flex justify-end gap-2">
            <Button ref={keepEditingRef} variant="secondary" size="xs" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="danger" size="xs" onClick={onCancel}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'flex items-center justify-end gap-2 border-t border-border-subtle',
          variant === 'compact' ? '-mx-3 -mb-3 px-3 py-2.5' : '-mx-6 mt-1 px-6 py-4',
        )}
      >
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={apply} loading={saving} disabled={!dirty || !validation.ok || pending !== null}>
          Apply
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  readonly label: Label;
  readonly kind: 'status' | 'dropdown';
  readonly isDone: boolean;
  readonly error: string | undefined;
  readonly usage: number;
  readonly autoFocus: boolean;
  readonly onChange: (patch: Partial<Label>) => void;
  readonly onToggleDone: () => void;
  readonly onDelete: () => void;
}

function SortableLabelRow({ label, kind, isDone, error, usage, autoFocus, onChange, onToggleDone, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: label.id });
  const [colorOpen, setColorOpen] = useState(false);
  const isBlank = label.isDefault === true;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging}
      className="ks-label-row group/row flex flex-col rounded-sm"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Reorder ${label.name || 'label'}`}
          className="inline-flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded-xs text-icon opacity-60 hover:bg-hover hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden className="size-3.5" />
        </button>
        <Popover open={colorOpen} onOpenChange={setColorOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Color: ${LABEL_COLOR_NAMES[label.color]}. Change color`}
              style={labelColorStyle(label.color)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-[var(--lc-bg)] transition-[background-color,transform] duration-[var(--duration-instant)] hover:bg-[var(--lc-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95"
            />
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-auto">
            <ColorPicker
              value={label.color}
              colors={LABEL_PALETTE_ORDER}
              columns={8}
              size="sm"
              label="Label color"
              onChange={(color) => {
                onChange({ color });
                setColorOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <input
          value={label.name}
          autoFocus={autoFocus}
          maxLength={100}
          placeholder={isBlank ? 'Blank (default)' : 'Label name'}
          aria-label={isBlank ? 'Default label name' : 'Label name'}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange({ name: event.target.value })}
          style={labelColorStyle(label.color)}
          className={cn(
            'h-8 min-w-0 flex-1 rounded-sm border border-l-4 border-border-input border-l-[var(--lc-bg)] bg-panel px-2 text-base text-fg outline-none',
            'transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-input-hover hover:border-l-[var(--lc-bg)]',
            'focus:border-primary focus:border-l-[var(--lc-bg)] focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
            error && 'border-danger hover:border-danger',
          )}
        />
        {kind === 'status' && !isBlank ? (
          <Tooltip content={isDone ? 'Counts as done' : 'Mark as the Done label'}>
            <button
              type="button"
              aria-pressed={isDone}
              aria-label={isDone ? `${label.name || 'Label'} is the Done label` : `Mark ${label.name || 'label'} as Done`}
              onClick={onToggleDone}
              className={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors duration-[var(--duration-instant)] focus-visible:outline-2 focus-visible:outline-focus',
                isDone
                  ? 'text-success-text'
                  : 'text-icon opacity-0 group-focus-within/row:opacity-60 group-hover/row:opacity-60 hover:bg-hover hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60',
              )}
            >
              <CircleCheck aria-hidden className="size-4" />
            </button>
          </Tooltip>
        ) : (
          <span className="w-7 shrink-0" />
        )}
        {isBlank ? (
          <span className="w-7 shrink-0" />
        ) : (
          <IconButton
            size="sm"
            label={usage > 0 ? `Delete (used by ${usage})` : 'Delete label'}
            icon={<X aria-hidden />}
            onClick={onDelete}
            className="size-7 text-icon opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-danger-subtle hover:text-danger-text focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          />
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-0.5 ml-[60px] text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </li>
  );
}

interface DeleteWarningProps {
  readonly label: Label;
  readonly count: number;
  readonly itemNoun: string;
  readonly options: readonly Label[];
  readonly replacement: string | null;
  readonly onReplacementChange: (id: string | null) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function DeleteWarning({ label, count, itemNoun, options, replacement, onReplacementChange, onConfirm, onCancel }: DeleteWarningProps) {
  const noun = count === 1 ? itemNoun.toLowerCase() : `${itemNoun.toLowerCase()}s`;
  return (
    <div role="alertdialog" aria-label={`Delete ${label.name || 'label'}`} className="rounded-md border border-warning bg-warning-subtle p-3" data-testid="label-delete-warning">
      <p className="flex items-start gap-2 text-sm text-fg">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
        <span>
          <span className="font-semibold">“{label.name || 'Blank'}”</span> is used by {count} {noun}. Move them to:
        </span>
      </p>
      <Select
        size="sm"
        className="mt-2"
        aria-label="Replacement label"
        value={replacement ?? '__none__'}
        onValueChange={(next) => onReplacementChange(next === '__none__' ? null : next)}
        options={[
          ...options.map((option) => ({ value: option.id, label: option.name || 'Untitled' })),
          { value: '__none__', label: 'No label (clear)' },
        ]}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Keep label
        </Button>
        <Button variant="danger" size="xs" leadingIcon={<Trash2 aria-hidden />} onClick={onConfirm}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export interface EditLabelsDialogProps extends Omit<LabelEditorProps, 'onCancel' | 'variant'> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly columnTitle: string;
}

/** Full-size label editor (column header menu → "Edit labels"). */
export function EditLabelsDialog({ open, onOpenChange, columnTitle, ...editor }: EditLabelsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="edit-labels-dialog">
        <DialogHeader title="Edit labels" description={`Labels of “${columnTitle}”. Changes apply to every ${editor.itemNoun?.toLowerCase() ?? 'item'} on the board.`} />
        <DialogBody className="pb-0">
          {open ? <LabelEditor {...editor} variant="roomy" onCancel={() => onOpenChange(false)} /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
