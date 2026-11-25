'use client';
/**
 * "Programs today" on Home (docs/programs/SPEC.md 5.2): one tile per running program with today's
 * runs ("Weekday glove run · 5 of 8 builds · 560 of 800 kits"), a progress bar for today's kits,
 * this month against the target (money only when the person may see it) and 30 days of output.
 * Log output, Open and Open Floor today show once their pages exist (kit/live-pages.ts). Shown only
 * when the person can see a running program.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowRight, ArrowUpRight, ClipboardPen, Factory } from 'lucide-react';
import { unitLabel } from '@kitstak/programs-engine';
import { Badge, ProgressBar, Skeleton, cn } from '@/components/ui';
import { useFloorToday, usePrograms } from '@/lib/hooks/use-programs';
import type { FloorTodayDTO, ProgramListItemDTO, RunDTO, UnitLabel } from '@/lib/program-types';
import { MoneyHiddenNote, ProgramIcon, ProgramStatusPill, TargetChip } from '@/features/programs/kit/chips';
import { MoneyText, OutputSparkline, RunRing } from '@/features/programs/kit/numbers';
import { RUN_STATE_TEXT, RUN_STATE_TONE, dayLabel, doneOfText, qtyOfText, qtyPercent, qtyTone } from '@/features/programs/kit/format';
import { floorTodayHref, logOutputHref, programHref } from '@/features/programs/kit/live-pages';
import { useHydrated } from '@/features/programs/kit/use-hydrated';
import { sameAsDay } from './home-model';

/** "Weekday glove run · 5 of 8 builds · 560 of 800 kits". */
export function homeRunText(run: Pick<RunDTO, 'name' | 'done' | 'builds' | 'builtUnits' | 'plannedUnits'>, unit: UnitLabel): string {
  return `${run.name} · ${run.done} of ${run.builds} ${run.builds === 1 ? 'build' : 'builds'} · ${qtyOfText(run.builtUnits, run.plannedUnits, unit)}`;
}

