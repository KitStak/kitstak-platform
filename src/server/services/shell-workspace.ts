/**
 * Workspace overview extras (shell module): the explicit member list of a workspace with user
 * details. Org-scoped and visibility-checked through `requireWorkspace`.
 */
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { member, user, workspaceMembers } from '@/server/db/schema';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { requireWorkspace } from './access';
import { inTransaction, isOrgAdmin, type ServiceContext } from './context';

export interface WorkspaceMemberDto {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly title: string | null;
  readonly role: 'owner' | 'member';
}

export async function listWorkspaceMembers(ctx: ServiceContext, workspaceId: string): Promise<WorkspaceMemberDto[]> {
  await requireWorkspace(ctx, workspaceId);
  const rows = await ctx.db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      title: user.title,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.orgId, ctx.orgId), eq(workspaceMembers.workspaceId, workspaceId)))
    .orderBy(asc(user.name));
  return rows;
}

// ------------------------------------------------------------------ member writes (role-preserving)

export const workspaceRoleSchema = z.enum(['owner', 'member']);
export const addWorkspaceMemberSchema = z.object({ userId: z.uuid(), role: workspaceRoleSchema.default('member') });
export const updateWorkspaceMemberSchema = z.object({ role: workspaceRoleSchema });

/** True when the caller may manage this workspace's members: an org admin/owner or a workspace owner. */
export async function canManageWorkspaceMembers(ctx: ServiceContext, workspaceId: string): Promise<boolean> {
  if (ctx.userId === null || isOrgAdmin(ctx)) return true;
  const [row] = await ctx.db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.orgId, ctx.orgId),
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, ctx.userId),
      ),
    )
    .limit(1);
  return row?.role === 'owner';
}

async function requireMemberManager(tx: ServiceContext, workspaceId: string): Promise<void> {
  await requireWorkspace(tx, workspaceId);
  if (!(await canManageWorkspaceMembers(tx, workspaceId))) {
    throw new ForbiddenError('Only workspace owners and org admins can manage workspace members');
  }
}

async function announce(tx: ServiceContext, workspaceId: string): Promise<void> {
  await publish(tx.db, { type: 'workspace.changed', orgId: tx.orgId, ids: [workspaceId], actorId: tx.userId });
}

/** Adds one org member to a workspace (idempotent; an existing row keeps its role). */
export async function addWorkspaceMember(
  ctx: ServiceContext,
  workspaceId: string,
  input: z.infer<typeof addWorkspaceMemberSchema>,
): Promise<{ userId: string }> {
  return inTransaction(ctx, async (tx) => {
    await requireMemberManager(tx, workspaceId);
    const [orgMember] = await tx.db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, tx.orgId), eq(member.userId, input.userId)))
      .limit(1);
    if (!orgMember) throw new BadRequestError('That person is not a member of this organization');
    await tx.db
      .insert(workspaceMembers)
      .values({ orgId: tx.orgId, workspaceId, userId: input.userId, role: input.role })
      .onConflictDoNothing();
    await announce(tx, workspaceId);
    return { userId: input.userId };
  });
}

async function ownerCount(tx: ServiceContext, workspaceId: string): Promise<number> {
  const [row] = await tx.db
    .select({ value: count() })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.orgId, tx.orgId),
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, 'owner'),
      ),
    );
  return Number(row?.value ?? 0);
}

/** Switch a workspace member between owner and member. The last owner cannot be demoted. */
export async function updateWorkspaceMemberRole(
  ctx: ServiceContext,
  workspaceId: string,
  userId: string,
  input: z.infer<typeof updateWorkspaceMemberSchema>,
): Promise<{ userId: string; role: 'owner' | 'member' }> {
  return inTransaction(ctx, async (tx) => {
    await requireMemberManager(tx, workspaceId);
    const where = and(
      eq(workspaceMembers.orgId, tx.orgId),
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    );
    const [current] = await tx.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(where).limit(1);
    if (!current) throw new NotFoundError('Workspace member');
    if (current.role === 'owner' && input.role === 'member' && (await ownerCount(tx, workspaceId)) <= 1) {
      throw new BadRequestError('A workspace needs at least one owner');
    }
    await tx.db.update(workspaceMembers).set({ role: input.role, updatedAt: new Date() }).where(where);
    await announce(tx, workspaceId);
    return { userId, role: input.role };
  });
}

/** Removes one member (other rows and their roles are untouched). */
export async function removeWorkspaceMember(
  ctx: ServiceContext,
  workspaceId: string,
  userId: string,
): Promise<{ userId: string }> {
  return inTransaction(ctx, async (tx) => {
    await requireMemberManager(tx, workspaceId);
    const [current] = await tx.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.orgId, tx.orgId),
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!current) throw new NotFoundError('Workspace member');
    if (current.role === 'owner' && (await ownerCount(tx, workspaceId)) <= 1) {
      throw new BadRequestError('A workspace needs at least one owner');
    }
    const deleted = await tx.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.orgId, tx.orgId),
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .returning({ userId: workspaceMembers.userId });
    if (deleted.length === 0) throw new NotFoundError('Workspace member');
    await announce(tx, workspaceId);
    return { userId };
  });
}
