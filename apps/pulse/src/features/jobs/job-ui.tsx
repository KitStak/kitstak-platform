'use client';
/**
 * Small building blocks shared by the jobs list, the new job wizard and the job page: the risk
 * pill with its reasons, the "How we got this" popover, the job status badge, a progress bar
 * with words, and the error panel with a retry button.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, CirclePause, CircleSlash, Clock3, Info, PlayCircle, RotateCw, type LucideIcon } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { MarginPill } from '@/components/charts/stats';
import { JOB_STATUS_LABELS, type JobStatusValue } from '@/lib/constants';
import { formatMoney, formatNumber } from '@/lib/format';
import type { JobListItemDTO } from '@/lib/types';
import { nextStepHref } from './job-math';

const STATUS_STYLE: Readonly<Record<JobStatusValue, { icon: LucideIcon; className: string }>> = {
  planned: { icon: Clock3, className: 'bg-[var(--label-blue-subtle)] text-[var(--label-blue-text)]' },
  active: { icon: PlayCircle, className: 'bg-success-subtle text-success-text' },
  on_hold: { icon: CirclePause, className: 'bg-[var(--label-yellow-subtle)] text-[var(--label-yellow-text)]' },
  completed: { icon: CircleCheck, className: 'bg-muted text-fg-secondary' },
  cancelled: { icon: CircleSlash, className: 'bg-muted text-fg-muted' },
};

/** Where the job is in its life: icon and word, never color alone. */
export function JobStatusBadge({ status, className }: { readonly status: JobStatusValue; readonly className?: string }) {
  const { icon: Icon, className: tone } = STATUS_STYLE[status];
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-sm px-2 text-xs font-medium whitespace-nowrap', tone, className)}>
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={2.25} />
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The risk pill. Click or focus opens the top three reasons in plain words, what each one costs
 * and the next step, so nobody has to open the job to learn why it is flagged.
 */
export function RiskPill({ job, size = 'md', withReasons = true }: { readonly job: JobListItemDTO; readonly size?: 'sm' | 'md'; readonly withReasons?: boolean }) {
  const status = job.stats.riskStatus;
  if (!status) return <span className="text-xs text-fg-muted">{job.status === 'planned' ? 'Not started' : 'No status'}</span>;
  const reasons = job.stats.riskReasons.slice(0, 3);
  if (!withReasons || reasons.length === 0) return <MarginPill status={status} size={size} />;
  const step = reasons.find((reason) => reason.nextStep);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${job.number} status. Show the reasons`}
          data-testid="risk-pill"
          className="inline-flex max-w-full rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={(event) => event.stopPropagation()}
        >
          <MarginPill status={status} size={size} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] max-w-[calc(100vw-32px)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-3 p-1">
          <div>
            <p className="text-xs font-medium text-fg-muted">Why {job.number} is flagged</p>
            <ul className="mt-2 flex flex-col gap-2">
              {reasons.map((reason) => (
                <li key={reason.rule} className="flex items-start gap-2 text-sm text-fg">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                  <span>
                    {reason.text}
                    {reason.impactCents !== null && reason.impactCents < 0 ? <span className="ml-1 text-xs whitespace-nowrap text-danger-text tabular-nums">{formatMoney(reason.impactCents, { cents: false })} of profit</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {step?.nextStepLabel ? (
            <Link
              href={nextStepHref(step.nextStep, job)}
              className="inline-flex items-center gap-1.5 self-start rounded-md text-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {step.nextStepLabel}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface ExplainRow {
  readonly label: string;
  readonly value: string;
  /** `minus` rows are taken away, `total` rows are the answer. */
  readonly kind?: 'plus' | 'minus' | 'total' | 'note';
}

/**
 * "How we got this": the inputs behind one number, with the rule in one plain sentence. Built
 * from the same DTO fields the number itself comes from.
 */
export function Explain({ title, rule, rows, footnote, label }: { readonly title: string; readonly rule: string; readonly rows: readonly ExplainRow[]; readonly footnote?: ReactNode; readonly label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ?? `How we got ${title}`}
          data-testid="explain"
          className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <Info aria-hidden className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] max-w-[calc(100vw-32px)]">
        <div className="flex flex-col gap-2.5 p-1">
          <div>
            <p className="text-xs font-medium text-fg-muted">How we got this</p>
            <p className="mt-0.5 text-sm font-semibold text-fg">{title}</p>
          </div>
          <p className="text-sm text-fg-secondary">{rule}</p>
          {rows.length > 0 ? (
            <dl className="flex flex-col rounded-lg border border-border-subtle bg-sunken text-sm tabular-nums">
              {rows.map((row) => (
                <div key={row.label} className={cn('flex items-baseline justify-between gap-3 px-3 py-1.5', row.kind === 'total' && 'border-t border-border-default font-semibold text-fg', row.kind === 'note' && 'text-fg-muted')}>
                  <dt className="min-w-0 text-fg-secondary">
                    {row.kind === 'minus' ? <span aria-hidden>less </span> : null}
                    {row.label}
                  </dt>
                  <dd className="shrink-0 text-fg">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {footnote ? <p className="text-xs text-fg-muted">{footnote}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Units done of units planned, as a bar with the words next to it. */
export function UnitsProgress({ done, planned, pctBp, unit, compact = false }: { readonly done: string; readonly planned: string; readonly pctBp: number | null; readonly unit: string; readonly compact?: boolean }) {
  const hasPlan = Number(planned) > 0;
  const pct = pctBp === null ? null : Math.max(0, Math.min(100, pctBp / 100));
  const doneText = formatNumber(done, { maxDigits: 0 });
  const plannedText = formatNumber(planned, { maxDigits: 0 });
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', compact ? 'w-[124px]' : 'w-full')}>
      <span className="truncate text-xs text-fg tabular-nums">
        {doneText}
        {hasPlan ? <span className="text-fg-muted"> of {plannedText}</span> : null}
        {compact ? null : <span className="text-fg-muted"> {unit}</span>}
      </span>
      {hasPlan && pct !== null ? (
        <span role="progressbar" aria-label={`${doneText} of ${plannedText} ${unit} done`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-info" style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </div>
  );
}

/** A read failed: say so in plain words and offer the retry. */
export function LoadError({ what, message, onRetry }: { readonly what: string; readonly message?: string; readonly onRetry?: () => void }) {
  return (
    <div role="alert" data-testid="load-error" className="flex flex-col items-center gap-3 rounded-xl border border-border-subtle bg-panel px-6 py-10 text-center">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl bg-danger-subtle text-danger-text">
        <CircleAlert className="size-6" />
      </span>
      <div>
        <p className="text-md font-semibold text-fg">We could not load {what}</p>
        <p className="mt-1 text-sm text-fg-secondary">{message ?? 'Check your connection and try again.'}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" leadingIcon={<RotateCw aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Text tone for a good or bad number. */
export function toneClass(tone: 'good' | 'bad' | 'neutral'): string {
  return tone === 'good' ? 'text-success-text' : tone === 'bad' ? 'text-danger-text' : 'text-fg';
}

/** "Hidden" marker for a money cell the reader may not see. */
export function Hidden() {
  return <span className="text-fg-muted">Hidden</span>;
}