/** Revenue so far over the month target as 0 to 100 for the bar (display only, never money math). */
export function monthBarPercent(revenueCents: string | null, targetCents: string | null): number {
  if (!revenueCents || !targetCents) return 0;
  const target = BigInt(targetCents);
  if (target <= BigInt(0)) return 0;
  return Math.min(100, Number((BigInt(revenueCents) * BigInt(1000)) / target) / 10);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthWord(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

type FloorRow = FloorTodayDTO['programs'][number];

function SectionLabel({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{children}</p>;
}

function TodayBlock({ program, floor, date }: { readonly program: ProgramListItemDTO; readonly floor: FloorRow | undefined; readonly date: string }) {
  const runs = floor?.runs ?? [];
  const builds = runs.length > 0 ? runs.reduce((sum, run) => sum + run.builds, 0) : program.today.builds;
  const done = runs.length > 0 ? runs.reduce((sum, run) => sum + run.done, 0) : program.today.done;
  const { plannedUnits, builtUnits } = program.today;
  const tone = qtyTone(builtUnits, plannedUnits);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SectionLabel>Today · {dayLabel(date)}</SectionLabel>
      {builds === 0 ? (
        <p className="text-sm text-fg-muted">No builds today</p>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <RunRing done={done} total={builds} size={28} label={doneOfText(done, builds)} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-fg tabular-nums">{qtyOfText(builtUnits, plannedUnits, program.unit)}</span>
                <span className="shrink-0 text-xs text-fg-muted tabular-nums">{Math.round(qtyPercent(builtUnits, plannedUnits))}%</span>
              </div>
              <ProgressBar value={qtyPercent(builtUnits, plannedUnits)} tone={tone} label={`${qtyOfText(builtUnits, plannedUnits, program.unit)} today`} />
            </div>
          </div>
          <p className={cn('text-xs tabular-nums', done >= builds ? 'font-medium text-success-text' : 'text-fg-secondary')}>{done >= builds ? (builds === 1 ? 'The build is done' : `All ${builds} builds done`) : doneOfText(done, builds)}</p>
          {runs.length === 1 && sameAsDay(runs[0]!, builds, plannedUnits, builtUnits) ? (
            <p className="flex min-w-0 items-center gap-1.5 border-t border-border-subtle pt-2 text-xs text-fg-secondary" data-testid="home-program-one-run">
              <span className="min-w-0 truncate">
                All in one run: <span className="font-medium text-fg">{runs[0]!.name}</span>
              </span>
              <Badge tone={RUN_STATE_TONE[runs[0]!.state]} size="sm" className="shrink-0">
                {RUN_STATE_TEXT[runs[0]!.state]}
              </Badge>
            </p>
          ) : runs.length > 0 ? (
            <ul className="flex flex-col gap-1 border-t border-border-subtle pt-2">
              {runs.map((run) => (
                <li key={run.id} className="flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary">
                  <RunRing done={run.done} total={run.builds} size={14} label={`${run.done} of ${run.builds} builds done in ${run.name}`} />
                  <span className="line-clamp-2 min-w-0 tabular-nums">{homeRunText(run, program.unit)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

function MonthBlock({ program }: { readonly program: ProgramListItemDTO }) {
  const { month } = program;
  const showMoney = !program.moneyHidden && month.revenueCents !== null;
  const hasTarget = showMoney && month.targetCents !== null && BigInt(month.targetCents) > BigInt(0);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SectionLabel>This month · {monthWord(month.month)}</SectionLabel>
      {showMoney ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <span className="text-sm text-fg-secondary">
              <MoneyText cents={month.revenueCents} className="font-semibold text-fg" /> so far
            </span>
            {hasTarget ? (
              <span className="text-xs text-fg-muted">
                of <MoneyText cents={month.targetCents} /> target
              </span>
            ) : null}
          </div>
          {hasTarget ? <ProgressBar value={monthBarPercent(month.revenueCents, month.targetCents)} tone={monthBarPercent(month.revenueCents, month.targetCents) >= 100 ? 'success' : 'primary'} label="Revenue so far against the month target" /> : null}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            {month.forecastCents !== null ? (
              <span>
                Forecast <MoneyText cents={month.forecastCents} className="font-medium text-fg-secondary" />
              </span>
            ) : null}
            {month.targetBp !== null ? <TargetChip targetBp={month.targetBp} /> : null}
          </div>
        </div>
      ) : program.moneyHidden ? (
        <MoneyHiddenNote />
      ) : null}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium text-fg tabular-nums">{unitLabel(month.units, program.unit)} built</span>
          <span className="text-fg-muted">Last 30 days</span>
        </div>
        <OutputSparkline points={program.sparkline} unit={program.unit} />
      </div>
    </div>
  );
}

function ProgramTile({ program, floor, date }: { readonly program: ProgramListItemDTO; readonly floor: FloorRow | undefined; readonly date: string }) {
  const href = programHref(program.key);
  const log = program.today.builds > program.today.done ? logOutputHref(program.key, date) : null;
  const name = (
    <span className="flex min-w-0 items-center gap-2.5">
      <ProgramIcon icon={program.icon} color={program.color} size={32} />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-fg">{program.name}</span>
          <span className="shrink-0 font-key text-2xs text-fg-muted">{program.key}</span>
        </span>
        <span className="truncate text-xs text-fg-muted">{[program.customer?.name, program.scheduleText].filter(Boolean).join(' · ') || 'Repeat kitting'}</span>
      </span>
    </span>
  );
  return (
    <li className="rounded-lg border border-border-subtle bg-panel p-3 sm:p-4" data-testid={`home-program-${program.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {href ? (
          <Link href={href} className="min-w-0 flex-1 rounded-sm outline-none hover:[&_.text-fg]:underline focus-visible:outline-2 focus-visible:outline-focus">
            {name}
          </Link>
        ) : (
          <div className="min-w-0 flex-1">{name}</div>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <ProgramStatusPill status={program.status} />
          {log ? (
            <Link href={log} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-input bg-panel px-2.5 text-xs font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus" aria-label={`Log output for ${program.name}`}>
              <ClipboardPen aria-hidden className="size-3.5" />
              Log output
            </Link>
          ) : null}
          {href ? (
            <Link href={href} aria-label={`Open ${program.name}`} className="inline-flex size-7 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus">
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <TodayBlock program={program} floor={floor} date={date} />
        <MonthBlock program={program} />
      </div>
    </li>
  );
}

export function ProgramsTodayCard() {
  const hydrated = useHydrated();
  const programs = usePrograms({}, { staleTime: 60_000 });
  const running = useMemo(() => (programs.data ?? []).filter((program) => !program.archivedAt && (program.status === 'active' || program.status === 'on_hold')), [programs.data]);
  const date = running[0]?.today.date ?? '';
  const floor = useFloorToday(date, { enabled: Boolean(date), staleTime: 30_000 });
  const floorByKey = useMemo(() => new Map<string, FloorRow>((floor.data?.programs ?? []).map((row) => [row.key, row])), [floor.data]);
  const ordered = useMemo(() => [...running].sort((a, b) => Number(b.today.builds > 0) - Number(a.today.builds > 0) || a.name.localeCompare(b.name)), [running]);
  if (!hydrated || programs.isPending || running.length === 0) return null;

  const builds = running.reduce((sum, program) => sum + program.today.builds, 0);
  const done = running.reduce((sum, program) => sum + program.today.done, 0);
  const floorHref = floorTodayHref(date);
  const summary = builds === 0 ? 'No builds today' : `${doneOfText(done, builds)} across ${running.length === 1 ? '1 program' : `${running.length} programs`}`;

  return (
    <section className="rounded-xl border border-border-subtle bg-panel shadow-xs" data-testid="home-programs" aria-label="Programs today">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-3">
        <div className="flex min-w-0 flex-col gap-x-2 sm:flex-row sm:items-center">
          <h2 className="flex shrink-0 items-center gap-2 text-base font-semibold text-fg">
            <Factory aria-hidden className="size-4 shrink-0 text-icon" />
            Programs today
          </h2>
          <span className="min-w-0 truncate pl-6 text-sm text-fg-muted tabular-nums sm:pl-0">{summary}</span>
        </div>
        {floorHref ? (
          <Link href={floorHref} className="inline-flex items-center gap-1 text-sm font-medium text-fg-link hover:underline" data-testid="home-programs-floor">
            Open Floor today <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </header>
      <div className="p-3">
        {floor.isPending && date ? (
          <div className="flex flex-col gap-2">
            <Skeleton height={148} rounded="md" />
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {ordered.map((program) => (
              <ProgramTile key={program.id} program={program} floor={floorByKey.get(program.key)} date={floor.data?.date ?? date} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

