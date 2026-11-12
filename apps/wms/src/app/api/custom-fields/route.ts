/** `/api/custom-fields` — list (GET) and define (POST) custom field slots per entity. */
import { defineRoute } from '@/server/api/define-route';
import { created } from '@/server/api/envelope';
import {
  ANY_CUSTOM_FIELD_PERMISSION,
  createCustomField,
  customFieldCreateSchema,
  customFieldListQuerySchema,
  listCustomFields,
} from '@/server/repositories/platform-custom-fields';

export const GET = defineRoute({
  query: customFieldListQuerySchema,
  handler: async ({ db, query }) => await listCustomFields(db, query),
});

export const POST = defineRoute({
  permission: ANY_CUSTOM_FIELD_PERMISSION,
  body: customFieldCreateSchema,
  handler: async ({ db, auth, body }) => created(await createCustomField(db, auth, body)),
});
