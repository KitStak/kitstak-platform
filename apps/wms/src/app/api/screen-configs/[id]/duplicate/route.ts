/** `POST /api/screen-configs/[id]/duplicate` — copies a configuration (inactive, "(copy)" name). */
import { defineRoute } from '@/server/api/define-route';
import { created } from '@/server/api/envelope';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { duplicateScreenConfig } from '@/server/repositories/screen-configs';

export const POST = defineRoute({
  permission: 'settings.screen_configuration.duplicate',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) =>
    created(await duplicateScreenConfig(db, auth, actor, params.id)),
});
