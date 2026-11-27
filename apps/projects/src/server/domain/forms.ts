/**
 * Intake forms: editors build a form for a project; anyone with the link (public forms) or any
 * signed-in member submits it at /forms/<token>, which creates a task. Answers map onto task
 * fields (`mapTo`); unmapped answers are written into the description as a Q&A list.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { organization } from '@kitstak/db/schema';
import { db } from '@/server/db';
import { orgProjectsAccess } from '@/server/entitlements';
import { formSubmissions, forms, projects, tasks, type Form } from '@/server/db/schema';
import { DomainError, invalid, notFound } from '@/server/errors';
import { PRIORITIES, type Priority } from '@/lib/constants';
import { isIsoDate } from '@/lib/dates';
import type { FormField, FormSettings } from '@/lib/form-types';
import { routes } from '@/lib/routes';
import { taskKey } from '@/lib/task-key';
import type { FormDTO, PublicFormDTO } from '@/lib/types';
import { cleanText, isoRequired, type DomainContext } from './_shared';
import { requireProject } from './access';
import { logActivity } from './activity';
import { notify } from './notifications';
import { insertTask } from './tasks';

function toDTO(row: Form): FormDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    fields: row.fields,
    settings: row.settings,
    isPublic: row.isPublic,
    enabled: row.enabled,
    publicToken: row.publicToken,
    submissionCount: row.submissionCount,
    createdAt: isoRequired(row.createdAt),
  };
}

const newToken = (): string => randomBytes(18).toString('base64url');

export async function listForms(ctx: DomainContext, projectId?: string): Promise<FormDTO[]> {
  if (projectId) await requireProject(ctx, { id: projectId });
  const rows = await db
    .select()
    .from(forms)
    .where(and(eq(forms.orgId, ctx.orgId), isNull(forms.deletedAt), projectId ? eq(forms.projectId, projectId) : undefined))
    .orderBy(desc(forms.createdAt));
  if (projectId) return rows.map(toDTO);
  const visible: FormDTO[] = [];
  for (const row of rows) {
    try {
      await requireProject(ctx, { id: row.projectId });
      visible.push(toDTO(row));
    } catch {
      // hidden project
    }
  }
  return visible;
}

async function loadForm(ctx: DomainContext, formId: string): Promise<Form> {
  const [row] = await db.select().from(forms).where(and(eq(forms.id, formId), eq(forms.orgId, ctx.orgId), isNull(forms.deletedAt)));
  if (!row) throw notFound('That form');
  return row;
}

export async function getForm(ctx: DomainContext, formId: string): Promise<FormDTO> {
  const row = await loadForm(ctx, formId);
  await requireProject(ctx, { id: row.projectId });
  return toDTO(row);
}

function validateFields(fields: readonly FormField[]): FormField[] {
  if (fields.length === 0) throw invalid('Add at least one question.');
  if (fields.length > 50) throw invalid('Forms can have up to 50 questions.');
  const titles = fields.filter((f) => f.mapTo === 'title');
  if (titles.length > 1) throw invalid('Only one question can become the task name.');
  return fields.map((field) => {
    const label = cleanText(field.label);
    if (!label) throw invalid('Every question needs a label.');
    if ((field.type === 'select' || field.type === 'multiselect') && !(field.options?.length)) {
      throw invalid(`Add choices to “${label}”.`);
    }
    return { ...field, label };
  });
}

export interface FormInput {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly fields: readonly FormField[];
  readonly settings?: FormSettings;
  readonly isPublic?: boolean;
  readonly enabled?: boolean;
}

export async function createForm(ctx: DomainContext, input: FormInput): Promise<FormDTO> {
  await requireProject(ctx, { id: input.projectId }, 'form:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the form a name.', { name: 'Give the form a name.' });
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(forms)
      .values({
        orgId: ctx.orgId,
        projectId: input.projectId,
        name,
        description: cleanText(input.description),
        fields: validateFields(input.fields),
        settings: input.settings ?? {},
        isPublic: input.isPublic ?? true,
        enabled: input.enabled ?? true,
        publicToken: newToken(),
        createdBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'form.created', entityType: 'form', entityId: inserted[0].id, projectId: input.projectId, after: { name } });
    return inserted;
  });
  return toDTO(row);
}

export async function updateForm(
  ctx: DomainContext,
  formId: string,
  patch: Partial<Omit<FormInput, 'projectId'>> & { readonly regenerateLink?: boolean },
): Promise<FormDTO> {
  const current = await loadForm(ctx, formId);
  await requireProject(ctx, { id: current.projectId }, 'form:manage');
  const set: Partial<typeof forms.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw invalid('Give the form a name.', { name: 'Give the form a name.' });
    set.name = name;
  }
  if (patch.description !== undefined) set.description = cleanText(patch.description);
  if (patch.fields !== undefined) set.fields = validateFields(patch.fields);
  if (patch.settings !== undefined) set.settings = patch.settings;
  if (patch.isPublic !== undefined) set.isPublic = patch.isPublic;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.regenerateLink) set.publicToken = newToken();
  const [row] = await db.update(forms).set(set).where(eq(forms.id, formId)).returning();
  return toDTO(row);
}

export async function deleteForm(ctx: DomainContext, formId: string): Promise<void> {
  const current = await loadForm(ctx, formId);
  await requireProject(ctx, { id: current.projectId }, 'form:manage');
  await db.transaction(async (tx) => {
    await tx.update(forms).set({ deletedAt: new Date() }).where(eq(forms.id, formId));
    await logActivity(tx, ctx, { verb: 'form.deleted', entityType: 'form', entityId: formId, projectId: current.projectId, before: { name: current.name } });
  });
}

/** Undo for deleteForm. */
export async function restoreForm(ctx: DomainContext, formId: string): Promise<FormDTO> {
  const [row] = await db.select().from(forms).where(and(eq(forms.id, formId), eq(forms.orgId, ctx.orgId)));
  if (!row) throw notFound('That form');
  await requireProject(ctx, { id: row.projectId }, 'form:manage');
  const [restored] = await db.update(forms).set({ deletedAt: null, updatedAt: new Date() }).where(eq(forms.id, formId)).returning();
  return toDTO(restored);
}

