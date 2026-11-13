'use client';
/**
 * Workflow editor: the project's statuses (board columns). Drag to reorder, rename inline,
 * recolor, pick a category (To do / In progress / Done / Cancelled), set a WIP limit, choose
 * where new tasks start, add and delete (tasks move to a status you pick).
 */
import { useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxisModifier } from '@/features/task/dnd-modifiers';
import { GripVertical, Plus, Star, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogBody, IconButton, Input, Select, Tooltip, cn } from '@/components/ui';
import { StatusIcon } from '@/components/pm';
import { STATUS_CATEGORIES, STATUS_CATEGORY_LABELS, type StatusCategory } from '@/lib/constants';
import { useProjectTasks } from '@/lib/hooks/use-data';
import { rankBetween } from '@/lib/rank';
import type { StatusDTO } from '@/lib/types';
import { createStatusAction, deleteStatusAction, updateStatusAction } from '@/server/actions/structure';
import { useCurrentProject } from './project-context';
import { ColorDot, SettingsSection, useSettingsRunner } from './settings-shared';

const CATEGORY_HELP: Readonly<Record<StatusCategory, string>> = {
  todo: 'Not started yet',
  in_progress: 'Someone is working on it',
  done: 'Finished. Counts toward progress',
  cancelled: 'Won’t do. Left out of progress',
};

const DEFAULT_COLOR: Readonly<Record<StatusCategory, string>> = { todo: 'gray', in_progress: 'blue', done: 'green', cancelled: 'brown' };

