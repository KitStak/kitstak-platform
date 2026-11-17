import { Calculator, HandCoins, Gauge } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { StepList, Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

/** Calculator: price a new job for a target margin, or open a real job in what if mode. */
export async function CalculatorPage() {
  const page = await pulsePage(routes.calculator(), 'calculator');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Calculator" role={page.access.role} />;
  return (
    <Page title="Calculator" subtitle="Price a new job, or test a what if, before you say yes.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel>
          <Teach
            icon={Calculator}
            title="The calculator needs a labor rate first"
            why="To price a job, Pulse has to know what an hour of work really costs you. Set one labor rate, then come back: type the units, the pace and the crew, and you get the price for the margin you want."
            points={['The price per unit that hits your target margin', 'The lowest price worth taking, and the break even price', 'What happened last time on jobs like this one']}
            actions={
              <>
                {page.can('rate:manage') ? (
                  <ButtonLink href={routes.labor('rates')} icon={<HandCoins aria-hidden />}>
                    Set a labor rate
                  </ButtonLink>
                ) : null}
                <ButtonLink href={routes.targetPace()} variant="secondary" icon={<Gauge aria-hidden />}>
                  Target pace
                </ButtonLink>
              </>
            }
            footnote={page.can('rate:manage') ? undefined : 'Ask an admin to set the first labor rate.'}
          />
        </Panel>
        <Panel title="How the price is worked out">
          <StepList
            steps={[
              { title: 'Labor', detail: 'Units divided by the pace gives hours. Hours times the real cost of an hour gives labor cost.' },
              { title: 'Materials and other costs', detail: 'Parts you pay for, per unit, plus things like freight and packaging.' },
              { title: 'Shared costs', detail: 'A fair share of time not on a job, like meetings and cleanup.' },
              { title: 'Price', detail: 'Cost divided by one minus your target margin. A 30 percent margin on a $7.00 cost is a $10.00 price.' },
            ]}
          />
        </Panel>
      </div>
    </Page>
  );
}
