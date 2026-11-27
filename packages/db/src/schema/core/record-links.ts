/**
 * core.record_links: one link graph for any record to any record (drizzle/0007_core_record_links.sql,
 * docs/programs/SPEC.md 2.1). Typed mirror for queries only; writers use the raw SQL helper in
 * `@kitstak/db/record-links`, which normalizes edge direction and maps the money indexes to UI copy.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { RECORD_RELATIONS, RECORD_TYPES } from '../../record-links';
import { coreSchema, createdAt, id } from '../_shared';
import { organization, user } from './auth';

const TYPE_LIST = sql.raw(RECORD_TYPES.map((value) => `'${value}'`).join(','));
const RELATION_LIST = sql.raw(RECORD_RELATIONS.map((value) => `'${value}'`).join(','));

export const recordLinks = coreSchema.table(
  'record_links',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    fromType: text('from_type', { enum: RECORD_TYPES }).notNull(),
    fromId: text('from_id').notNull(),
    toType: text('to_type', { enum: RECORD_TYPES }).notNull(),
    toId: text('to_id').notNull(),
    relation: text('relation', { enum: RECORD_RELATIONS }).notNull().default('related'),
    cachedTitle: text('cached_title'),
    cachedStatus: text('cached_status'),
    /** A path ("/programs/GLOVE"), never an absolute URL. */
    cachedUrl: text('cached_url'),
    cachedAt: timestamp('cached_at', { withTimezone: true, mode: 'date' }),
    meta: jsonb('meta')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('record_links_from_type_check', sql`${t.fromType} IN (${TYPE_LIST})`),
    check('record_links_to_type_check', sql`${t.toType} IN (${TYPE_LIST})`),
    check('record_links_relation_check', sql`${t.relation} IN (${RELATION_LIST})`),
    check('record_links_not_self_check', sql`(${t.fromType}, ${t.fromId}) <> (${t.toType}, ${t.toId})`),
    check('record_links_cached_url_check', sql`${t.cachedUrl} IS NULL OR (${t.cachedUrl} LIKE '/%' AND ${t.cachedUrl} NOT LIKE '//%')`),
    check('record_links_bills_to_shape_check', sql`${t.relation} <> 'bills_to' OR (${t.fromType} IN ('pm_program','pm_build') AND ${t.toType} = 'pulse_job')`),
    check('record_links_uses_kit_shape_check', sql`${t.relation} <> 'uses_kit' OR (${t.fromType} = 'pm_variant' AND ${t.toType} IN ('core_item','wms_product'))`),
    uniqueIndex('record_links_edge_key').on(t.orgId, t.fromType, t.fromId, t.toType, t.toId, t.relation),
    index('record_links_from_idx').on(t.orgId, t.fromType, t.fromId),
    index('record_links_to_idx').on(t.orgId, t.toType, t.toId),
    uniqueIndex('record_links_one_job_per_program').on(t.orgId, t.fromId).where(sql`${t.fromType} = 'pm_program' AND ${t.relation} = 'bills_to'`),
    uniqueIndex('record_links_one_job_per_build').on(t.orgId, t.fromId).where(sql`${t.fromType} = 'pm_build' AND ${t.relation} = 'bills_to'`),
    uniqueIndex('record_links_one_program_per_job').on(t.orgId, t.toId).where(sql`${t.fromType} = 'pm_program' AND ${t.relation} = 'bills_to'`),
    uniqueIndex('record_links_one_kit_per_variant').on(t.orgId, t.fromId, t.toType).where(sql`${t.relation} = 'uses_kit'`),
  ],
);

export type RecordLinkRecord = typeof recordLinks.$inferSelect;
export type NewRecordLinkRecord = typeof recordLinks.$inferInsert;
