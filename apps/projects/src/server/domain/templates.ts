/**
 * Templates: built-ins + org-saved. `instantiateTemplate` creates a real project with statuses,
 * sections, labels, custom fields, milestones, tasks (with subtasks + relative dates),
 * dependencies and automations. `saveProjectAsTemplate` captures an existing project.
 */
import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import {
  automations,
  customFields,
  labels,
  milestones,
  sections,
  statuses,
  taskDependencies,
  taskLabels,
  tasks,
  templates,
  type Template,
} from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { AutomationAction, AutomationTrigger } from '@/lib/automation-types';
import { addDaysIso, diffDays, todayIso } from '@/lib/dates';
import { ranksBetween } from '@/lib/rank';
import type { TemplatePayload, TemplateTask } from '@/lib/template-types';
import type { ProjectDetail, TemplateDTO } from '@/lib/types';
import { cleanText, type DomainContext } from './_shared';
import { requireOrg, requireProject } from './access';
import { logActivity } from './activity';
import { getProjectDetail, insertProject, type CreateProjectInput } from './projects';
import { insertTask } from './tasks';
import { BUILTIN_TEMPLATES, countTemplateTasks, findBuiltinTemplate } from './templates-builtin';

function orgTemplateDTO(row: Template): TemplateDTO {
  return {
    id: row.id,
    builtIn: false,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    color: row.color,
    payload: row.payload,
    useCount: row.useCount,
    taskCount: countTemplateTasks(row.payload),
  };
}

export async function listTemplates(ctx: DomainContext): Promise<TemplateDTO[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(and(eq(templates.orgId, ctx.orgId), isNull(templates.deletedAt)))
    .orderBy(desc(templates.updatedAt));
  const builtins: TemplateDTO[] = BUILTIN_TEMPLATES.map((template) => ({
    id: `builtin:${template.slug}`,
    builtIn: true,
    name: template.name,
    description: template.description,
    category: template.category,
    icon: template.icon,
    color: template.color,
    payload: template.payload,
    useCount: 0,
    taskCount: countTemplateTasks(template.payload),
  }));
  return [...rows.map(orgTemplateDTO), ...builtins];
}

export async function getTemplate(ctx: DomainContext, id: string): Promise<TemplateDTO> {
  if (id.startsWith('builtin:')) {
    const builtin = findBuiltinTemplate(id);
    if (!builtin) throw notFound('That template');
    return (await listTemplates(ctx)).find((template) => template.id === id) as TemplateDTO;
  }
  const [row] = await db.select().from(templates).where(and(eq(templates.id, id), eq(templates.orgId, ctx.orgId), isNull(templates.deletedAt)));
  if (!row) throw notFound('That template');
  return orgTemplateDTO(row);
}

// --- Capture --------------------------------------------------------------------------------

