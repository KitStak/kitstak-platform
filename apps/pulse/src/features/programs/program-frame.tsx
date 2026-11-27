'use client';
/**
 * The program page frame (spec 7.3): header (name, key, customer, status chip, month picker,
 * "Print report", "Open in Projects", "Open the job"), the five tabs, and the open tab. The tab
 * and the month live in the address bar, written with `history.pushState`, so they can be
 * bookmarked and Back works, without asking the server for the page again.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useState, type MouseEvent } from 'react';
import { Archive, FileText, SquareArrowOutUpRight } from 'lucide-react';
import { DashboardLinkProvider, Tag } from '@kitstak/ui/dashboard';
import { Page } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { ScrollX } from '@/components/ui/scroll-x';
import { cn } from '@/components/ui/cn';
import type { ProgramDaysDTO, ProgramLaborDTO, ProgramMonthDTO, ProgramMonthsDTO, ProgramVariantsDTO } from '@/lib/program-types';
import { PROGRAM_TABS, PROGRAM_TAB_LABELS, routes, type ProgramTab } from '@/lib/routes';
import { LoadError } from '@/features/profit/profit-ui';
import { useShell } from '@/features/shell/shell-context';
import { addMonth } from './program-format';
import { ProgramDays } from './program-days';
import { ProgramLabor } from './program-labor';
import { ProgramMonths } from './program-months';
import { ProgramOverview } from './program-overview';
import { ProgramReportDialog, type ProgramReportTarget } from './program-report-dialog';
import { ProgramVariants } from './program-variants';
import { MonthPicker, PlaceLink, SectionSkeleton, StatusPill } from './program-ui';
import { useProgramMonth } from './use-programs';

export interface ProgramInitial {
  readonly overview?: ProgramMonthDTO;
  readonly variants?: ProgramVariantsDTO;
  readonly months?: ProgramMonthsDTO;
  readonly days?: ProgramDaysDTO;
  readonly labor?: ProgramLaborDTO;
}

/** Where a tab and month live: `?tab=` and `?month=`, both left out when they are the defaults. */
function useProgramPlace(programKey: string, initialTab: ProgramTab, initialMonth: string, currentMonth: string) {
  const params = useSearchParams();
  const rawTab = params?.get('tab') ?? '';
  const rawMonth = params?.get('month') ?? '';
  const tab: ProgramTab = (PROGRAM_TABS as readonly string[]).includes(rawTab) ? (rawTab as ProgramTab) : params ? 'overview' : initialTab;
  const month = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : params ? currentMonth : initialMonth;
  const href = useCallback((next: { tab?: ProgramTab; month?: string }) => {
    const nextMonth = next.month ?? month;
    return routes.program(programKey, { tab: next.tab ?? tab, month: nextMonth === currentMonth ? undefined : nextMonth });
  }, [programKey, tab, month, currentMonth]);
  const go = useCallback((next: { tab?: ProgramTab; month?: string }) => {
    const target = href(next);
    if (target !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, '', target);
    window.scrollTo({ top: 0 });
  }, [href]);
  return { tab, month, href, go };
}

function ProgramTabs({ active, href, onPick }: { readonly active: ProgramTab; readonly href: (tab: ProgramTab) => string; readonly onPick: (tab: ProgramTab) => void }) {
  const pick = (tab: ProgramTab) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onPick(tab);
  };
  return (
    <nav aria-label="Program sections" className="-mb-px min-w-0">
      <ScrollX label="Program sections" tabStop={false} fade="app" className="-mx-1 -my-1" scrollerClassName="px-1 py-1">
        <ul className="flex min-w-max items-end gap-6 border-b border-border-subtle">
          {PROGRAM_TABS.map((tab) => (
            <li key={tab}>
              <a
                href={href(tab)}
                onClick={pick(tab)}
                aria-current={tab === active ? 'page' : undefined}
                data-testid={`tab-${tab}`}
                className={cn(
                  'relative -mb-px inline-flex h-9 items-center gap-1.5 rounded-t-sm border-b-2 border-transparent px-0.5 text-sm font-medium whitespace-nowrap text-fg-secondary',
                  'transition-[color,border-color] duration-[var(--duration-fast)] ease-out hover:text-fg',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  tab === active && 'border-primary text-fg',
                )}
              >
                {PROGRAM_TAB_LABELS[tab]}
              </a>
            </li>
          ))}
        </ul>
      </ScrollX>
    </nav>
  );
}

