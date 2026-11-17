import { CheckCircle2, FileSpreadsheet, Package, PackagePlus, CalendarClock, type LucideIcon } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

const TABS = ['open', 'all', 'completed', 'planned'] as const;
type JobsTab = (typeof TABS)[number];

const TAB_LABELS: Readonly<Record<JobsTab, string>> = { open: 'Open', all: 'All', completed: 'Completed', planned: 'Planned' };

const EMPTY: Readonly<Record<JobsTab, { icon: LucideIcon; title: string; why: string; points?: readonly string[] }>> = {
  open: {
    icon: Package,
    title: 'No open jobs',
    why: 'A job is one piece of work for one client, like building 5,000 gift kits. Add one and Pulse tracks its revenue, cost and margin as the work gets logged.',
    points: ['Jobs at risk or losing money come first, with the reason', 'How much is done, and what profit the job is heading for', 'One click from a job to its plan, work log and costs'],
  },
  all: {
    icon: Package,
    title: 'No jobs yet',
    why: 'Every job you add shows up here, whatever its status. Type one in, or bring a whole list in from a spreadsheet.',
  },
  completed: {
    icon: CheckCircle2,
    title: 'No completed jobs yet',
    why: 'When a job is finished, mark it complete. It moves here with its final revenue, cost and margin, so you can price the next one better.',
  },
  planned: {
    icon: CalendarClock,
    title: 'No planned jobs',
    why: 'Planned jobs are quoted or booked but not started. Add one early to see the margin you expect before any work begins.',
  },
};

function parseTab(value: string | string[] | undefined): JobsTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return (TABS as readonly string[]).includes(raw ?? '') ? (raw as JobsTab) : 'open';
}

/** Jobs: the open jobs list (at risk and losing money first) and the All, Completed and Planned tabs. */
export async function JobsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tab = parseTab((await searchParams).tab);
  const page = await pulsePage(routes.jobs({ tab: tab === 'open' ? undefined : tab }), 'jobs');
  if (page.blocked) return <PageBlocked title="Jobs" role={page.access.role} />;
  const empty = EMPTY[tab];
  const canManage = page.can('job:manage');
  return (
    <Page
      title="Jobs"
      subtitle="Every job, with the ones at risk or losing money first."
      actions={
        canManage ? (
          <>
            <ButtonLink href={routes.newImport('jobs')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
              Import jobs
            </ButtonLink>
            <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />} testId="jobs-new">
              New job
            </ButtonLink>
          </>
        ) : null
      }
      tabs={<RouteTabs label="Job lists" active={tab} tabs={TABS.map((id) => ({ id, label: TAB_LABELS[id], href: routes.jobs({ tab: id === 'open' ? undefined : id }) }))} />}
    >
      <Panel>
        <Teach
          icon={empty.icon}
          title={empty.title}
          why={empty.why}
          points={empty.points}
          actions={
            canManage ? (
              <>
                <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />}>
                  Add a job
                </ButtonLink>
                <ButtonLink href={routes.newImport('jobs')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                  Import from a spreadsheet
                </ButtonLink>
              </>
            ) : null
          }
          footnote={canManage ? undefined : 'Your role can read jobs but not add them. Ask a manager to add the first one.'}
        />
      </Panel>
    </Page>
  );
}
