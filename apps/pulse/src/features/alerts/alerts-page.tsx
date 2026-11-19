import { Page } from '@/components/layout/page';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { getSettings, listAlertRules, listAlerts, listClients, listJobTypes, listSites } from '@/server/domain';
import { todayInZone } from '@/server/domain/_shared';
import { pulsePage } from '@/server/page';
import { AlertsView } from './alerts-view';
import { RulesView } from './rules-view';

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
      {children}
    </Page>
  );
}

/** Alerts inbox: open, snoozed and done alerts, each with why it fired and the next step. */
export async function AlertsPage() {
  const page = await pulsePage(routes.alerts(), 'alerts');
  if (page.blocked) return <PageBlocked title="Alerts" role={page.access.role} />;
  const [open, snoozed, settings] = await Promise.all([listAlerts(page.ctx, { status: 'open', limit: 500 }), listAlerts(page.ctx, { status: 'snoozed', limit: 500 }), getSettings(page.ctx)]);
  return (
    <Frame view="inbox">
      <AlertsView initialOpen={open} initialSnoozed={snoozed} today={todayInZone(settings.timezone)} canManageRules={page.can('alert:manage')} />
    </Frame>
  );
}

/** Alert rules: plain sentence rules with a line, who gets told, quiet hours and a 30 day preview. */
export async function AlertRulesPage() {
  const page = await pulsePage(routes.alertRules(), 'alerts');
  if (page.blocked) return <PageBlocked title="Alert rules" role={page.access.role} />;
  const [rules, clients, jobTypes, sites, settings] = await Promise.all([listAlertRules(page.ctx), listClients(page.ctx, {}), listJobTypes(page.ctx), listSites(page.ctx), getSettings(page.ctx)]);
  return (
    <Frame view="rules">
      <RulesView
        initialRules={rules}
        canManage={page.can('alert:manage')}
        // A count of days is not money: every reader sees how long "nothing logged" waits.
        facts={{ noEntryDays: settings.noEntryDays }}
        options={{
          clients: clients.map((client) => ({ id: client.id, name: client.name })),
          jobTypes: jobTypes.map((type) => ({ id: type.id, name: type.name })),
          sites: sites.map((site) => ({ id: site.id, name: site.name })),
        }}
      />
    </Frame>
  );
}
