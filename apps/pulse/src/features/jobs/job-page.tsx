import { PackageSearch } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { JOB_TABS, JOB_TAB_LABELS, routes, type JobTab } from '@/lib/routes';
import { pulsePage } from '@/server/page';

/** Tabs a supervisor does not get: they show money. */
const MONEY_TABS: readonly JobTab[] = ['plan', 'money-in'];

/**
 * One job and its tabs: Overview, Plan vs actual, Work log, Materials, Money in, Activity.
 * An unknown number or id lands on a helpful page with the way back, never a blank screen.
 */
export async function JobPage({ params, tab }: { readonly params: Promise<{ ref: string }>; readonly tab: JobTab }) {
  const ref = decodeURIComponent((await params).ref);
  const page = await pulsePage(routes.jobTab(ref, tab), 'jobs');
  if (page.blocked) return <PageBlocked title="Job" role={page.access.role} />;
  const tabs = JOB_TABS.filter((id) => page.access.seesMoney || !MONEY_TABS.includes(id));
  if (!tabs.includes(tab)) return <PageBlocked title={JOB_TAB_LABELS[tab]} role={page.access.role} />;
  return (
    <Page
      title={`Job ${ref}`}
      breadcrumbs={[{ label: 'Jobs', href: routes.jobs() }, { label: ref }]}
      tabs={<RouteTabs label="Job sections" active={tab} tabs={tabs.map((id) => ({ id, label: JOB_TAB_LABELS[id], href: routes.jobTab(ref, id) }))} />}
    >
      <Panel>
        <Teach
          testId="job-not-found"
          icon={PackageSearch}
          title="We could not find that job"
          why={`There is no job with the number or id ${ref} in ${page.context.org.name}. It may have been deleted, or the link may belong to another workspace.`}
          actions={
            <>
              <ButtonLink href={routes.jobs({ tab: 'all' })}>See all jobs</ButtonLink>
              {page.can('job:manage') ? (
                <ButtonLink href={routes.newJob()} variant="secondary">
                  Add a job
                </ButtonLink>
              ) : null}
            </>
          }
        />
      </Panel>
    </Page>
  );
}