export async function listFormSubmissions(ctx: DomainContext, formId: string, limit = 100) {
  const current = await loadForm(ctx, formId);
  await requireProject(ctx, { id: current.projectId });
  const rows = await db
    .select({ submission: formSubmissions, taskNumber: tasks.number, taskTitle: tasks.title, taskDeletedAt: tasks.deletedAt, projectKey: projects.key })
    .from(formSubmissions)
    .leftJoin(tasks, eq(tasks.id, formSubmissions.taskId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(formSubmissions.formId, formId))
    .orderBy(desc(formSubmissions.createdAt))
    .limit(Math.min(limit, 500));
  return rows.map(({ submission: row, taskNumber, taskTitle, taskDeletedAt, projectKey }) => ({
    id: row.id,
    taskId: row.taskId,
    data: row.data,
    submitterName: row.submitterName,
    submitterEmail: row.submitterEmail,
    createdAt: isoRequired(row.createdAt),
    /** `OPS-42` of the task it created (null if that task was deleted). */
    taskKey: taskNumber !== null && projectKey && !taskDeletedAt ? taskKey(projectKey, taskNumber) : null,
    taskTitle: taskDeletedAt ? null : taskTitle,
  }));
}

// --- Public ---------------------------------------------------------------------------------

async function loadPublic(token: string) {
  const [row] = await db
    .select({ form: forms, orgName: organization.name, projectName: projects.name, projectKey: projects.key, project: projects })
    .from(forms)
    .innerJoin(projects, eq(projects.id, forms.projectId))
    .innerJoin(organization, eq(organization.id, forms.orgId))
    .where(and(eq(forms.publicToken, token), isNull(forms.deletedAt), isNull(projects.deletedAt)));
  return row ?? null;
}

/** What /forms/<token> renders. `viewerOrgIds` lets members open non-public forms. */
export async function getPublicForm(token: string, viewerOrgIds: readonly string[] = []): Promise<PublicFormDTO | null> {
  const row = await loadPublic(token);
  if (!row || !row.form.enabled || row.project.archivedAt) return null;
  if (!row.form.isPublic && !viewerOrgIds.includes(row.form.orgId)) return null;
  return {
    token,
    name: row.form.name,
    description: row.form.description,
    fields: row.form.fields,
    collectContact: row.form.settings.collectContact ?? row.form.isPublic,
    confirmationMessage: row.form.settings.confirmationMessage ?? null,
    accentColor: row.form.settings.accentColor ?? null,
    orgName: row.orgName,
    projectName: row.projectName,
  };
}

export interface SubmitFormInput {
  readonly token: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly submitterName?: string | null;
  readonly submitterEmail?: string | null;
  /** Signed-in submitter (non-public forms). */
  readonly viewer?: { readonly userId: string; readonly name: string; readonly orgIds: readonly string[] } | null;
}

function answerText(field: FormField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'checkbox') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value.map((id) => field.options?.find((o) => o.id === id)?.label ?? String(id)).join(', ');
  }
  if (field.type === 'select') return field.options?.find((o) => o.id === value)?.label ?? String(value);
  return String(value);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Validates answers, creates the task and records the submission. Returns the plain confirmation. */
