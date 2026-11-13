/** pm.record_triggers (cross-app recipes) and pm.record_trigger_runs. SQL: drizzle/0003_record_triggers.sql. */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, orgId, pmSchema, tstz, updatedAt } from './_shared';

export const RECORD_TRIGGER_KINDS = ['crm_deal_won', 'wms_receipt_discrepancy', 'wms_count_variance'] as const;
export type RecordTriggerKind = (typeof RECORD_TRIGGER_KINDS)[number];

export const recordTriggers = pmSchema.table(
  'record_triggers',
  {
    id: id(),
    orgId: orgId(),
    kind: text('kind', { enum: RECORD_TRIGGER_KINDS }).notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    since: tstz('since').notNull().defaultNow(),
    lastCheckedAt: tstz('last_checked_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('record_triggers_org_idx').on(t.orgId).where(sql`${t.deletedAt} IS NULL`)],
);

export const recordTriggerRuns = pmSchema.table(
  'record_trigger_runs',
  {
    id: id(),
    orgId: orgId(),
    triggerId: uuid('trigger_id')
      .notNull()
      .references(() => recordTriggers.id, { onDelete: 'cascade' }),
    recordType: text('record_type').notNull(),
    recordId: text('record_id').notNull(),
    recordTitle: text('record_title'),
    status: text('status', { enum: ['created', 'skipped', 'failed'] }).notNull(),
    message: text('message').notNull(),
    resultUrl: text('result_url'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('record_trigger_runs_once_idx').on(t.triggerId, t.recordType, t.recordId),
    index('record_trigger_runs_recent_idx').on(t.orgId, t.createdAt),
  ],
);
