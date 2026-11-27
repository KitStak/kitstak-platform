'use client';
/**
 * Floating multi-select action bar (bottom center, CRM anatomy) for the List and Table:
 * status, assignee, priority, due date, labels (add/remove), move (section or another
 * project), delete with Undo. Escape or the X clears the selection.
 */
import { forwardRef, useMemo, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowRightLeft, CalendarDays, CircleDashed, FolderInput, Signal, Tag, Trash2, UserRound, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@/components/ui';
import { useProjects } from '@/lib/hooks/use-data';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProject } from '@/features/projects/project-context';
import { AssigneePicker, DuePicker, LabelDot, PriorityPicker, StatusPicker } from './field-pickers';
import { OptionList } from './option-list';
import type { Selection } from './use-selection';
import type { TaskOps } from './use-task-ops';
import { useViewSelectionCommands } from '@/features/command/use-view-selection-commands';
import { useCardExtras } from './card-extras';

interface BarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly danger?: boolean;
}

export const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton({ icon, label, danger, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'flex h-14 w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium text-fg-secondary max-sm:h-11 max-sm:w-11',
        'transition-colors duration-[var(--duration-instant)] hover:bg-hover hover:text-fg active:bg-pressed focus-visible:outline-2 focus-visible:outline-focus',
        'data-[state=open]:bg-hover data-[state=open]:text-fg [&_svg]:size-[18px]',
        danger && 'hover:bg-danger-subtle hover:text-danger-text',
        className,
      )}
      {...rest}
    >
      {icon}
      <span className="max-sm:sr-only">{label}</span>
    </button>
  );
});

