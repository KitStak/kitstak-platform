'use client';
/**
 * What a group / swimlane / column means for a task field: its order, a friendly title + icon
 * for each key, and the change that moves a task into it (drag between groups, add-in-group).
 * Shared by Board swimlanes, List groups and Table groups.
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import { Tag, UserRound } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { NO_GROUP } from '@/lib/task-filters';
import type { TaskSummary } from '@/lib/types';
import type { GroupField } from '@/lib/view-config';
import type { TaskPatch } from '@/server/actions/tasks';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShell } from '@/features/shell/shell-context';
import { LabelDot } from './field-pickers';

export interface GroupInfo {
  readonly key: string;
  readonly title: string;
  readonly icon?: ReactNode;
}

/** The change that puts a task into group `to` (coming from group `from`). */
export interface GroupMove {
  readonly patch: TaskPatch;
  /** For section moves the drag goes through moveTask (sectionId), not updateTask. */
  readonly sectionId?: string | null;
  readonly statusId?: string;
  readonly labelIds?: readonly string[];
}

export interface GroupMeta {
  readonly field: GroupField;
  /** Group keys in display order (every possible group, even empty ones). */
  readonly order: readonly string[];
  info(key: string): GroupInfo;
  /** null when this grouping can't be changed by dragging (e.g. date groups). */
  move(task: TaskSummary, from: string, to: string): GroupMove | null;
  /** Defaults for a task created inside the group. */
  createDefaults(key: string): Partial<{ statusId: string; sectionId: string | null; assigneeId: string | null; priority: Priority; labelIds: string[]; customFields: Record<string, unknown> }>;
  /** Show empty groups (statuses, sections, priorities) or only groups that have tasks. */
  readonly showEmpty: boolean;
}

export function useGroupMeta(field: GroupField, tasks: readonly TaskSummary[], fieldId?: string | null): GroupMeta {
  const { project, statuses, statusById, sectionById, labelById } = useCurrentProject();
  const people = usePeopleMap();
  const { user } = useShell();
  const customField = field === 'custom' ? project.customFields.find((entry) => entry.id === fieldId) : undefined;

  const order = useMemo<string[]>(() => {
    switch (field) {
      case 'status':
        return statuses.map((status) => status.id);
      case 'priority':
        return [...PRIORITIES];
      case 'section':
        return [...project.sections.map((section) => section.id), NO_GROUP];
      case 'label':
        return [...project.labels.map((label) => label.id), NO_GROUP];
      case 'assignee': {
        const ids = new Set<string>();
        for (const task of tasks) if (task.assigneeId) ids.add(task.assigneeId);
        const sorted = [...ids].sort((a, b) => {
          if (a === user.id) return -1;
          if (b === user.id) return 1;
          return (people.get(a)?.name ?? '').localeCompare(people.get(b)?.name ?? '');
        });
        return [...sorted, NO_GROUP];
      }
      case 'custom':
        return [...(customField?.config.options ?? []).map((option) => option.id), NO_GROUP];
      default:
        return ['all'];
    }
  }, [customField, field, people, project.labels, project.sections, statuses, tasks, user.id]);

  const info = useCallback(
    (key: string): GroupInfo => {
      switch (field) {
        case 'status': {
          const status = statusById.get(key);
          return { key, title: status?.name ?? 'Unknown status', icon: status ? <StatusIcon category={status.category} color={status.color} /> : undefined };
        }
        case 'priority':
          return { key, title: PRIORITY_LABELS[key as Priority] ?? key, icon: <PriorityIcon priority={key as Priority} /> };
        case 'section':
          return { key, title: key === NO_GROUP ? (project.sections.length ? 'No section' : 'Tasks') : (sectionById.get(key)?.name ?? 'Section') };
        case 'label': {
          const label = labelById.get(key);
          return key === NO_GROUP || !label
            ? { key, title: 'No label', icon: <Tag aria-hidden className="size-3.5 text-icon" /> }
            : { key, title: label.name, icon: <LabelDot color={label.color} /> };
        }
        case 'assignee': {
          if (key === NO_GROUP) return { key, title: 'Unassigned', icon: <UserRound aria-hidden className="size-4 text-icon" /> };
          const person = people.get(key);
          return { key, title: person ? (key === user.id ? `${person.name} (me)` : person.name) : 'Former member', icon: <Avatar name={person?.name ?? '?'} src={person?.image} size="xs" /> };
        }
        case 'custom': {
          const option = customField?.config.options?.find((entry) => entry.id === key);
          return option ? { key, title: option.label, icon: <LabelDot color={option.color} /> } : { key, title: `No ${customField?.name.toLowerCase() ?? 'value'}` };
        }
        default:
          return { key, title: 'All tasks' };
      }
    },
    [customField, field, labelById, people, project.sections.length, sectionById, statusById, user.id],
  );

  const move = useCallback(
    (task: TaskSummary, from: string, to: string): GroupMove | null => {
      if (from === to) return { patch: {} };
      const value = to === NO_GROUP ? null : to;
      switch (field) {
        case 'status':
          return value ? { patch: {}, statusId: value } : null;
        case 'priority':
          return { patch: { priority: (value ?? 'none') as Priority } };
        case 'section':
          return { patch: {}, sectionId: value };
        case 'assignee':
          return { patch: { assigneeId: value } };
        case 'label': {
          const next = new Set(task.labelIds);
          if (from !== NO_GROUP) next.delete(from);
          if (value) next.add(value);
          else next.clear();
          return { patch: {}, labelIds: [...next] };
        }
        case 'custom':
          return customField ? { patch: { customFields: { [customField.id]: value } } } : null;
        default:
          return null;
      }
    },
    [customField, field],
  );

  const createDefaults = useCallback(
    (key: string): ReturnType<GroupMeta['createDefaults']> => {
      const value = key === NO_GROUP ? null : key;
      switch (field) {
        case 'status':
          return value ? { statusId: value } : {};
        case 'priority':
          return { priority: (value ?? 'none') as Priority };
        case 'section':
          return { sectionId: value };
        case 'assignee':
          return { assigneeId: value };
        case 'label':
          return value ? { labelIds: [value] } : {};
        case 'custom':
          return customField && value ? { customFields: { [customField.id]: value } } : {};
        default:
          return {};
      }
    },
    [customField, field],
  );

  return { field, order, info, move, createDefaults, showEmpty: field === 'status' || field === 'section' || field === 'priority' };
}
