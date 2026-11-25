/** Task comments: markdown body with @mentions, threaded replies, emoji reactions. */
import 'server-only';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { attachments, comments, tasks, type Comment } from '@/server/db/schema';
import { forbidden, invalid, notFound } from '@/server/errors';
import { REACTION_EMOJIS } from '@/lib/constants';
import { extractMentions, plainMentions } from '@/lib/mentions';
import { routes } from '@/lib/routes';
import { taskKey } from '@/lib/task-key';
import type { CommentDTO } from '@/lib/types';
import { iso, isoRequired, toAttachmentDTO, type DomainContext } from './_shared';
import { requireTask } from './access';
import { logActivity } from './activity';
import { addWatchers, listWatcherIds, notify } from './notifications';
import { filterOrgMembers } from './people';

const MAX_BODY = 20_000;
const ALLOWED_REACTIONS: ReadonlySet<string> = new Set(REACTION_EMOJIS);

async function toDTOs(rows: readonly Comment[]): Promise<CommentDTO[]> {
  if (rows.length === 0) return [];
  const files = await db
    .select({
      id: attachments.id,
      orgId: attachments.orgId,
      projectId: attachments.projectId,
      taskId: attachments.taskId,
      commentId: attachments.commentId,
      name: attachments.name,
      contentType: attachments.contentType,
      sizeBytes: attachments.sizeBytes,
      storage: attachments.storage,
      storageKey: attachments.storageKey,
      uploadedBy: attachments.uploadedBy,
      createdAt: attachments.createdAt,
      deletedAt: attachments.deletedAt,
    })
    .from(attachments)
    .where(and(inArray(attachments.commentId, rows.map((row) => row.id)), isNull(attachments.deletedAt)));
  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    parentCommentId: row.parentCommentId,
    authorId: row.authorId,
    body: row.body,
    mentions: row.mentions,
    reactions: row.reactions,
    editedAt: iso(row.editedAt),
    createdAt: isoRequired(row.createdAt),
    attachments: files.filter((file) => file.commentId === row.id).map(toAttachmentDTO),
  }));
}

export async function listComments(ctx: DomainContext, taskId: string): Promise<CommentDTO[]> {
  await requireTask(ctx, taskId);
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.taskId, taskId), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt));
  return toDTOs(rows);
}

export interface AddCommentInput {
  readonly taskId: string;
  readonly body: string;
  readonly parentCommentId?: string | null;
  /** Already-uploaded attachments (uploaded with this task) to attach to the comment. */
  readonly attachmentIds?: readonly string[];
}

export async function addComment(ctx: DomainContext, input: AddCommentInput): Promise<CommentDTO> {
  const { task, project } = await requireTask(ctx, input.taskId, 'comment:create');
  const body = input.body.trim();
  if (!body) throw invalid('Write something before posting.', { body: 'Write something before posting.' });
  if (body.length > MAX_BODY) throw invalid('Comments can be up to 20,000 characters.', { body: 'Too long.' });
  const mentions = await filterOrgMembers(ctx, extractMentions(body));
  const authorId = ctx.actorKind === 'user' || ctx.actorKind === 'integration' ? ctx.userId : null;
  const row = await db.transaction(async (tx) => {
    if (input.parentCommentId) {
      const [parent] = await tx
        .select({ id: comments.id })
        .from(comments)
        .where(and(eq(comments.id, input.parentCommentId), eq(comments.taskId, task.id), isNull(comments.deletedAt)));
      if (!parent) throw invalid('The comment you replied to was deleted.');
    }
    const [inserted] = await tx
      .insert(comments)
      .values({
        orgId: ctx.orgId,
        projectId: project.id,
        taskId: task.id,
        parentCommentId: input.parentCommentId ?? null,
        authorId,
        body,
        mentions,
      })
      .returning();
    if (input.attachmentIds?.length) {
      await tx
        .update(attachments)
        .set({ commentId: inserted.id })
        .where(and(inArray(attachments.id, [...input.attachmentIds]), eq(attachments.taskId, task.id)));
    }
    const followers = await listWatcherIds(task.id, tx);
    await addWatchers(tx, ctx, task.id, [authorId, ...mentions]);
    const key = taskKey(project.key, task.number);
    const url = `${routes.task(project.key, task.number)}#comment-${inserted.id}`;
    const preview = plainMentions(body).slice(0, 280);
    if (mentions.length) {
      await notify(tx, ctx, {
        recipients: mentions,
        kind: 'mention',
        title: `${ctx.userName} mentioned you on ${key}: ${task.title}`,
        body: preview,
        url,
        projectId: project.id,
        taskId: task.id,
        commentId: inserted.id,
      });
    }
    await notify(tx, ctx, {
      recipients: followers.filter((id) => !mentions.includes(id)),
      kind: 'comment',
      title: `${ctx.userName} commented on ${key}: ${task.title}`,
      body: preview,
      url,
      projectId: project.id,
      taskId: task.id,
      commentId: inserted.id,
    });
    await logActivity(tx, ctx, {
      verb: 'comment.added',
      entityType: 'comment',
      entityId: inserted.id,
      projectId: project.id,
      taskId: task.id,
      after: { preview: preview.slice(0, 140) },
    });
    await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    return inserted;
  });
  if (ctx.actorKind === 'user') {
    const { selectTaskSummary } = await import('./task-queries');
    const summary = await selectTaskSummary(task.id);
    if (summary) {
      const { runAutomationsForEvents } = await import('./automations');
      // The shared snapshot carries kind and variant, so workspace rules never treat a build as a task.
      const { engineTaskFromSummary } = await import('./automation-sweep');
      await runAutomationsForEvents(ctx, [{ type: 'comment_added', task: engineTaskFromSummary(summary) }]);
    }
  }
  const [dto] = await toDTOs([row]);
  return dto;
}