export async function submitForm(input: SubmitFormInput): Promise<{ confirmation: string }> {
  const row = await loadPublic(input.token);
  if (!row || !row.form.enabled || row.project.archivedAt) throw notFound('This form');
  const { form, project } = row;
  if (!form.isPublic && !input.viewer?.orgIds.includes(form.orgId)) throw new DomainError('UNAUTHENTICATED', 'Sign in to fill out this form.');
  // A form answer becomes a task. While the org's plan is view only, or Projects is not in its
  // plan, nothing may be written (docs/billing/SPEC.md section 9.4).
  if ((await orgProjectsAccess(form.orgId)) !== 'full') {
    throw new DomainError('FORBIDDEN', 'This form is not taking answers right now. Please try again later.');
  }
  const errors: Record<string, string> = {};
  const answers: Record<string, unknown> = {};
  for (const field of form.fields) {
    const raw = input.answers[field.id];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || (field.type === 'checkbox' && value !== true);
    if (field.required && empty) {
      errors[field.id] = 'This question is required.';
      continue;
    }
    if (empty) continue;
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors[field.id] = 'Enter a valid email address.';
    if (field.type === 'number' && !Number.isFinite(Number(value))) errors[field.id] = 'Enter a number.';
    if (field.type === 'date' && !isIsoDate(value)) errors[field.id] = 'Pick a valid date.';
    if (field.type === 'url' && !/^https?:\/\//i.test(String(value))) errors[field.id] = 'Enter a link starting with http:// or https://';
    if ((field.type === 'select') && !field.options?.some((o) => o.id === value)) errors[field.id] = 'Pick one of the choices.';
    if (field.type === 'multiselect' && (!Array.isArray(value) || !value.every((v) => field.options?.some((o) => o.id === v)))) errors[field.id] = 'Pick from the choices.';
    if (typeof value === 'string' && value.length > 10_000) errors[field.id] = 'That answer is too long.';
    answers[field.id] = field.type === 'number' ? Number(value) : value;
  }
  const email = cleanText(input.submitterEmail);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.submitterEmail = 'Enter a valid email address.';
  if (Object.keys(errors).length) throw invalid('Some answers need another look.', errors);

  const titleField = form.fields.find((f) => f.mapTo === 'title');
  const submitter = cleanText(input.submitterName) ?? input.viewer?.name ?? null;
  const title = (titleField ? answerText(titleField, answers[titleField.id]) : '') || `${form.name}${submitter ? ` from ${submitter}` : ''}`;
  const descriptionParts: string[] = [];
  const mappedDescription = form.fields.find((f) => f.mapTo === 'description');
  if (mappedDescription && answers[mappedDescription.id]) {
    descriptionParts.push(`<p>${escapeHtml(answerText(mappedDescription, answers[mappedDescription.id])).replace(/\n/g, '<br>')}</p>`);
  }
  const extra = form.fields.filter((f) => !f.mapTo && answers[f.id] !== undefined);
  if (extra.length) {
    descriptionParts.push(
      `<ul>${extra.map((f) => `<li><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(answerText(f, answers[f.id]))}</li>`).join('')}</ul>`,
    );
  }
  if (submitter || email) descriptionParts.push(`<p>Sent by ${escapeHtml([submitter, email].filter(Boolean).join(' · '))} using the form “${escapeHtml(form.name)}”.</p>`);
  const dueField = form.fields.find((f) => f.mapTo === 'due_date');
  const priorityField = form.fields.find((f) => f.mapTo === 'priority');
  const priorityAnswer = priorityField ? answerText(priorityField, answers[priorityField.id]).toLowerCase() : '';
  const priority: Priority | undefined = (PRIORITIES as readonly string[]).includes(priorityAnswer)
    ? (priorityAnswer as Priority)
    : form.settings.priority;
  const customFields: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (field.mapTo?.startsWith('custom:') && answers[field.id] !== undefined) customFields[field.mapTo.slice(7)] = answers[field.id];
  }

  const ctx: DomainContext = {
    orgId: form.orgId,
    orgSlug: '',
    userId: input.viewer?.userId ?? form.createdBy ?? '00000000-0000-0000-0000-000000000000',
    userName: submitter ?? 'Form',
    orgRole: 'owner',
    actorKind: input.viewer ? 'integration' : 'system',
  };
  if (form.settings.sendToTriage) {
    // The answer waits in the project's Triage queue; someone accepts it into a task.
    const { insertTriageItem } = await import('./triage');
    await db.transaction(async (tx) => {
      const item = await insertTriageItem(tx, ctx, {
        projectId: project.id,
        title: title.slice(0, 500),
        descriptionHtml: descriptionParts.join('') || null,
        priority: priority ?? 'none',
        source: 'form',
        sourceLabel: form.name,
        formId: form.id,
        requesterName: submitter,
        requesterEmail: email,
      });
      await tx.insert(formSubmissions).values({
        orgId: form.orgId,
        formId: form.id,
        taskId: null,
        data: answers,
        submitterName: submitter,
        submitterEmail: email,
        submittedBy: input.viewer?.userId ?? null,
      });
      await tx.update(forms).set({ submissionCount: sql`${forms.submissionCount} + 1` }).where(eq(forms.id, form.id));
      await logActivity(tx, ctx, { verb: 'form.submitted', entityType: 'form', entityId: form.id, projectId: project.id, meta: { submitter, email, triageItemId: item.id } });
      await notify(tx, ctx, {
        recipients: [...(form.settings.notifyUserIds ?? []), project.ownerId],
        kind: 'project',
        title: `New “${form.name}” response in Triage: ${item.title}`,
        url: routes.projectTriage(project.key),
        projectId: project.id,
      });
    });
    return { confirmation: form.settings.confirmationMessage ?? 'Thanks! Your request was sent to the team.' };
  }
  // Build forms (docs/programs/SPEC.md 5.17): on a program, `settings.build` maps a variant
  // question and a qty question, and each answer makes a build dated today (or the mapped date).
  const buildMode = (form.settings as { build?: { variantFieldId?: string; qtyFieldId?: string; dateFieldId?: string } }).build;
  if (project.kind === 'program' && buildMode?.variantFieldId && buildMode.qtyFieldId) {
    const { formBuild } = await import('./programs/form-builds');
    const created = await formBuild(ctx, project, {
      variantAnswer: answerText(form.fields.find((f) => f.id === buildMode.variantFieldId)!, answers[buildMode.variantFieldId]),
      qtyAnswer: String(answers[buildMode.qtyFieldId] ?? ''),
      dateAnswer: buildMode.dateFieldId && isIsoDate(answers[buildMode.dateFieldId]) ? (answers[buildMode.dateFieldId] as string) : null,
      title: titleField ? title : null,
      description: descriptionParts.join('') || null,
    });
    await db.transaction(async (tx) => {
      await tx.insert(formSubmissions).values({ orgId: form.orgId, formId: form.id, taskId: created.taskId, data: answers, submitterName: submitter, submitterEmail: email, submittedBy: input.viewer?.userId ?? null });
      await tx.update(forms).set({ submissionCount: sql`${forms.submissionCount} + 1` }).where(eq(forms.id, form.id));
      await logActivity(tx, ctx, { verb: 'form.submitted', entityType: 'form', entityId: form.id, projectId: project.id, taskId: created.taskId, meta: { submitter, email, build: true } });
      await notify(tx, ctx, {
        recipients: [...(form.settings.notifyUserIds ?? []), project.ownerId],
        kind: 'project',
        title: `New “${form.name}” response: ${taskKey(project.key, created.number)} planned`,
        url: routes.taskAny(project.kind, project.key, created.number),
        projectId: project.id,
        taskId: created.taskId,
      });
    });
    return { confirmation: form.settings.confirmationMessage ?? 'Thanks! Your request was sent to the team.' };
  }
  const task = await db.transaction(async (tx) => {
    const created = await insertTask(
      tx,
      ctx,
      project,
      {
        projectId: project.id,
        title: title.slice(0, 500),
        description: descriptionParts.join('') || null,
        statusId: form.settings.statusId ?? null,
        sectionId: form.settings.sectionId ?? null,
        assigneeId: form.settings.assigneeId ?? null,
        priority,
        dueDate: dueField && isIsoDate(answers[dueField.id]) ? (answers[dueField.id] as string) : null,
        labelIds: form.settings.labelIds ?? [],
        customFields,
        at: 'top',
      },
      { logVerb: 'task.created', activityMeta: { formId: form.id, formName: form.name } },
    );
    await tx.insert(formSubmissions).values({
      orgId: form.orgId,
      formId: form.id,
      taskId: created.id,
      data: answers,
      submitterName: submitter,
      submitterEmail: email,
      submittedBy: input.viewer?.userId ?? null,
    });
    await tx.update(forms).set({ submissionCount: sql`${forms.submissionCount} + 1` }).where(eq(forms.id, form.id));
    await logActivity(tx, ctx, { verb: 'form.submitted', entityType: 'form', entityId: form.id, projectId: project.id, taskId: created.id, meta: { submitter, email } });
    await notify(tx, ctx, {
      recipients: [...(form.settings.notifyUserIds ?? []), project.ownerId],
      kind: 'project',
      title: `New “${form.name}” response: ${taskKey(project.key, created.number)} ${created.title}`,
      url: routes.task(project.key, created.number),
      projectId: project.id,
      taskId: created.id,
    });
    return created;
  });
  // Rules like "When a task is created, assign it to…" also apply to form submissions.
  try {
    const { selectTaskSummary } = await import('./task-queries');
    const { engineTaskFromSummary } = await import('./automation-sweep');
    const { runAutomationsForEvents } = await import('./automations');
    const summary = await selectTaskSummary(task.id);
    if (summary) await runAutomationsForEvents(ctx, [{ type: 'task_created', task: engineTaskFromSummary(summary) }]);
  } catch (error) {
    console.error('[forms] automations after submit failed', error);
  }
  return { confirmation: form.settings.confirmationMessage ?? 'Thanks! Your request was sent to the team.' };
}
