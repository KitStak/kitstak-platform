/**
 * Admin center → Users: directory with status + last activity, bulk role / deactivate /
 * reactivate, invitation resend, and CSV export. Role changes reuse `members.updateMemberRole`
 * so the "keep one owner" and "cannot manage a higher role" rules stay in one place.
 */
import 'server-only';
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { invitation, member, session, team, teamMember, user } from '@/server/db/schema';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { canManageRole, primaryRole, type OrgRole } from '@/server/rbac';
import { inTransaction, type ServiceContext } from './context';
import { createInvitation, updateMemberRole } from './members';
import { assertMayChangeBillingManager, assertSeatAvailable } from './seat-limit';
import type {
  AdminInvitationDto,
  AdminUserDto,
  AdminUsersDto,
  BulkResultDto,
  BulkUsersInput,
} from './admin-contracts';
import { decodeMemberRole, encodeDeactivatedRole, toCsv } from './admin-policy';

function actorRole(ctx: ServiceContext): OrgRole {
  const role = primaryRole([...ctx.roles]);
  if (!role) throw new ForbiddenError();
  return role;
}

export async function listAdminUsers(ctx: ServiceContext): Promise<AdminUsersDto> {
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
    .limit(5000);
  const userIds = rows.map((row) => row.userId);
  const [teamRows, activity, invites] = await Promise.all([
    userIds.length
      ? ctx.db
          .select({ userId: teamMember.userId, teamId: teamMember.teamId })
          .from(teamMember)
          .innerJoin(team, eq(team.id, teamMember.teamId))
          .where(eq(team.organizationId, ctx.orgId))
      : Promise.resolve([]),
    userIds.length
      ? ctx.db
          .select({ userId: session.userId, last: max(session.updatedAt) })
          .from(session)
          .where(inArray(session.userId, userIds))
          .groupBy(session.userId)
      : Promise.resolve([]),
    ctx.db
      .select({ entry: invitation, inviterName: user.name })
      .from(invitation)
      .leftJoin(user, eq(user.id, invitation.inviterId))
      .where(and(eq(invitation.organizationId, ctx.orgId), eq(invitation.status, 'pending')))
      .orderBy(desc(invitation.createdAt)),
  ]);
  const teamsByUser = new Map<string, string[]>();
  for (const row of teamRows) teamsByUser.set(row.userId, [...(teamsByUser.get(row.userId) ?? []), row.teamId]);
  const lastByUser = new Map(activity.map((row) => [row.userId, row.last]));
  const now = Date.now();
  const users: AdminUserDto[] = rows
    .map((row) => {
      const decoded = decodeMemberRole(row.role);
      const last = lastByUser.get(row.userId);
      return {
        memberId: row.memberId,
        userId: row.userId,
        name: row.name,
        email: row.email,
        image: row.image,
        title: row.title,
        role: decoded.role,
        status: decoded.deactivated ? ('deactivated' as const) : ('active' as const),
        teamIds: teamsByUser.get(row.userId) ?? [],
        joinedAt: row.joinedAt.toISOString(),
        lastActiveAt: last ? new Date(last).toISOString() : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const invitations: AdminInvitationDto[] = invites.map(({ entry, inviterName }) => ({
    id: entry.id,
    email: entry.email,
    role: decodeMemberRole(entry.role ?? 'member').role,
    inviterName,
    expiresAt: entry.expiresAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    expired: entry.expiresAt.getTime() < now,
  }));
  return { users, invitations };
}

async function loadMember(ctx: ServiceContext, memberId: string) {
  const [row] = await ctx.db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Member');
  return { ...row, decoded: decodeMemberRole(row.role) };
}

async function activeOwnerCount(ctx: ServiceContext): Promise<number> {
  const rows = await ctx.db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, ctx.orgId));
  return rows.filter((row) => {
    const decoded = decodeMemberRole(row.role);
    return !decoded.deactivated && decoded.role === 'owner';
  }).length;
}

export async function setMemberActive(ctx: ServiceContext, memberId: string, active: boolean): Promise<void> {
  await inTransaction(ctx, async (tx) => {
    const actor = actorRole(tx);
    const target = await loadMember(tx, memberId);
    if (target.userId === tx.userId) throw new BadRequestError("You can't deactivate yourself");
    if (!canManageRole(actor, target.decoded.role)) {
      throw new ForbiddenError('You cannot change the status of someone with this role');
    }
    if (active === !target.decoded.deactivated) return; // already in the requested state
    if (!active && target.decoded.role === 'owner' && (await activeOwnerCount(tx)) <= 1) {
      throw new BadRequestError('An organization must keep at least one active owner');
    }
    // Deactivating a billing manager takes the billing role away, which only an owner may do.
    if (!active) await assertMayChangeBillingManager(tx, { userId: target.userId, role: target.role });
    // A deactivated member uses no seat. Turning them back on needs a free seat on the plan.
    if (active) await assertSeatAvailable(tx, { role: target.decoded.role });
    const role = active ? target.decoded.role : encodeDeactivatedRole(target.decoded.role);
    await tx.db.update(member).set({ role }).where(eq(member.id, memberId));
  });
}

function reasonOf(error: unknown): string {
  return error instanceof AppError ? error.message : 'Something went wrong';
}

export async function bulkUpdateUsers(ctx: ServiceContext, input: BulkUsersInput): Promise<BulkResultDto> {
  const updated: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const memberId of [...new Set(input.memberIds)]) {
    try {
      if (input.action === 'set_role') {
        const target = await loadMember(ctx, memberId);
        if (target.decoded.deactivated) throw new BadRequestError('Reactivate this member before changing their role');
        await updateMemberRole(ctx, memberId, input.role as OrgRole);
      } else {
        await setMemberActive(ctx, memberId, input.action === 'reactivate');
      }
      updated.push(memberId);
    } catch (error) {
      failed.push({ id: memberId, reason: reasonOf(error) });
    }
  }
  return { updated, failed };
}

