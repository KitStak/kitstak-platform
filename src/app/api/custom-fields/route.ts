/** `/api/custom-fields` — list (GET) and define (POST) custom field slots per entity. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import {
  ANY_CUSTOM_FIELD_PERMISSION, createCustomField, customFieldCreateSchema, customFieldListQuerySchema, listCustomFields,
} from "@/server/repositories/platform-custom-fields";

export const GET = defineRoute({
  query: customFieldListQuerySchema,
  handler: ({ db, query }) => listCustomFields(db, query),
});

export const POST = defineRoute({
  permission: ANY_CUSTOM_FIELD_PERMISSION,
  body: customFieldCreateSchema,
  handler: ({ db, auth, body }) => created(createCustomField(db, auth, body)),
});
