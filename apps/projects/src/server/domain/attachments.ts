/**
 * File attachments. Storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, otherwise the bytes
 * go into pm.attachments.data (works everywhere, incl. serverless). Downloads always go through
 * GET /api/v1/attachments/[id] so access is checked on every read.
 */
import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db';
import { attachments } from '@/server/db/schema';
import { env } from '@/server/env';
import { invalid, notFound } from '@/server/errors';
import { MAX_ATTACHMENT_BYTES } from '@/lib/constants';
import type { AttachmentDTO } from '@/lib/types';
import { toAttachmentDTO, type DomainContext } from './_shared';
import { requireProject, requireTask } from './access';
import { logActivity } from './activity';

/** Columns without the bytes (lists never load file contents). */
const META = {
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
};

const BLOCKED_TYPES = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/javascript', 'text/javascript']);

function safeName(name: string): string {
  const cleaned = name.replace(/[\\/\0\r\n]/g, '_').trim();
  return (cleaned || 'file').slice(0, 200);
}

export interface UploadInput {
  readonly projectId?: string;
  readonly taskId?: string | null;
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export async function uploadAttachment(ctx: DomainContext, input: UploadInput): Promise<AttachmentDTO> {
  let projectId = input.projectId;
  if (input.taskId) {
    const { task } = await requireTask(ctx, input.taskId, 'file:upload');
    projectId = task.projectId;
  } else if (projectId) {
    await requireProject(ctx, { id: projectId }, 'file:upload');
  } else {
    throw invalid('Choose a task or project for this file.');
  }
  if (input.bytes.byteLength === 0) throw invalid('That file is empty.');
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw invalid('Files can be up to 25 MB.');
  const name = safeName(input.name);
  // Active content is stored as a download-only binary so it can never render in our origin.
  const contentType = BLOCKED_TYPES.has(input.contentType.toLowerCase()) || !input.contentType ? 'application/octet-stream' : input.contentType;
  let storage: 'db' | 'blob' = 'db';
  let storageKey: string | null = null;
  let data: Buffer | null = Buffer.from(input.bytes);
  if (env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`projects/${ctx.orgId}/${projectId}/${crypto.randomUUID()}-${name}`, Buffer.from(input.bytes), {
      access: 'public',
      contentType,
      token: env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    });
    storage = 'blob';
    storageKey = blob.url;
    data = null;
  }
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(attachments)
      .values({
        orgId: ctx.orgId,
        projectId: projectId as string,
        taskId: input.taskId ?? null,
        name,
        contentType,
        sizeBytes: input.bytes.byteLength,
        storage,
        storageKey,
        data,
        uploadedBy: ctx.userId,
      })
      .returning(META);
    await logActivity(tx, ctx, {
      verb: 'attachment.added',
      entityType: 'attachment',
      entityId: inserted[0].id,
      projectId: projectId as string,
      taskId: input.taskId ?? null,
      after: { name, size: input.bytes.byteLength },
    });
    return inserted;
  });
  return toAttachmentDTO(row);
}

export async function listTaskAttachments(ctx: DomainContext, taskId: string): Promise<AttachmentDTO[]> {
  await requireTask(ctx, taskId);
  const rows = await db
    .select(META)
    .from(attachments)
    .where(and(eq(attachments.taskId, taskId), isNull(attachments.deletedAt)))
    .orderBy(desc(attachments.createdAt));
  return rows.map(toAttachmentDTO);
}

/** Every file in a project (Files tab), newest first, with the task it belongs to. */
export async function listProjectAttachments(ctx: DomainContext, projectId: string): Promise<AttachmentDTO[]> {
  await requireProject(ctx, { id: projectId });
  const rows = await db
    .select(META)
    .from(attachments)
    .where(and(eq(attachments.projectId, projectId), isNull(attachments.deletedAt)))
    .orderBy(desc(attachments.createdAt))
    .limit(1000);
  return rows.map(toAttachmentDTO);
}

export interface AttachmentContent {
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Bytes for db storage, or a redirect URL for blob storage. */
  readonly bytes: Buffer | null;
  readonly redirectUrl: string | null;
}

export async function readAttachment(ctx: DomainContext, attachmentId: string): Promise<AttachmentContent> {
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.orgId, ctx.orgId), isNull(attachments.deletedAt)));
  if (!row) throw notFound('That file');
  await requireProject(ctx, { id: row.projectId });
  return {
    name: row.name,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    bytes: row.storage === 'db' ? (row.data ?? Buffer.alloc(0)) : null,
    redirectUrl: row.storage === 'blob' ? row.storageKey : null,
  };
}

export async function deleteAttachment(ctx: DomainContext, attachmentId: string): Promise<void> {
  const [row] = await db
    .select(META)
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.orgId, ctx.orgId), isNull(attachments.deletedAt)));
  if (!row) throw notFound('That file');
  await requireProject(ctx, { id: row.projectId }, row.uploadedBy === ctx.userId ? 'file:upload' : 'task:delete');
  await db.transaction(async (tx) => {
    await tx.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, attachmentId));
    await logActivity(tx, ctx, {
      verb: 'attachment.deleted',
      entityType: 'attachment',
      entityId: attachmentId,
      projectId: row.projectId,
      taskId: row.taskId,
      before: { name: row.name },
    });
  });
}

export async function restoreAttachment(ctx: DomainContext, attachmentId: string): Promise<AttachmentDTO> {
  const [row] = await db.select(META).from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.orgId, ctx.orgId)));
  if (!row) throw notFound('That file');
  await requireProject(ctx, { id: row.projectId }, 'file:upload');
  const [restored] = await db.update(attachments).set({ deletedAt: null }).where(eq(attachments.id, attachmentId)).returning(META);
  return toAttachmentDTO(restored);
}
