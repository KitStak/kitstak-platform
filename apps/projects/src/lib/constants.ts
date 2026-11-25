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

/** Named colors from the shared token palette (`--label-<name>-*` in @kitstak/ui tokens.css; same set as CRM). */
export const LABEL_COLORS = [
  'green',
  'orange',
  'red',
  'gray',
  'blue',
  'dark-blue',
  'purple',
  'pink',
  'teal',
  'yellow',
  'lime',
  'brown',
  'sky',
  'berry',
  'indigo',
  'peach',
  'green-light',
  'orange-light',
  'red-light',
  'blue-light',
  'purple-light',
  'pink-light',
  'teal-light',
  'yellow-light',
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

/** Reactions offered on comments (server accepts only these). */
export const REACTION_EMOJIS = ['👍', '🎉', '❤️', '😄', '👀', '🚀', '✅', '🙏'] as const;

/** Default workflow for a blank project. */
export const DEFAULT_STATUSES: readonly { name: string; category: StatusCategory; color: LabelColor }[] = [
  { name: 'To do', category: 'todo', color: 'gray' },
  { name: 'In progress', category: 'in_progress', color: 'blue' },
  { name: 'In review', category: 'in_progress', color: 'purple' },
  { name: 'Done', category: 'done', color: 'green' },
];

/* Programs (docs/programs/SPEC.md 2.2.17). Each list is mirrored by a CHECK in drizzle/0006_programs.sql. */

export const PROJECT_KINDS = ['project', 'program'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const TASK_KINDS = ['task', 'build'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TEMPLATE_KINDS = ['project', 'program'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const VIEW_SURFACES = ['work', 'programs', 'floor'] as const;
export type ViewSurface = (typeof VIEW_SURFACES)[number];

export const PRICE_LINE_KINDS = ['per_unit', 'per_order', 'per_hour', 'flat_monthly', 'monthly_minimum'] as const;
export type PriceLineKind = (typeof PRICE_LINE_KINDS)[number];

export const LEDGER_KINDS = ['per_order', 'per_hour', 'flat_monthly', 'setup', 'adjustment', 'minimum_top_up'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const ONE_TIME_KINDS = ['setup', 'adjustment'] as const;
export type OneTimeKind = (typeof ONE_TIME_KINDS)[number];

export const PRICE_SOURCES = ['build', 'variant', 'card', 'job', 'none'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const POSTINGS = ['program', 'program_job', 'build_job', 'unbilled'] as const;
export type Posting = (typeof POSTINGS)[number];

/** Postings a ledger row can have (fees go to the program's job, else the program). */
export const LEDGER_POSTINGS = ['program', 'program_job'] as const;
export type LedgerPosting = (typeof LEDGER_POSTINGS)[number];

export const PLANNED_FROM = ['manual', 'schedule', 'variant_default', 'planner', 'unplanned', 'split', 'import', 'form'] as const;
export type PlannedFrom = (typeof PLANNED_FROM)[number];

export const OUTPUT_SOURCES = ['manual', 'scan', 'import', 'form'] as const;
export type OutputSource = (typeof OUTPUT_SOURCES)[number];

export const SCHEDULE_PATTERNS = ['daily', 'weekdays', 'custom_days', 'every_n_weeks'] as const;
export type SchedulePattern = (typeof SCHEDULE_PATTERNS)[number];

export const SCHEDULE_STATUSES = ['active', 'paused', 'ended'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const VARIANT_STATUSES = ['active', 'retired'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const REVIEW_STATUSES = ['none', 'waiting', 'sent_back'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const HOURLY_TIME_BASES = ['billable', 'all'] as const;
export type HourlyTimeBasis = (typeof HOURLY_TIME_BASES)[number];

export const VERSION_STATUSES = ['draft', 'published'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const VERSION_SOURCES = ['manual', 'crm_deal', 'copy', 'template', 'seed', 'variant_tab'] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];

export const RATE_RULE_OPS = ['add', 'set'] as const;
export type RateRuleOp = (typeof RATE_RULE_OPS)[number];

export const WIZARD_DRAFT_KINDS = ['program'] as const;
export type WizardDraftKind = (typeof WIZARD_DRAFT_KINDS)[number];

/** Derived from `effective_from` and today (4.4.1); only `draft` and `published` are stored. */
export const VERSION_STATES = ['draft', 'scheduled', 'in_force', 'ended'] as const;
export type VersionState = (typeof VERSION_STATES)[number];

export const UNIT_PRESETS = [
  { singular: 'kit', plural: 'kits' },
  { singular: 'order', plural: 'orders' },
  { singular: 'unit', plural: 'units' },
  { singular: 'pack', plural: 'packs' },
  { singular: 'box', plural: 'boxes' },
] as const;

/** The workspace calendar default zone (pm.org_calendar.timezone default). */
export const DEFAULT_PROGRAM_TIMEZONE = 'America/Chicago';

/** Max live attributes per program (domain check, 2.2.5). */
export const MAX_PROGRAM_ATTRIBUTES = 4;
/** Max values per attribute (2.2.5). */
export const MAX_ATTRIBUTE_VALUES = 30;
/** Max variants one generator run may make (3.9). */
export const MAX_GENERATED_VARIANTS = 200;

/** Shared project statuses in program words. */
export const PROGRAM_STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  planning: 'Setting up',
  active: 'Running',
  on_hold: 'Paused',
  completed: 'Ended',
  archived: 'Archived',
};

/** `per_unit` uses the program's unit word: "Per kit". */
export const PRICE_LINE_LABELS: Readonly<Record<PriceLineKind, string>> = {
  per_unit: 'Per {unit}',
  per_order: 'Per batch',
  per_hour: 'Per hour',
  flat_monthly: 'Monthly fee',
  monthly_minimum: 'Monthly minimum',
};

export const LEDGER_LABELS: Readonly<Record<LedgerKind, string>> = {
  per_order: 'Per batch',
  per_hour: 'Per hour',
  flat_monthly: 'Monthly fee',
  setup: 'Setup fee',
  adjustment: 'Adjustment',
  minimum_top_up: 'Minimum top up',
};

/** Shown after "Revenue goes to". */
export const POSTING_LABELS: Readonly<Record<Posting, string>> = {
  program: 'This program',
  program_job: "The program's Pulse job",
  build_job: "This build's Pulse job",
  unbilled: 'Not billed',
};

/** Shown after "Price from". */
export const PRICE_SOURCE_LABELS: Readonly<Record<PriceSource, string>> = {
  build: 'Build rate',
  variant: 'Variant rate',
  card: 'Card rate',
  job: 'Job price',
  none: 'No price',
};

export const VERSION_STATE_LABELS: Readonly<Record<VersionState, string>> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_force: 'In force',
  ended: 'Ended',
};

export const PLANNED_FROM_LABELS: Readonly<Record<PlannedFrom, string>> = {
  manual: 'Typed',
  schedule: 'Schedule',
  variant_default: 'Variant default',
  planner: 'Planner',
  unplanned: 'Unplanned',
  split: 'Moved from another build',
  import: 'Import',
  form: 'Form',
};

export const SCHEDULE_PATTERN_LABELS: Readonly<Record<SchedulePattern, string>> = {
  daily: 'Every day',
  weekdays: 'Every work day',
  custom_days: 'Chosen days',
  every_n_weeks: 'Every few weeks',
};

export const SCHEDULE_STATUS_LABELS: Readonly<Record<ScheduleStatus, string>> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
};

export const VARIANT_STATUS_LABELS: Readonly<Record<VariantStatus, string>> = {
  active: 'Active',
  retired: 'Retired',
};

export const HOURLY_TIME_BASIS_LABELS: Readonly<Record<HourlyTimeBasis, string>> = {
  billable: 'Billable time only',
  all: 'All time',
};

/** Default workflow for a new program (inserted instead of DEFAULT_STATUSES when kind is program). */
export const DEFAULT_PROGRAM_STATUSES: readonly { name: string; category: StatusCategory; color: LabelColor; isDefault?: boolean }[] = [
  { name: 'Planned', category: 'todo', color: 'gray', isDefault: true },
  { name: 'Staged', category: 'todo', color: 'sky' },
  { name: 'Building', category: 'in_progress', color: 'blue' },
  { name: 'Quality check', category: 'in_progress', color: 'purple' },
  { name: 'Done', category: 'done', color: 'green' },
  { name: 'Cancelled', category: 'cancelled', color: 'gray' },
];
