import { FileSpreadsheet } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { PageBlocked } from '@/features/access/page-blocked';
import { isIsoDate, todayIso } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { getJob, getLogGrid, getReviewQueue, getSettings, listLaborClasses, listSites } from '@/server/domain';
import type { DomainContext } from '@/server/domain/_shared';
import { pulsePage, type PulsePage } from '@/server/page';
import { BulkView } from './bulk-view';
import { EntriesView } from './entries-view';
import type { FocusJob } from './job-focus';
import { LogView } from './log-view';
import { ReviewView } from './review-view';

export type LogTab = 'day' | 'bulk' | 'review' | 'entries';

function logTabs(page: PulsePage) {
  return [
    { id: 'day', label: 'Day', href: routes.log() },
    ...(page.can('production:log') ? [{ id: 'bulk', label: 'Many days', href: routes.logBulk() }] : []),
    ...(page.can('day:review') ? [{ id: 'review', label: 'Review the day', href: routes.logReview() }] : []),
    { id: 'entries', label: 'All entries', href: routes.logEntries() },
  ];
}

function Frame({
  page,
  view,
  subtitle,
  children,
}: {
  readonly page: PulsePage;
  readonly view: LogTab;
  readonly subtitle: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Page
      title="Log work"
      subtitle={subtitle}
      actions={
        page.can('production:log') ? (
          <ButtonLink
            href={routes.newImport('production')}
            variant="secondary"
            icon={<FileSpreadsheet aria-hidden />}
          >
            Import production
          </ButtonLink>
        ) : null
      }
      tabs={<RouteTabs label="Log work views" active={view} tabs={logTabs(page)} />}
      width="full"
    >
      {children}
    </Page>
  );
}

/** The job a `?job=` link asks for, found by id or number. Never throws: a missing job is a message, not an error page. */
async function findFocusJob(ctx: DomainContext, ref: string, sites: readonly { id: string; name: string }[]): Promise<FocusJob> {
  try {
    const job = await getJob(ctx, ref);
    if (job.deletedAt) throw new Error('deleted');
    return { ref, id: job.id, number: job.number, name: job.name, status: job.status, siteId: job.siteId, siteName: sites.find((site) => site.id === job.siteId)?.name ?? null, startDate: job.startDate };
  } catch {
    return { ref, id: null, number: null, name: null, status: null, siteId: null, siteName: null, startDate: null };
  }
}

/** Log work: the day grid, one row per active job. Units, people and hours, keyboard first. */
export async function LogPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const rawDate = one(query.date);
  const date = rawDate && isIsoDate(rawDate) ? rawDate : undefined;
  const page = await pulsePage(routes.log({ date, job: one(query.job), site: one(query.site) }), 'log');
  if (page.blocked) return <PageBlocked title="Log work" role={page.access.role} />;
  const sites = await listSites(page.ctx);
  const wantedSite = one(query.site);
  const jobRef = one(query.job)?.trim() || null;
  const focus = jobRef ? await findFocusJob(page.ctx, jobRef, sites) : null;
  // A "Log work" link opens the job's own site unless the link names one.
  const siteId = wantedSite && sites.some((site) => site.id === wantedSite) ? wantedSite : (focus?.siteId ?? undefined);
  const [grid, laborClasses, settings] = await Promise.all([
    getLogGrid(page.ctx, { date, siteId }),
    listLaborClasses(page.ctx, { includeArchived: true }),
    getSettings(page.ctx),
  ]);
  return (
    <Frame
      page={page}
      view="day"
      subtitle="Type in what got finished: units, people and hours. Pulse does the rest."
    >
      <LogView
        initial={grid}
        sites={sites}
        laborClasses={laborClasses}
        thresholds={{ watchBp: settings.productivityWatchBp, riskBp: settings.productivityRiskBp }}
        focusJob={jobRef}
        focus={focus}
      />
    </Frame>
  );
}

/** Review the day: the manager queue of days, with their odd rows and missing jobs. */
export async function LogReviewPage() {
  const page = await pulsePage(routes.logReview(), 'log');
  if (page.blocked || !page.can('day:review'))
    return <PageBlocked title="Review the day" role={page.access.role} />;
  const [queue, sites, laborClasses, settings] = await Promise.all([
    getReviewQueue(page.ctx, { days: 21 }),
    listSites(page.ctx),
    listLaborClasses(page.ctx, { includeArchived: true }),
    getSettings(page.ctx),
  ]);
  return (
    <Frame page={page} view="review" subtitle="Check each day, fix odd rows, then approve.">
      <ReviewView
        initial={queue}
        sites={sites}
        laborClasses={laborClasses}
        thresholds={{ watchBp: settings.productivityWatchBp, riskBp: settings.productivityRiskBp }}
      />
    </Frame>
  );
}

/** Every production entry across days, with filters, bulk edit and export. */
export async function LogEntriesPage() {
  const page = await pulsePage(routes.logEntries(), 'log');
  if (page.blocked) return <PageBlocked title="All entries" role={page.access.role} />;
  const [sites, laborClasses] = await Promise.all([
    listSites(page.ctx),
    listLaborClasses(page.ctx, { includeArchived: true }),
  ]);
  const today = sites.find((site) => site.isDefault)?.today ?? sites[0]?.today ?? todayIso();
  return (
    <Frame page={page} view="entries" subtitle="Every production entry, across all days and jobs.">
      <EntriesView sites={sites} laborClasses={laborClasses} today={today} />
    </Frame>
  );
}

/** Many days at once: a sheet for catching up on a week or a whole job. */
export async function LogBulkPage() {
  const page = await pulsePage(routes.logBulk(), 'log');
  if (page.blocked || !page.can('production:log'))
    return <PageBlocked title="Many days" role={page.access.role} />;
  const [sites, settings] = await Promise.all([listSites(page.ctx), getSettings(page.ctx)]);
  const today = sites.find((site) => site.isDefault)?.today ?? sites[0]?.today ?? todayIso();
  return (
    <Frame
      page={page}
      view="bulk"
      subtitle="Catch up on many days in one sheet. Nothing is saved until you press Save all rows."
    >
      <BulkView
        today={today}
        thresholds={{ watchBp: settings.productivityWatchBp, riskBp: settings.productivityRiskBp }}
      />
    </Frame>
  );
}
