/** `POST /api/returns/manual` — Return Manually: creates a Manual RMA and receives it. */
import { defineRoute } from '@/server/api/define-route';
import { created } from '@/server/api/envelope';
import { forbiddenError } from '@/server/api/errors';
import { can } from '@/server/auth/permissions';
import { RETURN_PERMISSIONS, scopedCtx } from '@/server/repositories/returns';
import { receiveManual, receiveManualSchema } from '@/server/repositories/returns-receive';

export const POST = defineRoute({
  // Execute key at route level: 403 before body validation for callers who can't receive.
  permission: RETURN_PERMISSIONS.receive,
  body: receiveManualSchema,
  handler: async ({ db, auth, actor, body }) => {
    if (!can(auth, RETURN_PERMISSIONS.station))
      throw forbiddenError('You need access to the Return Station to receive returns.');
    return created(await receiveManual(db, scopedCtx(actor, auth), body));
  },
});
