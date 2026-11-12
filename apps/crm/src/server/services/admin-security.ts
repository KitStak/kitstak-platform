/**
 * Admin center → Security (sessions), Audit log (filtered + CSV), API tokens and Usage.
 * Every query is scoped to `ctx.orgId`; sessions are scoped through org membership.
 */
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, lt, or, sql, sum, type SQL } from 'drizzle-orm';
import {
  apiTokens,
  auditLog,
  automationRuns,
  automations,
  boards,
  dashboards,
  files,
  invitation,
  items,
  member,
  organization,
  session,
  team,
  user,
  views,
  webhooks,
  workspaces,
} from '@/server/db/schema';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { canManageRole, ORG_ROLES, primaryRole, type OrgRole } from '@/server/rbac';
import { isOrgAdmin, type ServiceContext } from './context';
import { decodeCursor, encodeCursor, timeIdCursorSchema, toPage, type Page } from './pagination';
import type {
  AdminAuditEntryDto,
  AdminAuditQuery,
  AdminSessionDto,
  ApiTokenDto,
  CreateApiTokenInput,
  CreatedApiTokenDto,
  UsageDto,
} from './admin-contracts';
import { auditCategoryPrefixes, decodeMemberRole, describeAuditAction, parseUserAgent, toCsv } from './admin-policy';

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export async function listOrgSessions(ctx: ServiceContext, currentToken: string | null): Promise<AdminSessionDto[]> {
  const now = new Date();
  const rows = await ctx.db
    .select({
      id: session.id,
      token: session.token,
      userId: session.userId,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      userName: user.name,
      userEmail: user.email,
      image: user.image,
    })
    .from(session)
    .innerJoin(member, and(eq(member.userId, session.userId), eq(member.organizationId, ctx.orgId)))
    .innerJoin(user, eq(user.id, session.userId))
    .where(gte(session.expiresAt, now))
    .orderBy(desc(session.updatedAt))
    .limit(500);
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    image: row.image,
    ipAddress: row.ipAddress,
    device: parseUserAgent(row.userAgent),
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: (row.updatedAt ?? row.createdAt).toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: currentToken !== null && row.token === currentToken,
  }));
}

export async function revokeOrgSession(
  ctx: ServiceContext,
  sessionId: string,
  currentToken: string | null,
): Promise<{ id: string; userId: string }> {
  const [row] = await ctx.db
    .select({ id: session.id, token: session.token, userId: session.userId, role: member.role })
    .from(session)
    .innerJoin(member, and(eq(member.userId, session.userId), eq(member.organizationId, ctx.orgId)))
    .where(eq(session.id, sessionId))
    .limit(1);
  if (!row) throw new NotFoundError('Session');
  if (currentToken && row.token === currentToken) {
    throw new BadRequestError('This is your current session. Use Sign out instead.');
  }
  const actor = primaryRole([...ctx.roles]);
  const target = decodeMemberRole(row.role).role;
  if (row.userId !== ctx.userId && (!actor || !canManageRole(actor, target))) {
    throw new ForbiddenError('You cannot sign out someone with this role');
  }
  await ctx.db.delete(session).where(eq(session.id, sessionId));
  return { id: row.id, userId: row.userId };
}

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------

function dayStart(day: string, tz: string): SQL {
  return sql`((${day})::timestamp at time zone ${tz})`;
}

type AuditFilterQuery = Omit<AdminAuditQuery, 'cursor' | 'limit' | 'order'>;

