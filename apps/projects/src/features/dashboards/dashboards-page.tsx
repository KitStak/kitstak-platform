import { getPortfolioReport, getProjectReport, listProjects } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pageContext } from '@/server/page';
import { DashboardsView, type DashboardsFilters } from './dashboards-view';

const UUID = /^[0-9a-f-]{36}$/i;

export async function DashboardsPage({ project, space, weeks }: { readonly project?: string; readonly space?: string; readonly weeks?: string }) {
  const { ctx } = await pageContext('/dashboards');
  const parsedWeeks = Number(weeks);
  const filters: DashboardsFilters = {
    project: project ? project.toUpperCase() : undefined,
    space: space && UUID.test(space) ? space : undefined,
    weeks: [4, 8, 12].includes(parsedWeeks) ? parsedWeeks : 8,
  };
  const projects = await listProjects(ctx);
  const report = await (filters.project
    ? getProjectReport(ctx, { key: filters.project }, { weeks: filters.weeks })
    : getPortfolioReport(ctx, { weeks: filters.weeks, spaceId: filters.space ?? null })
  ).catch((error: unknown) => {
    if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) return null;
    throw error;
  });
  return <DashboardsView initialReport={report} initialProjects={projects} initialFilters={report || !filters.project ? filters : { ...filters, project: undefined }} />;
}