export async function resendInvitation(ctx: ServiceContext, invitationId: string): Promise<AdminInvitationDto> {
  const [row] = await ctx.db
    .select()
    .from(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, ctx.orgId), eq(invitation.status, 'pending')))
    .limit(1);
  if (!row) throw new NotFoundError('Invitation');
  // createInvitation cancels the pending invite and issues a fresh one with a new expiry.
  const fresh = await createInvitation(ctx, {
    email: row.email,
    role: decodeMemberRole(row.role ?? 'member').role,
    teamId: row.teamId ?? undefined,
  });
  const [inviter] = await ctx.db.select({ name: user.name }).from(user).where(eq(user.id, fresh.inviterId)).limit(1);
  return {
    id: fresh.id,
    email: fresh.email,
    role: fresh.role,
    inviterName: inviter?.name ?? null,
    expiresAt: fresh.expiresAt,
    createdAt: fresh.createdAt,
    expired: false,
  };
}

export async function exportUsersCsv(ctx: ServiceContext): Promise<{ csv: string; count: number }> {
  const { users, invitations } = await listAdminUsers(ctx);
  const teams = await ctx.db
    .select({ id: team.id, name: team.name })
    .from(team)
    .where(eq(team.organizationId, ctx.orgId));
  const teamName = new Map(teams.map((entry) => [entry.id, entry.name]));
  const rows = [
    ...users.map((entry) => [
      entry.name,
      entry.email,
      entry.title ?? '',
      entry.role,
      entry.status,
      entry.teamIds.map((id) => teamName.get(id) ?? id).join('; '),
      entry.joinedAt,
      entry.lastActiveAt ?? '',
    ]),
    ...invitations.map((entry) => [
      '',
      entry.email,
      '',
      entry.role,
      entry.expired ? 'invite expired' : 'invited',
      '',
      entry.createdAt,
      '',
    ]),
  ];
  return {
    csv: toCsv(['Name', 'Email', 'Title', 'Role', 'Status', 'Teams', 'Joined', 'Last active'], rows),
    count: rows.length,
  };
}
