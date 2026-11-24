'use client';
/**
 * Cancel and pause (SPEC 6.8). Click one was "Cancel plan" on billing home. Click two is "Cancel my
 * plan" here. The question is optional and never blocks. A pause is offered first on monthly plans.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RadioGroup } from 'radix-ui';
import { CircleAlert, PauseCircle } from 'lucide-react';
import type { CancelReason } from '@kitstak/billing/server';
import { Button, Card, LinkButton, Textarea, cn } from '@/components/ui';
import { cancelPlanAction, pausePlanAction } from '@/features/billing/actions';

const REASONS: readonly { readonly value: CancelReason; readonly label: string }[] = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'missing_feature', label: 'Missing something I need' },
  { value: 'switching_tool', label: 'Switching to another tool' },
  { value: 'not_using', label: 'Not using it enough' },
  { value: 'seasonal', label: 'Our work is seasonal' },
  { value: 'other', label: 'Something else' },
];

export interface PauseOption {
  readonly months: 1 | 2 | 3;
  readonly startsLabel: string;
  readonly resumesLabel: string;
}

export interface CancelFlowProps {
  /** Empty when a pause is not on offer (yearly plans, a trial, a late payment, already pausing). */
  readonly pauseOptions: readonly PauseOption[];
  /** True when the plan has 2 or more apps, so removing one is an option. */
  readonly canRemoveApp: boolean;
}

export function CancelFlow({ pauseOptions, canRemoveApp }: CancelFlowProps) {
  const router = useRouter();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [detail, setDetail] = useState('');
  const [months, setMonths] = useState<1 | 2 | 3 | null>(null);
  const [busy, setBusy] = useState<'cancel' | 'pause' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picked = pauseOptions.find((option) => option.months === months) ?? null;

  const submit = async (kind: 'cancel' | 'pause') => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const result =
        kind === 'pause' && months !== null
          ? await pausePlanAction({ months, reason })
          : await cancelPlanAction({ reason, detail: detail.trim() === '' ? null : detail.trim() });
      if (result.ok) {
        router.push(`/billing?notice=${kind === 'pause' ? 'paused' : 'canceled'}`);
        return;
      }
      setError(result.error.message);
    } catch {
      setError('We could not reach KitStak. Nothing changed. Check your connection and try again.');
    }
    setBusy(null);
  };

  return (
    <div className="flex flex-col gap-6">
      {pauseOptions.length > 0 ? (
        <Card data-testid="cancel-offer-pause" aria-labelledby="cancel-pause-heading" className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-subtle text-info-text">
              <PauseCircle aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 id="cancel-pause-heading" className="text-base font-semibold text-fg">
                Need a break?
              </h2>
              <p className="mt-0.5 text-sm text-fg-secondary">Pause for 1, 2 or 3 months. No bills while paused. Your plan starts again by itself.</p>
            </div>
          </div>
          <div role="group" aria-label="How long to pause" className="mt-4 grid grid-cols-3 gap-2">
            {pauseOptions.map((option) => (
              <button
                key={option.months}
                type="button"
                data-testid={`cancel-pause-${option.months}`}
                aria-pressed={months === option.months}
                onClick={() => setMonths(months === option.months ? null : option.months)}
                className={cn(
                  'min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold text-fg',
                  'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  months === option.months ? 'border-primary bg-primary-subtle/40' : 'border-border-input bg-panel hover:border-border-input-hover hover:bg-muted',
                )}
              >
                {option.months === 1 ? '1 month' : `${option.months} months`}
              </button>
            ))}
          </div>
          {picked ? (
            <div className="mt-4 flex flex-col gap-3 rounded-lg bg-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p role="status" className="text-sm font-medium text-fg">
                Paused from {picked.startsLabel}. Starts again on {picked.resumesLabel}.
                <span className="block font-normal text-fg-secondary">Your apps are view only while paused. Nothing is deleted.</span>
              </p>
              <Button size="xl" data-testid="cancel-pause-confirm" loading={busy === 'pause'} disabled={busy === 'cancel'} onClick={() => submit('pause')} className="shrink-0">
                Pause my plan
              </Button>
            </div>
          ) : null}
          {canRemoveApp ? (
            <p className="mt-4 text-sm text-fg-secondary">
              Or{' '}
              <Link href="/billing/plan" className="font-semibold text-fg underline underline-offset-2">
                remove an app you do not use
              </Link>
              .
            </p>
          ) : null}
        </Card>
      ) : canRemoveApp ? (
        <p className="text-sm text-fg-secondary">
          Paying for an app you do not use?{' '}
          <Link href="/billing/plan" className="font-semibold text-fg underline underline-offset-2">
            Remove an app
          </Link>{' '}
          and keep the rest.
        </p>
      ) : null}

      <Card aria-labelledby="cancel-why-heading" className="p-5 sm:p-6">
        <h2 id="cancel-why-heading" className="text-base font-semibold text-fg">
          Why are you leaving?
        </h2>
        <p className="mt-0.5 text-sm text-fg-secondary">You can skip this. It helps us get better.</p>
        <RadioGroup.Root
          aria-labelledby="cancel-why-heading"
          value={reason ?? ''}
          onValueChange={(value) => setReason(value as CancelReason)}
          className="mt-4 grid gap-2 sm:grid-cols-2"
        >
          {REASONS.map((option) => {
            const on = reason === option.value;
            return (
              <RadioGroup.Item
                key={option.value}
                value={option.value}
                data-testid={`cancel-reason-${option.value}`}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium text-fg',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  on ? 'border-primary bg-primary-subtle/40' : 'border-border-input bg-panel hover:border-border-input-hover',
                )}
              >
                <span aria-hidden className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]', on ? 'border-primary' : 'border-border-strong')}>
                  <span className={cn('size-2 rounded-full bg-primary', !on && 'opacity-0')} />
                </span>
                {option.label}
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
        <label htmlFor="cancel-detail" className="mt-4 block text-sm font-medium text-fg-secondary">
          Anything else we should know?
        </label>
        <Textarea
          id="cancel-detail"
          data-testid="cancel-detail"
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          maxLength={1000}
          rows={3}
          className="mt-1.5"
        />
      </Card>

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <LinkButton href="/billing" variant="secondary" size="xl" data-testid="cancel-back">
          Keep my plan
        </LinkButton>
        <Button variant="danger" size="xl" data-testid="cancel-confirm" loading={busy === 'cancel'} disabled={busy === 'pause'} onClick={() => submit('cancel')}>
          Cancel my plan
        </Button>
      </div>
    </div>
  );
}
