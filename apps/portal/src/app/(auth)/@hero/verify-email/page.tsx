import { unstable_rethrow } from 'next/navigation';
import { PRODUCT_IDS, formatDay, formatMoney } from '@kitstak/billing/catalog';
import { quote } from '@kitstak/billing/quote';
import { getPlanState } from '@kitstak/billing/server';
import { getBillingContext } from '@/server/billing/context';
import { SignInHero, TrialHero, type TrialHeroProps } from '../../_components/auth-hero';

/** The running free trial of the signed in person's organization, in the panel's words. null when there is none. */
async function runningTrial(): Promise<TrialHeroProps | null> {
  try {
    const context = await getBillingContext();
    if (!context) return null;
    const state = await getPlanState(context.rt, context.org.id);
    if (state.phase !== 'trial' || !state.trial) return null;
    const inTrial = PRODUCT_IDS.filter((id) => state.modules[id].inPlan);
    if (inTrial.length === 0) return null;
    // The apps of the trial, with the seats, warehouses and pay period of the saved cart.
    const priced = quote({ ...state.selection, products: inTrial });
    const period = priced.interval === 'yearly' ? 'year' : 'month';
    return {
      products: priced.selection.products,
      thenLine: `Then ${formatMoney(priced.totalCents)} per ${period} if you add a card.`,
      monthlyLine: priced.interval === 'yearly' ? `That is ${formatMoney(priced.monthlyEquivalentCents)} per month.` : null,
      endsLabel: formatDay(state.trial.endsAt, context.timeZone),
    };
  } catch (error: unknown) {
    // Next's own signals (a redirect, "this page reads the request") are not failures: hand them back.
    unstable_rethrow(error);
    // The panel is a nice to have. A failed read never breaks the form beside it.
    console.error('[portal] verify email panel: plan read failed', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * The panel beside "Check your email". A person who just pressed "Start my free trial" sees that
 * trial: the apps in it, the price that follows it and the day it ends. Their cart does not turn
 * back into list prices. Anyone else (a teammate who verifies later, a plan that is paid) gets the
 * plain sign in panel.
 */
export default async function Hero() {
  const trial = await runningTrial();
  return trial ? <TrialHero {...trial} /> : <SignInHero />;
}
