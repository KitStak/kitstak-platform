import { withApi } from '@/server/api';
import { reactionSchema } from '@/server/services/contracts/item-inputs';
import { toggleReaction } from '@/server/services/updates';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Toggle the caller's reaction. */
export const POST = withApi(
  { permission: 'update:write', params: uuidParams('updateId'), body: reactionSchema },
  (ctx) => toggleReaction(svc(ctx), ctx.params.updateId, ctx.body.emoji),
);
