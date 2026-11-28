import 'server-only';
import { getSetupSignals } from '@kitstak/crew-bridge';
import { Page } from '@/components/layout/page';
import { db } from '@/server/db';
import { withOrg } from '@/server/db/scope';
import { whoRunsCrew } from '@/server/domain/roles';
import { pageFor } from '@/server/page';
import { canCrew } from '@/lib/permissions';
import { setupChecklist } from '@/lib/setup-steps';
import { WelcomeView } from './welcome-view';

/**
 * First run (docs/crew/SPEC.md 6.1 `/welcome`): the claim step, "Who can see pay?", the first site
 * time zone from the browser, "How do you want to start?" and the setup checklist (section 9).
 * Open to every member, because the claim step is how the first owner gets in.
 */
export async function WelcomePage() {
  const { ctx, access, context, locked } = await pageFor('/welcome');
  if (locked) return null;
  const [state, signals] = await Promise.all([whoRunsCrew(ctx), withOrg(ctx.orgId, () => getSetupSignals(db, { orgId: ctx.orgId }))]);
  return (
    <Page title="Getting started" subtitle="Set Crew up for your floor in a few short steps." width="narrow">
      <WelcomeView
        orgName={context.org.name}
        role={access.role}
        state={state}
        canSetUp={canCrew(access.role, 'settings:manage')}
        steps={setupChecklist(signals)}
      />
    </Page>
  );
}
