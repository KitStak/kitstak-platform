/**
 * Per-project structure: workflow statuses, list sections, labels, custom fields, milestones.
 * All edits need `structure:manage` (project editors and owners) and are activity-logged.
 */
import 'server-only';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { customFields, labels, milestones, sections, statuses, tasks } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { CustomFieldConfig } from '@/lib/custom-field-types';
import type { CustomFieldType, StatusCategory } from '@/lib/constants';
import { isIsoDate } from '@/lib/dates';
import { rankAfter } from '@/lib/rank';
import type { CustomFieldDTO, LabelDTO, MilestoneDTO, SectionDTO, StatusDTO } from '@/lib/types';
import { cleanText, iso, toCustomFieldDTO, toLabelDTO, toSectionDTO, toStatusDTO, type DomainContext } from './_shared';
import { requireOrg, requireProject } from './access';
import { logActivity } from './activity';

function requiredName(value: string | undefined, what: string): string {
  const name = cleanText(value);
  if (!name) throw invalid(`Give the ${what} a name.`, { name: `Give the ${what} a name.` });
  if (name.length > 80) throw invalid(`${what[0].toUpperCase()}${what.slice(1)} names can be up to 80 characters.`, { name: 'Too long.' });
  return name;
}

// --- Statuses -------------------------------------------------------------------------------

export async function createStatus(
  ctx: DomainContext,
  projectId: string,
  input: { name: string; category: StatusCategory; color?: string; wipLimit?: number | null; position?: string },
): Promise<StatusDTO> {
  await requireProject(ctx, { id: projectId }, 'structure:manage');
  const name = requiredName(input.name, 'status');
  const row = await db.transaction(async (tx) => {
    const [last] = await tx.select({ position: statuses.position }).from(statuses).where(eq(statuses.projectId, projectId)).orderBy(sql`${statuses.position} COLLATE "C" desc`).limit(1);
    const [inserted] = await tx
      .insert(statuses)
      .values({
        orgId: ctx.orgId,
        projectId,
        name,
        category: input.category,
        color: input.color ?? 'gray',
        wipLimit: input.wipLimit ?? null,
        position: input.position ?? rankAfter(last?.position),
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'status.created', entityType: 'status', entityId: inserted.id, projectId, after: { name, category: input.category } });
    return inserted;
  });
  return toStatusDTO(row);
}

export async function updateStatus(
  ctx: DomainContext,
  statusId: string,
  patch: { name?: string; category?: StatusCategory; color?: string; wipLimit?: number | null; position?: string; isDefault?: boolean },
): Promise<StatusDTO> {
  const [current] = await db.select().from(statuses).where(and(eq(statuses.id, statusId), eq(statuses.orgId, ctx.orgId)));
  if (!current) throw notFound('That status');
  await requireProject(ctx, { id: current.projectId }, 'structure:manage');
  const set: Partial<typeof statuses.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = requiredName(patch.name, 'status');
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.wipLimit !== undefined) {
    if (patch.wipLimit !== null && (!Number.isInteger(patch.wipLimit) || patch.wipLimit < 1)) throw invalid('A limit has to be 1 or more.');
    set.wipLimit = patch.wipLimit;
  }
  if (patch.position !== undefined) set.position = patch.position;
  const row = await db.transaction(async (tx) => {
    if (patch.isDefault) {
      await tx.update(statuses).set({ isDefault: false }).where(and(eq(statuses.projectId, current.projectId), ne(statuses.id, statusId)));
      set.isDefault = true;
    }
    if (patch.category !== undefined && patch.category !== current.category) {
      const closed = patch.category === 'done' || patch.category === 'cancelled';
      await tx
        .update(tasks)
        .set(closed ? { completedAt: sql`coalesce(${tasks.completedAt}, now())` } : { completedAt: null })
        .where(eq(tasks.statusId, statusId));
    }
    const [updated] = await tx.update(statuses).set(set).where(eq(statuses.id, statusId)).returning();
    await logActivity(tx, ctx, {
      verb: 'status.updated',
      entityType: 'status',
      entityId: statusId,
      projectId: current.projectId,
      before: { name: current.name, category: current.category },
      after: { name: updated.name, category: updated.category },
    });
    return updated;
  });
  return toStatusDTO(row);
}

