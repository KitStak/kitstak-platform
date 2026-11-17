import { FileSpreadsheet, Target } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

/** Goals: targets for margin, profit, revenue and pace, and how the org, sites, clients and job types are doing. */
export async function GoalsPage() {
  const page = await pulsePage(routes.goals(), 'goals');
  if (page.blocked) return <PageBlocked title="Goals" role={page.access.role} />;
  const canManage = page.can('target:manage');
  return (
    <Page
      title="Goals"
      subtitle="What you are aiming for, and how you are doing against it."
      actions={
        canManage ? (
          <ButtonLink href={routes.newImport('goals')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
            Import goals
          </ButtonLink>
        ) : null
      }
    >
      <Panel>
        <Teach
          icon={Target}
          title="No goals set"
          why="A goal is a number to aim for, like a 30 percent margin or 40 units per person per hour. Set one for the whole company, a site, a client or a job type, and Pulse shows green, amber or red against it every month."
          points={['Margin, profit, revenue, pace, cost per unit and more', 'A goal for every month, or one that holds all year', 'The trend, so you know if you are closing the gap']}
          actions={
            canManage ? (
              <ButtonLink href={routes.newImport('goals')} icon={<FileSpreadsheet aria-hidden />}>
                Import goals from a spreadsheet
              </ButtonLink>
            ) : null
          }
          footnote={canManage ? 'The template has one row per goal: scope, measure, month and value.' : 'A manager sets the goals. You will see progress against them here.'}
        />
      </Panel>
    </Page>
  );
}
