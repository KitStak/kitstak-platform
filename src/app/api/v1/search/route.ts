import { withApi } from '@/server/api';
import { search, searchQuerySchema } from '@/server/services/search';
import { svc } from '../_lib/route-helpers';

export const GET = withApi(
  { permission: 'item:read', rateLimit: 'search', query: searchQuerySchema },
  (ctx) => search(svc(ctx), ctx.query),
);
