/**
 * Projects: directory listing with progress, detail, create (blank or from template),
 * update, archive/restore, soft delete/restore, duplicate, members and stars.
 */
import 'server-only';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { customers } from '@kitstak/db/schema';
import { db, type Executor } from '@/server/db';
import {
  customFields,
  favorites,
  orgCalendar,
  programSettings,
  labels,
  milestones,
  projectMembers,
  projects,
  sections,
  spaces,
  statuses,
  tasks,
  type Project,
} from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { sanitizeRichText } from '@/server/sanitize';
import {
  DEFAULT_PROGRAM_STATUSES,
  DEFAULT_PROGRAM_TIMEZONE,
  DEFAULT_STATUSES,
  PROJECT_KEY_PATTERN,
  type ProjectKind,
  type ProjectHealth,
  type ProjectRole,
  type ProjectStatus,
  type ProjectVisibility,
} from '@/lib/constants';
import { isIsoDate, todayIso } from '@/lib/dates';
import { projectCapabilities } from '@/lib/permissions';
import { rankAfter, ranksBetween } from '@/lib/rank';
import { suggestProjectKey } from '@/lib/task-key';
import type { MilestoneDTO, ProjectDetail, ProjectMemberDTO, ProjectSummary } from '@/lib/types';
import {
  cleanText,
  iso,
  isoRequired,
  toCustomFieldDTO,
  toLabelDTO,
  toSectionDTO,
  toStatusDTO,
  type DomainContext,
} from './_shared';
import { requireOrg, requireProject, roleForProject, visibleProjectsWhere, type KindFilter } from './access';
import { logActivity } from './activity';
import { notify } from './notifications';
import { getPeople, isOrgMember } from './people';
import { setFavorite } from './prefs';

// --- Progress -------------------------------------------------------------------------------

interface ProgressRow {
  projectId: string;
  total: number;
  done: number;
  overdue: number;
}

async function progressFor(projectIds: readonly string[], executor: Executor = db): Promise<Map<string, ProgressRow>> {
  if (projectIds.length === 0) return new Map();
  const today = todayIso();
  const rows = await executor
    .select({
      projectId: tasks.projectId,
      total: sql<number>`count(*) filter (where ${statuses.category} <> 'cancelled')::int`,
      done: sql<number>`count(*) filter (where ${statuses.category} = 'done')::int`,
      overdue: sql<number>`count(*) filter (where ${statuses.category} not in ('done', 'cancelled') and ${tasks.dueDate} < ${today})::int`,
    })
    .from(tasks)
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .where(and(inArray(tasks.projectId, [...projectIds]), isNull(tasks.deletedAt), isNull(tasks.parentTaskId)))
    .groupBy(tasks.projectId);
  return new Map(rows.map((row) => [row.projectId, { ...row, total: Number(row.total), done: Number(row.done), overdue: Number(row.overdue) }]));
}

function progressOf(row: ProgressRow | undefined) {
  const total = row?.total ?? 0;
  const done = row?.done ?? 0;
  return { total, done, overdue: row?.overdue ?? 0, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

async function memberCounts(projectIds: readonly string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: projectMembers.projectId, n: sql<number>`count(*)::int` })
    .from(projectMembers)
    .where(inArray(projectMembers.projectId, [...projectIds]))
    .groupBy(projectMembers.projectId);
  return new Map(rows.map((row) => [row.projectId, Number(row.n)]));
}

async function starredSet(ctx: DomainContext): Promise<Set<string>> {
  const rows = await db
    .select({ id: favorites.entityId })
    .from(favorites)
    .where(and(eq(favorites.userId, ctx.userId), eq(favorites.entityType, 'project'), eq(favorites.orgId, ctx.orgId)));
  return new Set(rows.map((row) => row.id));
}

