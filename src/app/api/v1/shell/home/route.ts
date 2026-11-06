import { withApi } from '@/server/api';
import { shellHome, shellHomeQuerySchema } from '@/server/services/shell-home';
import { svc } from '../../_lib/route-helpers';

/** Home page aggregate: enriched recents, my work due this week, latest updates. */
export const GET = withApi({ permission: 'org:read', query: shellHomeQuerySchema }, (ctx) =>
  shellHome(svc(ctx), ctx.query),
);
