/**
 * Domain enums shared by the database schema, server domain layer and client UI.
 * Pure module (no server imports): safe to use anywhere. Every list here is mirrored by a
 * CHECK constraint in apps/projects/drizzle/*.sql; change both together (new migration).
 */

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_HEALTHS = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

export const PROJECT_VISIBILITIES = ['org', 'private'] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

/** Project-level roles, most to least powerful. */
export const PROJECT_ROLES = ['owner', 'editor', 'commenter', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const STATUS_CATEGORIES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'select',
  'multiselect',
  'date',
  'person',
  'checkbox',
  'currency',
  'url',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const VIEW_TYPES = ['board', 'list', 'table', 'timeline', 'calendar', 'workload'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const NOTIFICATION_KINDS = [
  'mention',
  'assigned',
  'comment',
  'status_changed',
  'due_soon',
  'overdue',
  'watching',
  'automation',
  'integration',
  'project',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const ACTOR_KINDS = ['user', 'automation', 'system', 'integration'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const INTEGRATION_TARGET_TYPES = [
  'crm_item',
  'crm_account',
  'core_customer',
  'wms_order',
  'wms_work_order',
  'wms_receipt',
  'wms_count',
] as const;
export type IntegrationTargetType = (typeof INTEGRATION_TARGET_TYPES)[number];

export const GOAL_HEALTHS = ['on_track', 'at_risk', 'off_track', 'achieved', 'missed'] as const;
export type GoalHealth = (typeof GOAL_HEALTHS)[number];

export const GOAL_PROGRESS_MODES = ['key_results', 'projects', 'manual'] as const;
export type GoalProgressMode = (typeof GOAL_PROGRESS_MODES)[number];

export const KEY_RESULT_KINDS = ['number', 'percent', 'currency', 'boolean', 'project'] as const;
export type KeyResultKind = (typeof KEY_RESULT_KINDS)[number];

export const TIME_ENTRY_SOURCES = ['timer', 'manual'] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

export const ATTACHMENT_STORAGES = ['db', 'disk', 'blob'] as const;
export type AttachmentStorage = (typeof ATTACHMENT_STORAGES)[number];

export const AUTOMATION_RUN_STATUSES = ['success', 'skipped', 'failed'] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const DEPENDENCY_KINDS = ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

/** Named colors from the shared token palette (`--label-<name>-*` in @kitstak/ui tokens.css). */
export const LABEL_COLORS = [
  'gray',
  'brown',
  'orange',
  'peach',
  'yellow',
  'lime',
  'green',
  'teal',
  'sky',
  'blue',
  'indigo',
  'purple',
  'pink',
  'berry',
  'red',
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

/** Friendly copy for enums (plain language for every reader). */
export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
};

export const PROJECT_STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  planning: 'Planning',
  active: 'In progress',
  on_hold: 'On hold',
  completed: 'Done',
  archived: 'Archived',
};

export const PROJECT_HEALTH_LABELS: Readonly<Record<ProjectHealth, string>> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

export const GOAL_HEALTH_LABELS: Readonly<Record<GoalHealth, string>> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  achieved: 'Achieved',
  missed: 'Missed',
};

export const STATUS_CATEGORY_LABELS: Readonly<Record<StatusCategory, string>> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PROJECT_ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export const VIEW_TYPE_LABELS: Readonly<Record<ViewType, string>> = {
  board: 'Board',
  list: 'List',
  table: 'Table',
  timeline: 'Timeline',
  calendar: 'Calendar',
  workload: 'Workload',
};

export const CUSTOM_FIELD_TYPE_LABELS: Readonly<Record<CustomFieldType, string>> = {
  text: 'Text',
  number: 'Number',
  select: 'Single choice',
  multiselect: 'Multiple choice',
  date: 'Date',
  person: 'Person',
  checkbox: 'Checkbox',
  currency: 'Money',
  url: 'Link',
};

export const INTEGRATION_TARGET_LABELS: Readonly<Record<IntegrationTargetType, string>> = {
  crm_item: 'CRM deal',
  crm_account: 'CRM account',
  core_customer: 'Customer',
  wms_order: 'WMS order',
  wms_work_order: 'WMS work order',
  wms_receipt: 'WMS receipt',
  wms_count: 'WMS cycle count',
};

/** Max upload size for attachments (bytes). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Project keys: 2-6 uppercase letters/digits, starting with a letter (e.g. OPS, Q4MKT). */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;
