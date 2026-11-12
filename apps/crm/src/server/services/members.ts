/**
 * Organization members, invitations and teams. Operates on the Better Auth tables so that
 * Better Auth's own invitation acceptance flow (`/api/auth/organization/accept-invitation`)
 * works with invitations created here.
 */
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { invitation, member, team, teamMember, user } from '@/server/db/schema';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { canManageRole, ORG_ROLES, parseRoles, primaryRole, type OrgRole } from '@/server/rbac';
import { inTransaction, type ServiceContext } from './context';
import { assertInviteEmailAllowed } from './admin-org';
import type { InvitationDto, MemberDto, TeamDto } from './contracts/dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const roleSchema = z.enum(ORG_ROLES);

export const updateMemberSchema = z.object({ role: roleSchema });
export const createInvitationSchema = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  role: roleSchema.default('member'),
  teamId: z.uuid().optional(),
});
export const bulkInvitationSchema = z.object({ invitations: z.array(createInvitationSchema).min(1).max(50) });
export const teamSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const teamMembersSchema = z.object({ userIds: z.array(z.uuid()).min(1).max(500) });

function actorRole(ctx: ServiceContext): OrgRole {
  const role = primaryRole([...ctx.roles]);
  if (!role) throw new ForbiddenError();
  return role;
}

export async function listMembers(ctx: ServiceContext): Promise<MemberDto[]> {
  const rows = await ctx.db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      title: user.title,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name));
  const teamRows = rows.length
    ? await ctx.db
        .select({ userId: teamMember.userId, teamId: teamMember.teamId })
        .from(teamMember)
        .innerJoin(team, eq(team.id, teamMember.teamId))
        .where(eq(team.organizationId, ctx.orgId))
    : [];
  const teamsByUser = new Map<string, string[]>();
  for (const row of teamRows)
    teamsByUser.set(row.userId, [...(teamsByUser.get(row.userId) ?? []), row.teamId]);
  return rows.map((row) => ({
    memberId: row.memberId,
    userId: row.userId,
    name: row.name,
    email: row.email,
    image: row.image,
    title: row.title,
    role: primaryRole(parseRoles(row.role)) ?? 'guest',
    teamIds: teamsByUser.get(row.userId) ?? [],
    joinedAt: row.joinedAt.toISOString(),
  }));
}

async function requireMember(ctx: ServiceContext, memberId: string) {
  const [row] = await ctx.db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Member');
  return { row, role: primaryRole(parseRoles(row.role)) ?? 'guest' };
}

async function ownerCount(ctx: ServiceContext): Promise<number> {
  const rows = await ctx.db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, ctx.orgId));
  return rows.filter((row) => parseRoles(row.role).includes('owner')).length;
}

export async function updateMemberRole(
  ctx: ServiceContext,
  memberId: string,
  role: OrgRole,
): Promise<MemberDto> {
  return inTransaction(ctx, async (tx) => {
    const actor = actorRole(tx);
    const target = await requireMember(tx, memberId);
    if (
      target.row.userId === tx.userId &&
      role !== target.role &&
      target.role === 'owner' &&
      (await ownerCount(tx)) <= 1
    ) {
      throw new BadRequestError('Assign another owner before changing your own role');
    }
    if (!canManageRole(actor, target.role) || !canManageRole(actor, role)) {
      throw new ForbiddenError('You cannot assign or change this role');
    }
    if (target.role === 'owner' && role !== 'owner' && (await ownerCount(tx)) <= 1) {
      throw new BadRequestError('An organization must keep at least one owner');
    }
    await tx.db.update(member).set({ role }).where(eq(member.id, memberId));
    const [dto] = (await listMembers(tx)).filter((entry) => entry.memberId === memberId);
    if (!dto) throw new NotFoundError('Member');
    return dto;
  });
}

export async function removeMember(ctx: ServiceContext, memberId: string): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    const actor = actorRole(tx);
    const target = await requireMember(tx, memberId);
    const isSelf = target.row.userId === tx.userId;
    if (!isSelf && !canManageRole(actor, target.role))
      throw new ForbiddenError('You cannot remove this member');
    if (target.role === 'owner' && (await ownerCount(tx)) <= 1)
      throw new BadRequestError('An organization must keep at least one owner');
    await tx.db.delete(member).where(eq(member.id, memberId));
    const orgTeams = await tx.db.select({ id: team.id }).from(team).where(eq(team.organizationId, tx.orgId));
    if (orgTeams.length > 0) {
      await tx.db.delete(teamMember).where(
        and(
          eq(teamMember.userId, target.row.userId),
          inArray(
            teamMember.teamId,
            orgTeams.map((entry) => entry.id),
          ),
        ),
      );
    }
    return { id: memberId };
  });
}

function toInvitationDto(row: typeof invitation.$inferSelect): InvitationDto {
  return {
    id: row.id,
    email: row.email,
    role: primaryRole(parseRoles(row.role)) ?? 'member',
    teamId: row.teamId,
    status: row.status,
    inviterId: row.inviterId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listInvitations(ctx: ServiceContext): Promise<InvitationDto[]> {
  const rows = await ctx.db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, ctx.orgId), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt));
  return rows.map(toInvitationDto);
}

