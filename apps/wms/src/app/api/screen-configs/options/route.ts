/** `GET /api/screen-configs/options` — warehouses, clients, vendors (caller scope) and PO types for the editor. */
import { defineRoute } from '@/server/api/define-route';
import { screenConfigOptions } from '@/server/repositories/screen-configs';

export const GET = defineRoute({
  permission: 'settings.screen_configuration.view',
  handler: async ({ db, auth }) => await screenConfigOptions(db, auth),
});
