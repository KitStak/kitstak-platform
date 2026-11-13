'use client';
/**
 * The task actions menu (right-click on a card/row, or its "…" button): open, copy link,
 * status, priority, assign to me, due date shortcuts, duplicate, move to another project,
 * delete with undo. One definition rendered as a DropdownMenu or a ContextMenu.
 */
import type { ComponentType, ReactNode } from 'react';
import { ArrowRightLeft, CalendarCheck2, CalendarX2, Copy, ExternalLink, Link2, Signal, SquareCheckBig, Trash2, UserRoundCheck, UserX } from 'lucide-react';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITIES, PRIORITY_LABELS } from '@/lib/constants';
import { addDaysIso, todayIso } from '@/lib/dates';
import { useProjects } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShell } from '@/features/shell/shell-context';
import type { TaskOps } from './use-task-ops';

type ItemProps = { readonly icon?: ReactNode; readonly onSelect?: (event: Event) => void; readonly variant?: 'default' | 'danger'; readonly children: ReactNode; readonly disabled?: boolean; readonly shortcut?: string };

interface MenuParts {
  readonly Item: ComponentType<ItemProps>;
  readonly Separator: ComponentType<{ className?: string }>;
  readonly Sub: ComponentType<{ children: ReactNode }>;
  readonly SubTrigger: ComponentType<{ icon?: ReactNode; children: ReactNode }>;
  readonly SubContent: ComponentType<{ children: ReactNode; className?: string }>;
}

const DROPDOWN: MenuParts = {
  Item: DropdownMenuItem as ComponentType<ItemProps>,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub as ComponentType<{ children: ReactNode }>,
  SubTrigger: DropdownMenuSubTrigger as ComponentType<{ icon?: ReactNode; children: ReactNode }>,
  SubContent: DropdownMenuSubContent as ComponentType<{ children: ReactNode; className?: string }>,
};

const CONTEXT: MenuParts = {
  Item: ContextMenuItem as ComponentType<ItemProps>,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub as ComponentType<{ children: ReactNode }>,
  SubTrigger: ContextMenuSubTrigger as ComponentType<{ icon?: ReactNode; children: ReactNode }>,
  SubContent: ContextMenuSubContent as ComponentType<{ children: ReactNode; className?: string }>,
};

export function TaskMenuItems({ task, ops, kind }: { readonly task: TaskSummary; readonly ops: TaskOps; readonly kind: 'dropdown' | 'context' }) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = kind === 'dropdown' ? DROPDOWN : CONTEXT;
  const { project, statuses, capabilities } = useCurrentProject();
  const { user } = useShell();
  const { openTask } = useTaskDrawer();
  const projects = useProjects();
  const canEdit = capabilities['task:update'];
  const canDelete = capabilities['task:delete'];
  const canCreate = capabilities['task:create'];
  const otherProjects = (projects.data ?? []).filter((entry) => entry.id !== project.id && !entry.archivedAt && !entry.isTemplate && (entry.role === 'owner' || entry.role === 'editor'));
  const today = todayIso();
  const done = statuses.find((status) => status.category === 'done');

  return (
    <>
      <Item icon={<ExternalLink aria-hidden />} onSelect={() => openTask(task.key)} shortcut="Enter">
        Open task
      </Item>
      <Item icon={<Link2 aria-hidden />} onSelect={() => void ops.copyLink(task)}>
        Copy link
      </Item>
      {canEdit ? (
        <>
          <Separator />
          {done && task.statusId !== done.id ? (
            <Item icon={<SquareCheckBig aria-hidden />} onSelect={() => void ops.updateTask(task.id, { statusId: done.id })}>
              Mark done
            </Item>
          ) : null}
          <Sub>
            <SubTrigger icon={<StatusIcon category={task.statusCategory} color={statuses.find((s) => s.id === task.statusId)?.color} />}>Status</SubTrigger>
            <SubContent className="w-52">
              {statuses.map((status) => (
                <Item key={status.id} icon={<StatusIcon category={status.category} color={status.color} />} onSelect={() => status.id !== task.statusId && void ops.updateTask(task.id, { statusId: status.id })}>
                  {status.id === task.statusId ? `${status.name} (now)` : status.name}
                </Item>
              ))}
            </SubContent>
          </Sub>
          <Sub>
            <SubTrigger icon={<Signal aria-hidden />}>Priority</SubTrigger>
            <SubContent className="w-48">
              {PRIORITIES.map((priority) => (
                <Item key={priority} icon={<PriorityIcon priority={priority} />} onSelect={() => priority !== task.priority && void ops.updateTask(task.id, { priority })}>
                  {priority === task.priority ? `${PRIORITY_LABELS[priority]} (now)` : PRIORITY_LABELS[priority]}
                </Item>
              ))}
            </SubContent>
          </Sub>
          {task.assigneeId === user.id ? (
            <Item icon={<UserX aria-hidden />} onSelect={() => void ops.updateTask(task.id, { assigneeId: null })}>
              Unassign me
            </Item>
          ) : (
            <Item icon={<UserRoundCheck aria-hidden />} onSelect={() => void ops.updateTask(task.id, { assigneeId: user.id })}>
              Assign to me
            </Item>
          )}
          <Sub>
            <SubTrigger icon={<CalendarCheck2 aria-hidden />}>Due date</SubTrigger>
            <SubContent className="w-48">
              <Item onSelect={() => void ops.updateTask(task.id, { dueDate: today })}>Today</Item>
              <Item onSelect={() => void ops.updateTask(task.id, { dueDate: addDaysIso(today, 1) })}>Tomorrow</Item>
              <Item onSelect={() => void ops.updateTask(task.id, { dueDate: addDaysIso(today, 7) })}>In a week</Item>
              {task.dueDate ? (
                <Item icon={<CalendarX2 aria-hidden />} onSelect={() => void ops.updateTask(task.id, { dueDate: null })}>
                  Remove due date
                </Item>
              ) : null}
            </SubContent>
          </Sub>
        </>
      ) : null}
      {canCreate || (canEdit && otherProjects.length > 0) ? <Separator /> : null}
      {canCreate ? (
        <Item icon={<Copy aria-hidden />} onSelect={() => void ops.duplicate(task)}>
          Duplicate
        </Item>
      ) : null}
      {canEdit && otherProjects.length > 0 ? (
        <Sub>
          <SubTrigger icon={<ArrowRightLeft aria-hidden />}>Move to project</SubTrigger>
          <SubContent className="max-h-72 w-60 overflow-y-auto">
            {otherProjects.map((entry) => (
              <Item key={entry.id} onSelect={() => void ops.moveToProject([task], { id: entry.id, name: entry.name })}>
                {`${entry.name} (${entry.key})`}
              </Item>
            ))}
          </SubContent>
        </Sub>
      ) : null}
      {canDelete ? (
        <>
          <Separator />
          <Item icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => void ops.deleteTasks([task.id], `Deleted ${task.key}`)} shortcut="Del">
            Delete
          </Item>
        </>
      ) : null}
    </>
  );
}
