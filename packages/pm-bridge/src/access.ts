import { sql, type SQL } from 'drizzle-orm';
import { pmAvailability, queryOne, type BridgeExecutor } from './executor';
import { effectiveProjectRole, isProjectRole, parseOrgRole, type OrgRole, type ProjectRole } from './permissions';
import type { BridgeActor } from './types';

export type BridgeErrorCode = 'UNAVAILABLE' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION';

/** Plain-language error the host app can show as is (`message`) and map to an HTTP status (`code`). */
export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly fields?: Readonly<Record<string, string>>;
  constructor(code: BridgeErrorCode, message: string, fields?: Readonly<Record<string, string>>) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.fields = fields;
  }
}

export function isBridgeError(error: unknown): error is BridgeError {
  return error instanceof Error && error.name === 'BridgeError' && 'code' in error;
}

/** The actor's org role from core.member (null = not a member / deactivated). */
export async function orgRoleOf(db: BridgeExecutor, actor: BridgeActor): Promise<OrgRole | null> {
  const row = await queryOne<{ role: string | null }>(
    db,
    sql`select role from core.member where organization_id = ${actor.orgId}::uuid and user_id = ${actor.userId}::uuid limit 1`,
  );
  return parseOrgRole(row?.role ?? null);
}

/**
 * WHERE fragment for projects (alias `p`) the actor can see; mirrors Projects'
 * `visibleProjectsWhere`.
 */
export function visibleProjects(role: OrgRole, userId: string): SQL {
  const base = sql`p.deleted_at is null`;
  if (role === 'owner' || role === 'admin') return base;
  const member = sql`exists (select 1 from pm.project_members vm where vm.project_id = p.id and vm.user_id = ${userId}::uuid)`;
  if (role === 'guest') return sql`${base} and (${member} or p.owner_id = ${userId}::uuid)`;
  return sql`${base} and (p.visibility = 'org' or ${member} or p.owner_id = ${userId}::uuid)`;
}

export interface ProjectRow {
  readonly id: string;
  readonly org_id: string;
  readonly key: string;
  readonly name: string;
  readonly visibility: string;
  readonly owner_id: string | null;
  readonly archived: boolean;
  readonly is_template: boolean;
  readonly member_role: string | null;
  /** `project` or `program` (always `project` on a database older than Projects 0006). */
  readonly kind: 'project' | 'program';
}

/** Loads a live project in the actor's org and the actor's effective role on it. */
export async function projectAccess(
  db: BridgeExecutor,
  actor: BridgeActor,
  projectId: string,
  orgRole?: OrgRole | null,
): Promise<{ project: ProjectRow; role: ProjectRole | null }> {
  const role = orgRole === undefined ? await orgRoleOf(db, actor) : orgRole;
  const { kinds } = await pmAvailability(db);
  const project = await queryOne<ProjectRow>(
    db,
    sql`select p.id, p.org_id, p.key, p.name, p.visibility, p.owner_id, p.archived_at is not null as archived, p.is_template,
               ${kinds ? sql`p.kind` : sql`'project'`} as kind,
               (select m.role from pm.project_members m where m.project_id = p.id and m.user_id = ${actor.userId}::uuid) as member_role
          from pm.projects p
         where p.id = ${projectId}::uuid and p.org_id = ${actor.orgId}::uuid and p.deleted_at is null`,
  );
  if (!project) throw new BridgeError('NOT_FOUND', 'That project no longer exists.');
  const effective = effectiveProjectRole({
    orgRole: role,
    memberRole: isProjectRole(project.member_role) ? project.member_role : null,
    visibility: project.visibility,
    isProjectOwner: project.owner_id === actor.userId,
  });
  if (!effective) throw new BridgeError('NOT_FOUND', 'That project no longer exists.');
  return { project, role: effective };
}
