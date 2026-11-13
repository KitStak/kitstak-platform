/**
 * Pure automation engine: given a task event and the org's rules, decide which rules fire and
 * which actions they want. No I/O — the executor (src/server/domain/automations.ts) applies the
 * planned actions through the normal domain functions (so they are permission-checked, logged
 * and can trigger further rules, bounded by MAX_AUTOMATION_DEPTH).
 *
 * Also renders rules as plain sentences for the builder ("When a task is marked done, notify
 * the project owner").
 */
import type {
  AutomationAction,
  AutomationCondition,
  AutomationPersonTarget,
  AutomationTrigger,
} from '@/lib/automation-types';
import { PRIORITY_LABELS, STATUS_CATEGORY_LABELS, type Priority, type StatusCategory } from '@/lib/constants';

/** Rules triggered by rule actions can trigger further rules up to this depth. */
export const MAX_AUTOMATION_DEPTH = 3;

export interface EngineTask {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly statusId: string;
  readonly statusCategory: StatusCategory;
  readonly priority: Priority;
  readonly assigneeId: string | null;
  readonly sectionId: string | null;
  readonly dueDate: string | null;
  readonly labelIds: readonly string[];
  readonly parentTaskId: string | null;
}

export type TaskEventType =
  | 'task_created'
  | 'status_changed'
  | 'assignee_changed'
  | 'priority_changed'
  | 'due_date_changed'
  | 'label_added'
  | 'comment_added'
  | 'section_changed'
  | 'subtasks_completed'
  /** Scheduled sweep: the task is due within some days (see `daysUntilDue`). */
  | 'due_soon'
  /** Scheduled sweep: the task is past its due date. */
  | 'overdue'
  /** A linked CRM record's stage changed (`stage`, `previousStage`). */
  | 'crm_stage_changed'
  /** A linked WMS order changed into a shipped status. */
  | 'wms_order_shipped';

export interface TaskEvent {
  readonly type: TaskEventType;
  readonly task: EngineTask;
  /** Values before the change (status_changed / assignee_changed / …). */
  readonly previous?: Partial<EngineTask>;
  /** label_added: which label. */
  readonly labelId?: string;
  /** due_soon: days between today and the due date (0 = due today). */
  readonly daysUntilDue?: number;
  /** crm_stage_changed / wms_order_shipped: the record's new and old stage/status. */
  readonly stage?: string | null;
  readonly previousStage?: string | null;
  /** Human name of the linked record ("Acme · Renewal"). */
  readonly targetTitle?: string | null;
  /**
   * Scheduled events can be seen many times; a rule runs at most once per (rule, task, key).
   * The executor stores it on the run and skips repeats.
   */
  readonly dedupeKey?: string;
}

export interface EngineRule {
  readonly id: string;
  readonly projectId: string | null;
  readonly enabled: boolean;
  readonly trigger: AutomationTrigger;
  readonly conditions: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
}

export interface PlannedRun {
  readonly ruleId: string;
  readonly actions: readonly AutomationAction[];
}

const isClosed = (category: StatusCategory | undefined): boolean => category === 'done' || category === 'cancelled';

export function triggerMatches(trigger: AutomationTrigger, event: TaskEvent): boolean {
  const { task, previous } = event;
  switch (trigger.type) {
    case 'task_created':
      return event.type === 'task_created';
    case 'status_changed':
      if (event.type !== 'status_changed') return false;
      if (trigger.toStatusId && task.statusId !== trigger.toStatusId) return false;
      if (trigger.toCategory && task.statusCategory !== trigger.toCategory) return false;
      if (trigger.fromStatusId && previous?.statusId !== trigger.fromStatusId) return false;
      return true;
    case 'task_completed':
      return event.type === 'status_changed' && task.statusCategory === 'done' && previous?.statusCategory !== 'done';
    case 'assignee_changed':
      if (event.type !== 'assignee_changed') return false;
      return trigger.toUserId === undefined || task.assigneeId === trigger.toUserId;
    case 'priority_changed':
      if (event.type !== 'priority_changed') return false;
      return trigger.to === undefined || task.priority === trigger.to;
    case 'due_date_changed':
      return event.type === 'due_date_changed';
    case 'label_added':
      if (event.type !== 'label_added') return false;
      return trigger.labelId === undefined || event.labelId === trigger.labelId;
    case 'comment_added':
      return event.type === 'comment_added';
    case 'section_changed':
      if (event.type !== 'section_changed') return false;
      return trigger.toSectionId === undefined || task.sectionId === trigger.toSectionId;
    case 'subtasks_completed':
      return event.type === 'subtasks_completed';
    case 'due_date_approaching':
      return event.type === 'due_soon' && event.daysUntilDue !== undefined && event.daysUntilDue >= 0 && event.daysUntilDue <= trigger.days;
    case 'task_overdue':
      return event.type === 'overdue';
    case 'crm_stage_changed':
      if (event.type !== 'crm_stage_changed') return false;
      return !trigger.toStage || (event.stage ?? '').trim().toLowerCase() === trigger.toStage.trim().toLowerCase();
    case 'wms_order_shipped':
      return event.type === 'wms_order_shipped';
  }
}

