/**
 * Organization settings (General, Permissions policy, Security policy, team owners) and per-member
 * profile preferences. Both live in `organization.metadata` (JSON text) under the `kitstak` key,
 * written with a row lock so concurrent saves never drop each other's changes.
 *
 * Also exports the enforcement hooks other services call: `assertCreationAllowed`,
 * `assertInviteEmailAllowed` and `enforceNetworkPolicy` (IP allow-list, cached per org).
 */
import 'server-only';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { db as defaultDb, type Executor } from '@/server/db';
import { member, organization, team, user, workspaces } from '@/server/db/schema';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { isOrgAdmin, type ServiceContext } from './context';
import type {
  OrgAdminDto,
  OrgSettings,
  ProfileDto,
  ProfilePrefs,
  UpdateOrgGeneralInput,
  UpdateOrgPolicyInput,
  UpdateProfileInput,
} from './admin-contracts';
import {
  decodeMemberRole,
  emailDomainAllowed,
  invalidIpRules,
  ipAllowed,
  mergeSettings,
  profileFor,
  readKitstakMetadata,
  writeKitstakMetadata,
  type KitstakMetadata,
} from './admin-policy';

export const DATA_REGION = 'United States (us-east) · local development';

// ---------------------------------------------------------------------------------------------
// Metadata read / locked read-modify-write
// ---------------------------------------------------------------------------------------------

async function loadOrgRow(executor: Executor, orgId: string, lock = false) {
  const query = executor
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      createdAt: organization.createdAt,
      metadata: organization.metadata,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Organization');
  return row;
}

export async function readOrgMetadata(executor: Executor, orgId: string): Promise<KitstakMetadata> {
  const row = await loadOrgRow(executor, orgId);
  return readKitstakMetadata(row.metadata);
}

/** Lock the org row, apply `update` to the kitstak metadata and persist it. */
export async function updateOrgMetadata(
  ctx: Pick<ServiceContext, 'db' | 'orgId'>,
  update: (meta: KitstakMetadata) => KitstakMetadata,
): Promise<KitstakMetadata> {
  const next = await ctx.db.transaction(async (tx) => {
    const row = await loadOrgRow(tx, ctx.orgId, true);
    const updated = update(readKitstakMetadata(row.metadata));
    await tx
      .update(organization)
      .set({ metadata: writeKitstakMetadata(row.metadata, updated) })
      .where(eq(organization.id, ctx.orgId));
    return updated;
  });
  policyCache.delete(ctx.orgId);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Admin: organization settings
// ---------------------------------------------------------------------------------------------

function requireAdmin(ctx: ServiceContext): void {
  if (!isOrgAdmin(ctx)) throw new ForbiddenError('Only owners and admins can change organization settings');
}

export async function getOrgAdmin(ctx: ServiceContext, requesterIp: string | null): Promise<OrgAdminDto> {
  const row = await loadOrgRow(ctx.db, ctx.orgId);
  const meta = readKitstakMetadata(row.metadata);
  const spaces = await ctx.db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(and(eq(workspaces.orgId, ctx.orgId), isNull(workspaces.deletedAt)))
    .orderBy(asc(workspaces.position));
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    createdAt: row.createdAt.toISOString(),
    region: DATA_REGION,
    settings: meta.settings,
    workspaces: spaces,
    requesterIp,
  };
}

const RESERVED_SLUGS = new Set(['api', 'login', 'signup', 'welcome', 'admin', 'settings', 'dev', 'terms', 'privacy']);

