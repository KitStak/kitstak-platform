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
  handler: ({ db, auth, query }) => listNotes(db, auth, query),
});

export const POST = defineRoute({
  body: noteCreateSchema,
  handler: ({ db, auth, body }) => created(createNote(db, auth, body)),
});

export const DELETE = defineRoute({
  query: idQuerySchema,
  handler: ({ db, auth, query }) => deleteNote(db, auth, query.id),
});