export function conditionMatches(condition: AutomationCondition, task: EngineTask, today: string): boolean {
  const value = condition.value;
  const actual: string | boolean | null | readonly string[] = (() => {
    switch (condition.field) {
      case 'project':
        return task.projectId;
      case 'priority':
        return task.priority;
      case 'assignee':
        return task.assigneeId;
      case 'label':
        return task.labelIds;
      case 'status':
        return task.statusId;
      case 'statusCategory':
        return task.statusCategory;
      case 'section':
        return task.sectionId;
      case 'dueDate':
        return task.dueDate;
      case 'title':
        return task.title;
      case 'isSubtask':
        return task.parentTaskId !== null;
    }
  })();
  const list = Array.isArray(actual) ? (actual as readonly string[]) : null;
  switch (condition.op) {
    case 'empty':
      return list ? list.length === 0 : actual === null || actual === '';
    case 'not_empty':
      return list ? list.length > 0 : actual !== null && actual !== '';
    case 'is':
      return list ? list.includes(String(value)) : actual === value;
    case 'is_not':
      return list ? !list.includes(String(value)) : actual !== value;
    case 'contains':
      return typeof actual === 'string' && typeof value === 'string' && actual.toLowerCase().includes(value.toLowerCase());
    case 'overdue':
      return typeof actual === 'string' && actual < today && !isClosed(task.statusCategory);
  }
}

/**
 * Rules that fire for `event`, in input order. A rule scoped to a project only sees that
 * project's tasks; org-wide rules (projectId null) see every project.
 */
export function planAutomations(event: TaskEvent, rules: readonly EngineRule[], today: string): PlannedRun[] {
  const runs: PlannedRun[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.projectId && rule.projectId !== event.task.projectId) continue;
    if (!triggerMatches(rule.trigger, event)) continue;
    if (!rule.conditions.every((condition) => conditionMatches(condition, event.task, today))) continue;
    if (rule.actions.length === 0) continue;
    runs.push({ ruleId: rule.id, actions: rule.actions });
  }
  return runs;
}

/** Names the describer needs to turn ids into words. Unknown ids fall back to generic words. */
export interface DescribeLookups {
  readonly status?: (id: string) => string | undefined;
  readonly label?: (id: string) => string | undefined;
  readonly section?: (id: string) => string | undefined;
  readonly person?: (id: string) => string | undefined;
  readonly project?: (id: string) => string | undefined;
}

function quote(name: string | undefined, fallback: string): string {
  return name ? `“${name}”` : fallback;
}

const PERSON_WORDS: Readonly<Record<AutomationPersonTarget, string>> = {
  assignee: 'the assignee',
  reporter: 'the person who created it',
  project_owner: 'the project owner',
  watchers: 'everyone following it',
  actor: 'the person who made the change',
  user: 'a teammate',
};

function personWords(target: AutomationPersonTarget, userId: string | undefined, lookups: DescribeLookups): string {
  if (target === 'user' && userId) return lookups.person?.(userId) ?? 'a teammate';
  return PERSON_WORDS[target];
}

