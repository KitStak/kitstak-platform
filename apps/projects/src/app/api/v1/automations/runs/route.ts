import { apiRoute } from '@/server/http/api';
import { listRecentAutomationRuns } from '@/server/domain';

/** Run history across every rule the viewer can see: ?automationId=&status=success|failed|skipped&limit= */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const status = searchParams.get('status');
  return listRecentAutomationRuns(ctx, {
    automationId: searchParams.get('automationId') ?? undefined,
    status: status === 'success' || status === 'failed' || status === 'skipped' ? status : undefined,
    limit: Number(searchParams.get('limit')) || 100,
  });
});
