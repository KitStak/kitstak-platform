import { CircleDollarSign, PackagePlus, Rocket } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { PROFIT_VIEWS, routes, type ProfitView } from '@/lib/routes';
import { pulsePage } from '@/server/page';

const VIEW_LABELS: Readonly<Record<ProfitView, string>> = {
  job: 'Jobs',
  client: 'Clients',
  type: 'Job types',
  service: 'Extra services',
  site: 'Sites',
  month: 'Months',
  week: 'Weeks',
  day: 'Days',
};

const VIEW_COPY: Readonly<Record<ProfitView, { title: string; why: string }>> = {
  job: { title: 'No job profit yet', why: 'Once a job has a price and some logged work, it shows here with its revenue, labor, materials, other costs, profit and margin. Best and worst jobs sit at the top of the chart.' },
  client: { title: 'No client profit yet', why: 'See which clients make you money and which ones cost you. Each client adds up the revenue and cost of all its jobs and extra services.' },
  type: { title: 'No profit by job type yet', why: 'Group your jobs by the kind of work, like kitting or relabeling, to see which kind pays best and where your pace is strongest.' },
  service: { title: 'No profit from extra services yet', why: 'Extra services are the small billable things around a job, like labeling or rework. Each one has its own revenue, cost and margin here.' },
  site: { title: 'No profit by site yet', why: 'With more than one site, this tab puts them side by side: margin, pace against target, and time not on a job.' },
  month: { title: 'No monthly profit yet', why: 'Each month shows what your jobs made, then what the company made after shared costs. Closed months are locked so the numbers stay put.' },
  week: { title: 'No weekly profit yet', why: 'Week by week revenue, cost and margin, so you can spot a bad week while there is still time to fix the month.' },
  day: { title: 'No daily profit yet', why: 'Every day with logged work shows its revenue earned, cost and margin. Click a day to see the entries behind it.' },
};

function parseView(value: string | string[] | undefined): ProfitView {
  const raw = Array.isArray(value) ? value[0] : value;
  return (PROFIT_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as ProfitView) : 'job';
}

/** Profit: revenue, cost and margin by job, client, job type, extra service, site, month, week or day. */
export async function ProfitPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = parseView((await searchParams).by);
  const page = await pulsePage(routes.profit({ by: view === 'job' ? undefined : view }), 'profit');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Profit" role={page.access.role} />;
  const copy = VIEW_COPY[view];
  return (
    <Page
      title="Profit"
      subtitle="Revenue, cost and margin, any way you want to cut it."
      tabs={<RouteTabs label="Profit views" active={view} tabs={PROFIT_VIEWS.map((id) => ({ id, label: VIEW_LABELS[id], href: routes.profit({ by: id === 'job' ? undefined : id }) }))} />}
    >
      <Panel>
        <Teach
          icon={CircleDollarSign}
          title={copy.title}
          why={copy.why}
          points={['Revenue, labor, materials, other costs and time not on a job', 'Margin before and after shared costs', 'Click any row to drill down, and totals always match']}
          actions={
            <>
              {page.can('job:manage') ? (
                <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />}>
                  Add a job
                </ButtonLink>
              ) : null}
              <ButtonLink href={routes.welcome()} variant="secondary" icon={<Rocket aria-hidden />}>
                Other ways to start
              </ButtonLink>
            </>
          }
        />
      </Panel>
    </Page>
  );
}
