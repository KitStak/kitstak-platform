/** Saved views (filters, sort, group, columns, date range) per page, and per person preferences. */
import 'server-only';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { savedViews, userPrefs } from '@/server/db/schema';
import { forbidden, invalid, notFound } from '@/server/errors';
import type { SavedViewPage } from '@/lib/constants';
import { canPulse } from '@/lib/permissions';
import type { SavedViewDTO, UserPrefsDTO } from '@/lib/types';
import { cleanText, inTx, isUuid, type DomainContext } from './_shared';
import { softDeleteRow } from './_crud';
import { requirePulse } from './access';
import { logActivity } from './activity';

type ViewRow = typeof savedViews.$inferSelect;

const toViewDTO = (row: ViewRow, userId: string): SavedViewDTO => ({ id: row.id, userId: row.userId, page: row.page as SavedViewPage, name: row.name, config: row.config ?? {}, shared: row.shared, isDefault: row.isDefault, position: row.position, mine: row.userId === userId });

/** The caller's own views plus the shared ones of a page. */
export const listSavedViews = scoped(async function listSavedViews(ctx: DomainContext, page?: SavedViewPage | null): Promise<SavedViewDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  const found = await db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.orgId, ctx.orgId), isNull(savedViews.deletedAt), page ? eq(savedViews.page, page) : undefined, or(eq(savedViews.userId, ctx.userId), eq(savedViews.shared, true))))
    .orderBy(asc(savedViews.page), asc(savedViews.position), asc(savedViews.createdAt));
  return found.map((row) => toViewDTO(row, ctx.userId));
});

export interface SavedViewInput {
  id?: string | null;
  page: SavedViewPage;
  name: string;
  config: Record<string, unknown>;
  shared?: boolean;
  isDefault?: boolean;
  position?: number;
}

/** Creates or edits a view. Sharing a view with the workspace needs a manager. */
export const saveView = scoped(async function saveView(ctx: DomainContext, input: SavedViewInput): Promise<SavedViewDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the view a name.', { name: 'Give the view a name.' });
  if (JSON.stringify(input.config ?? {}).length > 20_000) throw invalid('That view holds too much. Remove some filters and try again.');
  if (input.shared && !canPulse(access.role, 'job:manage')) throw forbidden('Only a manager can share a view with the workspace.');
  return inTx(async (tx) => {
    if (input.isDefault) await tx.update(savedViews).set({ isDefault: false }).where(and(eq(savedViews.orgId, ctx.orgId), eq(savedViews.userId, ctx.userId), eq(savedViews.page, input.page)));
    if (input.id) {
      const [before] = isUuid(input.id) ? await tx.select().from(savedViews).where(and(eq(savedViews.orgId, ctx.orgId), eq(savedViews.id, input.id), isNull(savedViews.deletedAt))) : [];
      if (!before) throw notFound('That view');
      if (before.userId !== ctx.userId && !canPulse(access.role, 'job:manage')) throw forbidden('You can only change your own views.');
      const [row] = await tx
        .update(savedViews)
        .set({ name, config: input.config ?? {}, shared: input.shared ?? before.shared, isDefault: input.isDefault ?? before.isDefault, position: input.position ?? before.position, updatedAt: new Date() })
        .where(eq(savedViews.id, before.id))
        .returning();
      await logActivity(tx, ctx, { verb: 'view.updated', entityType: 'view', entityId: before.id, after: { name, page: input.page, shared: row!.shared, isDefault: row!.isDefault } });
      return toViewDTO(row!, ctx.userId);
    }
    const [row] = await tx.insert(savedViews).values({ orgId: ctx.orgId, userId: ctx.userId, page: input.page, name, config: input.config ?? {}, shared: Boolean(input.shared), isDefault: Boolean(input.isDefault), position: input.position ?? 0 }).returning();
    await logActivity(tx, ctx, { verb: 'view.created', entityType: 'view', entityId: row!.id, after: { name, page: input.page, shared: row!.shared } });
    return toViewDTO(row!, ctx.userId);
  });
});

export const deleteView = scoped(async function deleteView(ctx: DomainContext, viewId: string): Promise<void> {
  const access = await requirePulse(ctx, 'pulse:read');
  await inTx(async (tx) => {
    const [before] = isUuid(viewId) ? await tx.select().from(savedViews).where(and(eq(savedViews.orgId, ctx.orgId), eq(savedViews.id, viewId), isNull(savedViews.deletedAt))) : [];
    if (!before) throw notFound('That view');
    if (before.userId !== ctx.userId && !canPulse(access.role, 'job:manage')) throw forbidden('You can only delete your own views.');
    await softDeleteRow(tx, ctx.orgId, 'saved_views', viewId, 'That view');
    await logActivity(tx, ctx, { verb: 'view.deleted', entityType: 'view', entityId: viewId, before: { name: before.name, page: before.page } });
  });
});

/* ---------------------------------------------------------------- per person preferences */

export const getUserPrefs = scoped(async function getUserPrefs(ctx: DomainContext): Promise<UserPrefsDTO> {
  const [row] = await db.select({ prefs: userPrefs.prefs }).from(userPrefs).where(and(eq(userPrefs.orgId, ctx.orgId), eq(userPrefs.userId, ctx.userId)));
  return (row?.prefs ?? {}) as UserPrefsDTO;
});

/** Shallow merges `patch` into the caller's preferences for this org. A key set to null is removed. */
export const updateUserPrefs = scoped(async function updateUserPrefs(ctx: DomainContext, patch: Record<string, unknown>): Promise<UserPrefsDTO> {
  if (JSON.stringify(patch).length > 20_000) throw invalid('Those preferences are too large to save.');
  const [row] = await db
    .insert(userPrefs)
    .values({ orgId: ctx.orgId, userId: ctx.userId, prefs: patch })
    .onConflictDoUpdate({ target: [userPrefs.orgId, userPrefs.userId], set: { prefs: sql`jsonb_strip_nulls(${userPrefs.prefs} || ${JSON.stringify(patch)}::jsonb)`, updatedAt: new Date() } })
    .returning({ prefs: userPrefs.prefs });
  return (row?.prefs ?? {}) as UserPrefsDTO;
});

/** Puts a job at the front of the caller's recent jobs (kept to 12). */
export const recordRecentJob = scoped(async function recordRecentJob(ctx: DomainContext, jobId: string): Promise<void> {
  if (!isUuid(jobId)) return;
  const prefs = await getUserPrefs(ctx);
  const recent = [jobId, ...((prefs.recentJobIds ?? []) as string[]).filter((id) => id !== jobId)].slice(0, 12);
  await updateUserPrefs(ctx, { recentJobIds: recent });
});
