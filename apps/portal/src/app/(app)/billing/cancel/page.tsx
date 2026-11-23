import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CalendarCheck, Lock } from 'lucide-react';
import { BILLING_POLICY, CATALOG, formatDay, formatMoney } from '@kitstak/billing/catalog';
import { getPlanState } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { LinkButton, Notice } from '@/components/ui';
import { BackLink, BillingHeader, BillingMessage, TestModeBadge } from '@/features/billing/billing-chrome';
import { CancelFlow, type PauseOption } from '@/features/billing/cancel/cancel-flow';
import { addMonthsUtc } from '@/features/billing/format';

export const metadata: Metadata = { title: 'Cancel plan' };

const HOUR_MS = 60 * 60 * 1000;

/** Cancel and pause (SPEC 6.8). */
export default async function CancelPage() {
  const context = await requireBillingContext('/billing/cancel');
  const { rt, org, access, timeZone } = context;
  if (!access.canView) redirect('/billing');
  const state = await getPlanState(rt, org.id);
  const back = (
    <LinkButton href="/billing" size="xl">
      Back to Billing
    </LinkButton>
  );

  if (!access.canManage) {
    return (
      <BillingMessage icon={<Lock aria-hidden className="size-6" />} title="Only an owner or a billing manager can cancel the plan" actions={back}>
        {access.ownerName ? `Ask ${access.ownerName}.` : 'Ask your organization owner.'}
      </BillingMessage>
    );
  }
  if (state.phase === 'cancel_scheduled') redirect('/billing');
  if (!state.hasSubscription) {
    return state.phase === 'trial' && state.trial ? (
      <BillingMessage icon={<CalendarCheck aria-hidden className="size-6" />} title="There is nothing to cancel" actions={back}>
        You are on a free trial with no card on file. It ends by itself on {formatDay(state.trial.endsAt, timeZone)}. Nothing is charged and
        nothing is deleted.
      </BillingMessage>
    ) : (
      <BillingMessage icon={<CalendarCheck aria-hidden className="size-6" />} title="You have no paid plan to cancel" actions={back}>
        Nothing is being charged. Your data is safe.
      </BillingMessage>
    );
  }

  const endsAt = state.currentPeriodEnd;
  const monthly = state.selection.interval === 'monthly';
  // The same rule as `pausePlan`: the pause starts at the period end and ends 1 hour before the
  // renewal that many months later.
  const pauseOptions: PauseOption[] =
    monthly && state.phase === 'active' && !state.trial && endsAt
      ? CATALOG.pauseMonths.map((months) => ({
          months,
          startsLabel: formatDay(endsAt, timeZone),
          resumesLabel: formatDay(new Date(addMonthsUtc(endsAt, months).getTime() - HOUR_MS), timeZone),
        }))
      : [];
  const endLabel = endsAt ? formatDay(endsAt, timeZone) : null;

  return (
    <div className="flex max-w-[680px] flex-col gap-6">
      <div className="flex flex-col gap-3">
        <BackLink href="/billing">Billing</BackLink>
        <BillingHeader orgName={org.name} title="Cancel your plan" badges={<TestModeBadge mode={state.mode} />} />
      </div>

      <Notice tone="info" role="status">
        {state.trial
          ? `Your free trial still runs until ${endLabel ?? 'its last day'}. After that your apps are view only. Nothing is charged. Nothing is deleted.`
          : `Your plan will end on ${endLabel ?? 'the last day you paid for'}. You keep everything until then. After that your apps are view only. Nothing is deleted.`}
        {!monthly && endLabel && !state.trial ? <span className="mt-1 block font-normal">You are paid up until {endLabel}.</span> : null}
        {state.creditCents > 0 ? (
          <span className="mt-1 block font-normal" data-testid="cancel-credit">
            You have {formatMoney(state.creditCents)} credit. It stays on your account. If you come back, it comes off your first bill.
          </span>
        ) : null}
      </Notice>

      <CancelFlow pauseOptions={pauseOptions} canRemoveApp={state.selection.products.length >= 2} />

      {/* The refund rule, said before the person decides. The same words as on the pricing page. */}
      {state.trial ? null : (
        <p data-testid="cancel-refund-rule" className="text-sm text-fg-secondary">
          <span className="font-semibold text-fg">About refunds.</span> {BILLING_POLICY.refund}
        </p>
      )}
    </div>
  );
}
