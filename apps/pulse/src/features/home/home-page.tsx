import { redirect } from 'next/navigation';
import { CircleDollarSign, PackagePlus, Rocket } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { StepList, Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { landingPath } from '@/lib/nav';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Home: the two line answer, tiles, jobs that need you and the setup checklist. */
export async function HomePage() {
  const page = await pulsePage(routes.home(), 'home');
  // Supervisors log work; they land on the log, never on a money page.
  if (page.access.role === 'supervisor') redirect(landingPath(page.access.role));
  if (page.blocked) return <PageBlocked title="Home" role={page.access.role} />;
  const name = firstName(page.context.user.name);
  return (
    <Page
      title={name ? `Hello, ${name}` : 'Home'}
      subtitle={`How ${page.context.org.name} is doing, and which jobs need you.`}
      actions={
        page.can('job:manage') ? (
          <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />} testId="home-new-job">
            New job
          </ButtonLink>
        ) : null
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel>
          <Teach
            icon={CircleDollarSign}
            title="No profit numbers yet"
            why="Pulse turns your jobs, daily work and costs into one answer: are we making money, and if not, why? Add a job and log one day to see it here."
            points={[
              'Profit on your jobs, and profit for the whole company',
              'Jobs that need you, worst first, with the reason',
              'Today’s entries, alerts and things to fix',
            ]}
            actions={
              <>
                {page.can('job:manage') ? (
                  <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />}>
                    Add your first job
                  </ButtonLink>
                ) : null}
                <ButtonLink href={routes.welcome()} variant="secondary" icon={<Rocket aria-hidden />}>
                  Other ways to start
                </ButtonLink>
              </>
            }
          />
        </Panel>
        <Panel title="Five steps to your first profit number">
          <StepList
            steps={[
              { title: 'Set a labor rate', detail: 'Tell Pulse what an hour of work really costs you.', action: <ButtonLink href={routes.labor('rates')} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Add a client', detail: 'The company you do the work for.', action: <ButtonLink href={routes.profit({ by: 'client' })} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Add a job', detail: 'One piece of work with a price and a number of units.', action: <ButtonLink href={routes.newJob()} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Log a day', detail: 'Units finished, people and hours.', action: <ButtonLink href={routes.log()} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'See your profit', detail: 'Revenue, cost and margin for the job, right away.', action: <ButtonLink href={routes.profit()} variant="secondary" size="sm">Open</ButtonLink> },
            ]}
          />
        </Panel>
      </div>
    </Page>
  );
}
