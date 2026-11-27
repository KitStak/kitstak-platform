import { redirect } from 'next/navigation';
import { PackageSearch } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { JOB_TAB_LABELS, routes, type JobTab } from '@/lib/routes';
import type { JobDetailDTO } from '@/lib/types';
import {
  getJob,
  getSettings,
  listJobTypes,
  listLaborClasses,
  listSites,
  listVasServices,
  todayInZone,
} from '@/server/domain';
import { pulsePage } from '@/server/page';
import { JobFrame } from './job-frame';
import { programJobRedirect, type JobProgramPageDTO } from './program-job';
import { jobProgramPage, jobProgramRef } from './server/program-job';

/** Tabs a reader who may not see money does not get: they show money. */
const MONEY_TABS: readonly JobTab[] = ['plan', 'money-in'];

async function soft<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch {
    return fallback;
  }
}

/**
 * One job and its tabs: Overview, Plan vs actual, Work log, Materials, Money in, Activity.
 * The signed in layout answers a real 404 for a job that does not exist; the message below is
 * the safety net for a job that vanished between the two reads.
 *
 * A program job (PULSE_PROGRAMS_SPEC 5.3) lives under Programs: `/jobs/J-1040` goes to
 * `/programs/GLOVE`, and `/jobs/J-1040?view=job` shows the job with a banner, no Plan vs actual
 * tab, and its prices from the program's card.
 */
export async function JobPage({
  params,
  tab,
  searchParams,
}: {
  readonly params: Promise<{ ref: string }>;
  readonly tab: JobTab;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ref = decodeURIComponent((await params).ref);
  const query = (await searchParams) ?? {};
  const view = Array.isArray(query.view) ? query.view[0] : query.view;
  const page = await pulsePage(tab === 'overview' && view === 'job' ? routes.programJob(ref) : routes.jobTab(ref, tab), 'jobs');
  if (page.blocked) return <PageBlocked title="Job" role={page.access.role} />;
  if (!page.access.seesMoney && MONEY_TABS.includes(tab))
    return <PageBlocked title={JOB_TAB_LABELS[tab]} role={page.access.role} />;
  let job: JobDetailDTO | null = null;
  try {
    job = await getJob(page.ctx, ref);
  } catch {
    job = null;
  }
  if (!job) {
    return (
      <Page title="Job not found" breadcrumbs={[{ label: 'Jobs', href: routes.jobs() }, { label: ref }]}>
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
  const { ctx } = page;
  const programRef = await jobProgramRef(ctx, job);
  const to = programJobRedirect({ tab, view, program: programRef });
  if (to) redirect(to);
  const [settings, laborClasses, services, jobTypes, sites] = await Promise.all([
    getSettings(ctx),
    soft(listLaborClasses(ctx), []),
    soft(listVasServices(ctx), []),
    soft(listJobTypes(ctx), []),
    soft(listSites(ctx), []),
  ]);
  const site = sites.find((item) => item.id === job.siteId);
  const today = site?.today ?? todayInZone(settings.timezone);
  const program = programRef ? await soft<JobProgramPageDTO>(jobProgramPage(ctx, programRef, { seesMoney: page.access.seesMoney, today }), { program: programRef, price: null }) : null;
  return (
    <JobFrame
      initialJob={job}
      tab={tab}
      today={today}
      settings={settings}
      laborClasses={laborClasses}
      services={services}
      jobTypes={jobTypes}
      program={program}
    />
  );
}