export function BulkBar({ selection, tasks, ops }: { readonly selection: Selection; readonly tasks: readonly TaskSummary[]; readonly ops: TaskOps }) {
  const { project, capabilities } = useCurrentProject();
  const projects = useProjects();
  const extras = useCardExtras();
  const chosen = useMemo(() => tasks.filter((task) => selection.has(task.id)), [selection, tasks]);
  useViewSelectionCommands(chosen, ops, selection.clear);
  if (selection.count === 0) return null;
  const ids = chosen.map((task) => task.id);
  const canEdit = capabilities['task:update'];
  const canDelete = capabilities['task:delete'];
  const noun = extras.noun ? (ids.length === 1 ? extras.noun.singular : extras.noun.plural) : ids.length === 1 ? 'task' : 'tasks';
  const extraActions = extras.renderBulkActions ? extras.renderBulkActions(ids, () => selection.clear()) : null;
  const otherProjects = (projects.data ?? []).filter((entry) => entry.id !== project.id && !entry.archivedAt && !entry.isTemplate && (entry.role === 'owner' || entry.role === 'editor'));

  // Labels: checked when every selected task has it, tinted when some do.
  const labelCounts = new Map<string, number>();
  for (const task of chosen) for (const id of task.labelIds) labelCounts.set(id, (labelCounts.get(id) ?? 0) + 1);
  const allHave = [...labelCounts].filter(([, count]) => count === chosen.length).map(([id]) => id);

  const done = () => selection.clear();

  return (
    <div
      role="toolbar"
      aria-label={`${ids.length} ${noun} selected`}
      data-testid="bulk-bar"
      className="fixed bottom-6 left-1/2 z-[var(--z-dropdown)] flex max-w-[calc(100vw-24px)] -translate-x-1/2 animate-pop-in items-center gap-1 overflow-x-auto rounded-lg border border-border-subtle bg-raised py-1 pr-2 pl-0 shadow-popover max-sm:bottom-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') done();
      }}
    >
      <div className="flex h-16 shrink-0 items-center gap-3 border-r border-border-subtle pr-4 max-sm:h-12 max-sm:gap-2 max-sm:pr-2">
        <span className="flex h-16 w-14 items-center justify-center rounded-l-lg bg-selected text-xl font-medium text-fg tabular-nums max-sm:h-12 max-sm:w-11" data-testid="bulk-count">
          {ids.length}
        </span>
        <span className="flex flex-col gap-0.5 max-sm:hidden">
          <span className="text-md font-medium whitespace-nowrap text-fg">{`${noun.charAt(0).toUpperCase()}${noun.slice(1)} selected`}</span>
          <span className="text-xs whitespace-nowrap text-fg-muted">
            <Kbd>Shift</Kbd> + click to select a range
          </span>
        </span>
      </div>
      {extraActions}
      {canEdit && extraActions ? (
        <>
          <StatusPicker value={null} onChange={(statusId) => void ops.bulkUpdate(ids, { statusId })}>
            <BarButton icon={<CircleDashed aria-hidden />} label="Status" data-testid="bulk-status" />
          </StatusPicker>
          <AssigneePicker value={null} onChange={(assigneeId) => void ops.bulkUpdate(ids, { assigneeId })}>
            <BarButton icon={<UserRound aria-hidden />} label="Assign" data-testid="bulk-assignee" />
          </AssigneePicker>
        </>
      ) : null}
      {canEdit && !extraActions ? (
        <>
          <StatusPicker value={null} onChange={(statusId) => void ops.bulkUpdate(ids, { statusId })}>
            <BarButton icon={<CircleDashed aria-hidden />} label="Status" data-testid="bulk-status" />
          </StatusPicker>
          <AssigneePicker value={null} onChange={(assigneeId) => void ops.bulkUpdate(ids, { assigneeId })}>
            <BarButton icon={<UserRound aria-hidden />} label="Assign" data-testid="bulk-assignee" />
          </AssigneePicker>
          <PriorityPicker value={null} onChange={(priority) => void ops.bulkUpdate(ids, { priority })}>
            <BarButton icon={<Signal aria-hidden />} label="Priority" data-testid="bulk-priority" />
          </PriorityPicker>
          <DuePicker value={null} onChange={(dueDate) => void ops.bulkUpdate(ids, { dueDate })}>
            <BarButton icon={<CalendarDays aria-hidden />} label="Due" data-testid="bulk-due" />
          </DuePicker>
          {project.labels.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <BarButton icon={<Tag aria-hidden />} label="Labels" data-testid="bulk-labels" />
              </PopoverTrigger>
              <PopoverContent flush side="top" align="center" className="w-64">
                <OptionList
                  heading={`Click a label to add it to ${ids.length === 1 ? 'this task' : `all ${ids.length} tasks`}. Click a checked label to remove it.`}
                  placeholder="Find a label…"
                  options={project.labels.map((label) => {
                    const count = labelCounts.get(label.id) ?? 0;
                    return { value: label.id, label: label.name, icon: <LabelDot color={label.color} />, hint: count > 0 && count < chosen.length ? `${count} of ${chosen.length}` : undefined };
                  })}
                  selected={allHave}
                  onToggle={(labelId) => {
                    if (allHave.includes(labelId)) void ops.bulkUpdate(ids, { removeLabelIds: [labelId] });
                    else void ops.bulkUpdate(ids, { addLabelIds: [labelId] });
                  }}
                />
              </PopoverContent>
            </Popover>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <BarButton icon={<FolderInput aria-hidden />} label="Move" data-testid="bulk-move" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="max-h-80 w-60">
              {project.sections.length > 0 ? (
                <>
                  <DropdownMenuLabel>Move to section</DropdownMenuLabel>
                  {project.sections.map((section) => (
                    <DropdownMenuItem key={section.id} onSelect={() => void ops.bulkUpdate(ids, { sectionId: section.id })}>
                      {section.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => void ops.bulkUpdate(ids, { sectionId: null })}>No section</DropdownMenuItem>
                </>
              ) : null}
              {otherProjects.length > 0 ? (
                <>
                  {project.sections.length > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuLabel>Move to another project</DropdownMenuLabel>
                  {otherProjects.map((entry) => (
                    <DropdownMenuItem
                      key={entry.id}
                      icon={<ArrowRightLeft aria-hidden />}
                      onSelect={() => {
                        void ops.moveToProject(chosen, { id: entry.id, name: entry.name });
                        done();
                      }}
                    >
                      {`${entry.name} (${entry.key})`}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              {project.sections.length === 0 && otherProjects.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-fg-muted">Add a section in the List, or create another project, to move tasks.</p>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      {canDelete && !extraActions ? (
        <BarButton
          icon={<Trash2 aria-hidden />}
          label="Delete"
          danger
          data-testid="bulk-delete"
          onClick={() => {
            void ops.deleteTasks(ids);
            done();
          }}
        />
      ) : null}
      <span aria-hidden className="mx-1 h-8 w-px bg-border-subtle" />
      <IconButton label="Clear selection (Esc)" icon={<X aria-hidden />} onClick={done} data-testid="bulk-clear" />
    </div>
  );
}
