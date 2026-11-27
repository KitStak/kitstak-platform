/**
 * Program access (docs/programs/SPEC.md 8.1, A10): `requireProgram` loads a `kind = 'program'`
 * container the actor can see; `programCapabilities` resolves what the actor may do, including
 * `money:read`, which only an explicit membership at or above the program's `money_min_role`
 * passes (org owners and admins always pass; the implicit org role never does).
 */
import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { programSettings, projectMembers, projects, type Project, type ProgramSettingsRow } from '@/server/db/schema';
import { forbidden } from '@/server/errors';
import { canProject, canReadMoney, canSeeSync, type ProjectAction } from '@/lib/permissions';
import type { ProjectRole } from '@/lib/constants';
import type { ProgramCapabilities } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { requireProject, type ProjectAccess, type ProjectRefInput } from '../access';
import { loadSettings } from './_program';

export interface ProgramAccess extends ProjectAccess {
  readonly settings: ProgramSettingsRow;
  readonly program: Project;
  readonly caps: ProgramCapabilities;
}

function refOf(keyOrId: string | ProjectRefInput): ProjectRefInput {
  if (typeof keyOrId !== 'string') return keyOrId;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keyOrId) ? { id: keyOrId } : { key: keyOrId };
}

async function explicitRole(executor: Executor, projectId: string, userId: string): Promise<ProjectRole | null> {
  const [row] = await executor
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  return row?.role ?? null;
}

/** Whether the actor sees money on this program (A10). Non user actors act as owner. */
export function seesMoney(ctx: DomainContext, program: Pick<Project, 'ownerId'>, settings: Pick<ProgramSettingsRow, 'moneyMinRole'>, memberRole: ProjectRole | null): boolean {
  if (ctx.actorKind !== 'user') return true;
  return canReadMoney({ orgRole: ctx.orgRole, memberRole, isProjectOwner: program.ownerId === ctx.userId, moneyMinRole: settings.moneyMinRole });
}

export function capabilitiesFor(ctx: DomainContext, program: Pick<Project, 'ownerId'>, settings: Pick<ProgramSettingsRow, 'moneyMinRole'>, role: ProjectRole, memberRole: ProjectRole | null): ProgramCapabilities {
  const can = (action: ProjectAction) => canProject(role, action);
  return {
    canEdit: can('project:update'),
    canPlan: can('build:plan'),
    canLog: can('output:log'),
    canPropose: can('pricing:propose'),
    canPrice: can('pricing:manage'),
    canManage: can('project:manage_members'),
    canClose: can('program:close'),
    seesMoney: seesMoney(ctx, program, settings, memberRole),
    seesSync: ctx.actorKind !== 'user' || canSeeSync({ orgRole: ctx.orgRole, role }),
  };
}

/** Loads a live program the actor can see and checks `action`. NOT_FOUND for projects. */
export async function requireProgram(
  ctx: DomainContext,
  keyOrId: string | ProjectRefInput,
  action: ProjectAction = 'project:read',
  executor: Executor = db,
): Promise<ProgramAccess> {
  const access = await requireProject(ctx, refOf(keyOrId), action === 'money:read' ? 'project:read' : action, executor, { kind: 'program' });
  const [settings, memberRole] = await Promise.all([
    loadSettings(executor, access.project.id),
    ctx.actorKind === 'user' ? explicitRole(executor, access.project.id, ctx.userId) : Promise.resolve(null),
  ]);
  const caps = capabilitiesFor(ctx, access.project, settings, access.role, memberRole);
  if (action === 'money:read' && !caps.seesMoney) throw forbidden('Money is hidden for your role.');
  return { ...access, program: access.project, settings, caps };
}

/** Program capabilities for a loaded program. */
export async function programCapabilities(ctx: DomainContext, program: Project, settings: ProgramSettingsRow, role: ProjectRole, executor: Executor = db): Promise<ProgramCapabilities> {
  const memberRole = ctx.actorKind === 'user' ? await explicitRole(executor, program.id, ctx.userId) : null;
  return capabilitiesFor(ctx, program, settings, role, memberRole);
}

/** Throws FORBIDDEN unless the actor sees money (statements, CSV, PDF, reports with charges). */
export function assertMoney(access: Pick<ProgramAccess, 'caps'>): void {
  if (!access.caps.seesMoney) throw forbidden('Money is hidden for your role.');
}

/**
 * Batch money check for activity and lists: which of `programIds` the actor may see money on.
 * Ids that are not programs are left out of the answer (callers treat them as "no money keys").
 */
export async function seesMoneyFor(ctx: DomainContext, programIds: readonly string[], executor: Executor = db): Promise<Set<string>> {
  const ids = [...new Set(programIds)];
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const rows = await executor
    .select({ id: projects.id, ownerId: projects.ownerId, moneyMinRole: programSettings.moneyMinRole })
    .from(projects)
    .innerJoin(programSettings, eq(programSettings.programId, projects.id))
    .where(and(eq(projects.orgId, ctx.orgId), inArray(projects.id, ids), eq(projects.kind, 'program')));
  if (ctx.actorKind !== 'user' || ctx.orgRole === 'owner' || ctx.orgRole === 'admin') {
    for (const row of rows) out.add(row.id);
    return out;
  }
  const members = await executor
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(and(inArray(projectMembers.projectId, ids), eq(projectMembers.userId, ctx.userId)));
  const roleOf = new Map(members.map((row) => [row.projectId, row.role]));
  for (const row of rows) {
    if (seesMoney(ctx, row, row, roleOf.get(row.id) ?? null)) out.add(row.id);
  }
  return out;
}

/** The ids among `projectIds` that are programs (for activity money stripping). */
export async function programIdsAmong(ctx: DomainContext, projectIds: readonly string[], executor: Executor = db): Promise<Set<string>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Set();
  const rows = await executor
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, ctx.orgId), inArray(projects.id, ids), eq(projects.kind, 'program')));
  return new Set(rows.map((row) => row.id));
}