/** Builds a template payload from a live project (structure + optionally tasks). */
export async function templateFromProject(
  ctx: DomainContext,
  projectId: string,
  options: { readonly includeTasks?: boolean } = {},
): Promise<TemplatePayload> {
  const { project } = await requireProject(ctx, { id: projectId });
  const [statusRows, sectionRows, labelRows, fieldRows, milestoneRows, ruleRows] = await Promise.all([
    db.select().from(statuses).where(eq(statuses.projectId, projectId)).orderBy(sql`${statuses.position} COLLATE "C"`),
    db.select().from(sections).where(eq(sections.projectId, projectId)).orderBy(sql`${sections.position} COLLATE "C"`),
    db.select().from(labels).where(eq(labels.projectId, projectId)),
    db.select().from(customFields).where(and(eq(customFields.projectId, projectId), isNull(customFields.deletedAt))).orderBy(sql`${customFields.position} COLLATE "C"`),
    db.select().from(milestones).where(and(eq(milestones.projectId, projectId), isNull(milestones.deletedAt))),
    db.select().from(automations).where(and(eq(automations.projectId, projectId), isNull(automations.deletedAt))),
  ]);
  const start = project.startDate ?? todayIso();
  const offset = (date: string | null) => (date ? diffDays(start, date) : undefined);
  const payload: {
    -readonly [K in keyof TemplatePayload]: TemplatePayload[K];
  } = {
    description: project.description ?? undefined,
    color: project.color,
    icon: project.icon,
    durationDays: project.startDate && project.dueDate ? diffDays(project.startDate, project.dueDate) : undefined,
    statuses: statusRows.map((s) => ({ key: s.id, name: s.name, category: s.category, color: s.color, wipLimit: s.wipLimit, isDefault: s.isDefault })),
    sections: sectionRows.map((s) => ({ key: s.id, name: s.name })),
    labels: labelRows.map((l) => ({ key: l.id, name: l.name, color: l.color })),
    customFields: fieldRows.map((f) => ({ key: f.id, name: f.name, type: f.type, config: f.config })),
    milestones: milestoneRows.map((m) => ({ key: m.id, name: m.name, dueOffsetDays: offset(m.dueDate) })),
    automations: ruleRows.map((r) => ({ name: r.name, trigger: r.trigger, conditions: r.conditions, actions: r.actions })),
  };
  if (options.includeTasks) {
    const taskRows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .orderBy(sql`${tasks.position} COLLATE "C"`);
    const labelLinks = await db.select().from(taskLabels).innerJoin(tasks, eq(tasks.id, taskLabels.taskId)).where(eq(tasks.projectId, projectId));
    const labelsByTask = new Map<string, string[]>();
    for (const link of labelLinks) {
      const list = labelsByTask.get(link.task_labels.taskId) ?? [];
      list.push(link.task_labels.labelId);
      labelsByTask.set(link.task_labels.taskId, list);
    }
    const build = (row: (typeof taskRows)[number]): TemplateTask => ({
      key: row.id,
      title: row.title,
      description: row.description ?? undefined,
      statusKey: row.statusId,
      sectionKey: row.sectionId ?? undefined,
      priority: row.priority,
      startOffsetDays: offset(row.startDate),
      dueOffsetDays: offset(row.dueDate),
      labelKeys: labelsByTask.get(row.id),
      milestoneKey: row.milestoneId ?? undefined,
      isMilestone: row.isMilestone,
      estimatePoints: row.estimatePoints ?? undefined,
      subtasks: taskRows.filter((child) => child.parentTaskId === row.id).map(build),
    });
    payload.tasks = taskRows.filter((row) => !row.parentTaskId).map(build);
    const deps = await db
      .select({ blocking: taskDependencies.blockingTaskId, blocked: taskDependencies.blockedTaskId })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedTaskId))
      .where(eq(tasks.projectId, projectId));
    const ids = new Set(taskRows.map((row) => row.id));
    payload.dependencies = deps.filter((d) => ids.has(d.blocking) && ids.has(d.blocked)).map((d) => ({ blockingKey: d.blocking, blockedKey: d.blocked }));
  }
  return payload as TemplatePayload;
}

export async function saveProjectAsTemplate(
  ctx: DomainContext,
  projectId: string,
  input: { readonly name: string; readonly description?: string | null; readonly category?: string; readonly includeTasks?: boolean },
): Promise<TemplateDTO> {
  requireOrg(ctx, 'template:manage');
  const { project } = await requireProject(ctx, { id: projectId });
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the template a name.', { name: 'Give the template a name.' });
  const payload = await templateFromProject(ctx, projectId, { includeTasks: input.includeTasks ?? true });
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(templates)
      .values({
        orgId: ctx.orgId,
        name,
        description: cleanText(input.description),
        category: cleanText(input.category) ?? 'General',
        icon: project.icon,
        color: project.color,
        payload,
        sourceProjectId: projectId,
        createdBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'template.created', entityType: 'template', entityId: inserted[0].id, projectId, after: { name } });
    return inserted;
  });
  return orgTemplateDTO(row);
}

export async function createTemplate(
  ctx: DomainContext,
  input: { readonly name: string; readonly description?: string | null; readonly category?: string; readonly icon?: string; readonly color?: string; readonly payload: TemplatePayload },
): Promise<TemplateDTO> {
  requireOrg(ctx, 'template:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the template a name.', { name: 'Give the template a name.' });
  if (input.payload.statuses.length === 0) throw invalid('A template needs at least one status.');
  const [row] = await db
    .insert(templates)
    .values({
      orgId: ctx.orgId,
      name,
      description: cleanText(input.description),
      category: cleanText(input.category) ?? 'General',
      icon: input.icon ?? 'layout-template',
      color: input.color ?? 'blue',
      payload: input.payload,
      createdBy: ctx.userId,
    })
    .returning();
  return orgTemplateDTO(row);
}

export async function updateTemplate(
  ctx: DomainContext,
  id: string,
  patch: { readonly name?: string; readonly description?: string | null; readonly category?: string; readonly icon?: string; readonly color?: string; readonly payload?: TemplatePayload },
): Promise<TemplateDTO> {
  requireOrg(ctx, 'template:manage');
  if (id.startsWith('builtin:')) throw invalid('Built-in templates can’t be changed. Use it to make a project, then save that as your own template.');
  const set: Partial<typeof templates.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the template a name.', { name: 'Give the template a name.' });
    set.name = name;
  }
  if (patch.description !== undefined) set.description = cleanText(patch.description);
  if (patch.category !== undefined) set.category = cleanText(patch.category) ?? 'General';
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.payload !== undefined) set.payload = patch.payload;
  const [row] = await db
    .update(templates)
    .set(set)
    .where(and(eq(templates.id, id), eq(templates.orgId, ctx.orgId), isNull(templates.deletedAt)))
    .returning();
  if (!row) throw notFound('That template');
  return orgTemplateDTO(row);
}

