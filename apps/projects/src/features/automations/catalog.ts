/**
 * Builder catalogue (client-safe): every trigger, condition and action the sentence builder
 * offers, plus the recipe gallery. Phrases are written for an 8th grader.
 */
import type {
  AutomationAction,
  AutomationActionType,
  AutomationCondition,
  AutomationConditionField,
  AutomationTrigger,
  AutomationTriggerType,
} from '@/lib/automation-types';

export type IntegrationNeed = 'crm' | 'wms';

export interface TriggerOption {
  readonly type: AutomationTriggerType;
  /** Plain words after "When". */
  readonly label: string;
  readonly group: 'Task changes' | 'Dates' | 'Other KitStak apps';
  readonly needs?: IntegrationNeed;
  /** The trigger refers to project-specific things (a status or section by id). */
  readonly make: () => AutomationTrigger;
}

export const TRIGGER_OPTIONS: readonly TriggerOption[] = [
  { type: 'task_created', label: 'a task is created', group: 'Task changes', make: () => ({ type: 'task_created' }) },
  { type: 'status_changed', label: 'the status changes', group: 'Task changes', make: () => ({ type: 'status_changed' }) },
  { type: 'task_completed', label: 'a task is marked done', group: 'Task changes', make: () => ({ type: 'task_completed' }) },
  { type: 'assignee_changed', label: 'the assignee changes', group: 'Task changes', make: () => ({ type: 'assignee_changed' }) },
  { type: 'priority_changed', label: 'the priority changes', group: 'Task changes', make: () => ({ type: 'priority_changed' }) },
  { type: 'due_date_changed', label: 'the due date changes', group: 'Task changes', make: () => ({ type: 'due_date_changed' }) },
  { type: 'label_added', label: 'a label is added', group: 'Task changes', make: () => ({ type: 'label_added' }) },
  { type: 'comment_added', label: 'someone comments', group: 'Task changes', make: () => ({ type: 'comment_added' }) },
  { type: 'section_changed', label: 'a task moves to another section', group: 'Task changes', make: () => ({ type: 'section_changed' }) },
  { type: 'subtasks_completed', label: 'all subtasks are done', group: 'Task changes', make: () => ({ type: 'subtasks_completed' }) },
  { type: 'due_date_approaching', label: 'a due date is coming up', group: 'Dates', make: () => ({ type: 'due_date_approaching', days: 1 }) },
  { type: 'task_overdue', label: 'a task becomes overdue', group: 'Dates', make: () => ({ type: 'task_overdue' }) },
  { type: 'crm_stage_changed', label: 'a linked CRM deal changes stage', group: 'Other KitStak apps', needs: 'crm', make: () => ({ type: 'crm_stage_changed' }) },
  { type: 'wms_order_shipped', label: 'a linked WMS order ships', group: 'Other KitStak apps', needs: 'wms', make: () => ({ type: 'wms_order_shipped' }) },
];

export const triggerOption = (type: AutomationTriggerType): TriggerOption =>
  TRIGGER_OPTIONS.find((option) => option.type === type) ?? TRIGGER_OPTIONS[0];

export interface ActionOption {
  readonly type: AutomationActionType;
  readonly label: string;
  readonly group: 'Change the task' | 'Tell people' | 'Create work';
  /** Uses a project's statuses/sections: only for rules that belong to one project. */
  readonly needsProject?: boolean;
  readonly make: () => AutomationAction;
}

export const ACTION_OPTIONS: readonly ActionOption[] = [
  { type: 'set_status', label: 'move it to a status', group: 'Change the task', needsProject: true, make: () => ({ type: 'set_status', statusId: '' }) },
  { type: 'set_assignee', label: 'assign it', group: 'Change the task', make: () => ({ type: 'set_assignee', target: 'user', userId: '' }) },
  { type: 'set_priority', label: 'set the priority', group: 'Change the task', make: () => ({ type: 'set_priority', priority: 'high' }) },
  { type: 'set_due_date', label: 'set the due date', group: 'Change the task', make: () => ({ type: 'set_due_date', offsetDays: 2 }) },
  { type: 'add_label', label: 'add a label', group: 'Change the task', make: () => ({ type: 'add_label', labelId: '' }) },
  { type: 'remove_label', label: 'remove a label', group: 'Change the task', make: () => ({ type: 'remove_label', labelId: '' }) },
  { type: 'move_to_section', label: 'move it to a section', group: 'Change the task', needsProject: true, make: () => ({ type: 'move_to_section', sectionId: '' }) },
  { type: 'move_to_project', label: 'move it to another project', group: 'Change the task', make: () => ({ type: 'move_to_project', projectId: '' }) },
  { type: 'complete_parent', label: 'mark the parent task done', group: 'Change the task', make: () => ({ type: 'complete_parent' }) },
  { type: 'notify', label: 'send a notification', group: 'Tell people', make: () => ({ type: 'notify', target: 'assignee' }) },
  { type: 'add_comment', label: 'post a comment', group: 'Tell people', make: () => ({ type: 'add_comment', body: '' }) },
  { type: 'add_watcher', label: 'add a follower', group: 'Tell people', make: () => ({ type: 'add_watcher', target: 'actor' }) },
  { type: 'create_subtask', label: 'add a subtask', group: 'Create work', make: () => ({ type: 'create_subtask', title: '' }) },
  {
    type: 'create_follow_up',
    label: 'create a follow-up task',
    group: 'Create work',
    make: () => ({ type: 'create_follow_up', title: 'Follow up on {task}', dueInDays: 2, assignTo: 'assignee' }),
  },
];