export function describeTrigger(trigger: AutomationTrigger, lookups: DescribeLookups = {}): string {
  switch (trigger.type) {
    case 'task_created':
      return 'a task is created';
    case 'status_changed':
      if (trigger.toStatusId) return `a task moves to ${quote(lookups.status?.(trigger.toStatusId), 'a status')}`;
      if (trigger.toCategory) return `a task moves to ${STATUS_CATEGORY_LABELS[trigger.toCategory].toLowerCase()}`;
      return 'the status changes';
    case 'task_completed':
      return 'a task is marked done';
    case 'assignee_changed':
      if (trigger.toUserId === null) return 'a task is unassigned';
      if (trigger.toUserId) return `a task is assigned to ${lookups.person?.(trigger.toUserId) ?? 'a teammate'}`;
      return 'the assignee changes';
    case 'priority_changed':
      return trigger.to ? `the priority is set to ${PRIORITY_LABELS[trigger.to].toLowerCase()}` : 'the priority changes';
    case 'due_date_changed':
      return 'the due date changes';
    case 'label_added':
      return trigger.labelId ? `the label ${quote(lookups.label?.(trigger.labelId), '')} is added` : 'a label is added';
    case 'comment_added':
      return 'someone comments';
    case 'section_changed':
      return trigger.toSectionId
        ? `a task moves to the ${quote(lookups.section?.(trigger.toSectionId), '')} section`
        : 'a task moves to another section';
    case 'subtasks_completed':
      return 'all subtasks are done';
    case 'due_date_approaching':
      if (trigger.days <= 0) return 'a task is due today';
      if (trigger.days === 1) return 'a task is due tomorrow';
      return `a task is due in ${trigger.days} days or less`;
    case 'task_overdue':
      return 'a task becomes overdue';
    case 'crm_stage_changed':
      return trigger.toStage ? `a linked CRM deal moves to “${trigger.toStage}”` : 'a linked CRM deal changes stage';
    case 'wms_order_shipped':
      return 'a linked WMS order ships';
  }
}

export function describeAction(action: AutomationAction, lookups: DescribeLookups = {}): string {
  switch (action.type) {
    case 'set_status':
      return `move it to ${quote(lookups.status?.(action.statusId), 'a status')}`;
    case 'set_assignee':
      if (action.target === 'none') return 'unassign it';
      if (action.target === 'reporter') return 'assign it to the person who created it';
      if (action.target === 'actor') return 'assign it to the person who made the change';
      return `assign it to ${action.userId ? (lookups.person?.(action.userId) ?? 'a teammate') : 'a teammate'}`;
    case 'set_priority':
      return `set the priority to ${PRIORITY_LABELS[action.priority].toLowerCase()}`;
    case 'set_due_date':
      if (action.offsetDays === 0) return 'make it due today';
      if (action.offsetDays === 1) return 'make it due tomorrow';
      return `make it due in ${action.offsetDays} days`;
    case 'add_label':
      return `add the label ${quote(lookups.label?.(action.labelId), '')}`.trim();
    case 'remove_label':
      return `remove the label ${quote(lookups.label?.(action.labelId), '')}`.trim();
    case 'move_to_section':
      return `move it to the ${quote(lookups.section?.(action.sectionId), '')} section`;
    case 'notify':
      return `notify ${personWords(action.target, action.userId, lookups)}`;
    case 'add_comment':
      return 'post a comment';
    case 'create_subtask':
      return `add the subtask “${action.title}”`;
    case 'add_watcher':
      return `add ${personWords(action.target, action.userId, lookups)} as a follower`;
    case 'complete_parent':
      return 'mark the parent task done';
    case 'move_to_project':
      return `move it to the ${quote(lookups.project?.(action.projectId), '')} project`.replace(/\s+/g, ' ');
    case 'create_follow_up': {
      const who =
        action.assignTo === 'none'
          ? ''
          : action.assignTo === 'reporter'
            ? ' for the person who created it'
            : action.assignTo === 'user' && action.userId
              ? ` for ${lookups.person?.(action.userId) ?? 'a teammate'}`
              : ' for the assignee';
      const when =
        action.dueInDays === undefined ? '' : action.dueInDays === 0 ? ', due today' : action.dueInDays === 1 ? ', due tomorrow' : `, due in ${action.dueInDays} days`;
      const where = action.projectId ? ` in ${quote(lookups.project?.(action.projectId), 'another project')}` : '';
      return `create the follow-up task “${action.title.replaceAll('{task}', 'task name')}”${who}${where}${when}`;
    }
  }
}

