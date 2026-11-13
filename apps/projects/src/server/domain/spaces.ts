/** Spaces: team / department groupings of projects shown in the sidebar. */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { projects, spaces, type Space } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import { rankAfter } from '@/lib/rank';
import type { SpaceDTO } from '@/lib/types';
import { cleanText, iso, type DomainContext } from './_shared';
import { requireOrg, visibleProjectsWhere } from './access';
import { logActivity } from './activity';

function toDTO(row: Space, projectCount: number): SpaceDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    position: row.position,
    isPrivate: row.isPrivate,
    archivedAt: iso(row.archivedAt),
    projectCount,
  };
}

export async function listSpaces(ctx: DomainContext, options: { includeArchived?: boolean } = {}): Promise<SpaceDTO[]> {
  const rows = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.orgId, ctx.orgId), isNull(spaces.deletedAt), options.includeArchived ? undefined : isNull(spaces.archivedAt)))
    .orderBy(sql`${spaces.position} COLLATE "C"`);
  const counts = await db
    .select({ spaceId: projects.spaceId, n: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(visibleProjectsWhere(ctx), isNull(projects.archivedAt), eq(projects.isTemplate, false)))
    .groupBy(projects.spaceId);
  const byId = new Map(counts.map((row) => [row.spaceId, Number(row.n)]));
  return rows.map((row) => toDTO(row, byId.get(row.id) ?? 0));
}

export interface SpaceInput {
  readonly name: string;
  readonly description?: string | null;
  readonly color?: string;
  readonly icon?: string;
  readonly isPrivate?: boolean;
}

export async function createSpace(ctx: DomainContext, input: SpaceInput): Promise<SpaceDTO> {
  requireOrg(ctx, 'space:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the space a name.', { name: 'Give the space a name.' });
  const [row] = await db.transaction(async (tx) => {
    const [last] = await tx.select({ position: spaces.position }).from(spaces).where(eq(spaces.orgId, ctx.orgId)).orderBy(sql`${spaces.position} COLLATE "C" desc`).limit(1);
    const inserted = await tx
      .insert(spaces)
      .values({
        orgId: ctx.orgId,
        name: name.slice(0, 80),
        description: cleanText(input.description),
        color: input.color ?? 'blue',
        icon: input.icon ?? 'folder',
        isPrivate: input.isPrivate ?? false,
        position: rankAfter(last?.position),
        createdBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'space.created', entityType: 'space', entityId: inserted[0].id, after: { name } });
    return inserted;
  });
  return toDTO(row, 0);
}

export async function updateSpace(
  ctx: DomainContext,
  spaceId: string,
  patch: Partial<SpaceInput> & { readonly position?: string; readonly archived?: boolean },
): Promise<SpaceDTO> {
  requireOrg(ctx, 'space:manage');
  const [current] = await db.select().from(spaces).where(and(eq(spaces.id, spaceId), eq(spaces.orgId, ctx.orgId), isNull(spaces.deletedAt)));
  if (!current) throw notFound('That space');
  const set: Partial<typeof spaces.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the space a name.', { name: 'Give the space a name.' });
    set.name = name.slice(0, 80);
  }
  if (patch.description !== undefined) set.description = cleanText(patch.description);
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.isPrivate !== undefined) set.isPrivate = patch.isPrivate;
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(spaces).set(set).where(eq(spaces.id, spaceId)).returning();
    await logActivity(tx, ctx, { verb: 'space.updated', entityType: 'space', entityId: spaceId, before: { name: current.name }, after: { name: updated[0].name } });
    return updated;
  });
  const all = await listSpaces(ctx, { includeArchived: true });
  return all.find((space) => space.id === row.id) ?? toDTO(row, 0);
}

/** Deletes a space; its projects stay and become ungrouped. */
export async function deleteSpace(ctx: DomainContext, spaceId: string): Promise<void> {
  requireOrg(ctx, 'space:manage');
  const [current] = await db.select().from(spaces).where(and(eq(spaces.id, spaceId), eq(spaces.orgId, ctx.orgId), isNull(spaces.deletedAt)));
  if (!current) throw notFound('That space');
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ spaceId: null }).where(eq(projects.spaceId, spaceId));
    await tx.update(spaces).set({ deletedAt: new Date() }).where(eq(spaces.id, spaceId));
    await logActivity(tx, ctx, { verb: 'space.deleted', entityType: 'space', entityId: spaceId, before: { name: current.name } });
  });
}
