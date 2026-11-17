import { FileSpreadsheet, PackagePlus } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { StepList, Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

/** New job: three steps (basics, price and plan, links). Prefills from a CRM deal, a WMS work order or a project. */
export async function NewJobPage() {
  const page = await pulsePage(routes.newJob(), 'jobs');
  if (page.blocked) return <PageBlocked title="New job" role={page.access.role} />;
  const breadcrumbs = [{ label: 'Jobs', href: routes.jobs() }, { label: 'New job' }];
  if (!page.can('job:manage')) {
    return (
      <Page title="New job" breadcrumbs={breadcrumbs} width="narrow">
        <Panel>
          <Teach
            icon={PackagePlus}
            title="Your role cannot add jobs"
            why="Adding a job sets its price and plan, so it needs a manager. Ask a manager or admin of your workspace to add it, then you can log work against it."
            actions={<ButtonLink href={routes.jobs()}>Back to Jobs</ButtonLink>}
          />
        </Panel>
      </Page>
    );
  }
  const integrations = await page.integrations();
  const linkable = [integrations.crm ? 'a CRM deal' : null, integrations.wms ? 'a warehouse work order' : null, integrations.projects ? 'a project' : null].filter((value): value is string => value !== null);
  return (
    <Page title="New job" subtitle="A job is one piece of work for one client, with one kind of unit and one price." breadcrumbs={breadcrumbs} width="narrow">
      <div className="flex flex-col gap-5">
        <Panel title="What a job needs">
          <StepList
            steps={[
              { title: 'Basics', detail: 'The client, the kind of work, a name, how many units, and the dates. One time or ongoing.' },
              { title: 'Price and plan', detail: 'How you charge, the price, who buys the parts, and a quick plan: hours or units per person per hour, the usual crew, material cost per unit. You see the margin before you save.' },
              {
                title: 'Links',
                detail: linkable.length ? `Tie the job to ${linkable.join(', ')} so the numbers flow in on their own. Always optional.` : 'Nothing to link. Pulse works on its own, and you can connect other KitStak apps later.',
              },
            ]}
          />
        </Panel>
        <Panel>
          <Teach
            size="sm"
            icon={FileSpreadsheet}
            title="Have your jobs in a spreadsheet?"
            why="Download the jobs template, paste your rows in, and bring them all in at once. Pulse checks every row before anything is saved."
            actions={
              <>
                <ButtonLink href={routes.newImport('jobs')} icon={<FileSpreadsheet aria-hidden />}>
                  Import jobs
                </ButtonLink>
                <ButtonLink href={routes.jobs()} variant="secondary">
                  Back to Jobs
                </ButtonLink>
              </>
            }
          />
        </Panel>
      </div>
    </Page>
  );
}
