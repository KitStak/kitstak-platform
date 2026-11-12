/** `GET /api/analytics/operational/[page]?from=&to=&wh=` — Operational Analytics dashboards (M13 §4). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { getOperationalAnalytics } from '@/server/repositories/analytics';
import { analyticsQuerySchema } from '@/server/repositories/analytics-common';
import { OPERATIONAL_APP, OPERATIONAL_PAGES } from '@/server/repositories/analytics-types';

export const GET = defineRoute({
  name: 'GET /api/analytics/operational/[page]',
  permission: OPERATIONAL_APP.permission,
  params: z.object({ page: z.enum(OPERATIONAL_PAGES) }),
  query: analyticsQuerySchema,
  handler: async ({ db, auth, params, query }) => await getOperationalAnalytics(db, auth, params.page, query),
});
