import { BellRing, ListChecks } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage, type PulsePage } from '@/server/page';

function Frame({ view, children }: { readonly view: 'inbox' | 'rules'; readonly children: React.ReactNode }) {
  return (
    <Page
      title="Alerts"
      subtitle="Things that need you, with what happened and the next step."
      tabs={
        <RouteTabs
          label="Alert views"
          active={view}
          tabs={[
            { id: 'inbox', label: 'Inbox', href: routes.alerts() },
            { id: 'rules', label: 'Rules', href: routes.alertRules() },
          ]}
        />
      }
    >
      <Panel>{children}</Panel>
    </Page>
  );
}

const blocked = (page: PulsePage) => page.blocked;

/** Alerts inbox: open, snoozed and resolved alerts, each with the next step. */
export async function AlertsPage() {
  const page = await pulsePage(routes.alerts(), 'alerts');
  if (blocked(page)) return <PageBlocked title="Alerts" role={page.access.role} />;
  return (
    <Frame view="inbox">
      <Teach
        icon={BellRing}
        title="Nothing needs you right now"
        why="Pulse watches every open job. When one slips, for example the margin is heading under your target or a day was not logged, an alert lands here with what happened and what to do next."
        points={['What happened, in plain words', 'The next step, and a link straight to the job', 'Snooze it, hand it to someone, or mark it done']}
        actions={
          <>
            <ButtonLink href={routes.alertRules()} icon={<ListChecks aria-hidden />}>
              See the rules
            </ButtonLink>
            <ButtonLink href={routes.jobs()} variant="secondary">
              Open jobs
            </ButtonLink>
          </>
        }
      />
    </Frame>
  );
}

/** Alert rules: plain sentence rules with thresholds, scope and who gets told. */
export async function AlertRulesPage() {
  const page = await pulsePage(routes.alertRules(), 'alerts');
  if (blocked(page)) return <PageBlocked title="Alert rules" role={page.access.role} />;
  const canManage = page.can('alert:manage');
  return (
    <Frame view="rules">
      <Teach
        icon={ListChecks}
        title="No alert rules yet"
        why="A rule is one plain sentence, like: tell me when a job’s margin is heading under 15 percent. You pick the number, which jobs it covers and who gets told."
        points={['Margin heading under a number you choose', 'Pace under the target for two days in a row', 'A day with no entries, or a cost with no job']}
        actions={<ButtonLink href={routes.alerts()}>Back to the inbox</ButtonLink>}
        footnote={canManage ? 'Rules need at least one job to watch. Add a job and the starter rules switch on.' : 'A manager sets the rules. You get told when one of them fires for you.'}
      />
    </Frame>
  );
}
