import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getSetupState } from '@/server/onboarding';
import { CreateOrgForm } from '@/features/launcher/create-org-form';
import { WelcomeWizard } from '@/features/welcome/welcome-wizard';
import { LogoMark } from '@/features/shell/logo';

export const metadata: Metadata = { title: 'Welcome' };

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

const MANAGER_ROLES = new Set(['owner', 'admin']);

/** Post-signup welcome wizard: three tile-click questions → a personalized setup plan. */
export default async function WelcomePage() {
  const session = await requirePageSession('/welcome');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  // Org creation failed or was skipped during signup: recover here, then the wizard runs.
  if (!activeOrg) {
    return (
      <section className="flex flex-col items-center py-20 text-center">
        <LogoMark size={40} />
        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-fg">
          First, create your organization
        </h1>
        <p className="mt-2 max-w-md text-md text-fg-secondary">
          Your organization is the home for your team, apps and data. Name it and we’ll take
          it from there.
        </p>
        <div className="mt-8 flex w-full justify-center">
          <CreateOrgForm />
        </div>
      </section>
    );
  }

  // Members without a managing role (and already-profiled orgs) go straight to the launcher.
  if (!MANAGER_ROLES.has(activeOrg.role)) redirect('/');
  const setup = await getSetupState(activeOrg);
  if (setup.profile) redirect('/');

  return (
    <WelcomeWizard
      firstName={firstName(session.user.name)}
      orgName={activeOrg.name}
      crmEntitled={setup.guideEntitlements.crm}
      wmsEntitled={setup.guideEntitlements.wms}
    />
  );
}
