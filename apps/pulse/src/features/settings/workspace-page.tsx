import { PlanSummaryCard } from '@kitstak/ui/plan-summary';
import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { getSampleState, getSettings } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { getPlanSummary } from '@/server/plan';
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
  const [settings, sample, plan] = await Promise.all([
    getSettings(page.ctx),
    getSampleState(page.ctx),
    // The "Plan and payment" section (docs/billing/SPEC.md section 9.5). A read failure hides the
    // card, it never breaks Settings.
    getPlanSummary({ orgId: page.context.org.id, userId: page.context.user.id, role: page.context.org.roleString }).catch(() => null),
  ]);
  return (
    <Page title="Settings" subtitle={SUBTITLE} tabs={<SettingsTabs active="all" />}>
      <SettingsView initialSettings={settings} initialSample={sample} planCard={plan ? <PlanSummaryCard summary={plan} /> : null} />
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
