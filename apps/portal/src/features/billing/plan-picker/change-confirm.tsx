'use client';
/**
 * The confirm panel for a change to a paid plan (SPEC 6.3). It shows what the gateway said the
 * change costs. Nothing is charged until "Confirm change". Focus lands on the heading, not on the
 * button, so nobody confirms by reflex.
 */
import { useRef } from 'react';
import Link from 'next/link';
import { formatDay, formatMoney, type BillingInterval } from '@kitstak/billing/catalog';
import type { BillingError } from '@kitstak/billing/errors';
import type { ChangePreview } from '@kitstak/billing/server';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, Notice } from '@/components/ui';
import { perPeriod, plural } from '../format';

export interface ChangeConfirmProps {
  readonly open: boolean;
  readonly title: string;
  readonly preview: ChangePreview | null;
  readonly interval: BillingInterval;
  /** Whole days left in the paid period, for the "days left" words. */
  readonly daysLeftInPeriod: number | null;
  readonly timeZone: string;
  readonly error: BillingError | null;
  readonly confirming: boolean;
  readonly updatingCard: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly onUpdateCard: () => void;
  readonly verifyHref: string;
}

export function ChangeConfirm({
  open,
  title,
  preview,
  interval,
  daysLeftInPeriod,
  timeZone,
  error,
  confirming,
  updatingCard,
  onConfirm,
  onClose,
  onUpdateCard,
  verifyHref,
}: ChangeConfirmProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const unusedCents = preview ? -preview.lines.filter((line) => line.amountCents < 0).reduce((sum, line) => sum + line.amountCents, 0) : 0;
  const daysWords =
    daysLeftInPeriod !== null && daysLeftInPeriod > 0 ? `for the ${plural(daysLeftInPeriod, 'day', 'days')} left in this period` : 'for the time left in this period';

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !confirming ? onClose() : undefined)}>
      <DialogContent
        size="md"
        data-testid="change-preview"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
      >
        <DialogTitle ref={headingRef} tabIndex={-1}>
          {title}
        </DialogTitle>
        <DialogDescription>Check the amounts. Nothing is charged until you confirm.</DialogDescription>

        {preview ? (
          <dl className="mt-5 divide-y divide-border-subtle rounded-lg border border-border-default">
            {preview.creditCents > 0 ? (
              <div className="flex flex-col gap-0.5 px-4 py-3">
                <dt className="text-sm font-semibold text-fg">Credit</dt>
                <dd className="text-sm text-fg-secondary">
                  You get{' '}
                  <span data-testid="change-credit" className="font-semibold text-success-text tabular-nums">
                    {formatMoney(preview.creditCents)}
                  </span>{' '}
                  credit on your next bill.
                </dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-sm font-semibold text-fg">
                Due today
                <span className="block text-xs font-normal text-fg-muted">
                  {preview.dueTodayCents > 0
                    ? unusedCents > 0
                      ? `After ${formatMoney(unusedCents)} credit for the part you did not use.`
                      : daysWords.charAt(0).toUpperCase() + daysWords.slice(1) + '.'
                    : 'Nothing to pay now.'}
                </span>
              </dt>
              <dd data-testid="change-due-today" className="shrink-0 text-lg font-semibold text-fg tabular-nums">
                {formatMoney(preview.dueTodayCents)}
              </dd>
            </div>
            {preview.taxCents > 0 ? (
              <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-fg-secondary">Sales tax, included above</dt>
                <dd className="shrink-0 text-sm text-fg tabular-nums">{formatMoney(preview.taxCents)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-sm font-semibold text-fg">
                Then
                <span className="block text-xs font-normal text-fg-muted">Starting {formatDay(preview.nextChargeAt, timeZone)}.</span>
              </dt>
              <dd className="shrink-0 text-sm text-fg">
                <span data-testid="change-new-total" className="text-md font-semibold tabular-nums">
                  {formatMoney(preview.newRecurringCents)}
                </span>{' '}
                {perPeriod(interval)}
              </dd>
            </div>
          </dl>
        ) : null}

        {preview && preview.lines.length > 0 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer rounded-md py-1 font-medium text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              See the math
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5 rounded-lg bg-sunken px-4 py-3">
              {preview.lines.map((line, index) => (
                <li key={`${line.description}-${index}`} className="flex items-baseline justify-between gap-4 text-xs text-fg-secondary">
                  <span className="min-w-0">{line.description}</span>
                  <span className="shrink-0 tabular-nums">{formatMoney(line.amountCents)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {error ? (
          <Notice
            tone={error.code === 'price_changed' ? 'warning' : 'danger'}
            className="mt-4"
            action={
              error.code === 'card_declined' || error.code === 'payment_failed' ? (
                <Button variant="secondary" size="sm" loading={updatingCard} onClick={onUpdateCard}>
                  Update card
                </Button>
              ) : error.code === 'email_unverified' ? (
                <Link href={verifyHref} className="font-semibold underline underline-offset-2">
                  Enter code
                </Link>
              ) : undefined
            }
          >
            {error.message}
          </Notice>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" size="xl" onClick={onClose} disabled={confirming}>
            Go back
          </Button>
          <Button size="xl" data-testid="change-confirm" loading={confirming} disabled={!preview} onClick={onConfirm}>
            Confirm change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
