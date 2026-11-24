'use client';
/**
 * The buttons on billing home. Links for steps that open a page, server actions for the one click
 * steps (keep my plan, undo pause, pay now, update card). Every button shows its busy state at once
 * and cannot be sent twice.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert } from 'lucide-react';
import type { BillingResult } from '@kitstak/billing/errors';
import { Button, LinkButton, type ButtonSize, type ButtonVariant } from '@/components/ui';
import { keepPlanAction, openCardUpdateAction, retryPaymentAction, undoPauseAction } from '@/features/billing/actions';
import type { HomeAction, HomeActionId } from '../phase-copy';

const LINKS: Partial<Record<HomeActionId, string>> = {
  start_trial: '/billing/plan',
  add_card: '/billing/checkout',
  // The picker opens to pay by default during a trial. `apps=1` opens it to change the trial apps.
  change_apps: '/billing/plan?apps=1',
  change_plan: '/billing/plan',
  cancel: '/billing/cancel',
  pick_plan: '/billing/plan',
};

/** Steps that need the gateway. They are off, with the reason, when billing is not available. */
const NEEDS_GATEWAY: readonly HomeActionId[] = [
  'add_card',
  'change_plan',
  'update_card',
  'pay_now',
  'cancel',
  'keep_plan',
  'undo_pause',
  'resume_now',
  'pick_plan',
];

export const HOME_ACTION_TEST_ID: Readonly<Record<HomeActionId, string>> = {
  start_trial: 'billing-start-trial',
  add_card: 'billing-add-card',
  change_apps: 'billing-change-plan',
  change_plan: 'billing-change-plan',
  update_card: 'billing-update-card',
  pay_now: 'billing-pay-now',
  cancel: 'billing-cancel',
  keep_plan: 'billing-keep-plan',
  undo_pause: 'billing-undo-pause',
  resume_now: 'billing-undo-pause',
  pick_plan: 'billing-pick-plan',
};

const DONE_NOTICE: Partial<Record<HomeActionId, string>> = {
  keep_plan: 'kept',
  undo_pause: 'pause_undone',
  resume_now: 'resumed',
  pay_now: 'paid',
};

export interface HomeActionButtonProps {
  readonly action: HomeAction;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  /** Set on the Plan card only, so each test id is on the page once. */
  readonly withTestId?: boolean;
  /** True when billing is off (production with no keys). */
  readonly billingOff?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

const BILLING_OFF = 'Billing is not available right now. Nothing will be charged. Please try again later.';

export function HomeActionButton({
  action,
  variant = 'secondary',
  size = 'lg',
  fullWidth,
  withTestId = false,
  billingOff = false,
  autoFocus,
  className,
}: HomeActionButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testId = withTestId ? HOME_ACTION_TEST_ID[action.id] : undefined;
  const off = billingOff && NEEDS_GATEWAY.includes(action.id);
  const href = LINKS[action.id];

  if (off) {
    return (
      <Button variant={variant} size={size} fullWidth={fullWidth} data-testid={testId} disabled title={BILLING_OFF} className={className}>
        {action.label}
      </Button>
    );
  }
  if (href) {
    return (
      <LinkButton href={href} variant={variant} size={size} fullWidth={fullWidth} data-testid={testId} autoFocus={autoFocus} className={className}>
        {action.label}
      </LinkButton>
    );
  }

  const run = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (action.id === 'update_card') {
        const result = await openCardUpdateAction();
        if (result.ok) {
          window.location.assign(result.data.url);
          return;
        }
        setError(result.error.message);
      } else {
        const result: BillingResult<unknown> =
          action.id === 'pay_now'
            ? await retryPaymentAction()
            : action.id === 'keep_plan'
              ? await keepPlanAction()
              : await undoPauseAction();
        if (result.ok) {
          router.replace(`/billing?notice=${DONE_NOTICE[action.id] ?? 'saved'}`);
          router.refresh();
          return;
        }
        // The bank wants the card holder to approve the payment. That step is on Stripe's own page
        // for this bill (the server only ever hands out an https Stripe address here).
        if (result.error.code === 'payment_needs_approval' && result.error.actionUrl) {
          setError(result.error.message);
          window.location.assign(result.error.actionUrl);
          return;
        }
        setError(result.error.message);
      }
    } catch {
      setError('We could not reach KitStak. Check your connection and try again.');
    }
    setPending(false);
  };

  return (
    <span className={fullWidth ? 'flex w-full flex-col gap-1.5' : 'inline-flex flex-col gap-1.5'}>
      <Button
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        data-testid={testId}
        loading={pending}
        onClick={run}
        autoFocus={autoFocus}
        className={className}
      >
        {action.label}
      </Button>
      {error ? (
        <span role="alert" className="flex items-start gap-1 text-xs font-medium text-danger-text">
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </span>
      ) : null}
    </span>
  );
}
