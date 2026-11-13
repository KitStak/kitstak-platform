/** pm.spaces, pm.user_prefs, pm.favorites, pm.recents: workspace-level structure and per-user state. */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, orgId, pmSchema, tstz, updatedAt } from './_shared';

/** A team or department grouping projects ("Operations", "Marketing"). */
export const spaces = pmSchema.table(
  'spaces',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    description: text('description'),
    /** LabelColor name from src/lib/constants.ts. */
    color: text('color').notNull().default('blue'),
    /** lucide-react icon name (kebab-case), rendered by src/components/ui/entity-icon. */
    icon: text('icon').notNull().default('folder'),
    /** Fractional rank (src/lib/rank.ts). */
    position: text('position').notNull(),
    isPrivate: boolean('is_private').notNull().default(false),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: tstz('archived_at'),
    deletedAt: deletedAt(),
  },
  (t) => [index('spaces_org_idx').on(t.orgId).where(sql`${t.deletedAt} IS NULL`)],
);

/** Per-user, per-org preferences (notification settings, onboarding progress, UI state). */
export const userPrefs = pmSchema.table(
  'user_prefs',
  {
    orgId: orgId(),
    userId: uuid('user_id').notNull(),
    prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: 'user_prefs_pkey', columns: [t.orgId, t.userId] })],
);

export const FAVORITE_ENTITY_TYPES = ['project', 'space', 'goal', 'dashboard', 'view'] as const;
export type FavoriteEntityType = (typeof FAVORITE_ENTITY_TYPES)[number];

/** Starred items shown in the sidebar. */
export const favorites = pmSchema.table(
  'favorites',
  {
    orgId: orgId(),
    userId: uuid('user_id').notNull(),
    entityType: text('entity_type', { enum: FAVORITE_ENTITY_TYPES }).notNull(),
    entityId: uuid('entity_id').notNull(),
    position: text('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: 'favorites_pkey', columns: [t.userId, t.entityType, t.entityId] })],
);

export const RECENT_ENTITY_TYPES = ['project', 'task', 'goal', 'dashboard'] as const;
export type RecentEntityType = (typeof RECENT_ENTITY_TYPES)[number];

/** Recently opened items (Home "Jump back in", command palette). */
export const recents = pmSchema.table(
  'recents',
  {
    orgId: orgId(),
    userId: uuid('user_id').notNull(),
    entityType: text('entity_type', { enum: RECENT_ENTITY_TYPES }).notNull(),
    entityId: uuid('entity_id').notNull(),
    visitedAt: tstz('visited_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'recents_pkey', columns: [t.userId, t.entityType, t.entityId] }),
    index('recents_user_visited_idx').on(t.orgId, t.userId, t.visitedAt),
  ],
);

export type Space = typeof spaces.$inferSelect;
export type NewSpace = typeof spaces.$inferInsert;
export type UserPrefsRow = typeof userPrefs.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type Recent = typeof recents.$inferSelect;