/** Deletes a status, moving its tasks to `moveToStatusId` (required when it has tasks). */
export async function deleteStatus(ctx: DomainContext, statusId: string, moveToStatusId?: string): Promise<void> {
  const [current] = await db.select().from(statuses).where(and(eq(statuses.id, statusId), eq(statuses.orgId, ctx.orgId)));
  if (!current) throw notFound('That status');
  await requireProject(ctx, { id: current.projectId }, 'structure:manage');
  const siblings = await db.select().from(statuses).where(eq(statuses.projectId, current.projectId));
  if (siblings.length <= 1) throw invalid('A project needs at least one status.');
  await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.statusId, statusId));
    if (Number(n) > 0) {
      const target = siblings.find((s) => s.id === moveToStatusId && s.id !== statusId);
      if (!target) throw invalid('Choose where the tasks in this status should go.');
      const closed = target.category === 'done' || target.category === 'cancelled';
      await tx
        .update(tasks)
        .set({ statusId: target.id, completedAt: closed ? sql`coalesce(${tasks.completedAt}, now())` : null, updatedAt: new Date() })
        .where(eq(tasks.statusId, statusId));
    }
    await tx.delete(statuses).where(eq(statuses.id, statusId));
    if (current.isDefault) {
      const next = siblings.filter((s) => s.id !== statusId).sort((a, b) => (a.position < b.position ? -1 : 1))[0];
      if (next) await tx.update(statuses).set({ isDefault: true }).where(eq(statuses.id, next.id));
    }
    await logActivity(tx, ctx, {
      verb: 'status.deleted',
      entityType: 'status',
      entityId: statusId,
      projectId: current.projectId,
      before: { name: current.name },
      meta: { movedTo: moveToStatusId ?? null, tasks: Number(n) },
    });
  });
}

// --- Sections -------------------------------------------------------------------------------

export async function createSection(ctx: DomainContext, projectId: string, input: { name: string; position?: string }): Promise<SectionDTO> {
  await requireProject(ctx, { id: projectId }, 'structure:manage');
  const name = requiredName(input.name, 'section');
  const row = await db.transaction(async (tx) => {
    const [last] = await tx.select({ position: sections.position }).from(sections).where(eq(sections.projectId, projectId)).orderBy(sql`${sections.position} COLLATE "C" desc`).limit(1);
    const [inserted] = await tx.insert(sections).values({ orgId: ctx.orgId, projectId, name, position: input.position ?? rankAfter(last?.position) }).returning();
    await logActivity(tx, ctx, { verb: 'section.created', entityType: 'section', entityId: inserted.id, projectId, after: { name } });
    return inserted;
  });
  return toSectionDTO(row);
}

export async function updateSection(ctx: DomainContext, sectionId: string, patch: { name?: string; position?: string }): Promise<SectionDTO> {
  const [current] = await db.select().from(sections).where(and(eq(sections.id, sectionId), eq(sections.orgId, ctx.orgId)));
  if (!current) throw notFound('That section');
  await requireProject(ctx, { id: current.projectId }, 'structure:manage');
  const set: Partial<typeof sections.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = requiredName(patch.name, 'section');
  if (patch.position !== undefined) set.position = patch.position;
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(sections).set(set).where(eq(sections.id, sectionId)).returning();
    await logActivity(tx, ctx, { verb: 'section.updated', entityType: 'section', entityId: sectionId, projectId: current.projectId, before: { name: current.name }, after: { name: updated[0].name } });
    return updated;
  });
  return toSectionDTO(row);
}

