'use client';
/**
 * Months that end before a program starts have nothing to bill or close (SPEC 5.20). The close
 * and statement sheets show this note instead of an empty statement or a checklist that can never
 * pass.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, CalendarX2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { lastDayOfMonth, shortDate } from '@kitstak/programs-engine';
import type { IsoDate, IsoMonth } from '@/lib/program-types';
import { monthShortName } from '../overview/overview-model';

/** True when the whole month is before the program's first day. */
export function monthBeforeStart(month: IsoMonth, startDate: IsoDate | null): boolean {
  return Boolean(startDate && lastDayOfMonth(month) < startDate);
}

export function BeforeStartNotice({ programKey, month, startDate, what }: { readonly programKey: string; readonly month: IsoMonth; readonly startDate: IsoDate; readonly what: 'close' | 'bill' }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const first = startDate.slice(0, 7) as IsoMonth;
  const param = what === 'close' ? 'close' : 'statement';
  const openFirst = () => {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.set(param, first);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border-subtle bg-sunken px-4 py-4" data-testid="before-start">
      <CalendarX2 aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
      <div className="flex flex-col items-start gap-1">
        <p className="text-sm font-medium text-fg">
          {programKey} started {shortDate(startDate)}, so there is nothing to {what} for {monthShortName(month)}.
        </p>
        <p className="text-xs text-fg-muted">The first month is {monthShortName(first)}.</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={openFirst} data-testid="before-start-open-first">
          {what === 'close' ? `Open ${monthShortName(first)} close` : `View ${monthShortName(first)} statement`}
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
