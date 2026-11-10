/**
 * Files, attachments and notes (BUILD_PLAN F7 `/api/files`, `/api/attachments`, `/api/notes`).
 *
 * Downloads are authorized through what owns the file: a business record (view permission
 * + scope via the entity registry), an attachment row, the caller's own background task or
 * import batch, or the caller's own upload. Anything else is NOT_FOUND.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ATTACHMENT_DOCUMENT_TYPES } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { AppError, forbiddenError, notFoundError, validationError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { can } from "@/server/auth/permissions";
import { attachments, backgroundTasks, entityNotes, files, importBatches, users } from "@/server/db/schema";
import { MAX_UPLOAD_BYTES, type FileRecord, type FileStore } from "@/server/files";
// Leaf map, not the registry: the registry imports every module's handler (see permissions.ts).
import { IMPORT_PERMISSIONS } from "@/server/imports/permissions";
import { entityRefSchema, idSchema } from "./platform-common";
import { canOnEntity, findEntity, getEntityDef, requireEntity } from "./platform-entities";

/** Multipart envelope overhead allowed on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export interface Upload {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly fields: Readonly<Record<string, string>>;
}

/** Reads a `multipart/form-data` body with a single `file` part and string fields. */
export async function readUpload(request: Request, maxBytes: number = MAX_UPLOAD_BYTES): Promise<Upload> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    throw validationError("Upload the file as multipart/form-data", { file: ["Choose a file to upload"] });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes + MULTIPART_OVERHEAD_BYTES) {
    throw validationError(`The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`, { file: ["File is too large"] });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error: unknown) {
    throw new AppError("VALIDATION", "The upload could not be read", { cause: error, fieldErrors: { file: ["Upload failed"] } });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw validationError("Choose a file to upload", { file: ["Choose a file to upload"] });
  if (file.size > maxBytes) throw validationError(`The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`, { file: ["File is too large"] });
  const fields = Object.fromEntries([...form.entries()].flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as const] : [])));
  const fileName = "name" in file && typeof file.name === "string" && file.name ? file.name : "upload";
  return { fileName, bytes: new Uint8Array(await file.arrayBuffer()), fields };
}

/* ------------------------------------------------------------------ files */

export const fileUploadFieldsSchema = z.object({
  ownerEntityType: z.string().max(40).optional(),
  ownerEntityId: idSchema.optional(),
}).refine((f) => (f.ownerEntityType === undefined) === (f.ownerEntityId === undefined), "Send both ownerEntityType and ownerEntityId");

export type PublicFile = Pick<FileRecord, "id" | "name" | "mime" | "size" | "createdAt" | "expiresAt" | "ownerEntityType" | "ownerEntityId">;

export const toPublicFile = (f: FileRecord): PublicFile => ({
  id: f.id, name: f.name, mime: f.mime, size: f.size, createdAt: f.createdAt, expiresAt: f.expiresAt,
  ownerEntityType: f.ownerEntityType, ownerEntityId: f.ownerEntityId,
});

/** Stores an attachment-purpose upload, optionally owned by a record the caller may edit. */
export function storeUpload(db: AppDb, store: FileStore, auth: AuthContext, upload: Upload): PublicFile {
  const fields = fileUploadFieldsSchema.safeParse(upload.fields);
  if (!fields.success) throw validationError(fields.error.issues[0]?.message ?? "Invalid upload");
  const { ownerEntityType, ownerEntityId } = fields.data;
  if (ownerEntityType && ownerEntityId) requireEntity(db, auth, ownerEntityType, ownerEntityId, "edit");
  return toPublicFile(store.store(db, {
    name: upload.fileName, bytes: upload.bytes, purpose: "attachment",
    ownerEntityType: ownerEntityType ?? null, ownerEntityId: ownerEntityId ?? null, uploadedBy: auth.user.id,
  }));
}

function canReadOwned(db: AppDb, auth: AuthContext, file: FileRecord): boolean {
  const { ownerEntityType: type, ownerEntityId: id } = file;
  if (!type || !id) return false;
  if (type === "background_task") {
    return db.select({ userId: backgroundTasks.userId }).from(backgroundTasks).where(eq(backgroundTasks.id, id)).get()?.userId === auth.user.id;
  }
  if (type === "import_batch") {
    const batch = db.select({ key: importBatches.importKey }).from(importBatches).where(eq(importBatches.id, id)).get();
    const permission = batch ? IMPORT_PERMISSIONS[batch.key] : undefined;
    return permission !== undefined && can(auth, permission);
  }
  if (!getEntityDef(type)) return false;
  requireEntity(db, auth, type, id, "view");
  return true;
}

function canReadViaAttachment(db: AppDb, auth: AuthContext, fileId: string): boolean {
  const att = db.select().from(attachments).where(eq(attachments.fileId, fileId)).get();
  if (!att) return false;
  requireEntity(db, auth, att.entityType, att.entityId, "view");
  return true;
}

/** Throws NOT_FOUND unless the caller may download `id`. */
export function authorizeFileRead(db: AppDb, store: FileStore, auth: AuthContext, id: string): FileRecord {
  const file = store.get(db, id);
  if (file.uploadedBy === auth.user.id) return file;
  try {
    if (canReadOwned(db, auth, file) || canReadViaAttachment(db, auth, file.id)) return file;
  } catch (error: unknown) {
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) throw notFoundError("File");
    throw error;
  }
  throw notFoundError("File");
}