function auditConditions(ctx: ServiceContext, query: AuditFilterQuery): SQL[] {
  const conditions: SQL[] = [eq(auditLog.orgId, ctx.orgId)];
  const tz = query.tz ?? 'UTC';
  if (query.category) {
    const prefixes = auditCategoryPrefixes(query.category);
    conditions.push(or(...prefixes.map((prefix) => ilike(auditLog.action, `${prefix.replace(/[%_]/g, '\\$&')}%`))) as SQL);
  }
  if (query.actorId) conditions.push(eq(auditLog.actorId, query.actorId));
  // Calendar days are interpreted in the viewer's time zone: [from 00:00, to + 1 day 00:00).
  if (query.from) conditions.push(sql`${auditLog.createdAt} >= ${dayStart(query.from, tz)}`);
  if (query.to) conditions.push(sql`${auditLog.createdAt} < (${dayStart(query.to, tz)} + interval '1 day')`);
  if (query.q) {
    const like = `%${query.q.replace(/[%_\\]/g, '\\$&')}%`;
    conditions.push(
      or(
        ilike(auditLog.action, like),
        ilike(auditLog.targetId, like),
        ilike(auditLog.targetType, like),
        ilike(auditLog.ipAddress, like),
        ilike(user.name, like),
        ilike(user.email, like),
      ) as SQL,
    );
  }
  return conditions;
}

function metadataLabel(metadata: Record<string, unknown>): string | null {
  for (const key of ['name', 'title', 'boardName', 'email', 'label', 'fileName']) {
    const value = metadata[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NameRow = { id: string; name: string | null };

/**
 * Batched name lookup for audit targets (one org-scoped query per target type). Keys are
 * `${type}:${id}`. Ids that do not resolve belong to deleted entities.
 */
export async function resolveAuditTargets(
  ctx: ServiceContext,
  targets: ReadonlyArray<{ readonly type: string | null; readonly id: string | null }>,
): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const target of targets) {
    if (!target.type || !target.id || !UUID_RE.test(target.id)) continue;
    const set = byType.get(target.type) ?? new Set<string>();
    set.add(target.id);
    byType.set(target.type, set);
  }
  const names = new Map<string, string>();
  const jobs: Promise<void>[] = [];
  const lookup = (type: string, run: (list: string[]) => Promise<readonly NameRow[]>) => {
    const list = [...(byType.get(type) ?? [])];
    if (list.length === 0) return;
    jobs.push(
      run(list).then((rows) => {
        for (const row of rows) if (row.name) names.set(`${type}:${row.id}`, row.name);
      }),
    );
  };
  lookup('board', (list) =>
    ctx.db
      .select({ id: boards.id, name: boards.name })
      .from(boards)
      .where(and(eq(boards.orgId, ctx.orgId), inArray(boards.id, list))),
  );
  lookup('item', (list) =>
    ctx.db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(and(eq(items.orgId, ctx.orgId), inArray(items.id, list))),
  );
  lookup('automation', (list) =>
    ctx.db
      .select({ id: automations.id, name: automations.name })
      .from(automations)
      .where(and(eq(automations.orgId, ctx.orgId), inArray(automations.id, list))),
  );
  lookup('webhook', (list) =>
    ctx.db
      .select({ id: webhooks.id, name: webhooks.url })
      .from(webhooks)
      .where(and(eq(webhooks.orgId, ctx.orgId), inArray(webhooks.id, list))),
  );
  lookup('api_token', (list) =>
    ctx.db
      .select({ id: apiTokens.id, name: apiTokens.name })
      .from(apiTokens)
      .where(and(eq(apiTokens.orgId, ctx.orgId), inArray(apiTokens.id, list))),
  );
  lookup('view', (list) =>
    ctx.db
      .select({ id: views.id, name: views.name })
      .from(views)
      .innerJoin(boards, eq(boards.id, views.boardId))
      .where(and(eq(boards.orgId, ctx.orgId), inArray(views.id, list))),
  );
  lookup('team', (list) =>
    ctx.db
      .select({ id: team.id, name: team.name })
      .from(team)
      .where(and(eq(team.organizationId, ctx.orgId), inArray(team.id, list))),
  );
  lookup('member', (list) =>
    ctx.db
      .select({ id: member.id, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, ctx.orgId), inArray(member.id, list))),
  );
  lookup('user', (list) =>
    ctx.db
      .select({ id: user.id, name: user.name })
      .from(user)
      .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, ctx.orgId)))
      .where(inArray(user.id, list)),
  );
  lookup('invitation', (list) =>
    ctx.db
      .select({ id: invitation.id, name: invitation.email })
      .from(invitation)
      .where(and(eq(invitation.organizationId, ctx.orgId), inArray(invitation.id, list))),
  );
  lookup('organization', (list) =>
    ctx.db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(and(eq(organization.id, ctx.orgId), inArray(organization.id, list))),
  );
  await Promise.all(jobs);
  return names;
}

