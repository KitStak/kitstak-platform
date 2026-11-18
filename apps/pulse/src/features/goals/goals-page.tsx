import { Page } from '@/components/layout/page';
import { ExportStreamLink } from '@/components/pulse/export-link';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { getGoalsBoard } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { GoalsView } from './goals-view';

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Goals: targets for margin, profit, revenue and pace, and how the company, sites, clients and job types are doing. */
export async function GoalsPage({ searchParams }: { readonly searchParams?: Search }) {
  const params = (await searchParams) ?? {};
  const wanted = typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;
  const page = await pulsePage(routes.goals(), 'goals');
  if (page.blocked) return <PageBlocked title="Goals" role={page.access.role} />;
  const board = await getGoalsBoard(page.ctx, { month: wanted });
  return (
    <Page title="Goals" subtitle="What you are aiming for, and how you are doing against it." actions={<ExportStreamLink stream="goals" />}>
      <GoalsView initial={board} />
    </Page>
  );
}
