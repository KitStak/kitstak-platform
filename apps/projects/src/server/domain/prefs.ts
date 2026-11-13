/** Per-user preferences, favorites (stars) and recents. */
import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { favorites, recents, userPrefs, type FavoriteEntityType, type RecentEntityType } from '@/server/db/schema';
import type { NotificationKind } from '@/lib/constants';
import { rankAfter } from '@/lib/rank';
import type { DomainContext } from './_shared';

export interface UserPrefs {
  /** Per-kind inbox toggles; missing = on. */
  readonly notifications?: Partial<Record<NotificationKind, boolean>>;
  /** Email digest preference (delivery handled outside this app). */
  readonly emailDigest?: 'off' | 'daily' | 'weekly';
  readonly onboarding?: {
    readonly completedSteps?: readonly string[];
    readonly dismissed?: boolean;
    readonly tourSeen?: boolean;
    /** First-run welcome dialog was shown (studio onboarding). */
    readonly welcomeSeen?: boolean;
    /** Guided tour step to resume at. */
    readonly tourStep?: number;
  };
  readonly sidebar?: { readonly collapsed?: boolean; readonly collapsedSpaceIds?: readonly string[] };
  readonly defaultProjectView?: string;
  readonly [key: string]: unknown;
}

export async function getUserPrefs(ctx: DomainContext): Promise<UserPrefs> {
  const [row] = await db
    .select({ prefs: userPrefs.prefs })
    .from(userPrefs)
    .where(and(eq(userPrefs.orgId, ctx.orgId), eq(userPrefs.userId, ctx.userId)));
  return (row?.prefs ?? {}) as UserPrefs;
}

/** Shallow-merges `patch` into the stored prefs (top-level keys replace). */
export async function updateUserPrefs(ctx: DomainContext, patch: Partial<UserPrefs>): Promise<UserPrefs> {
  const [row] = await db
    .insert(userPrefs)
    .values({ orgId: ctx.orgId, userId: ctx.userId, prefs: patch as Record<string, unknown> })
    .onConflictDoUpdate({
      target: [userPrefs.orgId, userPrefs.userId],
      set: { prefs: sql`${userPrefs.prefs} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() },
    })
    .returning({ prefs: userPrefs.prefs });
  return (row?.prefs ?? {}) as UserPrefs;
}

export interface FavoriteRef {
  readonly entityType: FavoriteEntityType;
  readonly entityId: string;
  readonly position: string;
}

export async function listFavorites(ctx: DomainContext): Promise<FavoriteRef[]> {
  return db
    .select({ entityType: favorites.entityType, entityId: favorites.entityId, position: favorites.position })
    .from(favorites)
    .where(and(eq(favorites.orgId, ctx.orgId), eq(favorites.userId, ctx.userId)))
    .orderBy(sql`${favorites.position} COLLATE "C"`);
}

export async function setFavorite(
  ctx: DomainContext,
  entityType: FavoriteEntityType,
  entityId: string,
  starred: boolean,
): Promise<void> {
  if (!starred) {
    await db
      .delete(favorites)
      .where(
        and(eq(favorites.userId, ctx.userId), eq(favorites.entityType, entityType), eq(favorites.entityId, entityId)),
      );
    return;
  }
  const existing = await listFavorites(ctx);
  await db
    .insert(favorites)
    .values({ orgId: ctx.orgId, userId: ctx.userId, entityType, entityId, position: rankAfter(existing.at(-1)?.position) })
    .onConflictDoNothing();
}

export async function recordVisit(ctx: DomainContext, entityType: RecentEntityType, entityId: string): Promise<void> {
  await db
    .insert(recents)
    .values({ orgId: ctx.orgId, userId: ctx.userId, entityType, entityId, visitedAt: new Date() })
    .onConflictDoUpdate({
      target: [recents.userId, recents.entityType, recents.entityId],
      set: { visitedAt: new Date() },
    });
}

export async function listRecents(
  ctx: DomainContext,
  entityType?: RecentEntityType,
  limit = 12,
): Promise<{ entityType: RecentEntityType; entityId: string; visitedAt: string }[]> {
  const where = entityType
    ? and(eq(recents.orgId, ctx.orgId), eq(recents.userId, ctx.userId), eq(recents.entityType, entityType))
    : and(eq(recents.orgId, ctx.orgId), eq(recents.userId, ctx.userId));
  const rows = await db.select().from(recents).where(where).orderBy(desc(recents.visitedAt)).limit(limit);
  return rows.map((row) => ({ entityType: row.entityType, entityId: row.entityId, visitedAt: row.visitedAt.toISOString() }));
}
