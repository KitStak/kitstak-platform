import { apiRoute } from '@/server/http/api';
import { listDashboards } from '@/server/domain';

/** ?projectId=<id> or ?projectId=none for portfolio dashboards; omit for all. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const projectId = searchParams.get('projectId');
  return listDashboards(ctx, projectId === null ? undefined : projectId === 'none' ? null : projectId);
});