function toSummary(
  row: Project,
  extras: { progress: ProgressRow | undefined; memberCount: number; role: ProjectRole; starred: boolean },
): ProjectSummary {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    name: row.name,
    status: row.status,
    health: row.health,
    healthNote: row.healthNote,
    color: row.color,
    icon: row.icon,
    spaceId: row.spaceId,
    ownerId: row.ownerId,
    startDate: row.startDate,
    dueDate: row.dueDate,
    visibility: row.visibility,
    crmCustomerId: row.crmCustomerId,
    crmItemId: row.crmItemId,
    isTemplate: row.isTemplate,
    archivedAt: iso(row.archivedAt),
    completedAt: iso(row.completedAt),
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
    progress: progressOf(extras.progress),
    memberCount: extras.memberCount,
    role: extras.role,
    starred: extras.starred,
  };
}

// --- Reads ----------------------------------------------------------------------------------

export interface ListProjectsOptions {
  readonly spaceId?: string | null;
  readonly includeArchived?: boolean;
  readonly status?: readonly ProjectStatus[];
  readonly ids?: readonly string[];
  readonly search?: string;
  /** Default `'project'`: programs have their own directory (`listPrograms`). */
  readonly kind?: KindFilter;
}

/** Every project the actor can see (directory, sidebar, pickers). */
export async function listProjects(ctx: DomainContext, options: ListProjectsOptions = {}): Promise<ProjectSummary[]> {
  const conditions: SQL[] = [visibleProjectsWhere(ctx, { kind: options.kind ?? 'project' }), eq(projects.isTemplate, false)];
  if (!options.includeArchived) conditions.push(isNull(projects.archivedAt));
  if (options.spaceId !== undefined) {
    conditions.push(options.spaceId === null ? isNull(projects.spaceId) : eq(projects.spaceId, options.spaceId));
  }
  if (options.status?.length) conditions.push(inArray(projects.status, [...options.status]));
  if (options.ids?.length) conditions.push(inArray(projects.id, [...options.ids]));
  if (options.search?.trim()) {
    const term = `%${options.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(sql`(${projects.name} ilike ${term} or ${projects.key} ilike ${term})`);
  }
  const rows = await db
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(sql`${projects.position} COLLATE "C"`, asc(projects.name));
  const ids = rows.map((row) => row.id);
  const [progress, counts, starred, roles] = await Promise.all([
    progressFor(ids),
    memberCounts(ids),
    starredSet(ctx),
    explicitRoles(ctx, ids),
  ]);
  return rows.map((row) =>
    toSummary(row, {
      progress: progress.get(row.id),
      memberCount: counts.get(row.id) ?? 0,
      role: summaryRole(ctx, row, roles.get(row.id) ?? null),
      starred: starred.has(row.id),
    }),
  );
}

async function explicitRoles(ctx: DomainContext, projectIds: readonly string[]): Promise<Map<string, ProjectRole>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, ctx.userId), inArray(projectMembers.projectId, [...projectIds])));
  return new Map(rows.map((row) => [row.projectId, row.role]));
}

function summaryRole(ctx: DomainContext, row: Project, explicit: ProjectRole | null): ProjectRole {
  // Same rule as effectiveProjectRole; rows here are already visible so a role always exists.
  if (ctx.orgRole === 'owner' || ctx.orgRole === 'admin' || row.ownerId === ctx.userId) return 'owner';
  const implicit: ProjectRole | null = row.visibility === 'org' ? (ctx.orgRole === 'member' ? 'editor' : ctx.orgRole === 'viewer' ? 'commenter' : null) : null;
  const rank: Record<ProjectRole, number> = { owner: 4, editor: 3, commenter: 2, viewer: 1 };
  if (explicit && implicit) return rank[explicit] >= rank[implicit] ? explicit : implicit;
  return explicit ?? implicit ?? 'viewer';
}

async function milestoneDTOs(projectId: string): Promise<MilestoneDTO[]> {
  const rows = await db
    .select({
      milestone: milestones,
      // Fully qualified outer reference: single-table selects render columns unqualified.
      taskCount: sql<number>`(select count(*)::int from ${tasks} t where t.milestone_id = "pm"."milestones"."id" and t.deleted_at is null)`,
      doneCount: sql<number>`(select count(*)::int from ${tasks} t join ${statuses} s on s.id = t.status_id where t.milestone_id = "pm"."milestones"."id" and t.deleted_at is null and s.category = 'done')`,
    })
    .from(milestones)
    .where(and(eq(milestones.projectId, projectId), isNull(milestones.deletedAt)))
    .orderBy(sql`${milestones.dueDate} asc nulls last`, sql`${milestones.position} COLLATE "C"`);
  return rows.map(({ milestone, taskCount, doneCount }) => ({
    id: milestone.id,
    projectId: milestone.projectId,
    name: milestone.name,
    description: milestone.description,
    dueDate: milestone.dueDate,
    completedAt: iso(milestone.completedAt),
    position: milestone.position,
    taskCount: Number(taskCount),
    doneCount: Number(doneCount),
  }));
}

export async function listProjectMembers(ctx: DomainContext, projectId: string): Promise<ProjectMemberDTO[]> {
  await requireProject(ctx, { id: projectId });
  return membersOf(projectId);
}

async function membersOf(projectId: string): Promise<ProjectMemberDTO[]> {
  const rows = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(projectMembers.createdAt));
  const people = await getPeople(rows.map((row) => row.userId));
  return rows.flatMap((row) => {
    const person = people.get(row.userId);
    return person ? [{ userId: row.userId, role: row.role, person, addedAt: isoRequired(row.createdAt) }] : [];
  });
}

/** Full project payload for project pages (by key `OPS` or id). */
export async function getProjectDetail(ctx: DomainContext, ref: { key: string } | { id: string }): Promise<ProjectDetail> {
  const { project, role } = await requireProject(ctx, ref);
  const [statusRows, sectionRows, labelRows, fieldRows, milestoneRows, memberRows, progress, starred] = await Promise.all([
    db.select().from(statuses).where(eq(statuses.projectId, project.id)).orderBy(sql`${statuses.position} COLLATE "C"`),
    db.select().from(sections).where(eq(sections.projectId, project.id)).orderBy(sql`${sections.position} COLLATE "C"`),
    db
      .select()
      .from(labels)
      .where(and(eq(labels.orgId, ctx.orgId), sql`(${labels.projectId} = ${project.id} or ${labels.projectId} is null)`))
      .orderBy(asc(labels.name)),
    db
      .select()
      .from(customFields)
      .where(
        and(
          eq(customFields.orgId, ctx.orgId),
          isNull(customFields.deletedAt),
          sql`(${customFields.projectId} = ${project.id} or ${customFields.projectId} is null)`,
        ),
      )
      .orderBy(sql`${customFields.position} COLLATE "C"`),
    milestoneDTOs(project.id),
    membersOf(project.id),
    progressFor([project.id]),
    starredSet(ctx),
  ]);
  return {
    ...toSummary(project, {
      progress: progress.get(project.id),
      memberCount: memberRows.length,
      role,
      starred: starred.has(project.id),
    }),
    description: project.description,
    settings: project.settings,
    wmsRef: project.wmsRef ?? null,
    statuses: statusRows.map(toStatusDTO),
    sections: sectionRows.map(toSectionDTO),
    labels: labelRows.map(toLabelDTO),
    customFields: fieldRows.map(toCustomFieldDTO),
    milestones: milestoneRows,
    members: memberRows,
    capabilities: projectCapabilities(role),
  };
}

/** Taken keys in the org (live projects) — the create wizard suggests a free one. */
export async function takenProjectKeys(ctx: DomainContext): Promise<Set<string>> {
  const rows = await db
    .select({ key: projects.key })
    .from(projects)
    .where(and(eq(projects.orgId, ctx.orgId), isNull(projects.deletedAt)));
  return new Set(rows.map((row) => row.key));
}

export async function suggestKey(ctx: DomainContext, name: string): Promise<string> {
  return suggestProjectKey(name, await takenProjectKeys(ctx));
}

export async function isProjectKeyAvailable(ctx: DomainContext, key: string): Promise<boolean> {
  return !(await takenProjectKeys(ctx)).has(key.toUpperCase());
}

// --- Create ---------------------------------------------------------------------------------

export interface CreateProjectInput {
  readonly name: string;
  readonly key?: string;
  readonly description?: string | null;
  readonly spaceId?: string | null;
  readonly ownerId?: string | null;
  readonly status?: ProjectStatus;
  readonly health?: ProjectHealth;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly color?: string;
  readonly icon?: string;
  readonly visibility?: ProjectVisibility;
  readonly crmCustomerId?: string | null;
  readonly crmItemId?: string | null;
  readonly wmsRef?: Record<string, unknown> | null;
  /** Extra people to add (user id → role). The creator is always an owner. */
  readonly members?: readonly { readonly userId: string; readonly role: ProjectRole }[];
  /** Skip default statuses (template instantiation provides its own). */
  readonly skipDefaults?: boolean;
  readonly templateId?: string | null;
  readonly settings?: Record<string, unknown>;
  /** Default `'project'`. Only `domain/programs/programs.ts` passes `'program'`. */
  readonly kind?: ProjectKind;
  /** Programs: the `pm.program_settings` row values (time zone defaults to the workspace calendar). */
  readonly program?: Partial<Omit<typeof programSettings.$inferInsert, 'programId' | 'orgId'>>;
}

/** Refusal for generic project writes that a program does through its own settings (4.1). */
export const USE_PROGRAM_SETTINGS = 'Use the program settings.';

function assertNotProgram(project: Pick<Project, 'kind'>): void {
  if (project.kind === 'program') throw invalid(USE_PROGRAM_SETTINGS);
}

function validateDates(start: string | null | undefined, due: string | null | undefined): void {
  if (start && !isIsoDate(start)) throw invalid('Pick a valid start date.', { startDate: 'Pick a valid date.' });
  if (due && !isIsoDate(due)) throw invalid('Pick a valid due date.', { dueDate: 'Pick a valid date.' });
  if (start && due && start > due) throw invalid('The start date has to be on or before the due date.', { startDate: 'Start date is after the due date.' });
}

/** Inserts the project row + default structure inside `tx` (shared by templates and duplicate). */
export async function insertProject(tx: Executor, ctx: DomainContext, input: CreateProjectInput): Promise<Project> {
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the project a name.', { name: 'Give the project a name.' });
  if (name.length > 120) throw invalid('Project names can be up to 120 characters.', { name: 'Too long.' });
  validateDates(input.startDate, input.dueDate);
  const taken = new Set(
    (await tx.select({ key: projects.key }).from(projects).where(and(eq(projects.orgId, ctx.orgId), isNull(projects.deletedAt)))).map((r) => r.key),
  );
  const key = (input.key?.trim().toUpperCase() || suggestProjectKey(name, taken)).slice(0, 6);
  if (!PROJECT_KEY_PATTERN.test(key)) {
    throw invalid('Use 2 to 6 letters or numbers for the key, starting with a letter.', { key: 'Use 2-6 letters/numbers, starting with a letter.' });
  }
  if (taken.has(key)) throw conflict(`The key ${key} is already used by another project. Pick a different one.`);
  if (input.spaceId) {
    const [space] = await tx
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, input.spaceId), eq(spaces.orgId, ctx.orgId), isNull(spaces.deletedAt)));
    if (!space) throw invalid('That space no longer exists.');
  }
  if (input.crmCustomerId) {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, input.crmCustomerId), eq(customers.orgId, ctx.orgId)));
    if (!customer) throw invalid('That customer is not in this workspace.');
  }
  const kind: ProjectKind = input.kind ?? 'project';
  const ownerId = input.ownerId ?? ctx.userId;
  if (ownerId !== ctx.userId && !(await isOrgMember(ctx, ownerId, tx))) throw invalid('The owner has to be in this workspace.');
  const [last] = await tx
    .select({ position: projects.position })
    .from(projects)
    .where(eq(projects.orgId, ctx.orgId))
    .orderBy(sql`${projects.position} COLLATE "C" desc`)
    .limit(1);
  const [project] = await tx
    .insert(projects)
    .values({
      orgId: ctx.orgId,
      kind,
      spaceId: kind === 'program' ? null : (input.spaceId ?? null),
      key,
      name,
      description: sanitizeRichText(input.description ?? null),
      status: input.status ?? 'active',
      health: input.health ?? 'on_track',
      ownerId,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      color: input.color ?? 'blue',
      icon: input.icon ?? (kind === 'program' ? 'repeat' : 'folder-kanban'),
      visibility: input.visibility ?? 'org',
      crmCustomerId: input.crmCustomerId ?? null,
      crmItemId: input.crmItemId ?? null,
      wmsRef: input.wmsRef ?? null,
      templateId: input.templateId && !input.templateId.startsWith('builtin:') ? input.templateId : null,
      position: rankAfter(last?.position),
      settings: input.settings ?? {},
      createdBy: ctx.userId,
    })
    .returning();
  const memberRows = new Map<string, ProjectRole>([[ctx.userId, 'owner']]);
  if (ownerId !== ctx.userId) memberRows.set(ownerId, 'owner');
  for (const m of input.members ?? []) if (!memberRows.has(m.userId)) memberRows.set(m.userId, m.role);
  const validIds = new Set<string>([ctx.userId]);
  for (const id of memberRows.keys()) if (id !== ctx.userId && (await isOrgMember(ctx, id, tx))) validIds.add(id);
  await tx.insert(projectMembers).values(
    [...memberRows.entries()]
      .filter(([userId]) => validIds.has(userId))
      .map(([userId, role]) => ({ projectId: project.id, userId, orgId: ctx.orgId, role, addedBy: ctx.userId })),
  );
  if (!input.skipDefaults) {
    const defaults = kind === 'program' ? DEFAULT_PROGRAM_STATUSES : DEFAULT_STATUSES;
    const ranks = ranksBetween(defaults.length);
    const hasDefault = defaults.some((status) => 'isDefault' in status && status.isDefault);
    await tx.insert(statuses).values(
      defaults.map((status, index) => ({
        orgId: ctx.orgId,
        projectId: project.id,
        name: status.name,
        category: status.category,
        color: status.color,
        position: ranks[index],
        isDefault: hasDefault ? Boolean('isDefault' in status && status.isDefault) : index === 0,
      })),
    );
  }
  if (kind === 'program') {
    const [calendar] = await tx.select({ timezone: orgCalendar.timezone }).from(orgCalendar).where(eq(orgCalendar.orgId, ctx.orgId));
    await tx.insert(programSettings).values({
      ...(input.program ?? {}),
      programId: project.id,
      orgId: ctx.orgId,
      timezone: input.program?.timezone ?? calendar?.timezone ?? DEFAULT_PROGRAM_TIMEZONE,
    });
  }
  await logActivity(tx, ctx, {
    verb: kind === 'program' ? 'program.created' : 'project.created',
    entityType: 'project',
    entityId: project.id,
    projectId: project.id,
    after: { name, key, kind, templateId: input.templateId ?? null },
  });
  const others = [...memberRows.keys()].filter((id) => id !== ctx.userId && validIds.has(id));
  if (others.length) {
    await notify(tx, ctx, {
      recipients: others,
      kind: 'project',
      title: kind === 'program' ? `${ctx.userName} added you to the program ${name}` : `${ctx.userName} added you to the project ${name}`,
      url: kind === 'program' ? `/programs/${key}` : `/p/${key}`,
      projectId: project.id,
    });
  }
  return project;
}

export async function createProject(ctx: DomainContext, input: CreateProjectInput): Promise<ProjectDetail> {
  requireOrg(ctx, 'project:create');
  const project = await db.transaction((tx) => insertProject(tx, ctx, input));
  return getProjectDetail(ctx, { id: project.id });
}

// --- Update ---------------------------------------------------------------------------------

export interface UpdateProjectInput {
  readonly name?: string;
  readonly key?: string;
  readonly description?: string | null;
  readonly spaceId?: string | null;
  readonly ownerId?: string | null;
  readonly status?: ProjectStatus;
  readonly health?: ProjectHealth;
  readonly healthNote?: string | null;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly color?: string;
  readonly icon?: string;
  readonly visibility?: ProjectVisibility;
  readonly crmCustomerId?: string | null;
  readonly crmItemId?: string | null;
  readonly wmsRef?: Record<string, unknown> | null;
  readonly settings?: Record<string, unknown>;
}

const PROJECT_FIELDS = [
  'name',
  'key',
  'description',
  'spaceId',
  'ownerId',
  'status',
  'health',
  'healthNote',
  'startDate',
  'dueDate',
  'color',
  'icon',
  'visibility',
  'crmCustomerId',
  'crmItemId',
  'wmsRef',
  'settings',
] as const;

export async function updateProject(ctx: DomainContext, projectId: string, patch: UpdateProjectInput): Promise<ProjectDetail> {
  const needsOwner = patch.visibility !== undefined || patch.ownerId !== undefined || patch.key !== undefined;
  const { project } = await requireProject(ctx, { id: projectId }, needsOwner ? 'project:manage_members' : 'project:update');
  if (project.kind === 'program') {
    const programOwned = (['startDate', 'dueDate', 'status', 'visibility', 'spaceId'] as const).some((field) => patch[field] !== undefined);
    if (programOwned) throw invalid(USE_PROGRAM_SETTINGS);
  }
  const next: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the project a name.', { name: 'Give the project a name.' });
    next.name = name.slice(0, 120);
  }
  if (patch.key !== undefined) {
    const key = patch.key.trim().toUpperCase();
    if (!PROJECT_KEY_PATTERN.test(key)) throw invalid('Use 2 to 6 letters or numbers for the key, starting with a letter.', { key: 'Invalid key.' });
    if (key !== project.key && !(await isProjectKeyAvailable(ctx, key))) throw conflict(`The key ${key} is already used by another project.`);
    next.key = key;
  }
  if (patch.description !== undefined) next.description = sanitizeRichText(patch.description);
  if (patch.healthNote !== undefined) next.healthNote = cleanText(patch.healthNote);
  for (const field of ['spaceId', 'status', 'health', 'startDate', 'dueDate', 'color', 'icon', 'visibility', 'crmCustomerId', 'crmItemId', 'wmsRef', 'settings'] as const) {
    if (patch[field] !== undefined) next[field] = patch[field];
  }
  if (patch.ownerId !== undefined) {
    if (patch.ownerId && !(await isOrgMember(ctx, patch.ownerId))) throw invalid('The owner has to be in this workspace.');
    next.ownerId = patch.ownerId;
  }
  validateDates(
    (next.startDate !== undefined ? next.startDate : project.startDate) as string | null,
    (next.dueDate !== undefined ? next.dueDate : project.dueDate) as string | null,
  );
  const changed = PROJECT_FIELDS.filter(
    (field) => next[field] !== undefined && JSON.stringify(next[field]) !== JSON.stringify(project[field] ?? null),
  );
  if (changed.length === 0) return getProjectDetail(ctx, { id: projectId });
  const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  for (const field of changed) (set as Record<string, unknown>)[field] = next[field];
  if (changed.includes('status')) {
    if (next.status === 'completed' && !project.completedAt) set.completedAt = new Date();
    if (next.status !== 'completed') set.completedAt = null;
    if (next.status === 'archived') set.archivedAt = project.archivedAt ?? new Date();
    else if (project.archivedAt) set.archivedAt = null;
  }
  await db.transaction(async (tx) => {
    await tx.update(projects).set(set).where(eq(projects.id, projectId));
    if (changed.includes('ownerId') && next.ownerId) {
      await tx
        .insert(projectMembers)
        .values({ projectId, userId: next.ownerId as string, orgId: ctx.orgId, role: 'owner', addedBy: ctx.userId })
        .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: 'owner' } });
    }
    await logActivity(
      tx,
      ctx,
      changed.map((field) => ({
        verb: 'project.updated',
        entityType: 'project',
        entityId: projectId,
        projectId,
        field,
        before: field === 'description' ? null : (project[field] ?? null),
        after: field === 'description' ? null : (next[field] ?? null),
      })),
    );
    if (changed.includes('health') && project.ownerId && next.health !== 'on_track') {
      const watchersOfProject = await tx.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
      await notify(tx, ctx, {
        recipients: watchersOfProject.map((row) => row.userId),
        kind: 'project',
        title: `${ctx.userName} marked ${project.name} as ${next.health === 'at_risk' ? 'at risk' : 'off track'}`,
        body: (next.healthNote as string | null) ?? project.healthNote,
        url: `/p/${(next.key as string) ?? project.key}`,
        projectId,
      });
    }
  });
  return getProjectDetail(ctx, { id: projectId });
}

export async function archiveProject(ctx: DomainContext, projectId: string, archived = true): Promise<ProjectDetail> {
  const { project } = await requireProject(ctx, { id: projectId }, 'project:update');
  assertNotProgram(project);
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({
        archivedAt: archived ? new Date() : null,
        status: archived ? 'archived' : project.status === 'archived' ? 'active' : project.status,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
    await logActivity(tx, ctx, {
      verb: archived ? 'project.archived' : 'project.restored',
      entityType: 'project',
      entityId: projectId,
      projectId,
    });
  });
  return getProjectDetail(ctx, { id: projectId });
}

/** Soft delete (owners only). Undo with `restoreProject` from the toast. */
export async function deleteProject(ctx: DomainContext, projectId: string): Promise<void> {
  const { project } = await requireProject(ctx, { id: projectId }, 'project:delete');
  assertNotProgram(project);
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, projectId));
    await logActivity(tx, ctx, { verb: 'project.deleted', entityType: 'project', entityId: projectId, projectId });
  });
}

export async function restoreProject(ctx: DomainContext, projectId: string): Promise<ProjectDetail> {
  const [row] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)));
  if (!row) throw notFound('That project');
  assertNotProgram(row);
  const role = await roleForProject(ctx, { ...row, deletedAt: null });
  if (role !== 'owner') throw notFound('That project');
  if (!(await isProjectKeyAvailable(ctx, row.key))) {
    throw conflict(`Another project now uses the key ${row.key}. Change that project's key first.`);
  }
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ deletedAt: null }).where(eq(projects.id, projectId));
    await logActivity(tx, ctx, { verb: 'project.restored', entityType: 'project', entityId: projectId, projectId });
  });
  return getProjectDetail(ctx, { id: projectId });
}

