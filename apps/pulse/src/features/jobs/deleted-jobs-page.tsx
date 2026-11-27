import { ShieldQuestion } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import type { DeletedJobDTO } from '@/lib/types';
import { listDeletedJobs } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { DeletedJobsView } from './deleted-jobs-view';
import { jobListTabs } from './jobs-page';

/**
 * Jobs, Deleted: every deleted job with who deleted it and when, and a Restore button that puts
 * the job and its entries back in every list and report.
 */
export async function DeletedJobsPage() {
  const page = await pulsePage(routes.deletedJobs(), 'jobs');
  if (page.blocked) return <PageBlocked title="Jobs" role={page.access.role} />;
  if (!page.can('job:manage')) {
    return (
      <Page title="Jobs" subtitle="Every job, with the ones at risk or losing money first." width="full">
        <Panel>
          <Teach
            testId="deleted-jobs-blocked"
            icon={ShieldQuestion}
            title="Only managers can restore jobs"
            why="This list holds deleted jobs so a manager can bring them back. Your role cannot delete or restore jobs. Ask a manager or an admin of your workspace if a job is missing."
            actions={<ButtonLink href={routes.jobs()}>Go to Jobs</ButtonLink>}
          />
        </Panel>
      </Page>
    );
  }
  let jobs: DeletedJobDTO[] | undefined;
  try {
    jobs = await listDeletedJobs(page.ctx);
  } catch {
    // The client loads the list again and shows the retry state if that fails too.
    jobs = undefined;
  }
  return (
    <Page
      title="Jobs"
      subtitle="Every job, with the ones at risk or losing money first."
      width="full"
      tabs={<RouteTabs label="Job lists" active="deleted" tabs={jobListTabs(true)} />}
    >
      <DeletedJobsView initialJobs={jobs} />
    </Page>
  );
}
