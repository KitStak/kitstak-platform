import { withApi } from '@/server/api';
import { shellSearch, shellSearchQuerySchema } from '@/server/services/shell-search';
import { svc } from '../../_lib/route-helpers';

/** Command-palette search: items (with breadcrumb + status), boards, dashboards, people, workspaces. */
export const GET = withApi(
  { permission: 'item:read', rateLimit: 'search', query: shellSearchQuerySchema },
  (ctx) => shellSearch(svc(ctx), ctx.query),
);