function describeCondition(condition: AutomationCondition, lookups: DescribeLookups): string {
  const value = typeof condition.value === 'string' ? condition.value : '';
  switch (condition.field) {
    case 'project':
      return `it is ${condition.op === 'is_not' ? 'not ' : ''}in the ${quote(lookups.project?.(value), '')} project`.replace(/\s+/g, ' ');
    case 'priority':
      return condition.op === 'is'
        ? `the priority is ${PRIORITY_LABELS[value as Priority]?.toLowerCase() ?? value}`
        : `the priority is not ${PRIORITY_LABELS[value as Priority]?.toLowerCase() ?? value}`;
    case 'assignee':
      if (condition.op === 'empty') return 'nobody is assigned';
      if (condition.op === 'not_empty') return 'someone is assigned';
      return `it is ${condition.op === 'is_not' ? 'not ' : ''}assigned to ${lookups.person?.(value) ?? 'a teammate'}`;
    case 'label':
      return `it ${condition.op === 'is_not' ? 'does not have' : 'has'} the label ${quote(lookups.label?.(value), '')}`;
    case 'status':
      return `it is ${condition.op === 'is_not' ? 'not ' : ''}in ${quote(lookups.status?.(value), 'a status')}`;
    case 'statusCategory':
      return `it is ${condition.op === 'is_not' ? 'not ' : ''}${STATUS_CATEGORY_LABELS[value as StatusCategory]?.toLowerCase() ?? value}`;
    case 'section':
      return `it is ${condition.op === 'is_not' ? 'not ' : ''}in the ${quote(lookups.section?.(value), '')} section`;
    case 'dueDate':
      if (condition.op === 'overdue') return 'it is overdue';
      return condition.op === 'empty' ? 'it has no due date' : 'it has a due date';
    case 'title':
      return `the title contains “${value}”`;
    case 'isSubtask':
      return condition.value === false ? 'it is not a subtask' : 'it is a subtask';
  }
}

function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "When a task is marked done and the priority is high, notify the project owner and add the label “Shipped”." */
export function describeAutomation(
  rule: Pick<EngineRule, 'trigger' | 'conditions' | 'actions'>,
  lookups: DescribeLookups = {},
): string {
  const when = describeTrigger(rule.trigger, lookups);
  const conditions = rule.conditions.map((condition) => describeCondition(condition, lookups));
  const actions = rule.actions.map((action) => describeAction(action, lookups));
  const ifPart = conditions.length ? ` and ${joinWords(conditions)}` : '';
  const sentence = `When ${when}${ifPart}, ${joinWords(actions) || 'do nothing'}.`;
  return sentence.replace(/\s+/g, ' ');
}

const PRIORITY_WORDS: Readonly<Record<Priority, string>> = {
  urgent: 'urgent',
  high: 'high',
  medium: 'medium',
  low: 'low',
  none: 'no priority',
};

/**
 * Inbox headline for an automation "notify" action: what happened, not the rule's name (the rule
 * name goes in the notification body). `taskLabel` is "OPS-7 Fix the dock leveler".
 */
export function automationEventHeadline(event: TaskEvent | undefined, taskLabel: string, statusName?: string | null): string {
  if (!event) return `${taskLabel} needs your attention`;
  const task = event.task;
  switch (event.type) {
    case 'task_created':
      return `${taskLabel} was created`;
    case 'status_changed':
      if (task.statusCategory === 'done') return `${taskLabel} was marked done`;
      if (task.statusCategory === 'cancelled') return `${taskLabel} was cancelled`;
      return statusName ? `${taskLabel} moved to ${statusName}` : `${taskLabel} changed status`;
    case 'assignee_changed':
      return task.assigneeId ? `${taskLabel} was assigned` : `${taskLabel} was unassigned`;
    case 'priority_changed':
      return task.priority === 'none' ? `${taskLabel} no longer has a priority` : `${taskLabel} is now ${PRIORITY_WORDS[task.priority]} priority`;
    case 'due_date_changed':
      return task.dueDate ? `${taskLabel} has a new due date` : `${taskLabel} no longer has a due date`;
    case 'label_added':
      return `${taskLabel} got a new label`;
    case 'comment_added':
      return `New comment on ${taskLabel}`;
    case 'section_changed':
      return `${taskLabel} moved to another section`;
    case 'subtasks_completed':
      return `Every subtask of ${taskLabel} is done`;
    case 'due_soon': {
      const days = event.daysUntilDue ?? 1;
      if (days <= 0) return `${taskLabel} is due today`;
      if (days === 1) return `${taskLabel} is due tomorrow`;
      return `${taskLabel} is due in ${days} days`;
    }
    case 'overdue':
      return `${taskLabel} is overdue`;
    case 'crm_stage_changed':
      return `${event.targetTitle ?? 'A linked CRM record'} moved to ${event.stage ?? 'a new stage'} (${taskLabel})`;
    case 'wms_order_shipped':
      return `${event.targetTitle ?? 'A linked WMS order'} shipped (${taskLabel})`;
  }
}
