import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { getSettings } from '@/server/domain';
import { getOnboardingState } from '@/server/domain/sample';
import { pulsePage } from '@/server/page';
import { WelcomeView } from './welcome-view';

/** First run: five guided steps to a first profit number, sample data, and the other ways to start. */
export async function WelcomePage() {
  const page = await pulsePage(routes.welcome());
  if (page.blocked) return <PageBlocked title="Getting started" role={page.access.role} />;
  const [state, settings, integrations] = await Promise.all([getOnboardingState(page.ctx), getSettings(page.ctx), page.integrations()]);
  const connected = [integrations.crm ? 'CRM' : null, integrations.wms ? 'WMS' : null, integrations.projects ? 'Projects' : null].filter((value): value is string => value !== null);
  const firstName = page.context.user.name.trim().split(/\s+/)[0] || 'there';
  return (
    <Page title="Getting started" subtitle={`Welcome to Pulse, ${firstName}. You are a few minutes from your first profit number.`} width="narrow">
      <WelcomeView initial={state} settings={settings} firstName={firstName} connected={connected} />
    </Page>
  );
}
