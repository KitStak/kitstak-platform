import { CalendarCheck2 } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { ConnectedAppsBody } from '@/features/integrations/connected-apps-body';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';
import { SettingsTabs } from './settings-tabs';

/** Month close: the checklist, the payroll check, and locking a month so its numbers stay put. */
export async function SettingsClosePage() {
  const page = await pulsePage(routes.settingsClose(), 'settings');
  if (page.blocked) return <PageBlocked title="Month close" role={page.access.role} />;
  return (
    <Page title="Settings" subtitle="How Pulse is set up for your workspace." tabs={<SettingsTabs active="close" />} width="narrow">
      <Panel>
        <Teach
          icon={CalendarCheck2}
          title="No months to close yet"
          why="Closing a month locks its numbers. After that nobody can change an entry, a cost or a rate inside it by accident, so the profit you reported stays the profit you reported."
          points={['A checklist: every day logged, every cost in, payroll checked', 'One click to close, with who did it and when', 'An owner can reopen a month, with a reason that is kept on record']}
          actions={page.can('production:log') ? <ButtonLink href={routes.log()}>Log work</ButtonLink> : null}
          footnote={page.can('period:close') ? 'A month shows up here once it has at least one logged day.' : 'Only an admin or owner can close a month.'}
        />
      </Panel>
    </Page>
  );
}

/**
 * Connected apps: each sibling KitStak app's connection state, what flows where, the last sync
 * and the links between jobs and sibling records. The body belongs to `features/integrations`.
 */
export async function SettingsAppsPage() {
  const page = await pulsePage(routes.settingsApps(), 'settings');
  if (page.blocked) return <PageBlocked title="Connected apps" role={page.access.role} />;
  return (
    <Page title="Settings" subtitle="How Pulse is set up for your workspace." tabs={<SettingsTabs active="apps" />} width="narrow">
      <ConnectedAppsBody ctx={page.ctx} />
    </Page>
  );
}
