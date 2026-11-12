/** `GET /api/vas-operations/vas-types` — VAS types (Data Setup) with their calculation type. */
import { defineRoute } from '@/server/api/define-route';
import { vasTypes } from '@/server/repositories/vas';

export const GET = defineRoute({
  permission: ['settings.vas_operations.view', 'settings.billing.view'],
  handler: async ({ db, auth }) => await vasTypes(db, auth),
});
