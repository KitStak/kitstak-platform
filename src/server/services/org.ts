/** Organization-level reads: audit log, current user profile + memberships. */
import { and, count, desc, eq, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog, member, notifications, organization, user } from '@/server/db/schema';
import { NotFoundError } from '@/server/http/errors';
import { parseRoles, primaryRole } from '@/server/rbac';
import type { Executor } from '@/server/db';
import type { ServiceContext } from './context';
import type { AuditLogDto, MeDto } from './contracts/dto';
import { decodeCursor, encodeCursor, timeIdCursorSchema, toPage, type Page } from './pagination';

export const auditQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().max(100).optional(),
  actorId: z.uuid().optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export async function listAuditLog(ctx: ServiceContext, query: AuditQuery): Promise<Page<AuditLogDto>> {
  const cursor = decodeCursor(query.cursor, timeIdCursorSchema);
  const conditions: SQL[] = [eq(auditLog.orgId, ctx.orgId)];
  if (query.action) conditions.push(eq(auditLog.action, query.action));
  if (query.actorId) conditions.push(eq(auditLog.actorId, query.actorId));
  if (cursor) {
    const at = new Date(cursor[0]);
    conditions.push(
      or(lt(auditLog.createdAt, at), and(eq(auditLog.createdAt, at), lt(auditLog.id, cursor[1]))) as SQL,
    );
  }
  const rows = await ctx.db
    .select({ entry: auditLog, actorName: user.name })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(query.limit + 1);
  const page = toPage(rows, query.limit, (row) =>
    encodeCursor([row.entry.createdAt.toISOString(), row.entry.id]),
  );
  return {
    nextCursor: page.nextCursor,
    items: page.items.map(({ entry, actorName }) => ({
      id: entry.id,
      actorId: entry.actorId,
      actorName,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

export async function getMe(executor: Executor, userId: string): Promise<MeDto> {
  const [profile] = await executor
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      title: user.title,
      timezone: user.timezone,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!profile) throw new NotFoundError('User');
  const memberships = await executor
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);
  const orgIds = memberships.map((entry) => entry.id);
  const [unread] = orgIds.length
    ? await executor
        .select({ total: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            inArray(notifications.orgId, orgIds),
            isNull(notifications.readAt),
          ),
        )
    : [{ total: 0 }];
  return {
    user: profile,
    organizations: memberships.flatMap((entry) => {
      const role = primaryRole(parseRoles(entry.role));
      return role ? [{ id: entry.id, name: entry.name, slug: entry.slug, logo: entry.logo, role }] : [];
    }),
    unreadNotifications: unread?.total ?? 0,
  };
}
