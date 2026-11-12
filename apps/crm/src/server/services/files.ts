/**
 * File attachments (item files, update attachments, files columns). Bytes live in the object
 * store (`@/server/storage`) keyed by opaque ids — user-supplied names never reach storage.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { files, updates } from '@/server/db/schema';
import { env } from '@/server/env';
import { BadRequestError, NotFoundError, PayloadTooLargeError, ValidationError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { localObjectPath, objectStore, uploadRoot } from '@/server/storage';
import { requireBoard, requireItem } from './access';
import { logActivity } from './activity';
import { inTransaction, isOrgAdmin, type ServiceContext } from './context';
import type { FileDto } from './contracts/dto';

type FileRow = typeof files.$inferSelect;

/** Allowed MIME types (exact) and prefixes. Anything else is rejected. */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'audio/mpeg',
]);
/** Types that are safe to render inline in the browser. SVG/HTML are never inline. */
const INLINE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'audio/mpeg',
]);

const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  'image/webp': (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
  'application/pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  'application/zip': (b) => b[0] === 0x50 && b[1] === 0x4b,
};

export function toFileDto(row: FileRow): FileDto {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    boardId: row.boardId,
    itemId: row.itemId,
    updateId: row.updateId,
    columnKey: row.columnKey,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    url: `/api/v1/files/${row.id}`,
  };
}

function assertStorageKey(storageKey: string): void {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(storageKey)) throw new BadRequestError('Invalid storage key');
}

/** Resolve a storage key to an absolute local path, refusing anything that escapes the root. */
export function storagePath(storageKey: string): string {
  assertStorageKey(storageKey);
  return localObjectPath(uploadRoot(), storageKey);
}

/** Strip path separators and control characters from a display file name. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'file';
}

export function validateUpload(input: {
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
}): string {
  const mime = input.mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (input.size <= 0) throw new ValidationError([{ path: 'file', message: 'The file is empty' }]);
  if (input.size > env.MAX_UPLOAD_BYTES) throw new PayloadTooLargeError(env.MAX_UPLOAD_BYTES);
  if (!ALLOWED_MIME.has(mime))
    throw new ValidationError([
      { path: 'file', message: `Files of type "${mime || 'unknown'}" are not allowed` },
    ]);
  const signature = SIGNATURES[mime];
  if (signature && !signature(input.bytes)) {
    throw new ValidationError([{ path: 'file', message: 'The file content does not match its type' }]);
  }
  return mime;
}

export interface UploadInput {
  readonly itemId: string;
  readonly updateId?: string | null;
  readonly columnKey?: string | null;
  readonly file: File;
}

export async function uploadFile(ctx: ServiceContext, input: UploadInput): Promise<FileDto> {
  const { item, board } = await requireItem(ctx, input.itemId, 'write');
  if (input.updateId) {
    const [update] = await ctx.db
      .select({ itemId: updates.itemId })
      .from(updates)
      .where(and(eq(updates.id, input.updateId), eq(updates.orgId, ctx.orgId), isNull(updates.deletedAt)))
      .limit(1);
    if (!update || update.itemId !== item.id) throw new NotFoundError('Update');
  }
  if (input.file.size > env.MAX_UPLOAD_BYTES) throw new PayloadTooLargeError(env.MAX_UPLOAD_BYTES);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const mime = validateUpload({
    name: input.file.name,
    mime: input.file.type,
    size: bytes.byteLength,
    bytes,
  });
  const storageKey = `${ctx.orgId}/${randomUUID()}`;
  assertStorageKey(storageKey);
  await objectStore().put(storageKey, bytes, mime);
  try {
    return await inTransaction(ctx, async (tx) => {
      const [row] = await tx.db
        .insert(files)
        .values({
          orgId: tx.orgId,
          boardId: board.id,
          itemId: item.id,
          updateId: input.updateId ?? null,
          columnKey: input.columnKey ?? null,
          uploadedBy: tx.userId,
          name: sanitizeFileName(input.file.name),
          mime,
          size: bytes.byteLength,
          storageKey,
          checksum: createHash('sha256').update(bytes).digest('hex'),
        })
        .returning();
      if (!row) throw new Error('File insert returned no row');
      await logActivity(tx, {
        boardId: board.id,
        itemId: item.id,
        action: 'file.uploaded',
        after: { fileId: row.id, name: row.name },
      });
      await publish(tx.db, {
        type: 'files.changed',
        orgId: tx.orgId,
        boardId: board.id,
        ids: [item.id],
        actorId: tx.userId,
      });
      return toFileDto(row);
    });
  } catch (error) {
    await objectStore().delete(storageKey);
    throw error;
  }
}

export async function listItemFiles(ctx: ServiceContext, itemId: string): Promise<FileDto[]> {
  await requireItem(ctx, itemId, 'read');
  const rows = await ctx.db
    .select()
    .from(files)
    .where(and(eq(files.itemId, itemId), eq(files.orgId, ctx.orgId), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt));
  return rows.map(toFileDto);
}

export async function listBoardFiles(ctx: ServiceContext, boardId: string): Promise<FileDto[]> {
  await requireBoard(ctx, boardId, 'read');
  const rows = await ctx.db
    .select()
    .from(files)
    .where(and(eq(files.boardId, boardId), eq(files.orgId, ctx.orgId), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt))
    .limit(1_000);
  return rows.map(toFileDto);
}

async function requireFile(ctx: ServiceContext, fileId: string): Promise<FileRow> {
  const [row] = await ctx.db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.orgId, ctx.orgId), isNull(files.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('File');
  if (row.boardId) {
    try {
      await requireBoard(ctx, row.boardId, 'read');
    } catch {
      throw new NotFoundError('File');
    }
  }
  return row;
}

export interface FileDownload {
  readonly body: Uint8Array;
  readonly headers: Record<string, string>;
}

export async function readFileForDownload(
  ctx: ServiceContext,
  fileId: string,
  forceDownload: boolean,
): Promise<FileDownload> {
  const row = await requireFile(ctx, fileId);
  assertStorageKey(row.storageKey);
  const body = await objectStore().get(row.storageKey);
  if (!body) throw new NotFoundError('File', 'The file content is no longer available');
  const inline = !forceDownload && INLINE_MIME.has(row.mime);
  const encoded = encodeURIComponent(row.name);
  return {
    body,
    headers: {
      'Content-Type': inline ? row.mime : 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${row.name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encoded}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=300',
    },
  };
}

export async function deleteFile(ctx: ServiceContext, fileId: string): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    const row = await requireFile(tx, fileId);
    if (row.boardId) await requireBoard(tx, row.boardId, 'write');
    if (tx.userId && row.uploadedBy !== tx.userId && !isOrgAdmin(tx) && row.boardId === null) {
      throw new NotFoundError('File');
    }
    await tx.db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, fileId));
    await logActivity(tx, {
      boardId: row.boardId,
      itemId: row.itemId,
      action: 'file.deleted',
      before: { fileId, name: row.name },
    });
    await publish(tx.db, {
      type: 'files.changed',
      orgId: tx.orgId,
      boardId: row.boardId,
      ids: row.itemId ? [row.itemId] : [],
      actorId: tx.userId,
    });
    return { id: fileId };
  });
}