/** Reorder in the sidebar / directory. */
export async function reorderProject(ctx: DomainContext, projectId: string, position: string, spaceId?: string | null): Promise<void> {
  await requireProject(ctx, { id: projectId }, 'project:update');
  await db
    .update(projects)
    .set({ position, ...(spaceId !== undefined ? { spaceId } : {}), updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function starProject(ctx: DomainContext, projectId: string, starred: boolean): Promise<void> {
  await requireProject(ctx, { id: projectId });
  await setFavorite(ctx, 'project', projectId, starred);
}

// --- Members --------------------------------------------------------------------------------

export async function addProjectMembers(
  ctx: DomainContext,
  projectId: string,
  members: readonly { readonly userId: string; readonly role: ProjectRole }[],
): Promise<ProjectMemberDTO[]> {
  const { project } = await requireProject(ctx, { id: projectId }, 'project:manage_members');
  await db.transaction(async (tx) => {
    const added: string[] = [];
    for (const m of members) {
      if (!(await isOrgMember(ctx, m.userId, tx))) throw invalid('Only people in this workspace can be added. Invite them from the Portal first.');
      const [row] = await tx
        .insert(projectMembers)
        .values({ projectId, userId: m.userId, orgId: ctx.orgId, role: m.role, addedBy: ctx.userId })
        .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: m.role } })
        .returning({ userId: projectMembers.userId, createdAt: projectMembers.createdAt });
      if (row) added.push(m.userId);
      await logActivity(tx, ctx, {
        verb: 'project.member_added',
        entityType: 'project',
        entityId: projectId,
        projectId,
        after: { userId: m.userId, role: m.role },
      });
    }
    await notify(tx, ctx, {
      recipients: added,
      kind: 'project',
      title: `${ctx.userName} added you to the project ${project.name}`,
      url: `/p/${project.key}`,
      projectId,
    });
  });
  return membersOf(projectId);
}

