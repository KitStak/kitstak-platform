import { ClipboardCheck, ClipboardList, ClipboardPen, FileSpreadsheet, PackagePlus, type LucideIcon } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { formatLongDate, isIsoDate, todayIso } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { pulsePage, type PulsePage } from '@/server/page';

export type LogView = 'day' | 'review' | 'entries';

function logTabs(page: PulsePage) {
  return [
    { id: 'day', label: 'Day', href: routes.log() },
    ...(page.can('day:review') ? [{ id: 'review', label: 'Review the day', href: routes.logReview() }] : []),
    { id: 'entries', label: 'All entries', href: routes.logEntries() },
  ];
}

function Frame({ page, view, subtitle, children }: { readonly page: PulsePage; readonly view: LogView; readonly subtitle: string; readonly children: React.ReactNode }) {
  return (
    <Page
      title="Log work"
      subtitle={subtitle}
      actions={
        page.can('production:log') ? (
          <ButtonLink href={routes.newImport('production')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
            Import production
          </ButtonLink>
        ) : null
      }
      tabs={<RouteTabs label="Log work views" active={view} tabs={logTabs(page)} />}
    >
      <Panel>{children}</Panel>
    </Page>
  );
}

function StartActions({ page, icon: Icon = PackagePlus }: { readonly page: PulsePage; readonly icon?: LucideIcon }) {
  return (
    <>
      {page.can('job:manage') ? (
        <ButtonLink href={routes.newJob()} icon={<Icon aria-hidden />}>
          Add a job
        </ButtonLink>
      ) : null}
      <ButtonLink href={routes.jobs()} variant="secondary">
        See jobs
      </ButtonLink>
    </>
  );
}

/** Log work: the day grid, one row per active job. Units, people and hours, keyboard first. */
export async function LogPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const rawDate = Array.isArray(query.date) ? query.date[0] : query.date;
  const date = rawDate && isIsoDate(rawDate) ? rawDate : todayIso();
  const page = await pulsePage(routes.log({ date: rawDate && isIsoDate(rawDate) ? rawDate : undefined }), 'log');
  if (page.blocked) return <PageBlocked title="Log work" role={page.access.role} />;
  return (
    <Frame page={page} view="day" subtitle={`${formatLongDate(date)}. Type in what got finished: units, people and hours.`}>
      <Teach
        icon={ClipboardPen}
        title="No active jobs to log against"
        why="Each active job gets one row here for the day. Type the units finished, how many people worked on it and the hours each, and Pulse works out the labor cost and the pace."
        points={['Tab and Enter move through the grid, no mouse needed', 'Pace against the target shows as you type', 'Every row saves itself, with undo']}
        actions={<StartActions page={page} />}
        footnote={page.can('job:manage') ? undefined : 'Ask a manager to add the first job, then come back to log the day.'}
      />
    </Frame>
  );
}

/** Review the day: the manager queue of days marked complete, with their odd rows. */
export async function LogReviewPage() {
  const page = await pulsePage(routes.logReview(), 'log');
  if (page.blocked || !page.can('day:review')) return <PageBlocked title="Review the day" role={page.access.role} />;
  return (
    <Frame page={page} view="review" subtitle="Check the days your team marked complete, fix odd rows, then approve.">
      <Teach
        icon={ClipboardCheck}
        title="No days are waiting for review"
        why="When a supervisor marks a day complete it lands here. Pulse points out rows that look off, like units with no hours or a pace far from the target, so you can fix them before the numbers are used."
        points={['Units with no hours, and hours with no units', 'Pace under half or over double the target', 'More hours logged than were paid']}
        actions={<ButtonLink href={routes.log()}>Open today’s log</ButtonLink>}
      />
    </Frame>
  );
}

/** Every production entry across days, with filters, bulk edit and export. */
export async function LogEntriesPage() {
  const page = await pulsePage(routes.logEntries(), 'log');
  if (page.blocked) return <PageBlocked title="All entries" role={page.access.role} />;
  return (
    <Frame page={page} view="entries" subtitle="Every production entry, across all days and jobs.">
      <Teach
        icon={ClipboardList}
        title="No entries yet"
        why="Each row logged on the day grid, typed on the floor tablet or brought in from a spreadsheet is listed here. Filter by date, job, site or person, fix many rows at once, and export what you see."
        actions={
          <>
            <ButtonLink href={routes.log()} icon={<ClipboardPen aria-hidden />}>
              Log today
            </ButtonLink>
            {page.can('production:log') ? (
              <ButtonLink href={routes.newImport('production')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                Import production
              </ButtonLink>
            ) : null}
          </>
        }
      />
    </Frame>
  );
}
