'use client';
/**
 * Small pieces every program screen shares: the month picker, the health and status pills, money
 * and margin cells (hidden for a reader without money rights), a units cell with the unit word,
 * a plan meter, and section skeletons.
 */
import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import type { DashLinkProps } from '@kitstak/ui/dashboard';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Meter, Pill } from '@kitstak/ui/dashboard';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/cn';
import { formatMoney, formatNumber, formatPercentBp } from '@/lib/format';
import type { ProgramHealth } from '@/lib/program-types';
import { HEALTH_LABELS, HEALTH_TONES, addMonth, marginTone, monthChoices, monthLabel, shareOfPlan, statusTone, toneText } from './program-format';

/** Prev and next arrows around a month list. `latest` is the newest month offered (next month at most). */
export function MonthPicker({ value, onChange, latest, className }: { readonly value: string; readonly onChange: (month: string) => void; readonly latest: string; readonly className?: string }) {
  const choices = monthChoices(latest, 35);
  if (!choices.includes(value)) choices.unshift(value);
  const oldest = choices[choices.length - 1] ?? value;
  return (
    <div className={cn('flex items-center gap-1', className)} data-testid="program-month-picker">
      <IconButton label="Month before" icon={<ChevronLeft aria-hidden />} variant="outline" size="md" onClick={() => onChange(addMonth(value, -1))} disabled={value <= oldest} data-testid="month-prev" />
      <div className="w-[164px]">
        <Select aria-label="Month" size="md" value={value} onValueChange={onChange} options={choices.map((month) => ({ value: month, label: monthLabel(month) }))} data-testid="month-select" />
      </div>
      <IconButton label="Month after" icon={<ChevronRight aria-hidden />} variant="outline" size="md" onClick={() => onChange(addMonth(value, 1))} disabled={value >= latest} data-testid="month-next" />
    </div>
  );
}

/** The health of a program this month as a dot and a word. `reason` is the tooltip (the first alert). */
export function HealthPill({ health, reason }: { readonly health: ProgramHealth; readonly reason?: string | null }) {
  const pill = (
    <Pill tone={HEALTH_TONES[health]} dot data-testid={`health-${health}`}>
      {HEALTH_LABELS[health]}
    </Pill>
  );
  if (!reason) return pill;
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {pill}
      </span>
    </Tooltip>
  );
}

/** "Running", "Paused", "Ended". */
export function StatusPill({ status, label }: { readonly status: string; readonly label: string }) {
  return (
    <Pill tone={statusTone(status)} data-testid="program-status">
      {label}
    </Pill>
  );
}

/** A money amount, red when below zero. `whole` drops the cents. */
export function Money({ cents, whole = false, className }: { readonly cents: number | null | undefined; readonly whole?: boolean; readonly className?: string }) {
  if (cents === null || cents === undefined) return <span className={cn('text-fg-muted', className)}>Hidden</span>;
  return <span className={cn('tabular-nums', cents < 0 && 'text-danger-text', className)}>{formatMoney(cents, { cents: !whole })}</span>;
}

/** A margin colored against the customer's target. */
export function Margin({ marginBp, targetBp, empty = 'None yet', className }: { readonly marginBp: number | null | undefined; readonly targetBp: number | null | undefined; readonly empty?: string; readonly className?: string }) {
  if (marginBp === null || marginBp === undefined) return <span className={cn('text-fg-muted', className)}>{empty}</span>;
  return <span className={cn('font-medium tabular-nums', toneText(marginTone(marginBp, targetBp)), className)}>{formatPercentBp(marginBp, { fixed: true })}</span>;
}

/** Units as a whole number with thousands separators ("14,412"), or up to 3 places when there are any. */
export function units(value: string | number | null | undefined): string {
  return formatNumber(value === null || value === undefined ? null : Number(value), { maxDigits: 3 });
}

/** Hours with two places, so a column lines up ("15.00" over "14.99"). */
export function hoursText(value: string | number | null | undefined): string {
  return formatNumber(value === null || value === undefined ? null : Number(value), { minDigits: 2, maxDigits: 2 });
}

/** Built against planned: "14,412 of 16,012" with a thin meter. */
export function PlanMeter({ built, planned, label }: { readonly built: string; readonly planned: string | null; readonly label: string }) {
  const share = shareOfPlan(built, planned);
  return <Meter value={share} label={`${label}: ${units(built)} of ${units(planned)}`} tone={share >= 1 ? 'positive' : 'data'} className="w-full" />;
}

/** A skeleton the shape of one section, while its read loads. */
export function SectionSkeleton({ label, rows = 6, className }: { readonly label: string; readonly rows?: number; readonly className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-2 p-4', className)} data-testid="program-skeleton">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} aria-hidden className="ks-skeleton block h-7 w-full rounded-md" style={{ opacity: 1 - index * 0.1 }} />
      ))}
    </div>
  );
}

/** A label and value pair for a definition grid (the forecast row, labor totals). */
export function Figure({ label, value, note, testId }: { readonly label: string; readonly value: ReactNode; readonly note?: ReactNode; readonly testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <dt className="text-xs font-medium text-fg-secondary">{label}</dt>
      <dd className="truncate text-lg font-semibold text-fg tabular-nums">{value}</dd>
      {note ? <dd className="text-xs text-fg-muted">{note}</dd> : null}
    </div>
  );
}

/**
 * A link that stays on this page when it only changes the tab or the month: it writes the address
 * bar with `history.pushState` (the frame follows it) instead of asking the server for the page
 * again. Any other link is a normal Next link. Used for the dashboard pieces and in-page links.
 */
export function PlaceLink({ href, children, className, title, ...rest }: DashLinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
    event.preventDefault();
    window.history.pushState(null, '', `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0 });
  };
  return (
    <Link href={href} onClick={onClick} className={className} title={title} aria-label={rest['aria-label']} data-testid={rest['data-testid']}>
      {children}
    </Link>
  );
}