export async function updateProjectMemberRole(ctx: DomainContext, projectId: string, userId: string, role: ProjectRole): Promise<ProjectMemberDTO[]> {
  await requireProject(ctx, { id: projectId }, 'project:manage_members');
  if (role !== 'owner') await assertAnotherOwner(projectId, userId);
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ role: projectMembers.role }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    if (!before) throw notFound('That person is not on this project');
    await tx.update(projectMembers).set({ role }).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    await logActivity(tx, ctx, {
      verb: 'project.member_updated',
      entityType: 'project',
      entityId: projectId,
      projectId,
      before: { userId, role: before.role },
      after: { userId, role },
    });
  });
  return membersOf(projectId);
}

async function assertAnotherOwner(projectId: string, leavingUserId: string): Promise<void> {
  const owners = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')));
  if (owners.length === 1 && owners[0].userId === leavingUserId) {
    throw invalid('Every project needs at least one owner. Make someone else an owner first.');
  }
}

export async function removeProjectMember(ctx: DomainContext, projectId: string, userId: string): Promise<ProjectMemberDTO[]> {
  // People can always leave; removing others needs owner rights.
  await requireProject(ctx, { id: projectId }, userId === ctx.userId ? 'project:read' : 'project:manage_members');
  await assertAnotherOwner(projectId, userId);
  await db.transaction(async (tx) => {
    await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    await logActivity(tx, ctx, {
      verb: 'project.member_removed',
      entityType: 'project',
      entityId: projectId,
      projectId,
      before: { userId },
    });
  });
  return membersOf(projectId);
}

// --- Duplicate ------------------------------------------------------------------------------

/** Copies structure (statuses, sections, labels, fields, milestones) and optionally tasks. */
export async function duplicateProject(
  ctx: DomainContext,
  projectId: string,
  options: { readonly name: string; readonly key?: string; readonly includeTasks?: boolean },
): Promise<ProjectDetail> {
  requireOrg(ctx, 'project:create');
  const source = await getProjectDetail(ctx, { id: projectId });
  if (source.kind === 'program') throw invalid(USE_PROGRAM_SETTINGS);
  const { templateFromProject, instantiateTemplatePayload } = await import('./templates');
  const payload = await templateFromProject(ctx, projectId, { includeTasks: options.includeTasks ?? true });
  const created = await instantiateTemplatePayload(ctx, payload, {
    name: options.name,
    key: options.key,
    spaceId: source.spaceId,
    color: source.color,
    icon: source.icon,
    description: source.description,
    visibility: source.visibility,
    startDate: source.startDate ?? todayIso(),
    crmCustomerId: source.crmCustomerId,
  });
  return created;
}