async function loadOwnComment(ctx: DomainContext, commentId: string): Promise<Comment> {
  const [row] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.orgId, ctx.orgId), isNull(comments.deletedAt)));
  if (!row) throw notFound('That comment');
  return row;
}

export async function editComment(ctx: DomainContext, commentId: string, body: string): Promise<CommentDTO> {
  const current = await loadOwnComment(ctx, commentId);
  await requireTask(ctx, current.taskId, 'comment:create');
  if (current.authorId !== ctx.userId) throw forbidden('You can only edit your own comments.');
  const text = body.trim();
  if (!text) throw invalid('Write something before saving.', { body: 'Write something before saving.' });
  const mentions = await filterOrgMembers(ctx, extractMentions(text));
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(comments)
      .set({ body: text.slice(0, MAX_BODY), mentions, editedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning();
    const newMentions = mentions.filter((id) => !current.mentions.includes(id));
    if (newMentions.length) {
      const [task] = await tx.select({ number: tasks.number, title: tasks.title }).from(tasks).where(eq(tasks.id, current.taskId));
      const { projects } = await import('@/server/db/schema');
      const [project] = await tx.select({ key: projects.key }).from(projects).where(eq(projects.id, current.projectId));
      if (task && project) {
        await notify(tx, ctx, {
          recipients: newMentions,
          kind: 'mention',
          title: `${ctx.userName} mentioned you on ${taskKey(project.key, task.number)}: ${task.title}`,
          body: plainMentions(text).slice(0, 280),
          url: `${routes.task(project.key, task.number)}#comment-${commentId}`,
          projectId: current.projectId,
          taskId: current.taskId,
          commentId,
        });
        await addWatchers(tx, ctx, current.taskId, newMentions);
      }
    }
    await logActivity(tx, ctx, {
      verb: 'comment.edited',
      entityType: 'comment',
      entityId: commentId,
      projectId: current.projectId,
      taskId: current.taskId,
    });
    return updated;
  });
  const [dto] = await toDTOs([row]);
  return dto;
}

/** Authors delete their own comments; project editors can delete anyone's. */
export async function deleteComment(ctx: DomainContext, commentId: string): Promise<void> {
  const current = await loadOwnComment(ctx, commentId);
  const { capabilities } = await requireTask(ctx, current.taskId, 'comment:create');
  if (current.authorId !== ctx.userId && !capabilities['task:delete']) throw forbidden('You can only delete your own comments.');
  await db.transaction(async (tx) => {
    await tx.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
    await logActivity(tx, ctx, {
      verb: 'comment.deleted',
      entityType: 'comment',
      entityId: commentId,
      projectId: current.projectId,
      taskId: current.taskId,
    });
  });
}

export async function restoreComment(ctx: DomainContext, commentId: string): Promise<CommentDTO> {
  const [row] = await db.select().from(comments).where(and(eq(comments.id, commentId), eq(comments.orgId, ctx.orgId)));
  if (!row) throw notFound('That comment');
  await requireTask(ctx, row.taskId, 'comment:create');
  if (row.authorId !== ctx.userId) throw forbidden('You can only restore your own comments.');
  const [restored] = await db.update(comments).set({ deletedAt: null }).where(eq(comments.id, commentId)).returning();
  const [dto] = await toDTOs([restored]);
  return dto;
}

/** Toggle the actor's reaction. Returns the comment's new reaction map. */
export async function toggleReaction(ctx: DomainContext, commentId: string, emoji: string): Promise<Record<string, string[]>> {
  if (!ALLOWED_REACTIONS.has(emoji)) throw invalid('That reaction is not available.');
  const current = await loadOwnComment(ctx, commentId);
  await requireTask(ctx, current.taskId, 'comment:create');
  const [row] = await db
    .update(comments)
    .set({
      reactions: sql`
        case
          when coalesce(${comments.reactions} -> ${emoji}, '[]'::jsonb) ? ${ctx.userId}
            then case
              when jsonb_array_length((${comments.reactions} -> ${emoji}) - ${ctx.userId}) = 0
                then ${comments.reactions} - ${emoji}
              else jsonb_set(${comments.reactions}, array[${emoji}], (${comments.reactions} -> ${emoji}) - ${ctx.userId})
            end
          else jsonb_set(${comments.reactions}, array[${emoji}], coalesce(${comments.reactions} -> ${emoji}, '[]'::jsonb) || to_jsonb(${ctx.userId}::text))
        end`,
    })
    .where(eq(comments.id, commentId))
    .returning({ reactions: comments.reactions });
  return (row?.reactions ?? {}) as Record<string, string[]>;
}