/** Deletes a section; its tasks move to `moveToSectionId` or become unsectioned. */
export async function deleteSection(ctx: DomainContext, sectionId: string, moveToSectionId?: string | null): Promise<void> {
  const [current] = await db.select().from(sections).where(and(eq(sections.id, sectionId), eq(sections.orgId, ctx.orgId)));
  if (!current) throw notFound('That section');
  await requireProject(ctx, { id: current.projectId }, 'structure:manage');
  await db.transaction(async (tx) => {
    if (moveToSectionId) {
      const [target] = await tx.select({ id: sections.id }).from(sections).where(and(eq(sections.id, moveToSectionId), eq(sections.projectId, current.projectId)));
      if (!target) throw invalid('That section is not part of this project.');
    }
    await tx.update(tasks).set({ sectionId: moveToSectionId ?? null }).where(eq(tasks.sectionId, sectionId));
    await tx.delete(sections).where(eq(sections.id, sectionId));
    await logActivity(tx, ctx, { verb: 'section.deleted', entityType: 'section', entityId: sectionId, projectId: current.projectId, before: { name: current.name } });
  });
}

// --- Labels ---------------------------------------------------------------------------------

/** Labels usable in a project (its own + workspace-wide), or only workspace-wide when projectId is null. */
export async function listLabels(ctx: DomainContext, projectId: string | null): Promise<LabelDTO[]> {
  if (projectId) await requireProject(ctx, { id: projectId });
  const where = projectId
    ? and(eq(labels.orgId, ctx.orgId), sql`(${labels.projectId} = ${projectId} or ${labels.projectId} is null)`)
    : and(eq(labels.orgId, ctx.orgId), isNull(labels.projectId));
  return (await db.select().from(labels).where(where).orderBy(asc(labels.name))).map(toLabelDTO);
}

export async function createLabel(ctx: DomainContext, input: { projectId: string | null; name: string; color?: string }): Promise<LabelDTO> {
  if (input.projectId) await requireProject(ctx, { id: input.projectId }, 'structure:manage');
  else requireOrg(ctx, 'space:manage');
  const name = requiredName(input.name, 'label').slice(0, 40);
  const existing = await listLabels(ctx, input.projectId);
  const duplicate = existing.find((label) => label.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return duplicate;
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx.insert(labels).values({ orgId: ctx.orgId, projectId: input.projectId, name, color: input.color ?? 'gray' }).returning();
    await logActivity(tx, ctx, { verb: 'label.created', entityType: 'label', entityId: inserted[0].id, projectId: input.projectId, after: { name } });
    return inserted;
  });
  return toLabelDTO(row);
}

async function loadLabel(ctx: DomainContext, labelId: string) {
  const [row] = await db.select().from(labels).where(and(eq(labels.id, labelId), eq(labels.orgId, ctx.orgId)));
  if (!row) throw notFound('That label');
  if (row.projectId) await requireProject(ctx, { id: row.projectId }, 'structure:manage');
  else requireOrg(ctx, 'space:manage');
  return row;
}

export async function updateLabel(ctx: DomainContext, labelId: string, patch: { name?: string; color?: string }): Promise<LabelDTO> {
  const current = await loadLabel(ctx, labelId);
  const set: Partial<typeof labels.$inferInsert> = {};
  if (patch.name !== undefined) set.name = requiredName(patch.name, 'label').slice(0, 40);
  if (patch.color !== undefined) set.color = patch.color;
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(labels).set(set).where(eq(labels.id, labelId)).returning();
    await logActivity(tx, ctx, { verb: 'label.updated', entityType: 'label', entityId: labelId, projectId: current.projectId, before: { name: current.name, color: current.color }, after: { name: updated[0].name, color: updated[0].color } });
    return updated;
  });
  return toLabelDTO(row);
}

export async function deleteLabel(ctx: DomainContext, labelId: string): Promise<void> {
  const current = await loadLabel(ctx, labelId);
  await db.transaction(async (tx) => {
    await tx.delete(labels).where(eq(labels.id, labelId));
    await logActivity(tx, ctx, { verb: 'label.deleted', entityType: 'label', entityId: labelId, projectId: current.projectId, before: { name: current.name } });
  });
}

// --- Custom fields --------------------------------------------------------------------------

