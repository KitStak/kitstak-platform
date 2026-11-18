import { FileSpreadsheet } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { PageBlocked } from '@/features/access/page-blocked';
import { LABOR_TABS, routes, type LaborTab } from '@/lib/routes';
import { todayIso } from '@/lib/dates';
import { getSettings, listLaborClasses, listLaborRates, listSites } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { CostView } from './cost-view';
import { RatesView } from './rates-view';
import { TimeView } from './time-view';

const TAB_LABELS: Readonly<Record<LaborTab, string>> = { rates: 'Rates', time: 'Time', cost: 'Cost' };

function parseTab(value: string | string[] | undefined, fallback: LaborTab): LaborTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return (LABOR_TABS as readonly string[]).includes(raw ?? '') ? (raw as LaborTab) : fallback;
}

/** Labor: Rates (the real cost of an hour), Time (where paid hours go) and Cost. */
export async function LaborPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = (await searchParams).tab;
  const page = await pulsePage(routes.labor(), 'labor');
  if (page.blocked) return <PageBlocked title="Labor" role={page.access.role} />;
  // Rates need `rate:manage`; Cost shows money. Supervisors and no money viewers get Time only.
  const tabs = LABOR_TABS.filter((id) =>
    id === 'rates' ? page.can('rate:manage') : id === 'cost' ? page.access.seesMoney : true,
  );
  const tab = parseTab(requested, tabs[0] ?? 'time');
  if (!tabs.includes(tab))
    return <PageBlocked title={`Labor ${TAB_LABELS[tab].toLowerCase()}`} role={page.access.role} />;
  const [sites, laborClasses, settings] = await Promise.all([
    listSites(page.ctx),
    listLaborClasses(page.ctx, { includeArchived: true }),
    getSettings(page.ctx),
  ]);
  const today = sites.find((site) => site.isDefault)?.today ?? sites[0]?.today ?? todayIso();
  const rates = tab === 'rates' ? await listLaborRates(page.ctx) : [];
  const importStream = tab === 'rates' ? 'labor_rates' : 'paid_hours';
  const canImport = tab === 'rates' ? page.can('rate:manage') : page.can('import:run');
  return (
    <Page
      title="Labor"
      subtitle="What an hour really costs, where paid time goes, and what labor adds up to."
      actions={
        canImport && tab !== 'cost' ? (
          <ButtonLink
            href={routes.newImport(importStream)}
            variant="secondary"
            icon={<FileSpreadsheet aria-hidden />}
          >
            {tab === 'rates' ? 'Import labor rates' : 'Import paid hours'}
          </ButtonLink>
        ) : null
      }
      tabs={
        <RouteTabs
          label="Labor views"
          active={tab}
          tabs={tabs.map((id) => ({ id, label: TAB_LABELS[id], href: routes.labor(id) }))}
        />
      }
    >
      {tab === 'rates' ? (
        <RatesView
          initialClasses={laborClasses}
          initialRates={rates}
          sites={sites}
          settings={settings}
          today={today}
        />
      ) : tab === 'time' ? (
        <TimeView sites={sites} laborClasses={laborClasses} settings={settings} today={today} />
      ) : (
        <CostView sites={sites} today={today} />
      )}
    </Page>
  );
}
