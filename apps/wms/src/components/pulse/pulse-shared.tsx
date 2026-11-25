/**
 * Shared bits for the KitStak Pulse panels inside the WMS: the official Pulse mark, the health
 * pill with the five shared words, and a link styled as a button. Presentation only.
 */
import * as React from 'react';
import { PULSE_STATUS_LABELS, type PulseStatus } from '@kitstak/pulse-bridge/types';
import { statusTone, type PulseTone } from '@kitstak/pulse-bridge/format';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/** Shape for shape from the official brand file `kitstak-icon-pulse.svg`: two notched bars. */
export function PulseMark({ size = 14 }: { readonly size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="32 45 136 110" className="shrink-0">
      <polygon points="40,71 82,71 100,53 118,71 160,71 160,101 118,101 100,83 82,101 40,101" fill="#C8102E" />
      <polygon points="40,117 82,117 100,99 118,117 160,117 160,147 118,147 100,129 82,147 40,147" fill="#D65A6E" />
    </svg>
  );
}

const PILL: Readonly<Record<PulseTone, string>> = {
  good: 'bg-success-subtle text-success-text',
  watch: 'bg-warning-subtle text-warning-text',
  warn: 'bg-warning-subtle text-warning-text',
  bad: 'bg-danger-subtle text-danger-text',
  quiet: 'bg-sunken text-fg-secondary',
};

const DOT: Readonly<Record<PulseTone, string>> = {
  good: 'var(--success)',
  watch: 'var(--warning)',
  warn: 'var(--warning)',
  bad: 'var(--danger)',
  quiet: 'var(--border-strong)',
};

/** Job health in words plus a dot. The words carry the meaning, the color only supports them. */
export function PulseStatusPill({ risk, fallback }: { readonly risk: PulseStatus | null; readonly fallback: string }) {
  const tone = statusTone(risk);
  return (
    <span className={cn('inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium', PILL[tone])} data-testid="pulse-status-pill">
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: DOT[tone] }} />
      {risk ? PULSE_STATUS_LABELS[risk] : fallback}
    </span>
  );
}

/** A link that looks like a button. Every one of these opens KitStak Pulse in a new tab. */
export function PulseLink({
  href,
  children,
  variant = 'secondary',
  testId,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly testId?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant, size: 'sm' }), 'gap-1.5')} data-testid={testId}>
      {children}
      <span className="sr-only"> (opens KitStak Pulse in a new tab)</span>
    </a>
  );
}
