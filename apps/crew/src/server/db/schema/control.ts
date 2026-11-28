/** 5.8 Control and system: attachments, activity, notifications, email outbox, imports, prefs, sync. */
import { customType, integer, jsonb, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { base, createdAt, crewSchema, id, orgId, tstz, updatedAt } from './_shared';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const attachments = crewSchema.table('attachments', {
  ...base(),
  ownerType: text('owner_type').notNull(),
  ownerId: uuid('owner_id'),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storage: text('storage').notNull(),
  storageKey: text('storage_key'),
  data: bytea('data'),
  expiresAt: tstz('expires_at'),
  uploadedBy: uuid('uploaded_by'),
});

/** Append only (a trigger refuses UPDATE). */
export const activity = crewSchema.table('activity', {
  id: id(),
  orgId: orgId(),
  actorId: uuid('actor_id'),
  actorKind: text('actor_kind').notNull().default('user'),
  verb: text('verb').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/** Stored as `{ kind, params }` and rendered per reader (the Pulse renderReason pattern). */
export const notifications = crewSchema.table('notifications', {
  ...base(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  url: text('url'),
  readAt: tstz('read_at'),
  archivedAt: tstz('archived_at'),
});

export const outboxEmail = crewSchema.table('outbox_email', {
  ...base(),
  personId: uuid('person_id'),
  kind: text('kind').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  sentAt: tstz('sent_at'),
  error: text('error'),
});

export const importBatches = crewSchema.table('import_batches', {
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

export const importRows = crewSchema.table('import_rows', {
  ...base(),
  batchId: uuid('batch_id').notNull(),
  rowNumber: integer('row_number').notNull(),
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  parsed: jsonb('parsed').$type<Record<string, unknown>>(),
  action: text('action'),
  messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
  entityId: uuid('entity_id'),
  before: jsonb('before').$type<Record<string, unknown>>(),
});

export const importPresets = crewSchema.table('import_presets', {
  ...base(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  headerSignature: text('header_signature'),
  mapping: jsonb('mapping').$type<Record<string, unknown>>().notNull().default({}),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  lastUsedAt: tstz('last_used_at'),
});

export const userPrefs = crewSchema.table(
  'user_prefs',
  {
    orgId: orgId(),
    userId: uuid('user_id').notNull(),
    defaultSiteId: uuid('default_site_id'),
    scheduleView: text('schedule_view'),
    hiddenTips: text('hidden_tips').array().notNull().default([]),
    prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId], name: 'user_prefs_pkey' })],
);

export const syncState = crewSchema.table(
  'sync_state',
  {
    orgId: orgId(),
    source: text('source').notNull(),
    cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
    lockedUntil: tstz('locked_until'),
    lastRunAt: tstz('last_run_at'),
    lastOkAt: tstz('last_ok_at'),
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.source], name: 'sync_state_pkey' })],
);

export const syncRuns = crewSchema.table('sync_runs', {
  ...base(),
  source: text('source').notNull(),
  startedAt: tstz('started_at').notNull().defaultNow(),
  finishedAt: tstz('finished_at'),
  status: text('status').notNull().default('running'),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  error: text('error'),
  trigger: text('trigger').notNull().default('manual'),
});

export const dismissals = crewSchema.table('dismissals', {
  ...base(),
  kind: text('kind').notNull(),
  targetId: text('target_id').notNull(),
  userId: uuid('user_id'),
  until: tstz('until'),
});
