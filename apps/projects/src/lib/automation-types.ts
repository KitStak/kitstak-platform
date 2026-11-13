/**
 * Automation rule model (pm.automations.trigger / conditions / actions). Pure types + the
 * catalogue the builder UI renders as plain sentences. The engine lives in
 * src/server/automations/engine.ts (pure) and the executor in src/server/domain/automations.ts.
 */
import type { Priority, StatusCategory } from './constants';

export type AutomationTrigger =
  | { readonly type: 'task_created' }
  | {
      readonly type: 'status_changed';
      /** Fire only when the new status is this id… */
      readonly toStatusId?: string;
      /** …or in this category (e.g. any "done" column). */
      readonly toCategory?: StatusCategory;
      readonly fromStatusId?: string;
    }
  | { readonly type: 'task_completed' }
  | { readonly type: 'assignee_changed'; readonly toUserId?: string | null }
  | { readonly type: 'priority_changed'; readonly to?: Priority }
  | { readonly type: 'due_date_changed' }
  | { readonly type: 'label_added'; readonly labelId?: string }
  | { readonly type: 'comment_added' }
  | { readonly type: 'section_changed'; readonly toSectionId?: string }
  | { readonly type: 'subtasks_completed' }
  /** Scheduled: an open task is due within `days` days (0 = today). Fires once per due date. */
  | { readonly type: 'due_date_approaching'; readonly days: number }
  /** Scheduled: an open task is past its due date. Fires once per due date. */
  | { readonly type: 'task_overdue' }
  /** A CRM deal/account linked to the task moves to a new stage (optionally a named one). */
  | { readonly type: 'crm_stage_changed'; readonly toStage?: string }
  /** A WMS order linked to the task ships (status becomes Shipped or Delivered). */
  | { readonly type: 'wms_order_shipped' };

export type AutomationTriggerType = AutomationTrigger['type'];

export type AutomationConditionField = 'project' | 'priority' | 'assignee' | 'label' | 'status' | 'statusCategory' | 'section' | 'dueDate' | 'title' | 'isSubtask';

export interface AutomationCondition {
  readonly field: AutomationConditionField;
  readonly op: 'is' | 'is_not' | 'contains' | 'empty' | 'not_empty' | 'overdue';
  readonly value?: string | boolean | null;
}

/** People targets resolved at run time. */
export type AutomationPersonTarget = 'assignee' | 'reporter' | 'project_owner' | 'watchers' | 'actor' | 'user';

export type AutomationAction =
  | { readonly type: 'set_status'; readonly statusId: string }
  | { readonly type: 'set_assignee'; readonly target: 'user' | 'reporter' | 'actor' | 'none'; readonly userId?: string }
  | { readonly type: 'set_priority'; readonly priority: Priority }
  | { readonly type: 'set_due_date'; readonly offsetDays: number }
  | { readonly type: 'add_label'; readonly labelId: string }
  | { readonly type: 'remove_label'; readonly labelId: string }
  | { readonly type: 'move_to_section'; readonly sectionId: string }
  | {
      readonly type: 'notify';
      readonly target: AutomationPersonTarget;
      readonly userId?: string;
      /** Optional custom message; default is generated. Supports {task} and {project}. */
      readonly message?: string;
    }
  | { readonly type: 'add_comment'; readonly body: string }
  | { readonly type: 'create_subtask'; readonly title: string }
  | { readonly type: 'add_watcher'; readonly target: AutomationPersonTarget; readonly userId?: string }
  | { readonly type: 'complete_parent' }
  | { readonly type: 'move_to_project'; readonly projectId: string }
  | {
      readonly type: 'create_follow_up';
      /** Title of the new task. Supports {task} (the original task's name). */
      readonly title: string;
      /** Due this many days after the run (omit for no due date). */
      readonly dueInDays?: number;
      /** Who gets it: the original task's assignee (default), a teammate, or nobody. */
      readonly assignTo?: 'assignee' | 'reporter' | 'user' | 'none';
      readonly userId?: string;
      /** Create it in another project (default: the same project). */
      readonly projectId?: string;
    };

export type AutomationActionType = AutomationAction['type'];

/** Builder catalogue: the plain-language phrase for each trigger/action type. */
export const TRIGGER_PHRASES: Readonly<Record<AutomationTriggerType, string>> = {
  task_created: 'a task is created',
  status_changed: 'the status changes',
  task_completed: 'a task is marked done',
  assignee_changed: 'the assignee changes',
  priority_changed: 'the priority changes',
  due_date_changed: 'the due date changes',
  label_added: 'a label is added',
  comment_added: 'someone comments',
  section_changed: 'a task moves to another section',
  subtasks_completed: 'all subtasks are done',
  due_date_approaching: 'a due date is coming up',
  task_overdue: 'a task becomes overdue',
  crm_stage_changed: 'a linked CRM deal changes stage',
  wms_order_shipped: 'a linked WMS order ships',
};

/** Triggers checked on a schedule (or when a linked record changes) instead of on a task edit. */
export const SCHEDULED_TRIGGER_TYPES: readonly AutomationTriggerType[] = ['due_date_approaching', 'task_overdue', 'crm_stage_changed', 'wms_order_shipped'];

/** WMS order statuses that count as "shipped". */
export const WMS_SHIPPED_STATUSES: readonly string[] = ['shipped', 'delivered'];

export const ACTION_PHRASES: Readonly<Record<AutomationActionType, string>> = {
  set_status: 'move it to a status',
  set_assignee: 'assign it',
  set_priority: 'set the priority',
  set_due_date: 'set the due date',
  add_label: 'add a label',
  remove_label: 'remove a label',
  move_to_section: 'move it to a section',
  notify: 'send a notification',
  add_comment: 'post a comment',
  create_subtask: 'add a subtask',
  add_watcher: 'add a follower',
  complete_parent: 'mark the parent task done',
  move_to_project: 'move it to another project',
  create_follow_up: 'create a follow-up task',
};
