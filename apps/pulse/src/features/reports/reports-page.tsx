import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, FileText, Lock } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { PageBlocked } from '@/features/access/page-blocked';
import { REPORTS, REPORT_GROUP_LABELS, reportInfo, type ReportGroup } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { ClientDTO, JobTypeDTO, SiteDTO } from '@/lib/types';
import { getSettings, listClients, listJobTypes, listSites, todayInZone } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { ReportView } from './report-view';
import { ReportsScheduled } from './reports-scheduled';

const GROUPS: readonly ReportGroup[] = ['profit', 'plan', 'floor', 'close'];

async function soft<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch {
    return undefined;
  }
}

/** Report library: every ready made report, grouped, with what it answers. The Scheduled tab holds schedules and past builds. */
export async function ReportsPage({ searchParams }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = (await searchParams) ?? {};
  const pick = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value[0] : value) ?? null;
  const tab = pick(query.tab) === 'scheduled' ? 'scheduled' : 'library';
  const page = await pulsePage(routes.reports(), 'reports');
  if (page.blocked) return <PageBlocked title="Reports" role={page.access.role} />;
  const seesMoney = page.access.seesMoney;
  return (
    <Page
      title="Reports"
      subtitle="Ready made reports you can filter, print, export or build on a schedule."
      tabs={
        <RouteTabs
          label="Reports"
          active={tab}
          tabs={[
            { id: 'library', label: 'Library', href: routes.reports() },
            { id: 'scheduled', label: 'Scheduled', href: `${routes.reports()}?tab=scheduled` },
          ]}
        />
      }
    >
      {tab === 'scheduled' ? (
        <ReportsScheduled highlightRun={pick(query.run)} />
      ) : (
        <div className="flex flex-col gap-6" data-testid="reports-library">
          {GROUPS.map((group) => (
            <section key={group} aria-labelledby={`reports-${group}`}>
              <h2 id={`reports-${group}`} className="mb-2 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
                {REPORT_GROUP_LABELS[group]}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {REPORTS.filter((report) => report.group === group).map((report) => {
                  const locked = report.needsMoney && !seesMoney;
                  return (
                    <li key={report.slug}>
                      {locked ? (
                        <div className="flex h-full items-start gap-3 rounded-xl border border-border-subtle bg-sunken p-4" data-testid={`report-${report.slug}`}>
                          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center text-icon">
                            <Lock className="size-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-fg-secondary">{report.name}</span>
                            <span className="mt-0.5 block text-sm text-fg-muted">Shows money. Ask an admin if you need it.</span>
                          </span>
                        </div>
                      ) : (
                        <Link
                          href={routes.report(report.slug)}
                          data-testid={`report-${report.slug}`}
                          className="group flex h-full items-start gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center text-icon">
                            <FileText className="size-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-fg">{report.name}</span>
                            <span className="mt-0.5 block text-sm text-fg-muted">{report.description}</span>
                          </span>
                          <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

/** One report: filters, a chart, a table, print, CSV export and schedules. Unknown slugs answer 404. */
export async function ReportPage({ params }: { readonly params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug);
  const report = reportInfo(slug);
  if (!report) notFound();
  const page = await pulsePage(routes.report(report.slug), 'reports');
  if (page.blocked || (report.needsMoney && !page.access.seesMoney)) return <PageBlocked title={report.name} role={page.access.role} />;
  const [sites, clients, jobTypes, settings] = await Promise.all([soft<SiteDTO[]>(listSites(page.ctx)), soft<ClientDTO[]>(listClients(page.ctx, {})), soft<JobTypeDTO[]>(listJobTypes(page.ctx)), soft(getSettings(page.ctx))]);
  const site = sites?.find((item) => item.isDefault) ?? sites?.[0];
  return (
    <Page title={report.name} subtitle={report.description} width="full" breadcrumbs={[{ label: 'Reports', href: routes.reports() }, { label: report.name }]}>
      <ReportView slug={report.slug} name={report.name} today={site?.today ?? todayInZone(settings?.timezone ?? 'UTC')} weekStart={settings?.weekStart ?? 1} sites={sites ?? []} clients={clients ?? []} jobTypes={jobTypes ?? []} />
    </Page>
  );
}