export async function updateOrgGeneral(
  ctx: ServiceContext,
  input: UpdateOrgGeneralInput,
  requesterIp: string | null,
): Promise<OrgAdminDto> {
  requireAdmin(ctx);
  if (input.slug !== undefined) {
    if (RESERVED_SLUGS.has(input.slug)) throw new BadRequestError('That URL is reserved. Pick another one.');
    const [clash] = await ctx.db
      .select({ id: organization.id })
      .from(organization)
      .where(and(eq(organization.slug, input.slug), ne(organization.id, ctx.orgId)))
      .limit(1);
    if (clash) throw new ConflictError('That URL is already taken');
  }
  if (input.defaultWorkspaceId) {
    const [space] = await ctx.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(eq(workspaces.id, input.defaultWorkspaceId), eq(workspaces.orgId, ctx.orgId), isNull(workspaces.deletedAt)),
      )
      .limit(1);
    if (!space) throw new NotFoundError('Workspace');
  }
  const columns: Partial<{ name: string; slug: string; logo: string | null }> = {};
  if (input.name !== undefined) columns.name = input.name;
  if (input.slug !== undefined) columns.slug = input.slug;
  if (input.logo !== undefined) columns.logo = input.logo;
  if (Object.keys(columns).length > 0) {
    await ctx.db.update(organization).set(columns).where(eq(organization.id, ctx.orgId));
  }
  if (input.defaultWorkspaceId !== undefined) {
    const defaultWorkspaceId = input.defaultWorkspaceId;
    await updateOrgMetadata(ctx, (meta) => ({
      ...meta,
      settings: mergeSettings(meta.settings, { defaultWorkspaceId }),
    }));
  }
  return getOrgAdmin(ctx, requesterIp);
}

export async function updateOrgPolicy(
  ctx: ServiceContext,
  input: UpdateOrgPolicyInput,
  requesterIp: string | null,
): Promise<OrgAdminDto> {
  requireAdmin(ctx);
  if (input.ipAllowList) {
    const invalid = invalidIpRules(input.ipAllowList);
    if (invalid.length > 0) throw new BadRequestError(`Invalid IP rule: ${invalid.join(', ')}`);
  }
  await updateOrgMetadata(ctx, (meta) => {
    const next = mergeSettings(meta.settings, {
      ...input,
      ...(input.allowedEmailDomains ? { allowedEmailDomains: [...new Set(input.allowedEmailDomains)] } : {}),
      ...(input.ipAllowList ? { ipAllowList: [...new Set(input.ipAllowList)] } : {}),
    });
    // Self-lockout guard: never enable a list that would block the admin saving it.
    if (next.ipAllowListEnabled) {
      if (next.ipAllowList.length === 0) throw new BadRequestError('Add at least one IP rule before enabling the allow-list');
      if (requesterIp && !ipAllowed(requesterIp, next.ipAllowList)) {
        throw new BadRequestError(`Your current IP (${requesterIp}) is not in the list. Add it first so you don't lock yourself out.`);
      }
    }
    return { ...meta, settings: next };
  });
  return getOrgAdmin(ctx, requesterIp);
}

export async function setTeamOwners(
  ctx: ServiceContext,
  teamId: string,
  userIds: readonly string[],
): Promise<OrgSettings> {
  if (!isOrgAdmin(ctx)) {
    const meta = await readOrgMetadata(ctx.db, ctx.orgId);
    if (!ctx.userId || !(meta.settings.teamOwners[teamId] ?? []).includes(ctx.userId)) {
      throw new ForbiddenError('Only admins and team owners can change team owners');
    }
  }
  const [row] = await ctx.db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Team');
  if (userIds.length > 0) {
    const members = await ctx.db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, ctx.orgId));
    const known = new Set(members.map((entry) => entry.userId));
    if (userIds.some((id) => !known.has(id))) throw new BadRequestError('Team owners must be members of the organization');
  }
  const next = await updateOrgMetadata(ctx, (meta) => {
    const teamOwners = { ...meta.settings.teamOwners };
    if (userIds.length === 0) delete teamOwners[teamId];
    else teamOwners[teamId] = [...new Set(userIds)];
    return { ...meta, settings: { ...meta.settings, teamOwners } };
  });
  return next.settings;
}

// ---------------------------------------------------------------------------------------------
// Enforcement hooks (called from other services / withApi)
// ---------------------------------------------------------------------------------------------

/** Workspace / board creation restriction ("admins only"). */
export async function assertCreationAllowed(
  ctx: ServiceContext,
  kind: 'workspace' | 'board',
): Promise<void> {
  if (ctx.userId === null || isOrgAdmin(ctx)) return;
  const { settings } = await readOrgMetadata(ctx.db, ctx.orgId);
  const policy = kind === 'workspace' ? settings.workspaceCreation : settings.boardCreation;
  if (policy === 'admins') {
    throw new ForbiddenError(
      kind === 'workspace'
        ? 'Only admins can create workspaces in this organization'
        : 'Only admins can create boards in this organization',
    );
  }
}

