import { redirect } from 'next/navigation';
import { PackagePlus } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { PageBlocked } from '@/features/access/page-blocked';
import { parsePeriod, searchGetter } from '@/features/profit/period';
import { landingPath } from '@/lib/nav';
import { suggestBucket } from '@/lib/profit/trends';
import { routes } from '@/lib/routes';
import { getProfit, getSettings, getSummary, listSites, todayInZone } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { HomeView } from './home-view';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** A read that failed leaves the client to load it again (and show the retry state if that fails too). */
async function soft<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch {
    return undefined;
  }
}

/**
 * Home: the two line answer, the headline numbers for a period, the jobs that need you, the
 * trend, today's entries and alerts. People who may not see money get units, hours and pace.
 * Supervisors land on Log work; `/?floor=1` shows them the floor version of Home.
 */
export async function HomePage({ searchParams }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = (await searchParams) ?? {};
  const page = await pulsePage(routes.home(), 'home');
  const floor = searchGetter(query)('floor') === '1';
  if (page.access.role === 'supervisor' && !floor) redirect(landingPath(page.access.role));
  if (page.access.role === 'none' || (page.blocked && page.access.role !== 'supervisor')) return <PageBlocked title="Home" role={page.access.role} />;
  const [settings, sites] = await Promise.all([soft(getSettings(page.ctx)), soft(listSites(page.ctx))]);
  const site = sites?.find((item) => item.isDefault) ?? sites?.[0];
  const today = site?.today ?? todayInZone(settings?.timezone ?? 'UTC');
  const weekStart = settings?.weekStart ?? 1;
  const period = parsePeriod(searchGetter(query), today, weekStart);
  const range = { from: period.from, to: period.to };
  const [summary, trend] = await Promise.all([soft(getSummary(page.ctx, range)), soft(getProfit(page.ctx, suggestBucket(range), range))]);
  const name = firstName(page.context.user.name);
  return (
    <Page
      title={name ? `Hello, ${name}` : 'Home'}
      subtitle={page.access.seesMoney ? `How ${page.context.org.name} is doing, and which jobs need you.` : `How the floor at ${page.context.org.name} is doing, and which jobs need you.`}
      width="full"
      actions={
        page.can('job:manage') ? (
          <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />} testId="home-new-job">
            New job
          </ButtonLink>
        ) : null
      }
    >
      <HomeView today={today} weekStart={weekStart} targetMarginBp={settings?.defaultTargetMarginBp ?? 3000} initialSummary={summary} initialTrend={trend} initialRange={range} />
    </Page>
  );
}
