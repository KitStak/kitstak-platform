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
  handler: ({ db, auth, query }) => listAttachments(db, auth, query),
});

export const POST = defineRoute({
  body: attachmentCreateSchema,
  handler: ({ db, auth, body }) => created(createAttachment(db, fileStore(), auth, body)),
});

export const DELETE = defineRoute({
  query: idQuerySchema,
  handler: ({ db, auth, query }) => deleteAttachment(db, fileStore(), auth, query.id),
});
