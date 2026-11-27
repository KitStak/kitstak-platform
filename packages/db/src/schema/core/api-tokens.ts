/**
 * core.api_tokens and core.api_token_events (drizzle/0012_core_api_tokens.sql, keys in 0013): platform API tokens
 * that every app accepts, and the log of writes made with them. The SQL file is the source of truth;
 * this mirror is for typed reads. Read and write them through `../../api-tokens.ts`.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { coreSchema, createdAt } from '../_shared';
import { organization, user } from './auth';

export const API_TOKEN_APPS = ['crm', 'projects', 'pulse'] as const;
export type ApiTokenApp = (typeof API_TOKEN_APPS)[number];

export const API_TOKEN_SCOPES = ['crm:read', 'crm:write', 'projects:read', 'projects:write', 'pulse:read', 'pulse:write'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const apiTokens = coreSchema.table(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Foreign keys are named in the table options: the default names clash with crm.api_tokens (0013).
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedBy: uuid('revoked_by'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'core_api_tokens_org_id_fk', columns: [t.orgId], foreignColumns: [organization.id] }).onDelete('cascade'),
    foreignKey({ name: 'core_api_tokens_user_id_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    unique('api_tokens_token_hash_unique').on(t.tokenHash),
    index('api_tokens_org_user_idx').on(t.orgId, t.userId),
    check('api_tokens_name_check', sql`char_length(btrim(${t.name})) BETWEEN 1 AND 80`),
    check('api_tokens_token_hash_check', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'api_tokens_scopes_check',
      sql`cardinality(${t.scopes}) BETWEEN 1 AND 12 AND ${t.scopes} <@ ARRAY['crm:read','crm:write','projects:read','projects:write','pulse:read','pulse:write']::text[]`,
    ),
    check('api_tokens_expires_check', sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '90 days 1 minute'`),
  ],
);

export const apiTokenEvents = coreSchema.table(
  'api_token_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    app: text('app', { enum: API_TOKEN_APPS }).notNull(),
    action: text('action').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
    ok: boolean('ok').notNull(),
    errorCode: text('error_code'),
    target: jsonb('target').notNull().default(sql`'{}'::jsonb`),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('api_token_events_token_at_idx').on(t.tokenId, t.at.desc()),
    index('api_token_events_org_at_idx').on(t.orgId, t.at.desc()),
    check('api_token_events_app_check', sql`${t.app} IN ('crm', 'projects', 'pulse')`),
    check('api_token_events_action_check', sql`char_length(${t.action}) BETWEEN 1 AND 120`),
  ],
);

export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type ApiTokenEventRow = typeof apiTokenEvents.$inferSelect;
