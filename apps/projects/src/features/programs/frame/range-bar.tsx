'use client';
/**
 * Range bar under the tabs on Builds pages (docs/programs/SPEC.md 5.7). One day: the day strip
 * (arrows, the day, its run summary, Today, Log output for this day). Longer: the range summary
 * ("Nov 23 to Nov 29 · 40 builds · 3,560 of 4,000 kits") with arrows that move by the range length.
 * Both read and write the one `range` URL param, so every builds view stays in step.
 */
import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, ClipboardPen } from 'lucide-react';
import { fromScaled, quantityToScaled } from '@kitstak/programs-engine';
import { Button, IconButton, Skeleton, cn } from '@/components/ui';
import { useProgramRuns } from '@/lib/hooks/use-programs';
import type { BuildView, RunDTO } from '@/lib/program-types';
import { useCurrentProgram } from '../program-context';
import { dayLabel, qtyOfText, rangeLabel } from '../kit/format';
import { RunLine } from '../kit/numbers';
import { RANGE_PARAM, formatRange, isOneDay, parseRange, shiftDay, shiftRange, type BuildRange } from './range';

/** Sum of run units as 3 decimal text (never Number math). */
function sumUnits(runs: readonly RunDTO[], pick: (run: RunDTO) => string): string {
  return fromScaled(runs.reduce((sum, run) => sum + quantityToScaled(pick(run)), BigInt(0)), 3);
}

/** The current builds range and a setter that writes the URL (keeps every other param). */
export function useBuildRange(view: BuildView | null): { range: BuildRange; setRange: (next: BuildRange) => void } {
  const { today } = useCurrentProgram();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const range = parseRange(params?.get(RANGE_PARAM), today, view);
  const setRange = useCallback(
    (next: BuildRange) => {
      const search = new URLSearchParams(params?.toString() ?? '');
      search.set(RANGE_PARAM, formatRange(next));
      router.replace(`${pathname}?${search.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  return { range, setRange };
}

export function RangeBar({ view }: { readonly view: BuildView | null }) {
  const { key, unit, today, capabilities } = useCurrentProgram();
  const { range, setRange } = useBuildRange(view);
  const runs = useProgramRuns(key, { from: range.from, to: range.to }, { staleTime: 15_000 });
  const oneDay = isOneDay(range);
  const list = runs.data ?? [];
  const builds = list.reduce((sum, run) => sum + run.builds, 0);
  const planned = sumUnits(list, (run) => run.plannedUnits);
  const built = sumUnits(list, (run) => run.builtUnits);
  const logHref = `?${new URLSearchParams({ [RANGE_PARAM]: formatRange(range), log: range.from }).toString()}`;

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle bg-sunken/50 px-4 py-1.5 text-xs text-fg-secondary sm:px-6" data-testid="range-bar">
      <span className="inline-flex items-center gap-0.5">
        <IconButton
          size="sm"
          label={oneDay ? 'Day before' : 'Earlier range'}
          icon={<ChevronLeft aria-hidden />}
          onClick={() => setRange(oneDay ? shiftDay(range, -1) : shiftRange(range, -1))}
          data-testid="range-prev"
        />
        <IconButton
          size="sm"
          label={oneDay ? 'Day after' : 'Later range'}
          icon={<ChevronRight aria-hidden />}
          onClick={() => setRange(oneDay ? shiftDay(range, 1) : shiftRange(range, 1))}
          data-testid="range-next"
        />
      </span>
      <span className="text-sm font-semibold text-fg" data-testid="range-label">
        {oneDay ? dayLabel(range.from) : rangeLabel(range.from, range.to)}
      </span>
      {oneDay && range.from === today ? <span className="rounded-full bg-primary-subtle px-1.5 py-px text-2xs font-semibold text-primary-text">Today</span> : null}
      <span className="order-last flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:order-none sm:w-auto sm:flex-1">
        {runs.isPending ? (
          <Skeleton width={260} height={12} />
        ) : list.length === 0 ? (
          <span className="text-fg-muted">{oneDay ? 'No builds on this day' : `No builds from ${rangeLabel(range.from, range.to)}`}</span>
        ) : oneDay ? (
          list.map((run) => <RunLine key={run.id} run={run} unit={unit} withDate={false} showState moneyHidden size="sm" className="min-w-0" />)
        ) : (
          <span className="tabular-nums">
            {builds} {builds === 1 ? 'build' : 'builds'} · {qtyOfText(built, planned, unit)}
          </span>
        )}
      </span>
      <span className="ml-auto inline-flex items-center gap-1.5">
        {!(oneDay && range.from === today) ? (
          <Button variant="ghost" size="sm" onClick={() => setRange({ from: today, to: today, preset: 'today' })} data-testid="range-today">
            Today
          </Button>
        ) : null}
        {oneDay && capabilities.canLog ? (
          <Link href={logHref} scroll={false} className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border border-border-input bg-panel px-2.5 text-xs font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus')} data-testid="range-log">
            <ClipboardPen aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">Log output for this day</span>
            <span className="sm:hidden">Log output</span>
          </Link>
        ) : null}
      </span>
    </div>
  );
}