export async function deleteTemplate(ctx: DomainContext, id: string): Promise<void> {
  requireOrg(ctx, 'template:manage');
  if (id.startsWith('builtin:')) throw invalid('Built-in templates can’t be deleted.');
  await db.update(templates).set({ deletedAt: new Date() }).where(and(eq(templates.id, id), eq(templates.orgId, ctx.orgId)));
}

/** Undo for deleteTemplate. */
export async function restoreTemplate(ctx: DomainContext, id: string): Promise<TemplateDTO> {
  requireOrg(ctx, 'template:manage');
  if (id.startsWith('builtin:')) throw invalid('Built-in templates can’t be deleted or restored.');
  const [row] = await db
    .update(templates)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(templates.id, id), eq(templates.orgId, ctx.orgId)))
    .returning();
  if (!row) throw notFound('That template');
  return orgTemplateDTO(row);
}

// --- Instantiate ----------------------------------------------------------------------------

export type InstantiateOptions = Omit<CreateProjectInput, 'skipDefaults' | 'templateId'> & {
  /** Start date the offsets count from (default today). */
  readonly startDate?: string | null;
  /** Create tasks from the template (default true). */
  readonly includeTasks?: boolean;
};

function remapIds<T>(value: T, maps: { status: Map<string, string>; label: Map<string, string>; section: Map<string, string> }): T {
  const json = JSON.stringify(value, (key, raw: unknown) => {
    if (typeof raw !== 'string') return raw;
    if (key === 'statusId' || key === 'toStatusId' || key === 'fromStatusId') return maps.status.get(raw) ?? raw;
    if (key === 'labelId') return maps.label.get(raw) ?? raw;
    if (key === 'sectionId' || key === 'toSectionId') return maps.section.get(raw) ?? raw;
    return raw;
  });
  return JSON.parse(json) as T;
}

