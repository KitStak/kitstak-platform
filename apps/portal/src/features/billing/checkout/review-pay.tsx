'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CircleAlert, Lock } from 'lucide-react';
import type { PlanSelection } from '@kitstak/billing/catalog';
import type { BillingError } from '@kitstak/billing/errors';
import { Button } from '@/components/ui';
import { startCheckoutAction } from '@/server/billing-actions';

/** The one button on the review step. It asks the server for a pay page and goes there. */
export function ReviewPay({
  selection,
  label,
  disabledReason,
}: {
  readonly selection: PlanSelection;
  readonly label: string;
  readonly disabledReason: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingError | null>(null);

  const pay = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await startCheckoutAction({ selection });
      if (result.ok) {
        // A full page load: the pay page is the gateway's own page.
        window.location.assign(result.data.url);
        return;
      }
      setError(result.error);
    } catch {
      setError({ code: 'gateway_error', message: 'We could not reach KitStak. Check your connection and try again.' });
    }
    setPending(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" data-testid="review-error" className="flex items-start gap-1.5 text-sm font-medium text-danger-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {error.message}{' '}
            {error.code === 'email_unverified' ? (
              <Link href="/verify-email?next=/billing/checkout" className="underline underline-offset-2">
                Enter code
              </Link>
            ) : error.code === 'below_usage' || error.code === 'already_subscribed' ? (
              <Link href="/billing/plan" className="underline underline-offset-2">
                Change my plan
              </Link>
            ) : null}
          </span>
        </p>
      ) : null}
      <Button
        size="xl"
        fullWidth
        data-testid="review-pay"
        loading={pending}
        disabled={disabledReason !== null}
        aria-describedby={disabledReason ? 'review-pay-hint' : undefined}
        leadingIcon={<Lock aria-hidden />}
        onClick={pay}
      >
        {label}
      </Button>
      {disabledReason ? (
        <p id="review-pay-hint" className="text-center text-xs text-fg-muted">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
