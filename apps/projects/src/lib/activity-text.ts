/**
 * Plain-language sentence for an activity row, without the actor ("moved this to Done").
 * Shared by the task activity feed, the project Activity tab and dashboards.
 */
import { PRIORITY_LABELS, type Priority } from './constants';
import type { ActivityDTO } from './types';

export interface ActivityLookups {
  readonly statusName?: (id: string) => string | undefined;
  readonly personName?: (id: string) => string | undefined;
  readonly labelName?: (id: string) => string | undefined;
  readonly sectionName?: (id: string) => string | undefined;
}

const FIELD_WORDS: Readonly<Record<string, string>> = {
  title: 'renamed this',
  description: 'updated the description',
  start_date: 'changed the start date',
  due_date: 'changed the due date',
  estimate_points: 'changed the estimate',
  estimate_minutes: 'changed the time estimate',
  milestone: 'changed the milestone',
  is_milestone: 'changed the milestone setting',
  recurrence: 'changed how this repeats',
  section: 'moved this to another section',
  reporter: 'changed the reporter',
};

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

export function describeActivity(event: ActivityDTO, lookups: ActivityLookups = {}): string {
  const meta = event.meta ?? {};
  switch (event.verb) {
    case 'task.created':
      if (meta.formName) return `sent this in with the form “${String(meta.formName)}”`;
      if (meta.recurringFrom) return 'created the next repeat of this task';
      if (meta.duplicatedFrom) return 'made this as a copy';
      return 'created this task';
    case 'task.updated': {
      if (event.field === 'status') {
        const to = str(meta.toName) ?? (str(event.after) ? lookups.statusName?.(event.after as string) : undefined);
        return to ? `moved this to ${to}` : 'changed the status';
      }
      if (event.field === 'assignee') {
        const to = str(event.after);
        if (!to) return 'unassigned this';
        return `assigned this to ${lookups.personName?.(to) ?? 'a teammate'}`;
      }
      if (event.field === 'priority') {
        const to = str(event.after) as Priority | undefined;
        return to ? `set the priority to ${PRIORITY_LABELS[to].toLowerCase()}` : 'changed the priority';
      }
      if (event.field === 'title' && str(event.after)) return `renamed this to “${event.after as string}”`;
      if (event.field === 'due_date') return str(event.after) ? `set the due date to ${event.after as string}` : 'removed the due date';
      if (event.field?.startsWith('custom:')) return 'updated a custom field';
      return FIELD_WORDS[event.field ?? ''] ?? 'updated this task';
    }
    case 'task.moved':
      return 'moved this';
    case 'task.moved_project':
      return `moved this to ${str(record(event.after).key) ?? 'another project'}`;
    case 'task.deleted':
      return `deleted ${str(record(event.before).key) ?? 'a task'}`;
    case 'task.restored':
      return 'restored this task';
    case 'task.label_added':
      return `added the label ${lookups.labelName?.(String(event.after)) ?? ''}`.trim();
    case 'task.label_removed':
      return `removed the label ${lookups.labelName?.(String(event.before)) ?? ''}`.trim();
    case 'task.dependency_added':
      return record(event.after).blockedBy ? `said this waits on ${str(record(event.after).key) ?? 'another task'}` : `said this blocks ${str(record(event.after).key) ?? 'another task'}`;
    case 'task.dependency_removed':
      return 'removed a dependency';
    case 'task.link_added':
      return `linked ${str(record(event.after).title) ?? 'a record'}`;
    case 'task.link_removed':
      return `unlinked ${str(record(event.before).title) ?? 'a record'}`;
    case 'comment.added':
      return 'commented';
    case 'comment.edited':
      return 'edited a comment';
    case 'comment.deleted':
      return 'deleted a comment';
    case 'attachment.added':
      return `attached ${str(record(event.after).name) ?? 'a file'}`;
    case 'attachment.deleted':
      return `removed ${str(record(event.before).name) ?? 'a file'}`;
    case 'time.logged': {
      const minutes = Number(record(event.after).minutes ?? 0);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return `logged ${h ? `${h}h ` : ''}${m}m`;
    }
    case 'automation.ran':
      return `ran the automation “${str(meta.name) ?? 'Automation'}”`;
    case 'project.created':
      return 'created this project';
    case 'project.updated':
      if (event.field === 'health') return `marked the project ${String(event.after).replace('_', ' ')}`;
      if (event.field === 'healthNote') return 'updated the status note';
      if (event.field === 'status') return 'changed the project stage';
      if (event.field === 'description') return 'updated the project description';
      if (event.field === 'dueDate' || event.field === 'startDate') return 'changed the project dates';
      if (event.field === 'ownerId') return 'changed the project owner';
      if (event.field === 'spaceId') return 'moved the project to another space';
      return `updated the project ${event.field ?? ''}`.trim();
    case 'project.archived':
      return 'archived this project';
    case 'project.restored':
      return 'restored this project';
    case 'project.member_added':
      return `added ${lookups.personName?.(String(record(event.after).userId)) ?? 'someone'} to the project`;
    case 'project.member_removed':
      return `removed ${lookups.personName?.(String(record(event.before).userId)) ?? 'someone'} from the project`;
    case 'project.member_updated':
      return `changed ${lookups.personName?.(String(record(event.after).userId)) ?? 'someone'}'s role`;
    case 'form.submitted':
      return 'received a form response';
    case 'project.update_posted': {
      const health = String(record(event.after).health ?? 'on_track');
      return `posted a status update: ${health === 'off_track' ? 'off track' : health === 'at_risk' ? 'at risk' : 'on track'}`;
    }
    case 'goal.checked_in':
      return 'checked in on a goal';
    case 'status.created':
      return `added the “${str(record(event.after).name) ?? 'new'}” column`;
    case 'status.updated':
      return `changed the “${str(record(event.after).name) ?? str(record(event.before).name) ?? ''}” column`;
    case 'status.deleted':
      return `removed the “${str(record(event.before).name) ?? ''}” column`;
    case 'section.created':
      return `added the section “${str(record(event.after).name) ?? ''}”`;
    case 'section.updated':
      return `renamed a section to “${str(record(event.after).name) ?? ''}”`;
    case 'section.deleted':
      return `removed the section “${str(record(event.before).name) ?? ''}”`;
    case 'label.created':
      return `added the label “${str(record(event.after).name) ?? ''}”`;
    case 'label.updated':
      return `changed the label “${str(record(event.after).name) ?? ''}”`;
    case 'label.deleted':
      return `removed the label “${str(record(event.before).name) ?? ''}”`;
    case 'field.created':
      return `added the custom field “${str(record(event.after).name) ?? ''}”`;
    case 'field.updated':
      return `changed the custom field “${str(record(event.after).name) ?? ''}”`;
    case 'field.deleted':
      return `removed the custom field “${str(record(event.before).name) ?? ''}”`;
    case 'milestone.created':
      return `added the milestone “${str(record(event.after).name) ?? ''}”`;
    case 'milestone.updated':
      return `updated the milestone “${str(record(event.after).name) ?? str(record(event.before).name) ?? ''}”`;
    case 'milestone.reached':
      return `reached the milestone “${str(record(event.after).name) ?? ''}”`;
    case 'milestone.deleted':
      return `removed the milestone “${str(record(event.before).name) ?? ''}”`;
    default:
      return event.verb.replace(/[._]/g, ' ');
  }
}