export function ProgramFrame({ programKey, initialTab, initialMonth, currentMonth, initial }: { readonly programKey: string; readonly initialTab: ProgramTab; readonly initialMonth: string; readonly currentMonth: string; readonly initial: ProgramInitial }) {
  const { appUrls, seesMoney } = useShell();
  const { tab, month, href, go } = useProgramPlace(programKey, initialTab, initialMonth, currentMonth);
  const [report, setReport] = useState<ProgramReportTarget | null>(null);
  const serverMonth = initial.overview?.month.month ?? initialMonth;
  const overview = useProgramMonth(programKey, month, { initialData: month === serverMonth ? initial.overview : undefined });
  const data = overview.data;
  const header = data?.header ?? initial.overview?.header;
  const key = header?.key ?? programKey.toUpperCase();
  const customer = header ? (header.customerName ?? header.client?.name ?? null) : null;
  const projectsHref = header ? `${appUrls.projects}${header.projectsPath}` : `${appUrls.projects}/programs`;

  const subtitle = header ? (
    <span className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 align-middle">
      <Tag>{header.key}</Tag>
      <StatusPill status={header.status} label={header.statusLabel} />
      {customer ? <span className="truncate text-fg-secondary" data-testid="program-customer">{customer}</span> : null}
      {header.cardVersion !== null ? <span className="text-fg-muted">· Price card v{header.cardVersion}</span> : null}
      {header.job ? (
        <>
          <span aria-hidden className="text-fg-muted">·</span>
          <Link href={header.job.path} className="rounded-sm text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="program-open-job" title={`${header.job.number}, ${header.job.name}`}>
            Open the job
          </Link>
        </>
      ) : null}
    </span>
  ) : undefined;

  const shared = { programKey: key, month, currentMonth };
  return (
    <Page
      title={header?.name ?? key}
      breadcrumbs={[{ label: 'Programs', href: routes.programs({ month: month === currentMonth ? undefined : month }) }, { label: key }]}
      subtitle={subtitle}
      width="full"
      actions={
        <>
          <MonthPicker value={month} onChange={(next) => go({ month: next })} latest={addMonth(currentMonth, 1)} />
          <Button variant="secondary" leadingIcon={<FileText aria-hidden />} onClick={() => setReport({ key, name: header?.name ?? key, month })} data-testid="program-print-report">
            Print report
          </Button>
          <a href={projectsHref} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium whitespace-nowrap text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="program-open-projects">
            Open in Projects
            <SquareArrowOutUpRight aria-hidden className="size-3.5 text-icon" />
          </a>
        </>
      }
      tabs={<ProgramTabs active={tab} href={(next) => href({ tab: next })} onPick={(next) => go({ tab: next })} />}
    >
      <DashboardLinkProvider component={PlaceLink}>
      <div className="flex flex-col gap-4">
        {header?.deleted ? (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-border-subtle bg-sunken px-4 py-3 text-sm text-fg" data-testid="program-deleted">
            <Archive aria-hidden className="size-4 shrink-0 text-icon" />
            This program was deleted in Projects. Its past months stay here.
          </div>
        ) : null}
        {!header ? (
          overview.isError ? (
            <LoadError what="this program" message={overview.error instanceof Error ? overview.error.message : undefined} onRetry={() => void overview.refetch()} />
          ) : (
            <div className="rounded-xl border border-border-subtle bg-panel">
              <SectionSkeleton label="Loading the program" rows={8} />
            </div>
          )
        ) : tab === 'overview' ? (
          <ProgramOverview query={overview} projectsHref={projectsHref} />
        ) : tab === 'variants' ? (
          <ProgramVariants {...shared} initial={initial.variants} />
        ) : tab === 'months' ? (
          <ProgramMonths programKey={key} currentMonth={currentMonth} initial={initial.months} onOpenMonth={(next) => go({ tab: 'overview', month: next })} />
        ) : tab === 'days' ? (
          <ProgramDays {...shared} initial={initial.days} />
        ) : (
          <ProgramLabor {...shared} initial={initial.labor} />
        )}
      </div>
      </DashboardLinkProvider>
      <ProgramReportDialog target={report} onClose={() => setReport(null)} seesMoney={seesMoney} />
    </Page>
  );
}
