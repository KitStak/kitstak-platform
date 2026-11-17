import { Clock, FileSpreadsheet, HandCoins, Users, type LucideIcon } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { LABOR_TABS, routes, type LaborTab } from '@/lib/routes';
import { pulsePage } from '@/server/page';

const TAB_LABELS: Readonly<Record<LaborTab, string>> = { rates: 'Rates', time: 'Time', cost: 'Cost' };

const COPY: Readonly<Record<LaborTab, { icon: LucideIcon; title: string; why: string; points: readonly string[] }>> = {
  rates: {
    icon: HandCoins,
    title: 'No labor rates yet',
    why: 'An hour of work costs more than the wage. Add the wage, payroll taxes, benefits and overhead for each kind of worker, and Pulse shows what one hour really costs you. Every job uses that number.',
    points: ['A live readout: one hour really costs this much', 'Rates start on a date, so old jobs keep their old cost', 'A preview of what a change does before you save it'],
  },
  time: {
    icon: Clock,
    title: 'No hours logged yet',
    why: 'This tab shows where paid time goes: on jobs, on things like meetings and cleanup, or nowhere at all. The less time that goes missing, the more your job profit can be trusted.',
    points: ['Hours on jobs against time not on a job, day by day', 'Share of paid time spent on jobs', 'A check of logged hours against payroll'],
  },
  cost: {
    icon: Users,
    title: 'No labor cost yet',
    why: 'Once hours are logged and a rate is set, labor cost shows here by kind of worker, job type and client, with the share that was overtime.',
    points: ['Labor cost by labor class, job type and client', 'Overtime share', 'Labor as a share of revenue'],
  },
};

function parseTab(value: string | string[] | undefined, fallback: LaborTab): LaborTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return (LABOR_TABS as readonly string[]).includes(raw ?? '') ? (raw as LaborTab) : fallback;
}

/** Labor: Rates (the real cost of an hour), Time (where paid hours go) and Cost. */
export async function LaborPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requested = (await searchParams).tab;
  const page = await pulsePage(routes.labor(), 'labor');
  if (page.blocked) return <PageBlocked title="Labor" role={page.access.role} />;
  // Rates need `rate:manage`; Cost shows money. Supervisors and no money viewers get Time only.
  const tabs = LABOR_TABS.filter((id) => (id === 'rates' ? page.can('rate:manage') : id === 'cost' ? page.access.seesMoney : true));
  const tab = parseTab(requested, tabs[0] ?? 'time');
  if (!tabs.includes(tab)) return <PageBlocked title={`Labor ${TAB_LABELS[tab].toLowerCase()}`} role={page.access.role} />;
  const copy = COPY[tab];
  const importStream = tab === 'rates' ? 'labor_rates' : 'paid_hours';
  const canImport = tab === 'rates' ? page.can('rate:manage') : page.can('import:run');
  return (
    <Page
      title="Labor"
      subtitle="What an hour really costs, where paid time goes, and what labor adds up to."
      tabs={<RouteTabs label="Labor views" active={tab} tabs={tabs.map((id) => ({ id, label: TAB_LABELS[id], href: routes.labor(id) }))} />}
    >
      <Panel>
        <Teach
          icon={copy.icon}
          title={copy.title}
          why={copy.why}
          points={copy.points}
          actions={
            <>
              {tab !== 'rates' && page.can('production:log') ? <ButtonLink href={routes.log()}>Log work</ButtonLink> : null}
              {canImport ? (
                <ButtonLink href={routes.newImport(importStream)} variant={tab === 'rates' ? 'primary' : 'secondary'} icon={<FileSpreadsheet aria-hidden />}>
                  {tab === 'rates' ? 'Import labor rates' : 'Import paid hours'}
                </ButtonLink>
              ) : null}
            </>
          }
        />
      </Panel>
    </Page>
  );
}