const INLINE_MIMES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/** `Content-Disposition` with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function fileResponse(record: FileRecord, bytes: Buffer, wantInline: boolean): Response {
  const inline = wantInline && INLINE_MIMES.has(record.mime);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": record.mime,
      "content-length": String(bytes.length),
      "content-disposition": contentDisposition(record.name, inline),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

/* ------------------------------------------------------------ attachments */

export const attachmentCreateSchema = entityRefSchema.extend({
  documentType: z.enum(ATTACHMENT_DOCUMENT_TYPES),
  fileId: idSchema,
});

export const idQuerySchema = z.object({ id: idSchema });

export interface AttachmentView {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly documentType: (typeof ATTACHMENT_DOCUMENT_TYPES)[number];
  readonly fileId: string;
  readonly fileName: string;
  readonly mime: string;
  readonly size: number;
  readonly uploadedBy: string | null;
  readonly uploadedByName: string | null;
  readonly createdAt: string;
}

const attachmentColumns = {
  id: attachments.id, entityType: attachments.entityType, entityId: attachments.entityId, documentType: attachments.documentType,
  fileId: attachments.fileId, fileName: files.name, mime: files.mime, size: files.size,
  uploadedBy: attachments.uploadedBy, uploadedByName: users.name, createdAt: attachments.createdAt,
};

export function listAttachments(db: AppDb, auth: AuthContext, ref: z.output<typeof entityRefSchema>): AttachmentView[] {
  requireEntity(db, auth, ref.entityType, ref.entityId, "view");
  return db.select(attachmentColumns).from(attachments)
    .innerJoin(files, eq(files.id, attachments.fileId))
    .leftJoin(users, eq(users.id, attachments.uploadedBy))
    .where(and(eq(attachments.entityType, ref.entityType), eq(attachments.entityId, ref.entityId)))
    .orderBy(desc(attachments.createdAt)).all();
}

export function createAttachment(db: AppDb, store: FileStore, auth: AuthContext, input: z.output<typeof attachmentCreateSchema>): AttachmentView {
  requireEntity(db, auth, input.entityType, input.entityId, "edit");
  const file = store.get(db, input.fileId);
  const ownedElsewhere = file.ownerEntityType !== null
    && (file.ownerEntityType !== input.entityType || file.ownerEntityId !== input.entityId);
  if (file.uploadedBy !== auth.user.id || ownedElsewhere) throw notFoundError("File");
  if (file.expiresAt !== null) throw validationError("This file cannot be attached", { fileId: ["Upload the file again"] });
  db.update(files).set({ ownerEntityType: input.entityType, ownerEntityId: input.entityId }).where(eq(files.id, file.id)).run();
  const row = db.insert(attachments).values({
    entityType: input.entityType, entityId: input.entityId, documentType: input.documentType, fileId: file.id, uploadedBy: auth.user.id,
  }).returning().get();
  const view = db.select(attachmentColumns).from(attachments).innerJoin(files, eq(files.id, attachments.fileId))
    .leftJoin(users, eq(users.id, attachments.uploadedBy)).where(eq(attachments.id, row.id)).get();
  if (!view) throw notFoundError("Attachment");
  return view;
}

export function deleteAttachment(db: AppDb, store: FileStore, auth: AuthContext, id: string): { id: string } {
  const att = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!att || !findEntity(db, att.entityType, att.entityId)) throw notFoundError("Attachment");
  requireEntity(db, auth, att.entityType, att.entityId, "edit");
  db.delete(attachments).where(eq(attachments.id, id)).run();
  store.remove(db, att.fileId);
  return { id };
}

/* ------------------------------------------------------------------ notes */

export type NoteView = typeof entityNotes.$inferSelect & { readonly userName: string | null };

export const noteCreateSchema = entityRefSchema.extend({
  body: z.string().trim().min(1, "Write a note").max(4000),
});

const noteColumns = {
  id: entityNotes.id, entityType: entityNotes.entityType, entityId: entityNotes.entityId, body: entityNotes.body,
  userId: entityNotes.userId, createdAt: entityNotes.createdAt, userName: users.name,
};

export function listNotes(db: AppDb, auth: AuthContext, ref: z.output<typeof entityRefSchema>): NoteView[] {
  requireEntity(db, auth, ref.entityType, ref.entityId, "view");
  return db.select(noteColumns).from(entityNotes).leftJoin(users, eq(users.id, entityNotes.userId))
    .where(and(eq(entityNotes.entityType, ref.entityType), eq(entityNotes.entityId, ref.entityId)))
    .orderBy(desc(entityNotes.createdAt)).all();
}

export function createNote(db: AppDb, auth: AuthContext, input: z.output<typeof noteCreateSchema>): NoteView {
  requireEntity(db, auth, input.entityType, input.entityId, "edit");
  const row = db.insert(entityNotes).values({ entityType: input.entityType, entityId: input.entityId, body: input.body, userId: auth.user.id }).returning().get();
  return { ...row, userName: auth.user.name };
}

/** The author may delete their note; anyone else needs edit on the record. */
export function deleteNote(db: AppDb, auth: AuthContext, id: string): { id: string } {
  const note = db.select().from(entityNotes).where(eq(entityNotes.id, id)).get();
  if (!note) throw notFoundError("Note");
  requireEntity(db, auth, note.entityType, note.entityId, "view");
  if (note.userId !== auth.user.id && !canOnEntity(auth, note.entityType, "edit")) throw forbiddenError();
  db.delete(entityNotes).where(eq(entityNotes.id, id)).run();
  return { id };
}
