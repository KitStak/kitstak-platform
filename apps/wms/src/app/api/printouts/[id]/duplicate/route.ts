/** `POST /api/printouts/[id]/duplicate` — copies a template (layout, options, client access). */
import { defineRoute } from '@/server/api/define-route';
import { created } from '@/server/api/envelope';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { duplicatePrintout } from '@/server/repositories/printouts';

export const POST = defineRoute({
  permission: 'settings.printouts_labels.duplicate',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) =>
    created(await duplicatePrintout(db, auth, actor, params.id)),
});
