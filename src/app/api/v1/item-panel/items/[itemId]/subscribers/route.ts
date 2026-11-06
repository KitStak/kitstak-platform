import { withApi } from '@/server/api';
import { changeItemSubscribers, changeSubscribersSchema, getItemSubscribers } from '@/server/services/item-panel';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('itemId');

/** Effective subscribers of an item (assignees, creator, update authors, explicit opt-ins). */
export const GET = withApi({ permission: 'item:read', params }, (ctx) => getItemSubscribers(svc(ctx), ctx.params.itemId));

/** Subscribe / unsubscribe people: `{ add?: uuid[], remove?: uuid[] }`. */
export const POST = withApi(
  { permission: 'update:read', params, body: changeSubscribersSchema, rateLimit: 'mutation' },
  (ctx) => changeItemSubscribers(svc(ctx), ctx.params.itemId, ctx.body),
);
