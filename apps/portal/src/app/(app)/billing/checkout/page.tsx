import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Check } from 'lucide-react';
import { formatDay, formatMoney } from '@kitstak/billing/catalog';
import { checkoutPreview, getPlanState } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { Card, LinkButton, Notice } from '@/components/ui';
import { BackLink, BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import { ReviewPay } from '@/features/billing/checkout/review-pay';
import { addMonthsUtc, eachPeriod } from '@/features/billing/format';
import { QuoteSummary } from '@/features/billing/quote-summary';

export const metadata: Metadata = { title: 'Review your plan' };

const BILLING_OFF = 'Billing is not available right now. Nothing will be charged. Please try again later.';

/** Review before paying (SPEC 6.4): one screen, three facts, one button. No card field here. */
export default async function CheckoutReviewPage() {
  const context = await requireBillingContext('/billing/checkout');
  const { rt, org, access, timeZone } = context;
  if (!access.canManage) redirect('/billing/plan');

  const state = await getPlanState(rt, org.id);
  // A plan the gateway already runs is changed on the picker, not paid for twice.
  if (state.hasSubscription) redirect('/billing/plan');
  const selection = state.selection;
  if (selection.products.length === 0) redirect('/billing/plan');

  const preview = await checkoutPreview(rt, { orgId: org.id, selection });
  if (!preview.ok) {
    return (
      <div className="mx-auto flex max-w-[640px] flex-col gap-6">
        <BackLink href="/billing/plan">Change my plan</BackLink>
        <BillingHeader orgName={org.name} title="Review your plan" badges={<TestModeBadge mode={state.mode} />} />
        <Notice
          tone="warning"
          action={
            <LinkButton href="/billing/plan" variant="secondary" size="lg">
              Change my plan
            </LinkButton>
          }
        >
          {preview.error.message}
        </Notice>
      </div>
    );
  }

  const { quote, dueTodayCents, firstChargeAt, trialEnd, taxNote } = preview.data;
  const inTrial = trialEnd !== null;
  const total = formatMoney(quote.totalCents);
  // After a payment today, the next one is one period later.
  const chargeAt = inTrial ? firstChargeAt : addMonthsUtc(firstChargeAt, quote.periodMonths);
  const billingOff = state.mode === 'unavailable';
  const disabledReason = billingOff ? BILLING_OFF : !context.emailVerified ? 'Verify your email first. It takes one minute.' : null;
  const trust = [inTrial ? 'No charge today.' : `You pay ${formatMoney(dueTodayCents)} today.`, 'Cancel any time in Billing.', 'Your data stays yours.'];

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-3">
        <BackLink href="/billing/plan">Change my plan</BackLink>
        <BillingHeader
          orgName={org.name}
          title="Review your plan"
          description="Check the plan and the dates. You enter your card on the next screen."
          badges={<TestModeBadge mode={state.mode} />}
        />
      </div>

      {!context.emailVerified ? (
        <Notice
          tone="info"
          action={
            <LinkButton href="/verify-email?next=/billing/checkout" variant="secondary" size="lg">
              Enter code
            </LinkButton>
          }
        >
          Verify your email first. It takes one minute.
        </Notice>
      ) : null}
      {billingOff ? (
        <Notice tone="neutral" role="status">
          {BILLING_OFF}
        </Notice>
      ) : null}

      <Card className="p-5 sm:p-6" aria-label="Your plan">
        <QuoteSummary quote={quote} totalLabel={inTrial ? 'After your trial' : undefined} />

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-sunken px-4 py-3">
            <dt className="text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">Due today</dt>
            <dd data-testid="review-due-today" className="mt-1 text-xl font-semibold tracking-[-0.02em] text-fg tabular-nums">
              {formatMoney(dueTodayCents)}
            </dd>
          </div>
          <div className="rounded-lg bg-sunken px-4 py-3">
            <dt className="text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{inTrial ? 'First charge' : 'Next charge'}</dt>
            <dd className="mt-1 text-xl font-semibold tracking-[-0.02em] text-fg tabular-nums">
              <span data-testid="review-first-charge-amount">{total}</span>
              <span className="block text-sm font-medium tracking-normal text-fg-secondary">
                on <span data-testid="review-first-charge-date">{formatDay(chargeAt, timeZone)}</span>
              </span>
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-sm text-fg">
          Then {total} {eachPeriod(quote.interval)} until you change or cancel.
          {taxNote ? ' Sales tax is added at checkout if it applies.' : ''}
        </p>
        <p className="mt-1 text-sm text-fg-secondary">Have a promo code? Enter it on the next screen.</p>

        <div className="mt-6">
          <ReviewPay
            selection={selection}
            label={state.mode === 'test_gateway' ? 'Continue to test checkout' : 'Continue to secure checkout'}
            disabledReason={disabledReason}
          />
        </div>
        <ul data-testid="review-trust" className="mt-4 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5">
          {trust.map((line) => (
            <li key={line} className="flex items-center gap-2 text-sm text-fg-secondary">
              <Check aria-hidden className="size-4 shrink-0 text-success-text" />
              {line}
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-center text-sm text-fg-secondary">
        Not right?{' '}
        <Link href="/billing/plan" className="font-semibold text-fg underline underline-offset-2">
          Change my plan
        </Link>
        . Your cart is saved.
      </p>
    </div>
  );
}
