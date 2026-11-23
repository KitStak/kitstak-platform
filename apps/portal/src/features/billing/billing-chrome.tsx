/** Shared page furniture for the billing area: the title row, back links and the test mode badge. */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import type { BillingMode } from '@kitstak/billing/plan-state';
import { cn } from '@/components/ui';

export function isTestMode(mode: BillingMode): boolean {
  return mode === 'stripe_test' || mode === 'test_gateway';
}

/** The small "Test mode" badge beside a billing title. The strip under the top bar carries the test id. */
export function TestModeBadge({ mode, testId }: { readonly mode: BillingMode; readonly testId?: string }) {
  if (!isTestMode(mode)) return null;
  return (
    <span
      data-testid={testId}
      title="No real money moves."
      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-subtle px-2 py-0.5 text-2xs font-semibold tracking-[0.06em] text-warning-text uppercase"
    >
      <FlaskConical aria-hidden className="size-3" />
      Test mode
    </span>
  );
}

export function BackLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {children}
    </Link>
  );
}

export interface BillingHeaderProps {
  readonly orgName: string;
  readonly title: string;
  readonly description?: ReactNode;
  /** Badges after the title (phase, test mode). */
  readonly badges?: ReactNode;
  /** Buttons on the right. */
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function BillingHeader({ orgName, title, description, badges, actions, className }: BillingHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg-muted">{orgName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
          {badges}
        </div>
        {description ? <p className="mt-1.5 max-w-2xl text-md text-fg-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A centered message page: empty, not allowed, or nothing to do here. Always with a way on. */
export function BillingMessage({
  icon,
  title,
  children,
  actions,
  testId,
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly testId?: string;
}) {
  return (
    <section data-testid={testId} className="mx-auto flex max-w-[520px] flex-col items-center py-12 text-center">
      {icon ? <span className="inline-flex size-12 items-center justify-center rounded-full bg-sunken text-icon">{icon}</span> : null}
      <h1 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
      {children ? <div className="mt-2 text-md text-fg-secondary">{children}</div> : null}
      {actions ? <div className="mt-6 flex flex-col gap-2 sm:flex-row">{actions}</div> : null}
    </section>
  );
}