export const actionOption = (type: AutomationActionType): ActionOption =>
  ACTION_OPTIONS.find((option) => option.type === type) ?? ACTION_OPTIONS[0];

export interface ConditionOption {
  readonly field: AutomationConditionField;
  readonly label: string;
  readonly needsProject?: boolean;
  readonly make: () => AutomationCondition;
}

export const CONDITION_OPTIONS: readonly ConditionOption[] = [
  { field: 'project', label: 'the project', make: () => ({ field: 'project', op: 'is', value: '' }) },
  { field: 'priority', label: 'the priority', make: () => ({ field: 'priority', op: 'is', value: 'high' }) },
  { field: 'label', label: 'the labels', make: () => ({ field: 'label', op: 'is', value: '' }) },
  { field: 'assignee', label: 'the assignee', make: () => ({ field: 'assignee', op: 'empty' }) },
  { field: 'statusCategory', label: 'the kind of status', make: () => ({ field: 'statusCategory', op: 'is', value: 'todo' }) },
  { field: 'status', label: 'the exact status', needsProject: true, make: () => ({ field: 'status', op: 'is', value: '' }) },
  { field: 'section', label: 'the section', needsProject: true, make: () => ({ field: 'section', op: 'is', value: '' }) },
  { field: 'dueDate', label: 'the due date', make: () => ({ field: 'dueDate', op: 'overdue' }) },
  { field: 'title', label: 'the task name', make: () => ({ field: 'title', op: 'contains', value: '' }) },
  { field: 'isSubtask', label: 'subtasks', make: () => ({ field: 'isSubtask', op: 'is', value: false }) },
];

export const conditionOption = (field: AutomationConditionField): ConditionOption =>
  CONDITION_OPTIONS.find((option) => option.field === field) ?? CONDITION_OPTIONS[0];

/** CRM deal stages offered as suggestions (any text works; matching ignores case). */
export const CRM_STAGE_SUGGESTIONS: readonly string[] = ['Lead', 'Discovery', 'Proposal', 'Negotiation', 'Won', 'Lost'];

export type RecipeCategory = 'Popular' | 'Reminders' | 'Hand-offs' | 'Tidy up' | 'CRM and WMS';
export const RECIPE_CATEGORIES: readonly RecipeCategory[] = ['Popular', 'Reminders', 'Hand-offs', 'Tidy up', 'CRM and WMS'];

export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly categories: readonly RecipeCategory[];
  readonly trigger: AutomationTrigger;
  readonly conditions?: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
  readonly needs?: IntegrationNeed;
}