export async function listCustomFields(ctx: DomainContext, projectId: string | null): Promise<CustomFieldDTO[]> {
  if (projectId) await requireProject(ctx, { id: projectId });
  const where = projectId
    ? and(eq(customFields.orgId, ctx.orgId), isNull(customFields.deletedAt), sql`(${customFields.projectId} = ${projectId} or ${customFields.projectId} is null)`)
    : and(eq(customFields.orgId, ctx.orgId), isNull(customFields.deletedAt), isNull(customFields.projectId));
  return (await db.select().from(customFields).where(where).orderBy(sql`${customFields.position} COLLATE "C"`)).map(toCustomFieldDTO);
}

function validateFieldConfig(type: CustomFieldType, config: CustomFieldConfig | undefined): CustomFieldConfig {
  const next: CustomFieldConfig = { ...(config ?? {}) };
  if (type === 'select' || type === 'multiselect') {
    const options = (next.options ?? []).map((option) => ({ ...option, label: option.label.trim() })).filter((option) => option.label);
    if (options.length === 0) throw invalid('Add at least one choice.', { options: 'Add at least one choice.' });
    return { ...next, options };
  }
  if (type === 'currency') return { ...next, currency: (next.currency ?? 'USD').toUpperCase().slice(0, 3), precision: next.precision ?? 2 };
  return next;
}

export async function createCustomField(
  ctx: DomainContext,
  input: { projectId: string | null; name: string; type: CustomFieldType; config?: CustomFieldConfig; description?: string | null; required?: boolean },
): Promise<CustomFieldDTO> {
  if (input.projectId) await requireProject(ctx, { id: input.projectId }, 'structure:manage');
  else requireOrg(ctx, 'workspace:manage');
  const name = requiredName(input.name, 'field');
  const config = validateFieldConfig(input.type, input.config);
  const [row] = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ position: customFields.position })
      .from(customFields)
      .where(and(eq(customFields.orgId, ctx.orgId), input.projectId ? eq(customFields.projectId, input.projectId) : isNull(customFields.projectId)))
      .orderBy(sql`${customFields.position} COLLATE "C" desc`)
      .limit(1);
    const inserted = await tx
      .insert(customFields)
      .values({
        orgId: ctx.orgId,
        projectId: input.projectId,
        name,
        type: input.type,
        config,
        description: cleanText(input.description),
        required: input.required ?? false,
        position: rankAfter(last?.position),
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'field.created', entityType: 'custom_field', entityId: inserted[0].id, projectId: input.projectId, after: { name, type: input.type } });
    return inserted;
  });
  return toCustomFieldDTO(row);
}

export async function updateCustomField(
  ctx: DomainContext,
  fieldId: string,
  patch: { name?: string; config?: CustomFieldConfig; description?: string | null; required?: boolean; position?: string },
): Promise<CustomFieldDTO> {
  const [current] = await db.select().from(customFields).where(and(eq(customFields.id, fieldId), eq(customFields.orgId, ctx.orgId), isNull(customFields.deletedAt)));
  if (!current) throw notFound('That field');
  if (current.projectId) await requireProject(ctx, { id: current.projectId }, 'structure:manage');
  else requireOrg(ctx, 'workspace:manage');
  const set: Partial<typeof customFields.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = requiredName(patch.name, 'field');
  if (patch.config !== undefined) set.config = validateFieldConfig(current.type, patch.config);
  if (patch.description !== undefined) set.description = cleanText(patch.description);
  if (patch.required !== undefined) set.required = patch.required;
  if (patch.position !== undefined) set.position = patch.position;
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(customFields).set(set).where(eq(customFields.id, fieldId)).returning();
    await logActivity(tx, ctx, { verb: 'field.updated', entityType: 'custom_field', entityId: fieldId, projectId: current.projectId, before: { name: current.name }, after: { name: updated[0].name } });
    return updated;
  });
  return toCustomFieldDTO(row);
}

export async function deleteCustomField(ctx: DomainContext, fieldId: string): Promise<void> {
  const [current] = await db.select().from(customFields).where(and(eq(customFields.id, fieldId), eq(customFields.orgId, ctx.orgId), isNull(customFields.deletedAt)));
  if (!current) throw notFound('That field');
  if (current.projectId) await requireProject(ctx, { id: current.projectId }, 'structure:manage');
  else requireOrg(ctx, 'workspace:manage');
  await db.transaction(async (tx) => {
    await tx.update(customFields).set({ deletedAt: new Date() }).where(eq(customFields.id, fieldId));
    await logActivity(tx, ctx, { verb: 'field.deleted', entityType: 'custom_field', entityId: fieldId, projectId: current.projectId, before: { name: current.name } });
  });
}