function StatusRow({ status, count, canEdit, onDelete, onlyOne }: { readonly status: StatusDTO; readonly count: number; readonly canEdit: boolean; readonly onDelete: () => void; readonly onlyOne: boolean }) {
  const run = useSettingsRunner();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, setActivatorNodeRef } = useSortable({ id: status.id, disabled: !canEdit });
  const [name, setName] = useState(status.name);
  const [wip, setWip] = useState(status.wipLimit ? String(status.wipLimit) : '');
  const saveName = () => {
    const value = name.trim();
    if (!value) setName(status.name);
    else if (value !== status.name) void run(updateStatusAction({ statusId: status.id, patch: { name: value } }), 'Status renamed');
  };
  const saveWip = () => {
    const value = wip.trim() ? Math.max(1, Math.min(999, Math.round(Number(wip)))) : null;
    if (wip.trim() && !Number.isFinite(Number(wip))) {
      setWip(status.wipLimit ? String(status.wipLimit) : '');
      return;
    }
    if (value !== status.wipLimit) void run(updateStatusAction({ statusId: status.id, patch: { wipLimit: value } }), value ? `Limit set to ${value}` : 'Limit removed');
  };
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex flex-wrap items-center gap-2 bg-panel px-2 py-2 sm:flex-nowrap', isDragging && 'relative z-[2] rounded-lg shadow-popover ring-1 ring-border-default')}
      data-testid="status-row"
    >
      {canEdit ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Move ${status.name}. Use the arrow keys, then Space to drop.`}
          className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-icon outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing"
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
      ) : null}
      <ColorDot color={status.color} label={`Color for ${status.name}`} disabled={!canEdit} onChange={(color) => void run(updateStatusAction({ statusId: status.id, patch: { color } }))} />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'Escape') setName(status.name);
        }}
        disabled={!canEdit}
        aria-label={`Name of ${status.name}`}
        maxLength={80}
        containerClassName="min-w-0 flex-1 basis-40 border-transparent bg-transparent hover:border-border-input focus-within:border-border-input"
      />
      <Select
        size="sm"
        aria-label={`Category of ${status.name}`}
        value={status.category}
        disabled={!canEdit}
        onValueChange={(category) => void run(updateStatusAction({ statusId: status.id, patch: { category: category as StatusCategory } }), 'Category updated')}
        options={STATUS_CATEGORIES.map((c) => ({ value: c, label: STATUS_CATEGORY_LABELS[c], description: CATEGORY_HELP[c] }))}
        className="w-32"
      />
      <Tooltip content="Most tasks allowed in this column at once (WIP limit). Leave empty for no limit.">
        <Input
          value={wip}
          onChange={(event) => setWip(event.target.value.replace(/[^0-9]/g, ''))}
          onBlur={saveWip}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          disabled={!canEdit}
          inputMode="numeric"
          placeholder="No limit"
          aria-label={`Task limit for ${status.name}`}
          size="sm"
          containerClassName="w-24"
        />
      </Tooltip>
      <span className="w-14 shrink-0 text-right text-xs text-fg-muted tabular-nums">{count} {count === 1 ? 'task' : 'tasks'}</span>
      <Tooltip content={status.isDefault ? 'New tasks start here' : 'Make new tasks start here'}>
        <IconButton
          label={status.isDefault ? `${status.name} is where new tasks start` : `Start new tasks in ${status.name}`}
          icon={<Star aria-hidden className={cn(status.isDefault && 'fill-warning text-warning')} />}
          size="sm"
          aria-pressed={status.isDefault}
          disabled={!canEdit || status.isDefault}
          onClick={() => void run(updateStatusAction({ statusId: status.id, patch: { isDefault: true } }), `New tasks now start in ${status.name}`)}
        />
      </Tooltip>
      <IconButton label={`Delete ${status.name}`} icon={<Trash2 aria-hidden />} size="sm" disabled={!canEdit || onlyOne} onClick={onDelete} />
    </li>
  );
}

export function WorkflowSettings({ highlight }: { readonly highlight?: boolean }) {
  const { project, capabilities } = useCurrentProject();
  const canEdit = capabilities['structure:manage'];
  const run = useSettingsRunner();
  const tasks = useProjectTasks(project.key);
  const [order, setOrder] = useState<readonly StatusDTO[] | null>(null);
  const statuses = order ?? project.statuses;
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks.data ?? []) map.set(task.statusId, (map.get(task.statusId) ?? 0) + 1);
    return map;
  }, [tasks.data]);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<StatusCategory>('in_progress');
  const [deleting, setDeleting] = useState<StatusDTO | null>(null);
  const [moveTo, setMoveTo] = useState<string>('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = statuses.findIndex((s) => s.id === active.id);
    const to = statuses.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove([...statuses], from, to);
    const before = next[to - 1]?.position ?? null;
    const after = next[to + 1]?.position ?? null;
    const position = rankBetween(before, after);
    setOrder(next.map((s) => (s.id === active.id ? { ...s, position } : s)));
    void run(updateStatusAction({ statusId: String(active.id), patch: { position } }), 'Order saved').finally(() => setOrder(null));
  };

  const others = deleting ? statuses.filter((s) => s.id !== deleting.id) : [];
  const deletingCount = deleting ? (counts.get(deleting.id) ?? 0) : 0;

  return (
    <SettingsSection id="workflow" title="Workflow" description="The steps a task goes through. These are the columns on your board, left to right." highlight={highlight}>
      <DndContext id={`workflow-${project.id}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxisModifier]}>
        <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle" aria-label="Statuses">
            {statuses.map((status) => (
              <StatusRow
                key={`${status.id}-${status.name}-${status.wipLimit}`}
                status={status}
                count={counts.get(status.id) ?? 0}
                canEdit={canEdit}
                onlyOne={statuses.length <= 1}
                onDelete={() => {
                  setDeleting(status);
                  setMoveTo(statuses.find((s) => s.id !== status.id && s.category === status.category)?.id ?? statuses.find((s) => s.id !== status.id)?.id ?? '');
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {canEdit ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newName.trim();
            if (!name) return;
            void run(createStatusAction({ projectId: project.id, name, category: newCategory, color: DEFAULT_COLOR[newCategory] }), `Added ${name}`).then((created) => {
              if (created) setNewName('');
            });
          }}
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New status, e.g. Waiting on client" aria-label="New status name" containerClassName="min-w-0 flex-1 basis-56" maxLength={80} data-testid="new-status-name" />
          <Select aria-label="New status category" value={newCategory} onValueChange={(v) => setNewCategory(v as StatusCategory)} options={STATUS_CATEGORIES.map((c) => ({ value: c, label: STATUS_CATEGORY_LABELS[c] }))} className="w-36" />
          <Button type="submit" variant="secondary" leadingIcon={<Plus aria-hidden />} disabled={!newName.trim()} data-testid="add-status">
            Add status
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-fg-muted">Only project editors can change the workflow.</p>
      )}

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader title={`Delete “${deleting?.name}”?`} description={deletingCount ? `${deletingCount} ${deletingCount === 1 ? 'task is' : 'tasks are'} in this status. Pick where they should go.` : 'No tasks are in this status.'} />
          {deletingCount ? (
            <DialogBody>
              <Select aria-label="Move tasks to" value={moveTo} onValueChange={setMoveTo} options={others.map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon category={s.category} color={s.color} /> }))} size="lg" />
            </DialogBody>
          ) : null}
          <DialogFooter className="border-t-0 pt-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-delete-status"
              onClick={() => {
                if (!deleting) return;
                const target = others.find((s) => s.id === moveTo);
                void run(deleteStatusAction({ statusId: deleting.id, moveToStatusId: moveTo || undefined }), deletingCount && target ? `Deleted ${deleting.name}. Tasks moved to ${target.name}.` : `Deleted ${deleting.name}`);
                setDeleting(null);
              }}
            >
              Delete status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
