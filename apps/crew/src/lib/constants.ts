/**
 * Enums shared by the database schema, server domain layer and client UI.
 * Pure module (no server imports): safe to use anywhere. Every list that is stored in a table is
 * mirrored by a CHECK constraint in apps/crew/drizzle/*.sql; change both together (new migration).
 */

/** Who performed a change (crew.activity.actor_kind). Non-user actors are treated as the workspace owner. */
export const ACTOR_KINDS = ['user', 'device', 'system', 'integration'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

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

/* ------------------------------------------------------------------------------------------
 * Stored enums of the `crew` schema (docs/crew/SPEC.md section 5). Each list mirrors a CHECK.
 * ---------------------------------------------------------------------------------------- */

export const PERSON_KINDS = ['employee', 'temp', 'seasonal'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];
export const PERSON_KIND_LABELS: Readonly<Record<PersonKind, string>> = { employee: 'Employee', temp: 'Temp', seasonal: 'Seasonal' };

export const PERSON_STATUSES = ['active', 'on_leave', 'ended'] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];
export const PERSON_STATUS_LABELS: Readonly<Record<PersonStatus, string>> = { active: 'Active', on_leave: 'On leave', ended: 'Ended' };

export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const FENCE_MODES = ['off', 'flag', 'block'] as const;
export type FenceMode = (typeof FENCE_MODES)[number];

export const RULE_PRESETS = ['federal', 'california', 'custom'] as const;
export type RulePreset = (typeof RULE_PRESETS)[number];

export const ROUNDING_MODES = ['exact', 'nearest', 'worker_favor'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export const LABOR_CLASS_KINDS = ['employee', 'temp_agency'] as const;
export type LaborClassKind = (typeof LABOR_CLASS_KINDS)[number];

/** `source` of the SRC tables (labor_classes, people). */
export const ROW_SOURCES = ['manual', 'csv', 'kiosk', 'phone', 'agency_link', 'pulse', 'projects', 'wms', 'crm', 'system', 'sample'] as const;
export type RowSource = (typeof ROW_SOURCES)[number];

export const ATTACHMENT_OWNERS = ['certification', 'punch_photo', 'payroll_export', 'import'] as const;
export type AttachmentOwner = (typeof ATTACHMENT_OWNERS)[number];

export const IMPORT_STREAMS = ['people', 'certifications', 'skills', 'time_off_balances', 'plan_inputs'] as const;
export type ImportStream = (typeof IMPORT_STREAMS)[number];

export const SYNC_SOURCES = ['pulse', 'projects', 'wms', 'crm'] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];
