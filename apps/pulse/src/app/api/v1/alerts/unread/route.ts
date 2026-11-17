import { apiRoute } from '@/server/http/api';
import { countOpenAlerts, requirePulse } from '@/server/domain';

/** `{ count }` of open alerts. */
export const GET = apiRoute(async ({ ctx }) => {
  await requirePulse(ctx, 'pulse:read');
  return { count: await countOpenAlerts(ctx) };
});
