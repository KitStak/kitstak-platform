import { withApi } from '@/server/api';
import { duplicatesQuerySchema } from '@/server/services/crm-contracts';
import { listDuplicates } from '@/server/services/crm-duplicates';
import { svc } from '../../_lib/route-helpers';

/** Suspected duplicate contacts or accounts, clustered with a confidence. */
export const GET = withApi({ permission: 'item:read', query: duplicatesQuerySchema }, (ctx) =>
  listDuplicates(svc(ctx), ctx.query.kind),
);
