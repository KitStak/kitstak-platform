/** Per-user conveniences, API access and security records. */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entityTypeEnum, fractionalKey, id, orgId, ownedByUser, timestamps, userRef } from './_shared';
import { boards } from './boards';

export const favorites = pgTable(
  'favorites',
  {
    id: id(),
    orgId: orgId(),
    userId: ownedByUser(),
    entityType: entityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    position: fractionalKey('position').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('favorites_user_entity_uq').on(t.userId, t.entityType, t.entityId),
    index('favorites_user_org_idx').on(t.userId, t.orgId, t.position),
  ],
);

export const recentVisits = pgTable(
  'recent_visits',
  {
    id: id(),
    orgId: orgId(),
    userId: ownedByUser(),
    entityType: entityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    visitCount: integer('visit_count').notNull().default(1),
    visitedAt: timestamp('visited_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('recent_visits_user_entity_uq').on(t.userId, t.entityType, t.entityId),
    index('recent_visits_user_org_visited_idx').on(t.userId, t.orgId, t.visitedAt),
  ],
);

export const savedFilters = pgTable(
  'saved_filters',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: ownedByUser(),
    name: text('name').notNull(),
    filter: jsonb('filter').$type<Record<string, unknown>>().notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    ...timestamps(),
  },
  (t) => [index('saved_filters_board_user_idx').on(t.boardId, t.userId)],
);

/** Personal API tokens. Only a SHA-256 hash is stored; the raw token is shown once. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: id(),
    orgId: orgId(),
    userId: ownedByUser(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /** First characters of the token for identification in the UI (e.g. `ks_live_ab12`). */
    tokenPrefix: text('token_prefix').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId), index('api_tokens_org_idx').on(t.orgId)],
);

/** Security-relevant organization events (append-only). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    orgId: orgId(),
    actorId: userRef('actor_id'),
    /** e.g. member.invited, member.role_changed, board.deleted, api_token.created, auth.denied */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    index('audit_log_org_created_idx').on(t.orgId, t.createdAt),
    index('audit_log_actor_idx').on(t.actorId),
    index('audit_log_action_idx').on(t.orgId, t.action),
  ],
);

export const webhooks = pgTable(
  'webhooks',
  {
    id: id(),
    orgId: orgId(),
    /** Null = organization-wide webhook. */
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    events: text('events')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** HMAC signing secret, encrypted at rest by the webhooks service (never returned after creation). */
    secretCiphertext: text('secret_ciphertext').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    failureCount: integer('failure_count').notNull().default(0),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true, mode: 'date' }),
    lastStatus: integer('last_status'),
    createdBy: userRef('created_by'),
    ...timestamps(),
  },
  (t) => [index('webhooks_org_idx').on(t.orgId), index('webhooks_board_idx').on(t.boardId)],
);
