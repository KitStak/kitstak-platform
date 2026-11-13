import { apiRoute } from '@/server/http/api';
import { getPortfolioReport, getProjectReport } from '@/server/domain';

const UUID = /^[0-9a-f-]{36}$/i;

/** `?project=KEY|id` → that project's report; otherwise the portfolio rollup (`?space=<id>`). `?weeks=4..26`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const weeks = Number(searchParams.get('weeks')) || undefined;
  const project = searchParams.get('project');
  if (project) return getProjectReport(ctx, UUID.test(project) ? { id: project } : { key: project.toUpperCase() }, { weeks });
  const space = searchParams.get('space');
  return getPortfolioReport(ctx, { weeks, spaceId: space && UUID.test(space) ? space : null });
});
