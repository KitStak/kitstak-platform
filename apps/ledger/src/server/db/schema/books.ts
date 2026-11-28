/** 5.7 Books, close and system: journal, month totals, periods, close, attachments, activity, imports, sync. */
import { boolean, customType, date, integer, jsonb, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import type { JournalSourceType } from '@/lib/ledger-enums';
import { base, cents, createdAt, id, ledgerSchema, orgId, tstz, updatedAt } from './_shared';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const journalEntries = ledgerSchema.table('journal_entries', {
  ...base(),
  number: text('number'),
  entryDate: date('entry_date').notNull(),
  /** Set by the database trigger from entry_date; any value sent is replaced. */
  periodMonth: date('period_month').notNull(),
  sourceType: text('source_type').$type<JournalSourceType>().notNull(),
  sourceId: uuid('source_id'),
  postingSeq: integer('posting_seq').notNull().default(0),
  reversesEntryId: uuid('reverses_entry_id'),
  autoReverseOn: date('auto_reverse_on'),
  memo: text('memo'),
  activityId: uuid('activity_id'),
  postedBy: uuid('posted_by'),
  postedAt: tstz('posted_at').notNull().defaultNow(),
  isSample: boolean('is_sample').notNull().default(false),
});

export const journalLines = ledgerSchema.table('journal_lines', {
  ...base(),
  entryId: uuid('entry_id').notNull(),
  lineNo: integer('line_no').notNull(),
  accountId: uuid('account_id').notNull(),
  debitCents: cents('debit_cents').notNull().default(BigInt(0)),
  creditCents: cents('credit_cents').notNull().default(BigInt(0)),
  customerId: uuid('customer_id'),
  vendorId: uuid('vendor_id'),
  invoiceId: uuid('invoice_id'),
  billId: uuid('bill_id'),
  pulseJobId: uuid('pulse_job_id'),
  taxRateId: uuid('tax_rate_id'),
  memo: text('memo'),
  /** Copied from the entry by the database trigger. */
  entryDate: date('entry_date').notNull(),
  periodMonth: date('period_month').notNull(),
});

export const accountMonthTotals = ledgerSchema.table(
  'account_month_totals',
  {
    orgId: orgId(),
    accountId: uuid('account_id').notNull(),
    periodMonth: date('period_month').notNull(),
    debitCents: cents('debit_cents').notNull().default(BigInt(0)),
    creditCents: cents('credit_cents').notNull().default(BigInt(0)),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.accountId, t.periodMonth] })],
);

