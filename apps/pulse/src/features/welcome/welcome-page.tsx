import Link from 'next/link';
import { ChevronRight, FileSpreadsheet, PackagePlus, Plug, type LucideIcon } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { StepList } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

interface StartCard {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
}

/** First run: how do you want to start, then the five steps to a first profit number. */
export async function WelcomePage() {
  const page = await pulsePage(routes.welcome());
  if (page.blocked) return <PageBlocked title="Getting started" role={page.access.role} />;
  const integrations = await page.integrations();
  const connected = [integrations.crm ? 'CRM' : null, integrations.wms ? 'WMS' : null, integrations.projects ? 'Projects' : null].filter((value): value is string => value !== null);
  const cards: StartCard[] = [];
  if (page.can('job:manage')) {
    cards.push({ id: 'type', icon: PackagePlus, title: 'Type your first job', detail: 'The fastest way to see how it works. A client, a name, the units and the price.', href: routes.newJob() });
  }
  if (page.can('production:log')) {
    cards.push({ id: 'import', icon: FileSpreadsheet, title: 'Import spreadsheets', detail: 'Bring in clients, jobs, daily production and costs from the files you already keep.', href: routes.importCenter() });
  }
  if (connected.length > 0 && page.can('settings:manage')) {
    cards.push({ id: 'connect', icon: Plug, title: 'Use your KitStak apps', detail: `Pulse can read ${connected.join(', ')} for this workspace, so deals, work orders and time flow in on their own.`, href: routes.settingsApps() });
  }
  return (
    <Page title="Getting started" subtitle={`Welcome to Pulse, ${page.context.user.name.trim().split(/\s+/)[0] ?? 'there'}. You are a few minutes from your first profit number.`} width="narrow">
      <div className="flex flex-col gap-5">
        {cards.length > 0 ? (
          <section aria-labelledby="start-title">
            <h2 id="start-title" className="mb-2 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
              How do you want to start?
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {cards.map((card) => (
                <li key={card.id}>
                  <Link
                    href={card.href}
                    data-testid={`start-${card.id}`}
                    className="group flex h-full items-start gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
                      <card.icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">{card.title}</span>
                      <span className="mt-0.5 block text-sm text-fg-muted">{card.detail}</span>
                    </span>
                    <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <Panel title="Five steps to your first profit number">
          <StepList
            steps={[
              { title: 'Set a labor rate', detail: 'Tell Pulse what an hour of work really costs you: the wage plus taxes, benefits and overhead.', action: <ButtonLink href={routes.labor('rates')} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Add a client', detail: 'The company you do the work for.', action: <ButtonLink href={routes.profit({ by: 'client' })} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Add a job', detail: 'One piece of work with a price and a number of units.', action: <ButtonLink href={routes.newJob()} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'Log a day', detail: 'Units finished, how many people, and the hours each.', action: <ButtonLink href={routes.log()} variant="secondary" size="sm">Open</ButtonLink> },
              { title: 'See your profit', detail: 'Revenue, cost and margin for the job, right away.', action: <ButtonLink href={routes.profit()} variant="secondary" size="sm">Open</ButtonLink> },
            ]}
          />
        </Panel>
        <p className="text-sm text-fg-muted">
          Want to know how the numbers are worked out?{' '}
          <Link href={routes.settings('math')} className="font-medium text-fg-link hover:underline">
            How Pulse does the math
          </Link>
        </p>
      </div>
    </Page>
  );
}
