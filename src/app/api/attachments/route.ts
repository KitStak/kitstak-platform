/**
 * `/api/attachments` — record documents.
 *   GET    ?entityType=&entityId=                 list
 *   POST   { entityType, entityId, documentType, fileId }  attach an uploaded file
 *   DELETE ?id=                                   remove (and delete the file)
 */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { fileStore } from "@/server/files";
import { entityRefSchema } from "@/server/repositories/platform-common";
import {
  attachmentCreateSchema, createAttachment, deleteAttachment, idQuerySchema, listAttachments,
} from "@/server/repositories/platform-files";

export const GET = defineRoute({
  query: entityRefSchema,
  handler: async ({ db, auth, query }) => await listAttachments(db, auth, query),
});

export const POST = defineRoute({
  body: attachmentCreateSchema,
  handler: async ({ db, auth, body }) => created(await createAttachment(db, fileStore(), auth, body)),
});

export const DELETE = defineRoute({
  query: idQuerySchema,
  handler: async ({ db, auth, query }) => await deleteAttachment(db, fileStore(), auth, query.id),
});
