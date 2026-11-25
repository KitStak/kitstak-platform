import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPlanState, upsertSignupIntent } from '@kitstak/billing/server';
import { handoffRecord, hasHandoff, readHandoff } from '@/features/signup/cart';
import { getBillingContext } from '@/server/billing/context';
import { db } from '@/server/db';
import { legalUrls } from '@/server/env';
import { getSession, type Session } from '@/server/session';
import { getSignupResume, isPlanUntouched, socialProviders, stepHref } from '@/server/signup';
import type { SignupHandoff } from '@kitstak/billing/handoff';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Start your free trial' };

/**
 * A signed in visitor is never bounced to the launcher with the cart lost (SPEC 5.1). The cart
 * from the link is kept in their signup, and they go to the step they are on.
 */
async function resumeSignedIn(session: Session, handoff: SignupHandoff): Promise<never> {
  const before = await getSignupResume(session);
  if (hasHandoff(handoff)) {
    const context = await getBillingContext();
    if (before.intent) {
      await upsertSignupIntent(db, { userId: session.user.id, handoff });
    } else if (!context) {
      await upsertSignupIntent(db, { userId: session.user.id, handoff, step: 'company' });
    } else {
      const state = await getPlanState(context.rt, context.org.id);
      if (isPlanUntouched(state) && context.access.canStartTrial) {
        await upsertSignupIntent(db, { userId: session.user.id, orgId: context.org.id, handoff, step: 'plan' });
        redirect('/signup/plan');
      }
      // A team that already has a trial or a plan: open the picker with the first new app turned on.
      const extra = handoff.selection?.products.find((product) => !state.modules[product].inPlan);
      if (extra && context.access.canView) redirect(`/billing/plan?add=${extra}`);
    }
  }
  redirect(stepHref((await getSignupResume(session)).step));
}

export default async function SignupPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const handoff = readHandoff(params);
  const session = await getSession();
  if (session) await resumeSignedIn(session, handoff);

  const error = typeof params.error === 'string' ? params.error : null;
  return (
    <SignupForm
      handoff={handoffRecord(handoff)}
      providers={socialProviders()}
      legal={legalUrls()}
      providerError={error}
    />
  );
}