export const periods = ledgerSchema.table('periods', {
  ...base(),
  periodMonth: date('period_month').notNull(),
  status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
  closedAt: tstz('closed_at'),
  closedBy: uuid('closed_by'),
  reopenedAt: tstz('reopened_at'),
  reopenedBy: uuid('reopened_by'),
  reopenReason: text('reopen_reason'),
  checklist: jsonb('checklist').$type<Record<string, unknown>>(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
  pulseLocked: boolean('pulse_locked').notNull().default(false),
});

export const closeTaskTemplates = ledgerSchema.table('close_task_templates', {
  ...base(),
  title: text('title').notNull(),
  ownerId: uuid('owner_id'),
  dueDay: smallint('due_day').notNull().default(5),
  position: integer('position').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const closeTasks = ledgerSchema.table('close_tasks', {
  ...base(),
  periodMonth: date('period_month').notNull(),
  templateId: uuid('template_id'),
  title: text('title').notNull(),
  ownerId: uuid('owner_id'),
  dueDate: date('due_date'),
  doneAt: tstz('done_at'),
  doneBy: uuid('done_by'),
  pmTaskId: uuid('pm_task_id'),
});

export const accruals = ledgerSchema.table('accruals', {
  ...base(),
  periodMonth: date('period_month').notNull(),
  entryId: uuid('entry_id'),
  reversalEntryId: uuid('reversal_entry_id'),
  totalCents: cents('total_cents').notNull(),
  lines: jsonb('lines').$type<Record<string, unknown>[]>().notNull().default([]),
  source: text('source').$type<'pulse' | 'manual'>().notNull(),
  createdBy: uuid('created_by'),
});

export const attachments = ledgerSchema.table('attachments', {
  ...base(),
  entityType: text('entity_type').$type<'bill' | 'expense' | 'invoice' | 'bank_import' | 'settings'>().notNull(),
  entityId: uuid('entity_id'),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storage: text('storage').$type<'blob' | 'db'>().notNull(),
  storageKey: text('storage_key'),
  data: bytea('data'),
  isSample: boolean('is_sample').notNull().default(false),
  uploadedBy: uuid('uploaded_by'),
});

export const activity = ledgerSchema.table('activity', {
  id: id(),
  orgId: orgId(),
  actorId: uuid('actor_id'),
  actorKind: text('actor_kind').$type<'user' | 'system' | 'integration' | 'automation' | 'customer'>().notNull().default('user'),
  verb: text('verb').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const notifications = ledgerSchema.table('notifications', {
  ...base(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  url: text('url'),
  readAt: tstz('read_at'),
});

export const userPrefs = ledgerSchema.table(
  'user_prefs',
  {
    orgId: orgId(),
    userId: uuid('user_id').notNull(),
    prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const importBatches = ledgerSchema.table('import_batches', {
  ...base(),
  stream: text('stream').notNull(),
  fileName: text('file_name'),
  fileSize: integer('file_size'),
  fileHash: text('file_hash'),
  delimiter: text('delimiter'),
  header: jsonb('header'),
  mapping: jsonb('mapping'),
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

export const importRows = ledgerSchema.table('import_rows', {
  ...base(),
  batchId: uuid('batch_id').notNull(),
  rowNumber: integer('row_number').notNull(),
  raw: jsonb('raw'),
  parsed: jsonb('parsed'),
  action: text('action'),
  messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
});

export const importPresets = ledgerSchema.table('import_presets', {
  ...base(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  headerSignature: text('header_signature'),
  mapping: jsonb('mapping').$type<Record<string, unknown>>().notNull().default({}),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  lastUsedAt: tstz('last_used_at'),
});

export const bridgeEvents = ledgerSchema.table('bridge_events', {
  ...base(),
  kind: text('kind').$type<'wms_bill_sent' | 'wms_bill_changed' | 'crew_hours_approved' | 'pulse_month_changed'>().notNull(),
  targetId: text('target_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  claimedAt: tstz('claimed_at'),
  claimedUntil: tstz('claimed_until'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  parkedAt: tstz('parked_at'),
  processedAt: tstz('processed_at'),
});

export const syncConnections = ledgerSchema.table(
  'sync_connections',
  {
    orgId: orgId(),
    provider: text('provider').$type<'qbo' | 'xero'>().notNull(),
    realmId: text('realm_id'),
    companyName: text('company_name'),
    status: text('status').$type<'connected' | 'needs_reconnect' | 'paused' | 'disconnected'>().notNull().default('disconnected'),
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    accessExpiresAt: tstz('access_expires_at'),
    refreshExpiresAt: tstz('refresh_expires_at'),
    startDate: date('start_date'),
    taxMode: text('tax_mode'),
    mappings: jsonb('mappings').$type<Record<string, unknown>>().notNull().default({}),
    connectedBy: uuid('connected_by'),
    lastOkAt: tstz('last_ok_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.provider] })],
);

export const syncObjects = ledgerSchema.table('sync_objects', {
  ...base(),
  provider: text('provider').notNull(),
  localType: text('local_type').notNull(),
  localId: uuid('local_id').notNull(),
  remoteType: text('remote_type'),
  remoteId: text('remote_id'),
  remoteSyncToken: text('remote_sync_token'),
  localVersion: integer('local_version'),
  pushedHash: text('pushed_hash'),
  status: text('status').$type<'synced' | 'pending' | 'failed' | 'conflict' | 'skipped'>().notNull().default('pending'),
  lastPushedAt: tstz('last_pushed_at'),
  lastError: text('last_error'),
});

export const syncQueue = ledgerSchema.table('sync_queue', {
  ...base(),
  provider: text('provider').notNull(),
  localType: text('local_type').notNull(),
  localId: uuid('local_id').notNull(),
  op: text('op').$type<'upsert' | 'void' | 'delete'>().notNull(),
  docDate: date('doc_date'),
  attempts: integer('attempts').notNull().default(0),
  nextTryAt: tstz('next_try_at').notNull().defaultNow(),
  claimedUntil: tstz('claimed_until'),
  parkedAt: tstz('parked_at'),
  lastError: text('last_error'),
});

export const syncRuns = ledgerSchema.table('sync_runs', {
  ...base(),
  provider: text('provider').notNull(),
  startedAt: tstz('started_at').notNull().defaultNow(),
  finishedAt: tstz('finished_at'),
  pushed: integer('pushed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  errors: jsonb('errors').$type<unknown[]>().notNull().default([]),
});

export const remoteChanges = ledgerSchema.table('remote_changes', {
  ...base(),
  provider: text('provider').notNull(),
  remoteType: text('remote_type').notNull(),
  remoteId: text('remote_id').notNull(),
  seenAt: tstz('seen_at').notNull().defaultNow(),
  kind: text('kind').$type<'made_in_remote' | 'changed_in_remote' | 'deleted_in_remote'>().notNull(),
  status: text('status').$type<'open' | 'brought_in' | 'ignored' | 'resolved'>().notNull().default('open'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
});
