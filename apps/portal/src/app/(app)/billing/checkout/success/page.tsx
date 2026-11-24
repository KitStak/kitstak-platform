import type { Metadata } from 'next';
import { CircleCheck, SearchX } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { CATALOG, formatDay, formatMoney } from '@kitstak/billing/catalog';
import { getBillingProfile, getPlanState, syncCheckoutSession } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { Card, LinkButton } from '@/components/ui';
import { BillingMessage, TestModeBadge } from '@/features/billing/billing-chrome';
import { FinishingUp } from '@/features/billing/checkout/finishing-up';
import { cardLabel, perPeriod, plural, usesSeats } from '@/features/billing/format';
import { ConfettiBurst } from '@/features/setup/confetti';

export const metadata: Metadata = { title: 'You are all set' };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Coming back from the pay page (SPEC 6.5). The server checks the session with the gateway and
 * applies it with the same code the webhook runs. A session that is not paid grants nothing.
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await requireBillingContext('/billing');
  const { rt, org, session, timeZone } = context;
  const sessionId = first(params.session_id);

  const notFound = (
    <BillingMessage
      icon={<SearchX aria-hidden className="size-6" />}
      title="We could not find that checkout."
      actions={
        <LinkButton href="/billing" size="xl">
          Go to Billing
        </LinkButton>
      }
    >
      Nothing was charged on this page. Billing shows your plan as it is right now.
    </BillingMessage>
  );
  if (!sessionId || !/^[A-Za-z0-9_]{4,200}$/.test(sessionId) || !context.access.canView) return notFound;

  const synced = await syncCheckoutSession(rt, { orgId: org.id, sessionId });
  if (!synced.ok) {
    if (synced.error.code === 'not_found') return notFound;
    // The gateway did not answer. Keep asking for a few seconds, then offer a button.
    return <FinishingUp />;
  }
  const state = await getPlanState(rt, org.id);
  if (!state.hasSubscription) return <FinishingUp />;

  const profile = await getBillingProfile(rt.db, org.id);
  const mailTo = profile.billingEmail ?? session.user.email;
  const inTrial = state.trial !== null;
  const quote = state.quote;
  const facts: string[] = [];
  if (usesSeats(state.selection)) facts.push(plural(state.selection.seats, 'seat', 'seats'));
  if (state.selection.products.includes('wms')) facts.push(plural(state.selection.warehouses, 'warehouse', 'warehouses'));
  facts.push(state.selection.interval === 'yearly' ? 'Yearly' : 'Monthly');

  return (
    // The two buttons sit right under the good news, so "Open my apps" is on the first screen at
    // 1280 by 800 and on a phone. The plan details follow as the record of what was bought.
    <section data-testid="checkout-success" className="relative mx-auto flex max-w-[560px] flex-col items-center py-2 text-center sm:py-4">
      <ConfettiBurst pieceCount={36} />
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-subtle text-success-text motion-safe:animate-check-pop">
        <CircleCheck aria-hidden className="size-8" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-fg">You are all set.</h1>
      <p className="mt-2 text-md text-fg-secondary">
        {inTrial ? 'Your card is saved. Your free trial carries on, and nothing is charged today.' : 'Your payment went through. Your apps are fully open.'}
      </p>
      <div className="mt-2">
        <TestModeBadge mode={state.mode} />
      </div>

      <div className="mt-5 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <LinkButton href="/" size="xl" data-testid="checkout-success-open-apps">
          Open my apps
        </LinkButton>
        <LinkButton href="/billing" variant="secondary" size="xl">
          See my plan
        </LinkButton>
      </div>

      <Card as="div" className="mt-6 w-full p-5 text-left">
        <div className="flex flex-wrap gap-1.5">
          {state.selection.products.map((id) => (
            <span key={id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-default bg-sunken pr-2.5 pl-1 text-xs font-semibold text-fg">
              <AppIcon app={id} size={20} />
              {CATALOG.products[id].shortName}
            </span>
          ))}
        </div>
        <p className="mt-2 text-sm text-fg-secondary">{facts.join(' · ')}</p>
        <dl className="mt-4 divide-y divide-border-subtle border-t border-border-subtle text-sm">
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-fg-secondary">Your plan</dt>
            <dd className="font-semibold text-fg tabular-nums">
              {formatMoney(quote.totalCents)} <span className="font-normal text-fg-secondary">{perPeriod(quote.interval)}</span>
            </dd>
          </div>
          {/* The promo code and credit are their own lines, so the charge below adds up on the page. */}
          {state.nextCharge && state.nextCharge.discountCents > 0 ? (
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-fg-secondary">
                {state.nextCharge.discountLabel ?? 'Promo code'}
                <span className="block text-xs text-fg-muted">On this charge only.</span>
              </dt>
              <dd data-testid="success-discount" className="font-semibold text-success-text tabular-nums">-{formatMoney(state.nextCharge.discountCents)}</dd>
            </div>
          ) : null}
          {state.nextCharge && state.nextCharge.creditAppliedCents > 0 ? (
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-fg-secondary">Credit on your account</dt>
              <dd data-testid="success-credit" className="font-semibold text-success-text tabular-nums">-{formatMoney(state.nextCharge.creditAppliedCents)}</dd>
            </div>
          ) : null}
          {state.nextCharge ? (
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-fg-secondary">{inTrial ? 'First charge' : 'Next charge'}</dt>
              <dd data-testid="success-next-charge" className="font-semibold text-fg tabular-nums">
                {formatMoney(state.nextCharge.amountCents)} on {formatDay(state.nextCharge.at, timeZone)}
              </dd>
            </div>
          ) : null}
          {state.paymentMethod ? (
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-fg-secondary">Card</dt>
              <dd className="font-semibold text-fg">{cardLabel(state.paymentMethod)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-3 text-sm text-fg-secondary">
          {inTrial ? `We emailed your plan details to ${mailTo}.` : `We emailed a receipt to ${mailTo}.`}
        </p>
      </Card>
    </section>
  );
}
