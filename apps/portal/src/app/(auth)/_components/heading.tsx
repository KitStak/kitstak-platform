/**
 * The words at the top of an auth screen, and the inline alert. Plain markup with no browser
 * state, so server pages and client forms can both render them.
 */
import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { cn } from '@/components/ui/cn';

export function AuthHeading({
  title,
  subtitle,
  eyebrow,
}: {
  readonly title: string;
  readonly subtitle?: ReactNode;
  /** A small line above the title, for example "Step 1 of 2". */
  readonly eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-2 sm:mb-7">
      {eyebrow ? <div className="mb-1">{eyebrow}</div> : null}
      <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg sm:text-2xl">{title}</h1>
      {subtitle ? <p className="text-md text-fg-secondary">{subtitle}</p> : null}
    </div>
  );
}

/** "Step 1 of 2" with a two part bar. Tells a person how short the road is. */
export function StepEyebrow({
  step,
  total,
  label,
}: {
  readonly step: number;
  readonly total: number;
  readonly label: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
        Step {step} of {total}
        <span className="mx-1.5 text-fg-disabled" aria-hidden>
          /
        </span>
        <span className="text-fg-secondary">{label}</span>
      </p>
      <div className="flex w-24 gap-1" aria-hidden>
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn('h-1 flex-1 rounded-full', index < step ? 'bg-primary' : 'bg-sunken')}
          />
        ))}
      </div>
    </div>
  );
}

export function FormAlert({
  tone = 'error',
  children,
  testId,
}: {
  readonly tone?: 'error' | 'success' | 'info';
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'success' ? CircleCheck : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-base animate-fade-in motion-reduce:animate-none',
        tone === 'error' && 'border-danger/25 bg-danger-subtle text-danger-text',
        tone === 'success' && 'border-success/25 bg-success-subtle text-success-text',
        tone === 'info' && 'border-info/25 bg-info-subtle text-info-text',
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