/** Display name + state for one entry given the batched lookup. Never truncates ids. */
export function auditTargetDisplay(
  entry: { readonly targetType: string | null; readonly targetId: string | null; readonly metadata: Record<string, unknown> },
  names: ReadonlyMap<string, string>,
): { label: string | null; state: AdminAuditEntryDto['targetState'] } {
  if (!entry.targetType && !entry.targetId) return { label: null, state: 'none' };
  if (entry.targetType && entry.targetId) {
    const resolved = names.get(`${entry.targetType}:${entry.targetId}`);
    if (resolved) return { label: resolved, state: 'resolved' };
  }
  const fromMetadata = metadataLabel(entry.metadata);
  if (fromMetadata) return { label: fromMetadata, state: 'resolved' };
  if (entry.targetId && !UUID_RE.test(entry.targetId)) return { label: entry.targetId, state: 'resolved' };
  return { label: null, state: entry.targetId ? 'deleted' : 'none' };
}

export async function listAdminAudit(ctx: ServiceContext, query: AdminAuditQuery): Promise<Page<AdminAuditEntryDto>> {
  const conditions = auditConditions(ctx, query);
  const ascending = query.order === 'asc';
  const cursor = decodeCursor(query.cursor, timeIdCursorSchema);
  if (cursor) {
    const at = new Date(cursor[0]);
    conditions.push(
      (ascending
        ? or(gt(auditLog.createdAt, at), and(eq(auditLog.createdAt, at), gt(auditLog.id, cursor[1])))
        : or(lt(auditLog.createdAt, at), and(eq(auditLog.createdAt, at), lt(auditLog.id, cursor[1])))) as SQL,
    );
  }
  const rows = await ctx.db
    .select({ entry: auditLog, actorName: user.name, actorEmail: user.email })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(and(...conditions))
    .orderBy(...(ascending ? [asc(auditLog.createdAt), asc(auditLog.id)] : [desc(auditLog.createdAt), desc(auditLog.id)]))
    .limit(query.limit + 1);
  const page = toPage(rows, query.limit, (row) => encodeCursor([row.entry.createdAt.toISOString(), row.entry.id]));
  const names = await resolveAuditTargets(
    ctx,
    page.items.map(({ entry }) => ({ type: entry.targetType, id: entry.targetId })),
  );
  return {
    nextCursor: page.nextCursor,
    items: page.items.map(({ entry, actorName, actorEmail }) => {
      const target = auditTargetDisplay(entry, names);
      return {
        id: entry.id,
        action: entry.action,
        actorId: entry.actorId,
        actorName,
        actorEmail,
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetLabel: target.label,
        targetState: target.state,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: entry.metadata,
        createdAt: entry.createdAt.toISOString(),
      };
    }),
  };
}

const AUDIT_EXPORT_LIMIT = 10_000;

export async function exportAuditCsv(
  ctx: ServiceContext,
  query: Omit<AdminAuditQuery, 'cursor' | 'limit' | 'order'>,
): Promise<{ csv: string; count: number }> {
  const rows = await ctx.db
    .select({ entry: auditLog, actorName: user.name, actorEmail: user.email })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(and(...auditConditions(ctx, query)))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(AUDIT_EXPORT_LIMIT);
  const names = await resolveAuditTargets(
    ctx,
    rows.map(({ entry }) => ({ type: entry.targetType, id: entry.targetId })),
  );
  const csv = toCsv(
    ['Time (UTC)', 'Event', 'Action key', 'Actor', 'Actor email', 'Target type', 'Target', 'Target id', 'IP address', 'User agent', 'Details'],
    rows.map(({ entry, actorName, actorEmail }) => [
      entry.createdAt.toISOString(),
      describeAuditAction(entry.action),
      entry.action,
      actorName ?? 'System',
      actorEmail ?? '',
      entry.targetType ?? '',
      auditTargetDisplay(entry, names).label ?? '',
      entry.targetId ?? '',
      entry.ipAddress ?? '',
      entry.userAgent ?? '',
      entry.metadata,
    ]),
  );
  return { csv, count: rows.length };
}

