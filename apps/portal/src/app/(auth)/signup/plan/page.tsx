import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DEFAULT_SELECTION } from '@kitstak/billing/catalog';
import { getPlanState } from '@kitstak/billing/server';
import { BillingOrgScope } from '@/features/billing/org-scope';
import { PlanPicker } from '@/features/billing/plan-picker/plan-picker';
import { getBillingContext } from '@/server/billing/context';
import { getSession } from '@/server/session';
import { getSignupResume, stepHref, trialOpenTo } from '@/server/signup';
import { PlanStepHeader } from './plan-step-header';

export const metadata: Metadata = { title: 'Pick your apps' };

/**
 * Step 2 of signup (docs/billing/SPEC.md section 5.3): the shared plan picker in `trial` mode,
 * prefilled from the cart the person brought. With no cart nothing is selected and the four apps
 * are equal choices. One press on "Start my free trial" and they are in.
 */
export default async function SignupPlanPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/signup/plan');
  const resume = await getSignupResume(session);
  if (resume.step !== '/signup/plan') redirect(stepHref(resume.step));
  const context = await getBillingContext();
  if (!context) redirect('/signup/company');

  const [state, trial] = await Promise.all([
    getPlanState(context.rt, context.org.id),
    trialOpenTo(context.org.id, session.user.id),
  ]);
  // A person who already used a free trial on another organization can still pick a plan.
  const trialUsed = !trial.ok && trial.reason === 'user_had_trial';

  return (
    <div className="flex flex-col gap-6">
      {/* Which organization this render is for. Billing actions send it back and a stale tab is refused. */}
      <BillingOrgScope orgId={context.org.id} />
      {/* The same width as the picker below, so the two line up. */}
      <div className="mx-auto w-full max-w-[1000px]">
        <PlanStepHeader orgName={context.org.name} email={session.user.email} trialUsed={trialUsed} />
      </div>
      <PlanPicker
        mode={trialUsed ? 'checkout' : 'trial'}
        initialSelection={resume.intent?.selection ?? DEFAULT_SELECTION}
        planState={state}
        layout="signup"
        timeZone={context.timeZone}
      />
    </div>
  );
}
