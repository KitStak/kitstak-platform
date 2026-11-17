/** 5.4 Control, workflow and system tables. */
import { boolean, date, integer, jsonb, numeric, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { base, cents, createdAt, deletedAt, id, orgId, pulseSchema, tstz, updatedAt } from './_shared';

export const periods = pulseSchema.table('periods', {
  ...base(),
  periodMonth: date('period_month').notNull(),
  status: text('status').notNull().default('open'),
  closedAt: tstz('closed_at'),
  closedBy: uuid('closed_by'),
  reopenedAt: tstz('reopened_at'),
  reopenedBy: uuid('reopened_by'),
  reopenReason: text('reopen_reason'),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
  checklist: jsonb('checklist').$type<Record<string, unknown>>(),
});

export const dayReviews = pulseSchema.table('day_reviews', {
  orgId: orgId(),
  siteId: uuid('site_id').notNull(),
  workDate: date('work_date').notNull(),
  status: text('status').notNull(),
  flags: jsonb('flags').$type<unknown[]>().notNull().default([]),
  markedBy: uuid('marked_by'),
  markedAt: tstz('marked_at'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: tstz('reviewed_at'),
  note: text('note'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const alertRules = pulseSchema.table('alert_rules', {
  ...base(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  threshold: numeric('threshold', { precision: 16, scale: 4 }),
  scope: jsonb('scope').$type<Record<string, unknown>>().notNull().default({}),
  severity: text('severity').notNull().default('warning'),
  notifyRoles: text('notify_roles').array().notNull().default([]),
  notifyUserIds: uuid('notify_user_ids').array().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  isSystem: boolean('is_system').notNull().default(false),
  createdBy: uuid('created_by'),
  deletedAt: deletedAt(),
});

export const alerts = pulseSchema.table('alerts', {
  ...base(),
  ruleId: uuid('rule_id'),
  kind: text('kind').notNull(),
  severity: text('severity').notNull().default('warning'),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  impactCents: cents('impact_cents'),
  url: text('url'),
  status: text('status').notNull().default('open'),
  snoozedUntil: date('snoozed_until'),
  assignedTo: uuid('assigned_to'),
  resolvedAt: tstz('resolved_at'),
  resolvedBy: uuid('resolved_by'),
  resolution: text('resolution'),
  dedupeKey: text('dedupe_key').notNull(),
  firstSeenAt: tstz('first_seen_at').notNull().defaultNow(),
  lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
  pmTaskId: uuid('pm_task_id'),
});

export const notifications = pulseSchema.table('notifications', {
  ...base(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  url: text('url'),
  alertId: uuid('alert_id'),
  jobId: uuid('job_id'),
  readAt: tstz('read_at'),
  archivedAt: tstz('archived_at'),
});

export const importBatches = pulseSchema.table('import_batches', {
  ...base(),
  stream: text('stream').notNull(),
  fileName: text('file_name'),
  fileSize: integer('file_size'),
  fileHash: text('file_hash'),
  delimiter: text('delimiter'),
  header: jsonb('header').$type<string[]>(),
  mapping: jsonb('mapping').$type<Record<string, unknown>>(),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('uploading'),
  totalRows: integer('total_rows').notNull().default(0),
  createCount: integer('create_count').notNull().default(0),
  updateCount: integer('update_count').notNull().default(0),
  unchangedCount: integer('unchanged_count').notNull().default(0),
  skipCount: integer('skip_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
  committedAt: tstz('committed_at'),
  undoneAt: tstz('undone_at'),
  undoUntil: tstz('undo_until'),
  createdBy: uuid('created_by'),
});

export const importRows = pulseSchema.table('import_rows', {
  ...base(),
  batchId: uuid('batch_id').notNull(),
  rowNumber: integer('row_number').notNull(),
  raw: jsonb('raw').$type<unknown>(),
  parsed: jsonb('parsed').$type<Record<string, unknown>>(),
  action: text('action'),
  messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
  entityId: uuid('entity_id'),
  before: jsonb('before').$type<Record<string, unknown>>(),
});

export const importPresets = pulseSchema.table('import_presets', {
  ...base(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  headerSignature: text('header_signature'),
  mapping: jsonb('mapping').$type<Record<string, unknown>>().notNull().default({}),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  lastUsedAt: tstz('last_used_at'),
});

export const savedViews = pulseSchema.table('saved_views', {
  ...base(),
  userId: uuid('user_id'),
  page: text('page').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  shared: boolean('shared').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  position: integer('position').notNull().default(0),
  deletedAt: deletedAt(),
});

export const activity = pulseSchema.table('activity', {
  id: id(),
  orgId: orgId(),
  actorId: uuid('actor_id'),
  actorKind: text('actor_kind').notNull().default('user'),
  verb: text('verb').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  jobId: uuid('job_id'),
  clientId: uuid('client_id'),
  field: text('field'),
  before: jsonb('before').$type<unknown>(),
  after: jsonb('after').$type<unknown>(),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  body: text('body'),
  createdAt: createdAt(),
});

export const userPrefs = pulseSchema.table('user_prefs', {
  orgId: orgId(),
  userId: uuid('user_id').notNull(),
  prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const quoteScenarios = pulseSchema.table('quote_scenarios', {
  ...base(),
  name: text('name').notNull(),
  clientId: uuid('client_id'),
  jobTypeId: uuid('job_type_id'),
  jobId: uuid('job_id'),
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('draft'),
  crmDealItemId: uuid('crm_deal_item_id'),
  createdBy: uuid('created_by'),
  deletedAt: deletedAt(),
});

export const reportSchedules = pulseSchema.table('report_schedules', {
  ...base(),
  name: text('name').notNull(),
  report: text('report').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  cadence: text('cadence').notNull(),
  weekday: smallint('weekday'),
  dayOfMonth: smallint('day_of_month'),
  hour: smallint('hour').notNull().default(7),
  recipientUserIds: uuid('recipient_user_ids').array().notNull().default([]),
  format: text('format').notNull().default('csv'),
  includeMoney: boolean('include_money').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: tstz('last_run_at'),
  nextRunAt: tstz('next_run_at'),
  createdBy: uuid('created_by'),
  deletedAt: deletedAt(),
});

export const reportRuns = pulseSchema.table('report_runs', {
  ...base(),
  scheduleId: uuid('schedule_id'),
  report: text('report').notNull(),
  periodLabel: text('period_label'),
  csv: text('csv'),
  html: text('html'),
  rowCount: integer('row_count').notNull().default(0),
  includeMoney: boolean('include_money').notNull().default(false),
  status: text('status').notNull().default('ready'),
  error: text('error'),
});

export const deviceLinks = pulseSchema.table('device_links', {
  ...base(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  siteId: uuid('site_id').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: tstz('expires_at').notNull(),
  lastSeenAt: tstz('last_seen_at'),
  revokedAt: tstz('revoked_at'),
  createdBy: uuid('created_by'),
  deletedAt: deletedAt(),
});

export const syncState = pulseSchema.table('sync_state', {
  orgId: orgId(),
  source: text('source').notNull(),
  cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
  lockedUntil: tstz('locked_until'),
  lastRunAt: tstz('last_run_at'),
  lastOkAt: tstz('last_ok_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  counts: jsonb('counts').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const syncRuns = pulseSchema.table('sync_runs', {
  ...base(),
  source: text('source').notNull(),
  startedAt: tstz('started_at').notNull().defaultNow(),
  finishedAt: tstz('finished_at'),
  status: text('status').notNull().default('running'),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  skippedClosed: integer('skipped_closed').notNull().default(0),
  error: text('error'),
  trigger: text('trigger').notNull().default('manual'),
});

export const dismissals = pulseSchema.table('dismissals', {
  ...base(),
  kind: text('kind').notNull(),
  targetId: text('target_id').notNull(),
  userId: uuid('user_id'),
});

export const bridgeEvents = pulseSchema.table('bridge_events', {
  ...base(),
  kind: text('kind').notNull(),
  targetId: text('target_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  claimedAt: tstz('claimed_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  processedAt: tstz('processed_at'),
});
