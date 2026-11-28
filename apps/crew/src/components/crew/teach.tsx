import type { ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/components/ui/cn';

/**
 * The teaching empty state used on every Crew page with no data yet: what this is, one sentence
 * on why it matters, what will show up here, and the next action. Never a dead end.
 */
export function Teach({
  icon: Icon,
  title,
  why,
  points,
  actions,
  footnote,
  size = 'md',
  className,
  testId = 'teach',
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  /** One or two plain sentences: what this is and why it matters. */
  readonly why: ReactNode;
  /** Up to four things the person will see here once there is data. */
  readonly points?: readonly string[];
  /** Primary action first, then secondary links. */
  readonly actions?: ReactNode;
  readonly footnote?: ReactNode;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <div data-testid={testId} className={cn('flex flex-col items-center text-center', size === 'sm' ? 'gap-3 px-4 py-8' : 'gap-4 px-6 py-12 sm:py-16', className)}>
      <span aria-hidden className={cn('flex items-center justify-center rounded-2xl bg-primary-subtle text-primary-text ring-1 ring-[color:var(--border-subtle)]', size === 'sm' ? 'size-12' : 'size-16')}>
        <Icon className={size === 'sm' ? 'size-6' : 'size-8'} strokeWidth={1.75} />
      </span>
      <div className="flex max-w-xl flex-col gap-1.5">
        <h2 className={cn('font-semibold tracking-[-0.01em] text-fg', size === 'sm' ? 'text-md' : 'text-lg')}>{title}</h2>
        <p className="text-base text-fg-secondary">{why}</p>
      </div>
      {points?.length ? (
        <ul className="mt-1 flex w-full max-w-md flex-col gap-2 rounded-xl border border-border-subtle bg-sunken px-4 py-3 text-left">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2.5 text-sm text-fg-secondary">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      {footnote ? <p className="max-w-md text-xs text-fg-muted">{footnote}</p> : null}
    </div>
  );
}

/** A plain numbered step (first run checklist, wizards explained in words). */
export function StepList({ steps }: { readonly steps: readonly { readonly title: string; readonly detail: ReactNode; readonly action?: ReactNode }[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border-subtle">
      {steps.map((step, index) => (
        <li key={step.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-fg-secondary tabular-nums">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{step.title}</p>
            <p className="mt-0.5 text-sm text-fg-muted">{step.detail}</p>
          </div>
          {step.action ? <div className="shrink-0">{step.action}</div> : null}
        </li>
      ))}
    </ol>
  );
}
