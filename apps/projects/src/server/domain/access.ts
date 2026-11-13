/**
 * Authoritative permission checks. Every domain read/write that touches a project goes through
 * `requireProject` / `requireTask` (or filters lists with `visibleProjectsWhere`). Rules live in
 * src/lib/permissions.ts (pure, unit tested).
 */
import 'server-only';
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { projectMembers, projects, tasks, type Project, type Task } from '@/server/db/schema';
import { forbidden, notFound } from '@/server/errors';
import {
  canOrg,
  canProject,
  effectiveProjectRole,
  projectCapabilities,
  type OrgAction,
  type ProjectAction,
} from '@/lib/permissions';
import type { ProjectRole } from '@/lib/constants';
import type { Capabilities } from '@/lib/types';
import type { DomainContext } from './_shared';

export interface ProjectAccess {
  readonly project: Project;
  readonly role: ProjectRole;
  readonly capabilities: Capabilities;
}

export interface TaskAccess extends ProjectAccess {
  readonly task: Task;
}

export type ProjectRefInput = { readonly id: string } | { readonly key: string };

export function requireOrg(ctx: DomainContext, action: OrgAction): void {
  if (!canOrg(ctx.orgRole, action)) throw forbidden();
}

async function memberRole(executor: Executor, projectId: string, userId: string): Promise<ProjectRole | null> {
  const [row] = await executor
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  return row?.role ?? null;
}

/** Role of the actor on a loaded project row (null = no access). */
export async function roleForProject(ctx: DomainContext, project: Project, executor: Executor = db): Promise<ProjectRole | null> {
  if (project.orgId !== ctx.orgId) return null;
  if (ctx.actorKind !== 'user') return 'owner';
  const explicit = await memberRole(executor, project.id, ctx.userId);
  return effectiveProjectRole({
    orgRole: ctx.orgRole,
    memberRole: explicit,
    visibility: project.visibility,
    isProjectOwner: project.ownerId === ctx.userId,
  });
}

async function loadProject(executor: Executor, ctx: DomainContext, ref: ProjectRefInput): Promise<Project | null> {
  const where =
    'id' in ref
      ? and(eq(projects.id, ref.id), eq(projects.orgId, ctx.orgId), isNull(projects.deletedAt))
      : and(eq(projects.key, ref.key.toUpperCase()), eq(projects.orgId, ctx.orgId), isNull(projects.deletedAt));
  const [row] = await executor.select().from(projects).where(where);
  return row ?? null;
}

/** Load a live project the actor can see, checking `action`. Throws NOT_FOUND / FORBIDDEN. */
export async function requireProject(
  ctx: DomainContext,
  ref: ProjectRefInput,
  action: ProjectAction = 'project:read',
  executor: Executor = db,
): Promise<ProjectAccess> {
  const project = await loadProject(executor, ctx, ref);
  if (!project) throw notFound('That project');
  const role = await roleForProject(ctx, project, executor);
  if (!role) throw notFound('That project');
  if (!canProject(role, action)) throw forbidden(forbiddenMessage(action));
  return { project, role, capabilities: projectCapabilities(role) };
}

/** Load a live task (and its project) the actor can see, checking `action`. */
export async function requireTask(
  ctx: DomainContext,
  taskId: string,
  action: ProjectAction = 'project:read',
  executor: Executor = db,
): Promise<TaskAccess> {
  const [task] = await executor
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, ctx.orgId), isNull(tasks.deletedAt)));
  if (!task) throw notFound('That task');
  const access = await requireProject(ctx, { id: task.projectId }, action, executor);
  return { ...access, task };
}

/**
 * WHERE fragment selecting the live projects the actor can see (lists, search, My Work).
 * Mirrors `effectiveProjectRole`: admins see everything; members/viewers see org-visible projects
 * plus private ones they belong to; guests only see projects they were added to.
 */
export function visibleProjectsWhere(ctx: DomainContext): SQL {
  const base = and(eq(projects.orgId, ctx.orgId), isNull(projects.deletedAt)) as SQL;
  if (ctx.actorKind !== 'user' || ctx.orgRole === 'owner' || ctx.orgRole === 'admin') return base;
  const isMember = sql`exists (select 1 from ${projectMembers} pm_m where pm_m.project_id = "pm"."projects"."id" and pm_m.user_id = ${ctx.userId})`;
  const access =
    ctx.orgRole === 'guest'
      ? or(isMember, eq(projects.ownerId, ctx.userId))
      : or(eq(projects.visibility, 'org'), isMember, eq(projects.ownerId, ctx.userId));
  return and(base, access) as SQL;
}

function forbiddenMessage(action: ProjectAction): string {
  switch (action) {
    case 'project:delete':
      return 'Only project owners can delete a project.';
    case 'project:manage_members':
      return 'Only project owners can change who is on this project.';
    case 'comment:create':
    case 'file:upload':
      return 'You can view this project but not comment on it.';
    default:
      return 'You can view this project but not change it. Ask a project owner for edit access.';
  }
}