// --- Milestones -----------------------------------------------------------------------------

function toMilestoneDTO(row: typeof milestones.$inferSelect, counts = { taskCount: 0, doneCount: 0 }): MilestoneDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    dueDate: row.dueDate,
    completedAt: iso(row.completedAt),
    position: row.position,
    ...counts,
  };
}

export async function createMilestone(
  ctx: DomainContext,
  projectId: string,
  input: { name: string; description?: string | null; dueDate?: string | null },
): Promise<MilestoneDTO> {
  await requireProject(ctx, { id: projectId }, 'structure:manage');
  const name = requiredName(input.name, 'milestone');
  if (input.dueDate && !isIsoDate(input.dueDate)) throw invalid('Pick a valid date.', { dueDate: 'Pick a valid date.' });
  const [row] = await db.transaction(async (tx) => {
    const [last] = await tx.select({ position: milestones.position }).from(milestones).where(eq(milestones.projectId, projectId)).orderBy(sql`${milestones.position} COLLATE "C" desc`).limit(1);
    const inserted = await tx
      .insert(milestones)
      .values({ orgId: ctx.orgId, projectId, name, description: cleanText(input.description), dueDate: input.dueDate ?? null, position: rankAfter(last?.position), createdBy: ctx.userId })
      .returning();
    await logActivity(tx, ctx, { verb: 'milestone.created', entityType: 'milestone', entityId: inserted[0].id, projectId, after: { name, dueDate: input.dueDate ?? null } });
    return inserted;
  });
  return toMilestoneDTO(row);
}

export async function updateMilestone(
  ctx: DomainContext,
  milestoneId: string,
  patch: { name?: string; description?: string | null; dueDate?: string | null; completed?: boolean; position?: string },
): Promise<MilestoneDTO> {
  const [current] = await db.select().from(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.orgId, ctx.orgId), isNull(milestones.deletedAt)));
  if (!current) throw notFound('That milestone');
  await requireProject(ctx, { id: current.projectId }, 'structure:manage');
  const set: Partial<typeof milestones.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = requiredName(patch.name, 'milestone');
  if (patch.description !== undefined) set.description = cleanText(patch.description);
  if (patch.dueDate !== undefined) {
    if (patch.dueDate && !isIsoDate(patch.dueDate)) throw invalid('Pick a valid date.', { dueDate: 'Pick a valid date.' });
    set.dueDate = patch.dueDate;
  }
  if (patch.completed !== undefined) set.completedAt = patch.completed ? (current.completedAt ?? new Date()) : null;
  if (patch.position !== undefined) set.position = patch.position;
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(milestones).set(set).where(eq(milestones.id, milestoneId)).returning();
    await logActivity(tx, ctx, {
      verb: patch.completed === true ? 'milestone.reached' : 'milestone.updated',
      entityType: 'milestone',
      entityId: milestoneId,
      projectId: current.projectId,
      before: { name: current.name, dueDate: current.dueDate },
      after: { name: updated[0].name, dueDate: updated[0].dueDate },
    });
    return updated;
  });
  return toMilestoneDTO(row);
}

export async function deleteMilestone(ctx: DomainContext, milestoneId: string): Promise<void> {
  const [current] = await db.select().from(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.orgId, ctx.orgId), isNull(milestones.deletedAt)));
  if (!current) throw notFound('That milestone');
  await requireProject(ctx, { id: current.projectId }, 'structure:manage');
  await db.transaction(async (tx) => {
    await tx.update(milestones).set({ deletedAt: new Date() }).where(eq(milestones.id, milestoneId));
    await tx.update(tasks).set({ milestoneId: null }).where(eq(tasks.milestoneId, milestoneId));
    await logActivity(tx, ctx, { verb: 'milestone.deleted', entityType: 'milestone', entityId: milestoneId, projectId: current.projectId, before: { name: current.name } });
  });
}
