import { FileSpreadsheet, PackagePlus } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { PageBlocked } from '@/features/access/page-blocked';
import { JOB_TABS, PULSE_STATUSES, type JobTab, type PulseStatus } from '@/lib/constants';
import { routes } from '@/lib/routes';
import type { ClientDTO, JobListItemDTO, JobTypeDTO, SiteDTO } from '@/lib/types';
import { listClients, listJobTypes, listJobs, listSites, todayInZone } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { JobsView } from './jobs-view';

const TAB_LABELS: Readonly<Record<JobTab, string>> = { open: 'Open', all: 'All', completed: 'Completed', planned: 'Planned' };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function parseTab(value: string | string[] | undefined): JobTab {
  const raw = first(value);
  return (JOB_TABS as readonly string[]).includes(raw) ? (raw as JobTab) : 'open';
}

/** A read that failed leaves the client to load it again (and show the retry state if that fails too). */
async function soft<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch {
    return undefined;
  }
}

/** Jobs: the open jobs list (at risk and losing money first) and the All, Completed and Planned tabs. */
export async function JobsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const tab = parseTab(query.tab);
  const page = await pulsePage(routes.jobs({ tab: tab === 'open' ? undefined : tab }), 'jobs');
  if (page.blocked) return <PageBlocked title="Jobs" role={page.access.role} />;
  const canManage = page.can('job:manage');
  const [jobs, clients, jobTypes, sites] = await Promise.all([
    soft<JobListItemDTO[]>(listJobs(page.ctx, { tab })),
    soft<ClientDTO[]>(listClients(page.ctx, {})),
    soft<JobTypeDTO[]>(listJobTypes(page.ctx)),
    soft<SiteDTO[]>(listSites(page.ctx)),
  ]);
  const risk = first(query.risk)
    .split(',')
    .filter((value): value is PulseStatus => (PULSE_STATUSES as readonly string[]).includes(value));
  const site = sites?.find((item) => item.isDefault) ?? sites?.[0];
  return (
    <Page
      title="Jobs"
      subtitle="Every job, with the ones at risk or losing money first."
      width="full"
      actions={
        canManage ? (
          <>
            <ButtonLink href={routes.newImport('jobs')} variant="secondary" icon={<FileSpreadsheet aria-hidden />} className="hidden sm:inline-flex">
              Import jobs
            </ButtonLink>
            <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />} testId="jobs-new">
              New job
            </ButtonLink>
          </>
        ) : null
      }
      tabs={<RouteTabs label="Job lists" active={tab} tabs={JOB_TABS.map((id) => ({ id, label: TAB_LABELS[id], href: routes.jobs({ tab: id === 'open' ? undefined : id }) }))} />}
    >
      <JobsView key={tab} tab={tab} initialJobs={jobs} initialRisk={risk} initialQuery={first(query.q).slice(0, 80)} clients={clients ?? []} jobTypes={jobTypes ?? []} sites={sites ?? []} today={site?.today ?? todayInZone('UTC')} initialViewId={first(query.view) || null} />
    </Page>
  );
}