export const RECIPES: readonly Recipe[] = [
  {
    id: 'done-notify-owner',
    name: 'Tell the owner when work is done',
    blurb: 'Project owners see finished work without asking around.',
    categories: ['Popular', 'Hand-offs'],
    trigger: { type: 'task_completed' },
    actions: [{ type: 'notify', target: 'project_owner' }],
  },
  {
    id: 'due-tomorrow-reminder',
    name: 'Remind people the day before',
    blurb: 'A heads-up in the inbox when a task is due tomorrow.',
    categories: ['Popular', 'Reminders'],
    trigger: { type: 'due_date_approaching', days: 1 },
    actions: [{ type: 'notify', target: 'assignee', message: '{task} is due tomorrow' }],
  },
  {
    id: 'overdue-escalate',
    name: 'Raise the alarm on late work',
    blurb: 'Late tasks become high priority and the owner hears about it.',
    categories: ['Popular', 'Reminders'],
    trigger: { type: 'task_overdue' },
    actions: [
      { type: 'set_priority', priority: 'high' },
      { type: 'notify', target: 'project_owner', message: '{task} is overdue' },
    ],
  },
  {
    id: 'subtasks-done-parent',
    name: 'Finish the parent when all subtasks are done',
    blurb: 'No more forgetting to close the big task.',
    categories: ['Popular', 'Tidy up'],
    trigger: { type: 'subtasks_completed' },
    actions: [{ type: 'complete_parent' }],
  },
  {
    id: 'unassigned-to-creator',
    name: 'Give new unassigned tasks to their creator',
    blurb: 'Every task has someone looking after it from day one.',
    categories: ['Tidy up'],
    trigger: { type: 'task_created' },
    conditions: [{ field: 'assignee', op: 'empty' }],
    actions: [{ type: 'set_assignee', target: 'reporter' }],
  },
  {
    id: 'comment-follow',
    name: 'Follow tasks you comment on',
    blurb: 'Join the conversation and you’ll hear about every reply.',
    categories: ['Tidy up'],
    trigger: { type: 'comment_added' },
    actions: [{ type: 'add_watcher', target: 'actor' }],
  },
  {
    id: 'urgent-deadline',
    name: 'Urgent work gets a 2-day deadline',
    blurb: 'Marking something urgent sets a due date so it can’t drift.',
    categories: ['Reminders'],
    trigger: { type: 'priority_changed', to: 'urgent' },
    actions: [{ type: 'set_due_date', offsetDays: 2 }],
  },
  {
    id: 'started-tell-reporter',
    name: 'Tell the requester when work starts',
    blurb: 'The person who asked knows it’s being worked on.',
    categories: ['Hand-offs'],
    trigger: { type: 'status_changed', toCategory: 'in_progress' },
    actions: [{ type: 'notify', target: 'reporter', message: 'Work has started on {task}' }],
  },
  {
    id: 'done-check-in',
    name: 'Plan a check-in a week after work is done',
    blurb: 'Creates a follow-up task so results get checked.',
    categories: ['Hand-offs'],
    trigger: { type: 'task_completed' },
    conditions: [{ field: 'isSubtask', op: 'is', value: false }],
    actions: [{ type: 'create_follow_up', title: 'Check the results of “{task}”', dueInDays: 7, assignTo: 'assignee' }],
  },
  {
    id: 'urgent-review-subtask',
    name: 'Add a review step to urgent tasks',
    blurb: 'New urgent tasks get a “Review with the team” subtask.',
    categories: ['Hand-offs'],
    trigger: { type: 'task_created' },
    conditions: [{ field: 'priority', op: 'is', value: 'urgent' }],
    actions: [{ type: 'create_subtask', title: 'Review with the team' }],
  },
  {
    id: 'due-today-not-started',
    name: 'Nudge work that hasn’t started',
    blurb: 'Posts a friendly comment when a task is due today but still in To do.',
    categories: ['Reminders'],
    trigger: { type: 'due_date_approaching', days: 0 },
    conditions: [{ field: 'statusCategory', op: 'is', value: 'todo' }],
    actions: [{ type: 'add_comment', body: 'Heads up: {task} is due today and hasn’t started yet. Need a hand?' }],
  },
  {
    id: 'crm-stage-tell',
    name: 'Tell the team when a linked deal moves',
    blurb: 'When the CRM deal on a task changes stage, the assignee hears about it.',
    categories: ['CRM and WMS', 'Popular'],
    needs: 'crm',
    trigger: { type: 'crm_stage_changed' },
    actions: [
      { type: 'notify', target: 'assignee', message: 'The deal on {task} moved to {stage}' },
      { type: 'add_comment', body: 'The linked CRM deal moved to **{stage}**.' },
    ],
  },
  {
    id: 'crm-won-kickoff',
    name: 'Start delivery when a deal is won',
    blurb: 'A won deal creates a kickoff task for the person who owns the work.',
    categories: ['CRM and WMS'],
    needs: 'crm',
    trigger: { type: 'crm_stage_changed', toStage: 'Won' },
    actions: [
      { type: 'create_follow_up', title: 'Kick off delivery: {task}', dueInDays: 2, assignTo: 'assignee' },
      { type: 'set_priority', priority: 'high' },
    ],
  },
  {
    id: 'wms-shipped-notify',
    name: 'Tell the owner when the order ships',
    blurb: 'When the WMS order on a task ships, the project owner gets a heads-up.',
    categories: ['CRM and WMS'],
    needs: 'wms',
    trigger: { type: 'wms_order_shipped' },
    actions: [{ type: 'notify', target: 'project_owner', message: '{record} shipped ({task})' }],
  },
  {
    id: 'wms-shipped-follow-up',
    name: 'Check delivery a few days after shipping',
    blurb: 'Creates a follow-up to confirm the customer got their order.',
    categories: ['CRM and WMS'],
    needs: 'wms',
    trigger: { type: 'wms_order_shipped' },
    actions: [{ type: 'create_follow_up', title: 'Confirm delivery with the customer: {task}', dueInDays: 3, assignTo: 'assignee' }],
  },
];

/** Placeholder words people can use in messages, comments and follow-up names. */
export const MESSAGE_VARIABLES: readonly { readonly token: string; readonly label: string }[] = [
  { token: '{task}', label: 'Task' },
  { token: '{project}', label: 'Project' },
  { token: '{stage}', label: 'CRM stage' },
  { token: '{record}', label: 'Linked record' },
];