/** Allowed email domains for new invitations. */
export async function assertInviteEmailAllowed(ctx: Pick<ServiceContext, 'db' | 'orgId'>, email: string): Promise<void> {
  const { settings } = await readOrgMetadata(ctx.db, ctx.orgId);
  if (!emailDomainAllowed(email, settings.allowedEmailDomains)) {
    throw new ForbiddenError(
      `Invitations are limited to ${settings.allowedEmailDomains.map((domain) => `@${domain}`).join(', ')}`,
    );
  }
}

interface CachedPolicy {
  readonly enabled: boolean;
  readonly rules: readonly string[];
  readonly at: number;
}

const POLICY_TTL_MS = 15_000;
const policyCache = new Map<string, CachedPolicy>();

/**
 * IP allow-list for org-scoped API requests. Unknown client IPs (no proxy headers, local dev)
 * are allowed outside production so the dev server stays usable; in production they are denied.
 */
export async function enforceNetworkPolicy(orgId: string, ip: string | null): Promise<void> {
  let policy = policyCache.get(orgId);
  if (!policy || Date.now() - policy.at > POLICY_TTL_MS) {
    const { settings } = await readOrgMetadata(defaultDb, orgId);
    policy = { enabled: settings.ipAllowListEnabled, rules: settings.ipAllowList, at: Date.now() };
    policyCache.set(orgId, policy);
  }
  if (!policy.enabled) return;
  if (!ip && process.env.NODE_ENV !== 'production') return;
  if (!ipAllowed(ip, policy.rules)) {
    throw new ForbiddenError('Access from your network is blocked by your organization’s IP allow-list', {
      reason: 'ip_not_allowed',
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function getProfile(ctx: ServiceContext): Promise<ProfileDto> {
  if (!ctx.userId) throw new ForbiddenError();
  const [row] = await ctx.db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      title: user.title,
      timezone: user.timezone,
      createdAt: user.createdAt,
      role: member.role,
    })
    .from(user)
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, ctx.orgId)))
    .where(eq(user.id, ctx.userId))
    .limit(1);
  if (!row) throw new NotFoundError('User');
  const meta = await readOrgMetadata(ctx.db, ctx.orgId);
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      title: row.title,
      timezone: row.timezone,
      createdAt: row.createdAt.toISOString(),
    },
    role: decodeMemberRole(row.role).role,
    prefs: profileFor(meta, row.id),
  };
}

const PREF_KEYS = [
  'phone',
  'location',
  'locale',
  'dateFormat',
  'weekStart',
  'timeFormat',
  'theme',
  'emailDigest',
  'quietHours',
] as const;

export async function updateProfile(ctx: ServiceContext, input: UpdateProfileInput): Promise<ProfileDto> {
  const userId = ctx.userId;
  if (!userId) throw new ForbiddenError();
  if (input.timezone && !isValidTimezone(input.timezone)) throw new BadRequestError('Unknown time zone');

  const columns: Partial<{ name: string; title: string | null; timezone: string | null; image: string | null }> = {};
  if (input.name !== undefined) columns.name = input.name;
  if (input.title !== undefined) columns.title = input.title || null;
  if (input.timezone !== undefined) columns.timezone = input.timezone || null;
  if (input.image !== undefined) columns.image = input.image;
  if (Object.keys(columns).length > 0) {
    await ctx.db.update(user).set({ ...columns, updatedAt: new Date() }).where(eq(user.id, userId));
  }

  const prefPatch: Partial<Record<string, unknown>> = {};
  for (const key of PREF_KEYS) {
    if (input[key] !== undefined) prefPatch[key] = key === 'phone' || key === 'location' ? input[key] || null : input[key];
  }
  if (Object.keys(prefPatch).length > 0 || input.notifications) {
    await updateOrgMetadata(ctx, (meta) => {
      const current: ProfilePrefs = profileFor(meta, userId);
      const notifications = { ...current.notifications };
      for (const [event, channels] of Object.entries(input.notifications ?? {})) {
        const existing = notifications[event] ?? { inApp: true, email: false };
        notifications[event] = { ...existing, ...channels };
      }
      const next = { ...current, ...prefPatch, notifications } as ProfilePrefs;
      return { ...meta, profiles: { ...meta.profiles, [userId]: next } };
    });
  }
  return getProfile(ctx);
}

/** Count members by decoded status (used by usage and tests). */
export async function memberRoleRows(executor: Executor, orgId: string) {
  return executor
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, orgId));
}

export const __test = { policyCache };
