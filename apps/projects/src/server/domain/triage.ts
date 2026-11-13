/**
 * Triage: a per-project intake queue. Requests from forms (when the form says "Send to Triage"),
 * sibling apps or people typing them in wait here before they become tasks. Each one is
 * accepted (becomes a task), declined (with an optional reason), snoozed until a date (comes
 * back on its own), or merged into an existing task as a comment (duplicates).
 */
import 'server-only';
import { and, asc, desc, eq, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { forms, projects, triageItems, type TriageItem } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import { INTEGRATION_TARGET_TYPES, type IntegrationTargetType, type Priority } from '@/lib/constants';
import { isIsoDate, todayIso } from '@/lib/dates';
import { taskKey } from '@/lib/task-key';
import { routes } from '@/lib/routes';
import type { FormSettings } from '@/lib/form-types';
import type { TaskRef, TaskSummary, TriageItemDTO, TriageQueueDTO, TriageSource } from '@/lib/types';
import { cleanText, iso, isoRequired, type DomainContext } from './_shared';
import { requireProject, requireTask, type ProjectRefInput } from './access';
import { logActivity } from './activity';
import { addComment } from './comments';
import { addLink } from './links';
import { notify } from './notifications';
import { createTask } from './tasks';
import { selectTaskRefs } from './task-queries';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Plain text (manual requests) → the rich-text HTML tasks use. */
export function plainToHtml(text: string | null | undefined): string | null {
  const clean = cleanText(text);
  if (!clean) return null;
  return clean
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** HTML → short plain text for comments (merge as duplicate). */
function htmlToText(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toDTO(row: TriageItem, refs: ReadonlyMap<string, TaskRef>): TriageItemDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    priority: row.priority,
    source: row.source,
    sourceLabel: row.sourceLabel,
    formId: row.formId,
    linkType: row.linkType,
    linkId: row.linkId,
    requesterId: row.requesterId,
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    state: row.state,
    snoozedUntil: row.snoozedUntil,
    declineReason: row.declineReason,
    task: row.taskId ? (refs.get(row.taskId) ?? null) : null,
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    createdAt: isoRequired(row.createdAt),
  };
}

async function toDTOs(rows: readonly TriageItem[]): Promise<TriageItemDTO[]> {
  const taskIds = [...new Set(rows.map((row) => row.taskId).filter((id): id is string => Boolean(id)))];
  const refs = await selectTaskRefs(taskIds);
  return rows.map((row) => toDTO(row, refs));
}

async function loadItem(ctx: DomainContext, id: string, executor: Executor = db): Promise<TriageItem> {
  const [row] = await executor.select().from(triageItems).where(and(eq(triageItems.id, id), eq(triageItems.orgId, ctx.orgId))).limit(1);
  if (!row) throw notFound('That request');
  return row;
}

/** Snoozed requests whose date has come go back to the queue. */
async function wakeSnoozed(projectId: string): Promise<void> {
  await db
    .update(triageItems)
    .set({ state: 'pending', snoozedUntil: null })
    .where(and(eq(triageItems.projectId, projectId), eq(triageItems.state, 'snoozed'), lte(triageItems.snoozedUntil, todayIso())));
}

export type TriageFilter = 'open' | 'snoozed' | 'decided';

export async function listTriage(ctx: DomainContext, ref: ProjectRefInput, filter: TriageFilter = 'open'): Promise<TriageQueueDTO> {
  const { project } = await requireProject(ctx, ref);
  await wakeSnoozed(project.id);
  const where: SQL =
    filter === 'open'
      ? eq(triageItems.state, 'pending')
      : filter === 'snoozed'
        ? eq(triageItems.state, 'snoozed')
        : (inArray(triageItems.state, ['accepted', 'declined', 'merged']) as SQL);
  const rows = await db
    .select()
    .from(triageItems)
    .where(and(eq(triageItems.projectId, project.id), eq(triageItems.orgId, ctx.orgId), where))
    .orderBy(filter === 'decided' ? desc(triageItems.decidedAt) : filter === 'snoozed' ? asc(triageItems.snoozedUntil) : desc(triageItems.createdAt))
    .limit(filter === 'decided' ? 100 : 500);
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${triageItems.state} = 'pending')::int`,
      snoozed: sql<number>`count(*) filter (where ${triageItems.state} = 'snoozed')::int`,
      decided: sql<number>`count(*) filter (where ${triageItems.state} in ('accepted', 'declined', 'merged'))::int`,
    })
    .from(triageItems)
    .where(eq(triageItems.projectId, project.id));
  return {
    items: await toDTOs(rows),
    counts: { pending: Number(counts?.pending ?? 0), snoozed: Number(counts?.snoozed ?? 0), decided: Number(counts?.decided ?? 0) },
  };
}

/** Pending request count for the tab badge (cheap). */
export async function triagePendingCount(ctx: DomainContext, projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(triageItems)
    .where(
      and(
        eq(triageItems.projectId, projectId),
        eq(triageItems.orgId, ctx.orgId),
        or(eq(triageItems.state, 'pending'), and(eq(triageItems.state, 'snoozed'), lte(triageItems.snoozedUntil, todayIso()))),
      ),
    );
  return Number(row?.n ?? 0);
}

export interface NewTriageItem {
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly descriptionHtml?: string | null;
  readonly priority?: Priority;
  readonly source?: TriageSource;
  readonly sourceLabel?: string | null;
  readonly formId?: string | null;
  readonly link?: { readonly targetType: IntegrationTargetType; readonly targetId: string } | null;
  readonly requesterName?: string | null;
  readonly requesterEmail?: string | null;
}

/** Insert inside an existing transaction (forms, integrations). Does no permission checks. */
export async function insertTriageItem(tx: Executor, ctx: DomainContext, input: NewTriageItem): Promise<TriageItem> {
  const title = cleanText(input.title)?.slice(0, 500);
  if (!title) throw invalid('Give the request a short title.', { title: 'Give the request a short title.' });
  const [row] = await tx
    .insert(triageItems)
    .values({
      orgId: ctx.orgId,
      projectId: input.projectId,
      title,
      description: input.descriptionHtml ?? plainToHtml(input.description),
      priority: input.priority ?? 'none',
      source: input.source ?? 'manual',
      sourceLabel: cleanText(input.sourceLabel)?.slice(0, 120) ?? null,
      formId: input.formId ?? null,
      linkType: input.link?.targetType ?? null,
      linkId: input.link?.targetId ?? null,
      requesterId: ctx.actorKind === 'user' || ctx.actorKind === 'integration' ? ctx.userId : null,
      requesterName: cleanText(input.requesterName) ?? (ctx.actorKind === 'user' ? ctx.userName : null),
      requesterEmail: cleanText(input.requesterEmail),
      createdBy: ctx.actorKind === 'user' ? ctx.userId : null,
    })
    .returning();
  if (!row) throw invalid("Couldn't save the request.");
  await logActivity(tx, ctx, { verb: 'triage.added', entityType: 'triage', entityId: row.id, projectId: input.projectId, after: { title, source: row.source } });
  return row;
}

/** Anyone who can comment on the project can send a request into its Triage queue. */
export async function createTriageItem(ctx: DomainContext, input: NewTriageItem): Promise<TriageItemDTO> {
  const { project } = await requireProject(ctx, { id: input.projectId }, 'comment:create');
  if (input.link && !(INTEGRATION_TARGET_TYPES as readonly string[]).includes(input.link.targetType)) throw invalid('That link type is not supported.');
  const row = await db.transaction(async (tx) => {
    const created = await insertTriageItem(tx, ctx, { ...input, descriptionHtml: null, source: input.source ?? 'manual' });
    await notify(tx, ctx, {
      recipients: [project.ownerId],
      kind: 'project',
      title: `New request in ${project.name} Triage: ${created.title}`,
      url: routes.projectTriage(project.key),
      projectId: project.id,
    });
    return created;
  });
  const [dto] = await toDTOs([row]);
  return dto!;
}

async function decide(ctx: DomainContext, item: TriageItem, patch: Partial<typeof triageItems.$inferInsert>, verb: string, extra: { taskId?: string | null } = {}) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(triageItems)
      .set({ ...patch, decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(triageItems.id, item.id), inArray(triageItems.state, ['pending', 'snoozed'])))
      .returning();
    if (!row) throw invalid('Someone already handled this request.');
    await logActivity(tx, ctx, { verb, entityType: 'triage', entityId: item.id, projectId: item.projectId, taskId: extra.taskId ?? null, before: { title: item.title } });
    return row;
  });
}

export interface AcceptTriageInput {
  readonly title?: string;
  readonly statusId?: string | null;
  readonly assigneeId?: string | null;
  readonly priority?: Priority;
  readonly dueDate?: string | null;
}

/** Accept: the request becomes a task in the project (form defaults apply), linked records carry over. */
export async function acceptTriageItem(ctx: DomainContext, id: string, input: AcceptTriageInput = {}): Promise<{ item: TriageItemDTO; task: TaskSummary }> {
  const item = await loadItem(ctx, id);
  await requireProject(ctx, { id: item.projectId }, 'task:create');
  if (item.state !== 'pending' && item.state !== 'snoozed') throw invalid('Someone already handled this request.');
  let settings: FormSettings = {};
  if (item.formId) {
    const [form] = await db.select({ settings: forms.settings }).from(forms).where(eq(forms.id, item.formId)).limit(1);
    settings = form?.settings ?? {};
  }
  if (input.dueDate && !isIsoDate(input.dueDate)) throw invalid('Pick a valid due date.');
  const task = await createTask(ctx, {
    projectId: item.projectId,
    title: cleanText(input.title) ?? item.title,
    description: item.description,
    statusId: input.statusId ?? settings.statusId ?? null,
    sectionId: settings.sectionId ?? null,
    assigneeId: input.assigneeId !== undefined ? input.assigneeId : (settings.assigneeId ?? null),
    priority: input.priority ?? (item.priority !== 'none' ? item.priority : (settings.priority ?? 'none')),
    dueDate: input.dueDate ?? null,
    labelIds: settings.labelIds ?? [],
    at: 'top',
  });
  if (item.linkType && item.linkId && (INTEGRATION_TARGET_TYPES as readonly string[]).includes(item.linkType)) {
    await addLink(ctx, { taskId: task.id, targetType: item.linkType as IntegrationTargetType, targetId: item.linkId }).catch((error: unknown) => {
      console.error('[triage] could not carry the link over', error);
    });
  }
  const row = await decide(ctx, item, { state: 'accepted', taskId: task.id, snoozedUntil: null }, 'triage.accepted', { taskId: task.id });
  if (item.requesterId && item.requesterId !== ctx.userId) {
    const [project] = await db.select({ key: projects.key }).from(projects).where(eq(projects.id, item.projectId)).limit(1);
    if (project) {
      await notify(db, ctx, {
        recipients: [item.requesterId],
        kind: 'project',
        title: `Your request was accepted: ${taskKey(project.key, task.number)} ${task.title}`,
        url: routes.task(project.key, task.number),
        projectId: item.projectId,
        taskId: task.id,
      });
    }
  }
  const [dto] = await toDTOs([row]);
  return { item: dto!, task };
}

export async function declineTriageItem(ctx: DomainContext, id: string, reason?: string | null): Promise<TriageItemDTO> {
  const item = await loadItem(ctx, id);
  await requireProject(ctx, { id: item.projectId }, 'task:create');
  const row = await decide(ctx, item, { state: 'declined', declineReason: cleanText(reason)?.slice(0, 500) ?? null, snoozedUntil: null }, 'triage.declined');
  const [dto] = await toDTOs([row]);
  return dto!;
}

export async function snoozeTriageItem(ctx: DomainContext, id: string, until: string): Promise<TriageItemDTO> {
  const item = await loadItem(ctx, id);
  await requireProject(ctx, { id: item.projectId }, 'task:create');
  if (!isIsoDate(until) || until <= todayIso()) throw invalid('Pick a day after today.', { until: 'Pick a day after today.' });
  if (item.state !== 'pending' && item.state !== 'snoozed') throw invalid('Someone already handled this request.');
  const [row] = await db.update(triageItems).set({ state: 'snoozed', snoozedUntil: until }).where(eq(triageItems.id, id)).returning();
  const [dto] = await toDTOs([row!]);
  return dto!;
}

/** Duplicate: the request text lands as a comment on the existing task and the request closes. */
export async function mergeTriageItem(ctx: DomainContext, id: string, intoTaskId: string): Promise<TriageItemDTO> {
  const item = await loadItem(ctx, id);
  await requireProject(ctx, { id: item.projectId }, 'task:create');
  const { task } = await requireTask(ctx, intoTaskId, 'comment:create');
  if (item.state !== 'pending' && item.state !== 'snoozed') throw invalid('Someone already handled this request.');
  const who = [item.requesterName, item.requesterEmail].filter(Boolean).join(' · ');
  const body = [`**Merged a duplicate request:** ${item.title}`, htmlToText(item.description), who ? `Sent by ${who}${item.sourceLabel ? ` (${item.sourceLabel})` : ''}.` : null]
    .filter(Boolean)
    .join('\n\n');
  await addComment(ctx, { taskId: task.id, body: body.slice(0, 19_000) });
  const row = await decide(ctx, item, { state: 'merged', taskId: task.id, snoozedUntil: null }, 'triage.merged', { taskId: task.id });
  const [dto] = await toDTOs([row]);
  return dto!;
}

/** Undo a decline or snooze: the request goes back to the queue. Accepted/merged ones stay put. */
export async function reopenTriageItem(ctx: DomainContext, id: string): Promise<TriageItemDTO> {
  const item = await loadItem(ctx, id);
  await requireProject(ctx, { id: item.projectId }, 'task:create');
  if (item.state === 'accepted' || item.state === 'merged') throw invalid('This request is already a task. Open the task to change it.');
  const [row] = await db
    .update(triageItems)
    .set({ state: 'pending', snoozedUntil: null, declineReason: null, decidedAt: null, decidedBy: null })
    .where(eq(triageItems.id, id))
    .returning();
  const [dto] = await toDTOs([row!]);
  return dto!;
}