// ---------------------------------------------------------------------------------------------
// API tokens (personal; admins can list + revoke every token in the org)
// ---------------------------------------------------------------------------------------------

export const TOKEN_PREFIX = 'ks_live_';

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

type TokenRow = typeof apiTokens.$inferSelect;

function tokenStatus(row: TokenRow, now = Date.now()): ApiTokenDto['status'] {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() < now) return 'expired';
  return 'active';
}

function toTokenDto(row: TokenRow, userName: string | null): ApiTokenDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.tokenPrefix,
    scopes: row.scopes,
    userId: row.userId,
    userName,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    status: tokenStatus(row),
  };
}

export async function listApiTokens(ctx: ServiceContext, scope: 'mine' | 'org'): Promise<ApiTokenDto[]> {
  if (!ctx.userId) throw new ForbiddenError();
  if (scope === 'org' && !isOrgAdmin(ctx)) throw new ForbiddenError('Only admins can see every token');
  const conditions: SQL[] = [eq(apiTokens.orgId, ctx.orgId)];
  if (scope === 'mine') conditions.push(eq(apiTokens.userId, ctx.userId));
  const rows = await ctx.db
    .select({ token: apiTokens, userName: user.name })
    .from(apiTokens)
    .leftJoin(user, eq(user.id, apiTokens.userId))
    .where(and(...conditions))
    .orderBy(desc(apiTokens.createdAt))
    .limit(500);
  return rows.map((row) => toTokenDto(row.token, row.userName));
}

const MAX_ACTIVE_TOKENS = 25;
const DAY_MS = 86_400_000;

