import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { getSampleState, getSettings } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { AuditView } from './audit-view';
import { SettingsTabs } from './settings-tabs';
import { SettingsView } from './settings-view';

const SUBTITLE = 'How Pulse is set up for your workspace.';

/** Settings, Workspace tab: every section of the workspace, picked with `?section=`. */
export async function SettingsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).section;
  const section = (Array.isArray(raw) ? raw[0] : raw) ?? undefined;
  const page = await pulsePage(routes.settings(section), 'settings');
  if (page.blocked) return <PageBlocked title="Settings" role={page.access.role} />;
  const [settings, sample] = await Promise.all([getSettings(page.ctx), getSampleState(page.ctx)]);
  return (
    <Page title="Settings" subtitle={SUBTITLE} tabs={<SettingsTabs active="all" />}>
      <SettingsView initialSettings={settings} initialSample={sample} />
    </Page>
  );
}

/** Settings, Audit log tab: who changed what, and when, with the before and after. */
export async function SettingsAuditPage() {
  const page = await pulsePage(routes.settingsAudit(), 'settings');
  if (page.blocked) return <PageBlocked title="Audit log" role={page.access.role} />;
  return (
    <Page title="Settings" subtitle={SUBTITLE} tabs={<SettingsTabs active="audit" />}>
      <AuditView canExport={page.can('export:run')} />
    </Page>
  );
}
