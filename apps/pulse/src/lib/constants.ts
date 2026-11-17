/**
 * Enums shared by the database schema, server domain layer and client UI.
 * Pure module (no server imports): safe to use anywhere. Every list that is stored in a table is
 * mirrored by a CHECK constraint in apps/pulse/drizzle/*.sql; change both together (new migration).
 */

/** Who performed a change. Non-user actors are treated as the workspace owner by the domain. */
export const ACTOR_KINDS = ['user', 'automation', 'system', 'integration'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * Risk status of a job (docs/pulse/SPEC.md 4.14). Worst first. The labels are the only words
 * people ever see for a status, in every app, export and report.
 */
export const PULSE_STATUSES = ['losing', 'at_risk', 'heads_up', 'on_track', 'no_data'] as const;
export type PulseStatus = (typeof PULSE_STATUSES)[number];

export const PULSE_STATUS_LABELS: Readonly<Record<PulseStatus, string>> = {
  losing: 'Losing money',
  at_risk: 'At risk',
  heads_up: 'Heads up',
  on_track: 'On track',
  no_data: 'Not enough data',
};

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