export async function createApiToken(ctx: ServiceContext, input: CreateApiTokenInput): Promise<CreatedApiTokenDto> {
  const userId = ctx.userId;
  if (!userId) throw new ForbiddenError();
  if (input.scopes.includes('audit:read') && !isOrgAdmin(ctx)) {
    throw new ForbiddenError('Only admins can grant the audit log scope');
  }
  const [active] = await ctx.db
    .select({ total: count() })
    .from(apiTokens)
    .where(and(eq(apiTokens.orgId, ctx.orgId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
  if ((active?.total ?? 0) >= MAX_ACTIVE_TOKENS) {
    throw new BadRequestError(`You can have up to ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
  }
  const token = generateToken();
  const [row] = await ctx.db
    .insert(apiTokens)
    .values({
      orgId: ctx.orgId,
      userId,
      name: input.name,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 4),
      scopes: [...new Set(input.scopes)],
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null,
    })
    .returning();
  if (!row) throw new Error('Token insert returned no row');
  const [owner] = await ctx.db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return { ...toTokenDto(row, owner?.name ?? null), token };
}

export async function revokeApiToken(ctx: ServiceContext, tokenId: string): Promise<ApiTokenDto> {
  const [row] = await ctx.db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.orgId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Token');
  if (row.userId !== ctx.userId && !isOrgAdmin(ctx)) throw new NotFoundError('Token');
  const [updated] = row.revokedAt
    ? [row]
    : await ctx.db
        .update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(apiTokens.id, tokenId))
        .returning();
  if (!updated) throw new NotFoundError('Token');
  const [owner] = await ctx.db.select({ name: user.name }).from(user).where(eq(user.id, updated.userId)).limit(1);
  return toTokenDto(updated, owner?.name ?? null);
}

// ---------------------------------------------------------------------------------------------
// Usage (demo plan)
// ---------------------------------------------------------------------------------------------

export const DEMO_PLAN = {
  name: 'Enterprise',
  seatLimit: 50,
  automationRunLimit: 25_000,
  storageLimitBytes: 50 * 1024 ** 3,
} as const;

export async function getUsage(ctx: ServiceContext): Promise<UsageDto> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const org = ctx.orgId;
  const [memberRows, invites, spaceCount, boardCount, itemCount, dashCount, autoRows, runRows, fileRows, tokenCount] =
    await Promise.all([
      ctx.db.select({ role: member.role }).from(member).where(eq(member.organizationId, org)),
      ctx.db
        .select({ total: count() })
        .from(invitation)
        .where(and(eq(invitation.organizationId, org), eq(invitation.status, 'pending'))),
      ctx.db.select({ total: count() }).from(workspaces).where(and(eq(workspaces.orgId, org), isNull(workspaces.deletedAt))),
      ctx.db.select({ total: count() }).from(boards).where(and(eq(boards.orgId, org), isNull(boards.deletedAt))),
      ctx.db
        .select({ total: count() })
        .from(items)
        .innerJoin(boards, eq(boards.id, items.boardId))
        .where(and(eq(items.orgId, org), isNull(items.deletedAt), isNull(boards.deletedAt))),
      ctx.db.select({ total: count() }).from(dashboards).where(and(eq(dashboards.orgId, org), isNull(dashboards.deletedAt))),
      ctx.db
        .select({ total: count(), enabled: sql<number>`count(*) filter (where ${automations.enabled})` })
        .from(automations)
        .where(and(eq(automations.orgId, org), isNull(automations.deletedAt))),
      ctx.db
        .select({ total: count(), failed: sql<number>`count(*) filter (where ${automationRuns.status} = 'failed')` })
        .from(automationRuns)
        .where(and(eq(automationRuns.orgId, org), gte(automationRuns.createdAt, monthStart))),
      ctx.db
        .select({ total: count(), bytes: sum(files.size) })
        .from(files)
        .where(and(eq(files.orgId, org), isNull(files.deletedAt))),
      ctx.db
        .select({
          total: sql<number>`count(*) filter (where ${apiTokens.revokedAt} is null)`,
          revoked: sql<number>`count(*) filter (where ${apiTokens.revokedAt} >= ${monthStart})`,
        })
        .from(apiTokens)
        .where(eq(apiTokens.orgId, org)),
    ]);
  const byRole = Object.fromEntries(ORG_ROLES.map((role) => [role, 0])) as Record<OrgRole, number>;
  let active = 0;
  let deactivated = 0;
  for (const row of memberRows) {
    const decoded = decodeMemberRole(row.role);
    if (decoded.deactivated) deactivated += 1;
    else {
      active += 1;
      byRole[decoded.role] += 1;
    }
  }
  const renews = new Date(monthStart);
  renews.setUTCMonth(renews.getUTCMonth() + 1);
  return {
    seats: { active, deactivated, pendingInvites: invites[0]?.total ?? 0, byRole, limit: DEMO_PLAN.seatLimit },
    workspaces: spaceCount[0]?.total ?? 0,
    boards: boardCount[0]?.total ?? 0,
    items: itemCount[0]?.total ?? 0,
    dashboards: dashCount[0]?.total ?? 0,
    automations: { total: autoRows[0]?.total ?? 0, enabled: Number(autoRows[0]?.enabled ?? 0) },
    automationRuns: {
      thisMonth: runRows[0]?.total ?? 0,
      failedThisMonth: Number(runRows[0]?.failed ?? 0),
      limit: DEMO_PLAN.automationRunLimit,
    },
    files: { count: fileRows[0]?.total ?? 0, bytes: Number(fileRows[0]?.bytes ?? 0), limitBytes: DEMO_PLAN.storageLimitBytes },
    apiTokens: Number(tokenCount[0]?.total ?? 0),
    apiTokensRevokedThisMonth: Number(tokenCount[0]?.revoked ?? 0),
    plan: { name: DEMO_PLAN.name, demo: true, renewsAt: renews.toISOString() },
  };
}

/** Exposed for the sessions route: ids of all members of the org (bulk revoke helpers). */
export async function orgMemberUserIds(ctx: ServiceContext): Promise<string[]> {
  const rows = await ctx.db.select({ userId: member.userId }).from(member).where(eq(member.organizationId, ctx.orgId));
  return rows.map((row) => row.userId);
}