async function materialize(
  tx: Executor,
  ctx: DomainContext,
  payload: TemplatePayload,
  options: InstantiateOptions & { templateId?: string | null },
): Promise<string> {
  const start = options.startDate ?? todayIso();
  const due = options.dueDate ?? (payload.durationDays !== undefined ? addDaysIso(start, payload.durationDays) : null);
  const project = await insertProject(tx, ctx, {
    ...options,
    description: options.description ?? payload.description ?? null,
    color: options.color ?? payload.color ?? 'blue',
    icon: options.icon ?? payload.icon ?? 'folder-kanban',
    startDate: start,
    dueDate: due,
    skipDefaults: true,
    templateId: options.templateId ?? null,
    settings: { ...(options.settings ?? {}), ...(payload.defaultView ? { defaultView: payload.defaultView } : {}) },
  });
  const statusMap = new Map<string, string>();
  const statusRanks = ranksBetween(payload.statuses.length);
  const hasDefault = payload.statuses.some((s) => s.isDefault);
  const insertedStatuses = payload.statuses.length
    ? await tx
        .insert(statuses)
        .values(
          payload.statuses.map((s, index) => ({
            orgId: ctx.orgId,
            projectId: project.id,
            name: s.name,
            category: s.category,
            color: s.color,
            wipLimit: s.wipLimit ?? null,
            position: statusRanks[index],
            isDefault: hasDefault ? Boolean(s.isDefault) : index === 0,
          })),
        )
        .returning()
    : [];
  payload.statuses.forEach((s, index) => statusMap.set(s.key, insertedStatuses[index].id));
  const sectionMap = new Map<string, string>();
  if (payload.sections?.length) {
    const ranks = ranksBetween(payload.sections.length);
    const rows = await tx
      .insert(sections)
      .values(payload.sections.map((s, index) => ({ orgId: ctx.orgId, projectId: project.id, name: s.name, position: ranks[index] })))
      .returning();
    payload.sections.forEach((s, index) => sectionMap.set(s.key, rows[index].id));
  }
  const labelMap = new Map<string, string>();
  if (payload.labels?.length) {
    const rows = await tx
      .insert(labels)
      .values(payload.labels.map((l) => ({ orgId: ctx.orgId, projectId: project.id, name: l.name, color: l.color })))
      .returning();
    payload.labels.forEach((l, index) => labelMap.set(l.key, rows[index].id));
  }
  const fieldMap = new Map<string, string>();
  if (payload.customFields?.length) {
    const ranks = ranksBetween(payload.customFields.length);
    const rows = await tx
      .insert(customFields)
      .values(payload.customFields.map((f, index) => ({ orgId: ctx.orgId, projectId: project.id, name: f.name, type: f.type, config: f.config ?? {}, position: ranks[index] })))
      .returning();
    payload.customFields.forEach((f, index) => fieldMap.set(f.key, rows[index].id));
  }
  const milestoneMap = new Map<string, string>();
  if (payload.milestones?.length) {
    const ranks = ranksBetween(payload.milestones.length);
    const rows = await tx
      .insert(milestones)
      .values(
        payload.milestones.map((m, index) => ({
          orgId: ctx.orgId,
          projectId: project.id,
          name: m.name,
          dueDate: m.dueOffsetDays !== undefined ? addDaysIso(start, m.dueOffsetDays) : null,
          position: ranks[index],
          createdBy: ctx.userId,
        })),
      )
      .returning();
    payload.milestones.forEach((m, index) => milestoneMap.set(m.key, rows[index].id));
  }
  const statusList = await tx.select().from(statuses).where(eq(statuses.projectId, project.id));
  const taskMap = new Map<string, string>();
  const place = async (list: readonly TemplateTask[] | undefined, parentTaskId: string | null) => {
    for (const item of list ?? []) {
      const created = await insertTask(
        tx,
        ctx,
        project,
        {
          projectId: project.id,
          title: item.title,
          description: item.description ?? null,
          statusId: item.statusKey ? (statusMap.get(item.statusKey) ?? null) : null,
          sectionId: item.sectionKey ? (sectionMap.get(item.sectionKey) ?? null) : null,
          priority: item.priority ?? 'none',
          startDate: item.startOffsetDays !== undefined ? addDaysIso(start, item.startOffsetDays) : null,
          dueDate: item.dueOffsetDays !== undefined ? addDaysIso(start, item.dueOffsetDays) : null,
          estimatePoints: item.estimatePoints ?? null,
          parentTaskId,
          milestoneId: item.milestoneKey ? (milestoneMap.get(item.milestoneKey) ?? null) : null,
          isMilestone: item.isMilestone ?? false,
          labelIds: (item.labelKeys ?? []).map((key) => labelMap.get(key)).filter((id): id is string => Boolean(id)),
          at: 'bottom',
        },
        { statusList, logVerb: 'task.created', activityMeta: { fromTemplate: true } },
      );
      if (item.key) taskMap.set(item.key, created.id);
      await place(item.subtasks, created.id);
    }
  };
  if (options.includeTasks !== false) await place(payload.tasks, null);
  for (const dep of payload.dependencies ?? []) {
    const blocking = taskMap.get(dep.blockingKey);
    const blocked = taskMap.get(dep.blockedKey);
    if (blocking && blocked && blocking !== blocked) {
      await tx.insert(taskDependencies).values({ orgId: ctx.orgId, blockingTaskId: blocking, blockedTaskId: blocked, createdBy: ctx.userId }).onConflictDoNothing();
    }
  }
  for (const rule of payload.automations ?? []) {
    const maps = { status: statusMap, label: labelMap, section: sectionMap };
    await tx.insert(automations).values({
      orgId: ctx.orgId,
      projectId: project.id,
      name: rule.name,
      trigger: remapIds<AutomationTrigger>(rule.trigger, maps),
      conditions: remapIds([...(rule.conditions ?? [])], maps).map((condition) =>
        condition.field === 'label' && typeof condition.value === 'string'
          ? { ...condition, value: labelMap.get(condition.value) ?? condition.value }
          : condition.field === 'status' && typeof condition.value === 'string'
            ? { ...condition, value: statusMap.get(condition.value) ?? condition.value }
            : condition,
      ),
      actions: remapIds<AutomationAction[]>([...rule.actions], maps),
      createdBy: ctx.userId,
    });
  }
  return project.id;
}

/** Creates a project from a raw payload (duplicate project, imports). */
export async function instantiateTemplatePayload(
  ctx: DomainContext,
  payload: TemplatePayload,
  options: InstantiateOptions,
): Promise<ProjectDetail> {
  requireOrg(ctx, 'project:create');
  const projectId = await db.transaction((tx) => materialize(tx, ctx, payload, options));
  return getProjectDetail(ctx, { id: projectId });
}

/** Creates a project from a built-in (`builtin:<slug>`) or org template. */
export async function instantiateTemplate(ctx: DomainContext, templateId: string, options: InstantiateOptions): Promise<ProjectDetail> {
  requireOrg(ctx, 'project:create');
  const template = await getTemplate(ctx, templateId);
  const projectId = await db.transaction(async (tx) => {
    const id = await materialize(tx, ctx, template.payload, { ...options, templateId: template.id });
    if (!template.builtIn) {
      await tx.update(templates).set({ useCount: sql`${templates.useCount} + 1` }).where(eq(templates.id, template.id));
    }
    await logActivity(tx, ctx, { verb: 'template.used', entityType: 'template', entityId: template.builtIn ? null : template.id, projectId: id, meta: { template: template.name } });
    return id;
  });
  return getProjectDetail(ctx, { id: projectId });
}
