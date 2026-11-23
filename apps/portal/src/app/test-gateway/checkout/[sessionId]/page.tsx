import { notFound, redirect } from 'next/navigation';
import { CircleCheck, TimerOff } from 'lucide-react';
import { formatDay, formatMoney } from '@kitstak/billing/catalog';
import { TEST_CARDS, TEST_PROMO_CODE, getTestCheckout } from '@kitstak/billing/gateway/test';
import { billingRuntime } from '@/server/billing/runtime';
import { isActiveOrgMember } from '@/server/orgs';
import { getSession } from '@/server/session';
import { Card, LinkButton } from '@/components/ui';
import { BillingMessage } from '@/features/billing/billing-chrome';
import { eachPeriod } from '@/features/billing/format';
import { QuoteSummary, SummaryRow } from '@/features/billing/quote-summary';
import { TestCheckout } from '@/features/test-gateway/test-checkout';

/**
 * The test gateway's pay page. 404 unless the mode is `test_gateway` (never in production) and the
 * signed in person is a member of the organization the session belongs to.
 */
export default async function TestCheckoutPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ sessionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const rt = billingRuntime();
  if (rt.mode !== 'test_gateway' || !/^[A-Za-z0-9_]{4,120}$/.test(sessionId)) notFound();
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/test-gateway/checkout/${sessionId}`)}`);
  const view = await getTestCheckout(rt.db, sessionId, rt.now());
  if (!view || !(await isActiveOrgMember(session.user.id, view.orgId))) notFound();

  if (view.status === 'complete') {
    return (
      <BillingMessage
        icon={<CircleCheck aria-hidden className="size-6" />}
        title="This checkout is done."
        actions={
          <LinkButton href="/billing" size="xl">
            Go to Billing
          </LinkButton>
        }
      >
        Your plan is already set. Billing shows it.
      </BillingMessage>
    );
  }
  if (view.status === 'expired') {
    return (
      <BillingMessage
        icon={<TimerOff aria-hidden className="size-6" />}
        title="This checkout page has closed."
        actions={
          <LinkButton href="/billing/checkout" size="xl">
            Start again
          </LinkButton>
        }
      >
        No charge was made. Your cart is saved.
      </BillingMessage>
    );
  }

  const inTrial = view.trialEnd !== null;
  const total = formatMoney(view.quote.totalCents);
  // What the card is really charged first: the plan price, minus a promo code, minus credit. It is
  // the gateway's own number, the same one the first invoice is made with.
  const firstCharge = formatMoney(view.firstChargeCents);
  const reduced = view.firstChargeCents !== view.quote.totalCents;
  const timeZone = typeof (session.user as { timezone?: unknown }).timezone === 'string' ? ((session.user as { timezone?: string }).timezone ?? 'UTC') : 'UTC';
  const startAtBank = view.needsBankApproval && query.step === 'bank';
  const promoLine = view.promo
    ? `${view.promo.code}: 10% off your first charge. You save ${formatMoney(view.promo.discountCents)}. Your first charge is ${firstCharge}.`
    : null;

  return (
    <div data-testid="test-checkout" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
      <section aria-labelledby="test-order-heading" className="min-w-0">
        <p className="text-sm font-medium text-fg-muted">{view.orgName}</p>
        <h1 id="test-order-heading" className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg">
          {inTrial ? 'Save your card' : 'Pay for your plan'}
        </h1>
        <Card as="div" className="mt-5 p-5">
          <QuoteSummary quote={view.quote} totalLabel={inTrial ? 'After your trial' : undefined}>
            {view.promo ? (
              <SummaryRow label={view.promo.label} tone="success" hint="On your first charge only.">
                <span data-testid="test-promo-line">-{formatMoney(view.promo.discountCents)}</span>
              </SummaryRow>
            ) : null}
            {view.creditAppliedCents > 0 ? (
              <SummaryRow label="Credit on your account" tone="success">
                <span data-testid="test-credit-line">-{formatMoney(view.creditAppliedCents)}</span>
              </SummaryRow>
            ) : null}
            <SummaryRow label="Due today" strong>
              <span data-testid="test-due-today">{formatMoney(view.dueTodayCents)}</span>
            </SummaryRow>
            <SummaryRow label={inTrial ? 'First charge' : 'Charged'}>
              <span data-testid="test-first-charge">{inTrial ? `${firstCharge} on ${formatDay(view.firstChargeAt, timeZone)}` : 'Today'}</span>
            </SummaryRow>
          </QuoteSummary>
          <p className="mt-4 border-t border-border-subtle pt-4 text-sm text-fg-secondary">
            {reduced ? `After that first charge, ${total}` : `Then ${total}`} {eachPeriod(view.quote.interval)} until you change or cancel. Cancel any time in Billing. Your data stays yours.
          </p>
        </Card>
      </section>

      <Card as="section" aria-label="Card details" className="p-5 sm:p-6">
        <TestCheckout
          sessionId={view.sessionId}
          cards={TEST_CARDS.map((card) => ({ number: card.number, label: card.label.replace('Works now, fails at the next renewal', 'Fails at next renewal'), outcome: card.outcome }))}
          payLabel={inTrial ? 'Save card and keep my trial' : `Pay ${formatMoney(view.dueTodayCents)}`}
          promoCode={TEST_PROMO_CODE}
          appliedPromo={view.promo && promoLine ? { code: view.promo.code, line: promoLine } : null}
          startAtBank={startAtBank}
          defaultName={session.user.name ?? ''}
        />
      </Card>
    </div>
  );
}