export async function createInvitation(
  ctx: ServiceContext,
  input: z.infer<typeof createInvitationSchema>,
): Promise<InvitationDto> {
  return inTransaction(ctx, async (tx) => {
    if (!tx.userId) throw new ForbiddenError();
    const actor = actorRole(tx);
    if (!canManageRole(actor, input.role))
      throw new ForbiddenError('You cannot invite people with this role');
    await assertInviteEmailAllowed(tx, input.email);
    const [existingMember] = await tx.db
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, tx.orgId), sql`lower(${user.email}) = ${input.email}`))
      .limit(1);
    if (existingMember) throw new ConflictError('This person is already a member');
    if (input.teamId) await requireTeam(tx, input.teamId);
    await tx.db
      .update(invitation)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(invitation.organizationId, tx.orgId),
          eq(invitation.email, input.email),
          eq(invitation.status, 'pending'),
        ),
      );
    const [row] = await tx.db
      .insert(invitation)
      .values({
        organizationId: tx.orgId,
        email: input.email,
        role: input.role,
        teamId: input.teamId ?? null,
        status: 'pending',
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        inviterId: tx.userId,
      })
      .returning();
    if (!row) throw new Error('Invitation insert returned no row');
    return toInvitationDto(row);
  });
}

export async function revokeInvitation(ctx: ServiceContext, invitationId: string): Promise<{ id: string }> {
  const updated = await ctx.db
    .update(invitation)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.organizationId, ctx.orgId),
        eq(invitation.status, 'pending'),
      ),
    )
    .returning({ id: invitation.id });
  if (updated.length === 0) throw new NotFoundError('Invitation');
  return { id: invitationId };
}

// Teams ---------------------------------------------------------------------------------------

async function requireTeam(ctx: ServiceContext, teamId: string) {
  const [row] = await ctx.db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Team');
  return row;
}

export async function listTeams(ctx: ServiceContext): Promise<TeamDto[]> {
  const rows = await ctx.db
    .select()
    .from(team)
    .where(eq(team.organizationId, ctx.orgId))
    .orderBy(asc(team.name));
  if (rows.length === 0) return [];
  const memberships = await ctx.db
    .select({ teamId: teamMember.teamId, userId: teamMember.userId })
    .from(teamMember)
    .where(
      inArray(
        teamMember.teamId,
        rows.map((row) => row.id),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    memberIds: memberships.filter((entry) => entry.teamId === row.id).map((entry) => entry.userId),
    createdAt: row.createdAt.toISOString(),
  }));
}

async function refreshMemberCount(ctx: ServiceContext, teamId: string): Promise<void> {
  const [row] = await ctx.db.select({ total: count() }).from(teamMember).where(eq(teamMember.teamId, teamId));
  await ctx.db
    .update(team)
    .set({ memberCount: row?.total ?? 0, updatedAt: new Date() })
    .where(eq(team.id, teamId));
}

async function teamDto(ctx: ServiceContext, teamId: string): Promise<TeamDto> {
  const dto = (await listTeams(ctx)).find((entry) => entry.id === teamId);
  if (!dto) throw new NotFoundError('Team');
  return dto;
}

export async function createTeam(ctx: ServiceContext, name: string): Promise<TeamDto> {
  const [existing] = await ctx.db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.organizationId, ctx.orgId), sql`lower(${team.name}) = lower(${name})`))
    .limit(1);
  if (existing) throw new ConflictError('A team with this name already exists');
  const [row] = await ctx.db
    .insert(team)
    .values({ name, organizationId: ctx.orgId, createdAt: new Date() })
    .returning();
  if (!row) throw new Error('Team insert returned no row');
  return teamDto(ctx, row.id);
}

export async function renameTeam(ctx: ServiceContext, teamId: string, name: string): Promise<TeamDto> {
  await requireTeam(ctx, teamId);
  await ctx.db.update(team).set({ name, updatedAt: new Date() }).where(eq(team.id, teamId));
  return teamDto(ctx, teamId);
}

export async function deleteTeam(ctx: ServiceContext, teamId: string): Promise<{ id: string }> {
  await requireTeam(ctx, teamId);
  await ctx.db.delete(team).where(eq(team.id, teamId));
  return { id: teamId };
}

export async function addTeamMembers(
  ctx: ServiceContext,
  teamId: string,
  userIds: readonly string[],
): Promise<TeamDto> {
  return inTransaction(ctx, async (tx) => {
    await requireTeam(tx, teamId);
    const unique = [...new Set(userIds)];
    const found = await tx.db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, tx.orgId), inArray(member.userId, unique)));
    if (found.length !== unique.length)
      throw new BadRequestError('Team members must belong to the organization');
    const existing = await tx.db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), inArray(teamMember.userId, unique)));
    const present = new Set(existing.map((row) => row.userId));
    const toAdd = unique.filter((id) => !present.has(id));
    if (toAdd.length > 0) {
      await tx.db
        .insert(teamMember)
        .values(toAdd.map((userId) => ({ teamId, userId, createdAt: new Date() })));
    }
    await refreshMemberCount(tx, teamId);
    return teamDto(tx, teamId);
  });
}

export async function removeTeamMembers(
  ctx: ServiceContext,
  teamId: string,
  userIds: readonly string[],
): Promise<TeamDto> {
  return inTransaction(ctx, async (tx) => {
    await requireTeam(tx, teamId);
    await tx.db
      .delete(teamMember)
      .where(and(eq(teamMember.teamId, teamId), inArray(teamMember.userId, [...userIds])));
    await refreshMemberCount(tx, teamId);
    return teamDto(tx, teamId);
  });
}
