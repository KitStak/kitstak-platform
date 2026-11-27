import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { PROFIT_VIEWS, routes, type ProfitView } from '@/lib/routes';
import type { ClientDTO, JobTypeDTO, SiteDTO } from '@/lib/types';
import { getSettings, listClients, listJobTypes, listSites, todayInZone } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { ProfitExplorer } from './profit-explorer';
import { ProfitTabs } from './profit-tabs';

function parseView(value: string | string[] | undefined): ProfitView {
  const raw = Array.isArray(value) ? value[0] : value;
  return (PROFIT_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as ProfitView) : 'job';
}

/** A read that failed leaves the page usable: the filter it feeds is hidden. */
async function soft<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch {
    return undefined;
  }
}

/** Profit: revenue, cost and margin by job, client, job type, extra service, site, month, week or day. */
export async function ProfitPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = parseView((await searchParams).by);
  const page = await pulsePage(routes.profit({ by: view === 'job' ? undefined : view }), 'profit');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Profit" role={page.access.role} />;
  const [sites, clients, jobTypes, settings] = await Promise.all([soft<SiteDTO[]>(listSites(page.ctx)), soft<ClientDTO[]>(listClients(page.ctx, {})), soft<JobTypeDTO[]>(listJobTypes(page.ctx)), soft(getSettings(page.ctx))]);
  const site = sites?.find((item) => item.isDefault) ?? sites?.[0];
  return (
    <Page title="Profit" subtitle="Revenue, cost and margin, any way you want to cut it." width="full" tabs={<ProfitTabs active={view} />}>
      <ProfitExplorer key={view} by={view} today={site?.today ?? todayInZone(settings?.timezone ?? 'UTC')} weekStart={settings?.weekStart ?? 1} targetMarginBp={settings?.defaultTargetMarginBp ?? 3000} sites={sites ?? []} clients={clients ?? []} jobTypes={jobTypes ?? []} orgSlug={page.context.org.slug} />
    </Page>
  );
}
