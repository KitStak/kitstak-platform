/**
 * `/api/notes` — record notes.
 *   GET    ?entityType=&entityId=          list (newest first)
 *   POST   { entityType, entityId, body }   add
 *   DELETE ?id=                            author, or anyone who may edit the record
 */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { entityRefSchema } from "@/server/repositories/platform-common";
import { createNote, deleteNote, idQuerySchema, listNotes, noteCreateSchema } from "@/server/repositories/platform-files";

export const GET = defineRoute({
  query: entityRefSchema,
  handler: async ({ db, auth, query }) => await listNotes(db, auth, query),
});

export const POST = defineRoute({
  body: noteCreateSchema,
  handler: async ({ db, auth, body }) => created(await createNote(db, auth, body)),
});

export const DELETE = defineRoute({
  query: idQuerySchema,
  handler: async ({ db, auth, query }) => await deleteNote(db, auth, query.id),
});
