/**
 * Crew roles for the people of a workspace (docs/crew/SPEC.md 3.1) and the claim step, the same as
 * Pulse: if nobody resolves to owner, the first admin who opens Crew is offered "Run Crew for this
 * workspace"; if there is no admin, any member is offered it.
 */
import 'server-only';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { member, user } from '@kitstak/db/schema';
import { resolveRole, type CrewAccess } from '@kitstak/crew-bridge';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { memberRoles, sites } from '@/server/db/schema';
import { forbidden, invalid, notFound } from '@/server/errors';
import { assignableRoles, canCrew, isCrewRole, parseOrgRole, type CrewRole, type OrgRole } from '@/lib/permissions';
import { inTx, type DomainContext } from './_shared';
import { logActivity } from './activity';
import { ensureSetup, loadSettings } from './settings';

export interface OrgMember {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly orgRole: OrgRole;
  readonly access: CrewAccess;
}

/** Everyone in the org with their resolved Crew access (one read per table, no query per person). */
export const listMemberAccess = scoped(async function listMemberAccess(ctx: DomainContext, executor: Executor = db): Promise<OrgMember[]> {
  const settings = await loadSettings(ctx.orgId, executor);
  const members = await executor
    .select({ userId: member.userId, role: member.role, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name));
  const explicit = await executor.select().from(memberRoles).where(eq(memberRoles.orgId, ctx.orgId));
  const byUser = new Map(explicit.map((row) => [row.userId, row]));
  const out: OrgMember[] = [];
  for (const row of members) {
    const orgRole = parseOrgRole(row.role);
    if (!orgRole) continue;
    const mine = byUser.get(row.userId);
    const access = resolveRole({ explicit: mine ? { role: mine.role, siteIds: mine.siteIds } : null, orgRole, defaultMemberRole: settings.defaultMemberRole });
    out.push({ userId: row.userId, name: row.name, email: row.email, orgRole, access });
  }
  return out;
});

export interface RunCrewState {
  readonly hasOwner: boolean;
  /** May this person take "Run Crew for this workspace" right now? */
  readonly canClaim: boolean;
  readonly ownerNames: readonly string[];
}

/** The claim rule as one pure function, so it is tested on its own. */
export function claimState(members: readonly Pick<OrgMember, 'userId' | 'name' | 'orgRole' | 'access'>[], userId: string): RunCrewState {
  const owners = members.filter((entry) => entry.access.role === 'owner');
  const admins = members.filter((entry) => entry.orgRole === 'owner' || entry.orgRole === 'admin');
  const me = members.find((entry) => entry.userId === userId);
  const canClaim = owners.length === 0 && Boolean(me) && (me!.orgRole === 'admin' || (admins.length === 0 && me!.orgRole === 'member'));
  return { hasOwner: owners.length > 0, canClaim, ownerNames: owners.map((entry) => entry.name) };
}

/** Is there a Crew owner yet, and may this person take the job? Open to every member (it gates the welcome screen). */
export const whoRunsCrew = scoped(async function whoRunsCrew(ctx: DomainContext): Promise<RunCrewState> {
  return claimState(await listMemberAccess(ctx), ctx.userId);
});

/** "Run Crew for this workspace": an explicit owner row for the caller when nobody owns Crew yet. */
export const claimCrewOwnership = scoped(async function claimCrewOwnership(ctx: DomainContext, options: { readonly timezone?: string } = {}): Promise<CrewAccess> {
  return inTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crew-owner:${ctx.orgId}`}))`);
    const members = await listMemberAccess(ctx, tx);
    const state = claimState(members, ctx.userId);
    if (!state.canClaim) throw forbidden(state.hasOwner ? 'Someone already runs Crew for this workspace. Ask them for a role.' : 'Ask an admin of your workspace to set up Crew.');
    const before = members.find((entry) => entry.userId === ctx.userId)!;
    await ensureSetup(ctx.orgId, options, tx);
    await tx
      .insert(memberRoles)
      .values({ orgId: ctx.orgId, userId: ctx.userId, role: 'owner', updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { role: 'owner', siteIds: null, updatedBy: ctx.userId, updatedAt: new Date() } });
    await logActivity(tx, ctx, { verb: 'role.changed', entityType: 'member_role', entityId: ctx.userId, before: { role: before.access.role }, after: { role: 'owner' }, meta: { claimed: true } });
    const after = (await listMemberAccess(ctx, tx)).find((entry) => entry.userId === ctx.userId)!;
    return after.access;
  });
});

export interface SetRoleInput {
  readonly userId: string;
  readonly role: CrewRole;
  /** Only for supervisor and lead. Null or empty means all sites. */
  readonly siteIds?: readonly string[] | null;
}

/**
 * People and roles (SPEC 3.1, 6.1 Settings): an explicit Crew role for one member. Needs
 * `roles:manage`. Only an owner makes or removes an owner, and the last owner stays.
 */
export const setMemberRole = scoped(async function setMemberRole(ctx: DomainContext, input: SetRoleInput): Promise<CrewAccess> {
  return inTx(async (tx) => {
    const members = await listMemberAccess(ctx, tx);
    const me = members.find((entry) => entry.userId === ctx.userId);
    const actorRole = ctx.actorKind === 'user' ? (me?.access.role ?? 'none') : 'owner';
    if (!canCrew(actorRole, 'roles:manage')) throw forbidden('Your Crew role cannot change roles.');
    if (!isCrewRole(input.role)) throw invalid('Pick a role.', { role: 'Pick a role.' });
    if (!assignableRoles(actorRole).includes(input.role)) throw forbidden('Only an owner can make someone an owner.');
    const target = members.find((entry) => entry.userId === input.userId);
    if (!target) throw notFound('That member');
    if (target.access.role === 'owner' && actorRole !== 'owner') throw forbidden('Only an owner can change the role of an owner.');
    if (target.access.role === 'owner' && input.role !== 'owner' && members.filter((entry) => entry.access.role === 'owner').length <= 1) {
      throw forbidden('Crew needs at least one owner. Make someone else the owner first.');
    }
    const scopedRole = input.role === 'supervisor' || input.role === 'lead';
    const siteIds = scopedRole && input.siteIds && input.siteIds.length > 0 ? [...new Set(input.siteIds)] : null;
    if (siteIds) {
      const found = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.orgId, ctx.orgId), inArray(sites.id, siteIds), isNull(sites.deletedAt)));
      if (found.length !== siteIds.length) throw invalid('One of those sites is not open.', { siteIds: 'Pick open sites.' });
    }
    await tx
      .insert(memberRoles)
      .values({ orgId: ctx.orgId, userId: input.userId, role: input.role, siteIds, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { role: input.role, siteIds, updatedBy: ctx.userId, updatedAt: new Date() } });
    await logActivity(tx, ctx, { verb: 'role.changed', entityType: 'member_role', entityId: input.userId, before: { role: target.access.role, siteIds: target.access.siteIds }, after: { role: input.role, siteIds } });
    const after = (await listMemberAccess(ctx, tx)).find((entry) => entry.userId === input.userId)!;
    return after.access;
  });
});

/** Members with their Crew access, for People and roles. Needs `roles:manage`. */
export const listRoles = scoped(async function listRoles(ctx: DomainContext): Promise<OrgMember[]> {
  const members = await listMemberAccess(ctx);
  const me = members.find((entry) => entry.userId === ctx.userId);
  if (!canCrew(me?.access.role ?? 'none', 'roles:manage')) throw forbidden('Your Crew role cannot change roles.');
  return members;
});
