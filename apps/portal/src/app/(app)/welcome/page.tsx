import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { formatDay } from '@kitstak/billing/catalog';
import { getOpenSignupIntent } from '@kitstak/billing/server';
import { firstNameOf } from '@/features/signup/fields';
import { READING_PLAN_COOKIE } from '@/features/welcome/reading-plan';
import { WelcomeWizard } from '@/features/welcome/welcome-wizard';
import { getBillingContext } from '@/server/billing/context';
import { db } from '@/server/db';
import { getSetupState } from '@/server/onboarding';
import { requirePageSession } from '@/server/session';
import { getSignupResume, stepHref } from '@/server/signup';

export const metadata: Metadata = { title: 'Welcome' };

const MANAGER_ROLES = new Set(['owner', 'admin']);

/**
 * The welcome wizard after signup (docs/billing/SPEC.md section 5.7). It shows the apps in the
 * trial, asks at most three tile questions, and ends on a short plan of next steps. Answers given
 * on the marketing site are already filled in, so nobody answers the same question twice.
 */
export default async function WelcomePage() {
  const session = await requirePageSession('/welcome');

  // The same check every signup screen runs: an earlier step that is still open comes first.
  const resume = await getSignupResume(session);
  if (resume.step === '/signup/company' || resume.step === '/signup/plan' || resume.step === '/verify-email') {
    redirect(stepHref(resume.step));
  }
  const context = await getBillingContext();
  // No organization: the signup step for a new person, home for one who was removed from theirs.
  if (!context) redirect(resume.step === '/' ? '/' : '/signup/company');

  // Members without a managing role (and already profiled orgs) go straight to the launcher.
  if (!MANAGER_ROLES.has(context.org.role)) redirect('/');
  const [setup, intent] = await Promise.all([
    getSetupState(context.org, { timeZone: context.timeZone }),
    resume.intent ? Promise.resolve(resume.intent) : getOpenSignupIntent(db, session.user.id),
  ]);
  // The wizard saves the answers the moment its last screen (the plan) opens, so "Done" there is
  // true. Its cookie says the person is still reading that screen: they stay on it, with the saved
  // answers, until they press "Looks good". Without it a saved profile means the launcher.
  const readingPlan = (await cookies()).get(READING_PLAN_COOKIE)?.value === '1';
  if (setup.profile && !readingPlan) redirect('/');
  const saved = setup.profile;

  return (
    <WelcomeWizard
      firstName={firstNameOf(session.user.name ?? '')}
      orgName={context.org.name}
      products={setup.products}
      billing={setup.billing}
      trialEndsOn={setup.trialEndsAt ? formatDay(setup.trialEndsAt, context.timeZone) : null}
      prefill={saved ? { businessType: saved.businessType, teamSize: saved.teamSize, startMode: saved.startMode } : (intent?.profile ?? {})}
      answersSaved={saved !== null}
    />
  );
}
