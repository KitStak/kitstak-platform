'use client';
/**
 * "Programs today" on Home (docs/programs/SPEC.md 5.2): one tile per running program with today's
 * runs ("Weekday glove run · 5 of 8 builds · 560 of 800 kits"), a meter for today's kits,
 * this month against the target (money only when the person may see it) and 30 days of output.
 * Quantities are drawn in the dashboard data color; states are shared Pills, keys are Tags.
 * Log output, Open and Open Floor today show once their pages exist (kit/live-pages.ts). Shown only
 * when the person can see a running program.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowUpRight, ClipboardPen, Target } from 'lucide-react';
import { unitLabel } from '@kitstak/programs-engine';
import { DashSection, Meter, Pill, Tag, type PillTone } from '@kitstak/ui/dashboard';
import { Skeleton } from '@/components/ui';
import { PROGRAM_STATUS_LABELS, type ProjectStatus } from '@/lib/constants';
import { routes } from '@/lib/routes';
import { useFloorToday, usePrograms } from '@/lib/hooks/use-programs';
import type { FloorTodayDTO, ProgramListItemDTO, RunDTO, RunState, UnitLabel } from '@/lib/program-types';
import { MoneyHiddenNote, ProgramIcon } from '@/features/programs/kit/chips';
import { MoneyText, OutputSparkline, RunRing } from '@/features/programs/kit/numbers';
import { RUN_STATE_TEXT, dayLabel, doneOfText, qtyOfText, qtyPercent, targetText, targetTone, type TargetTone } from '@/features/programs/kit/format';
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

/** Quantities on the Home dashboard use the app's data color. */
const DATA = 'var(--dash-data)';

const STATUS_TONE: Readonly<Record<ProjectStatus, PillTone>> = { planning: 'neutral', active: 'positive', on_hold: 'caution', completed: 'neutral', archived: 'neutral' };
const RUN_TONE: Readonly<Record<RunState, PillTone>> = { planned: 'neutral', in_progress: 'info', done: 'positive', short: 'caution', cancelled: 'neutral' };
const TARGET_TONE: Readonly<Record<TargetTone, PillTone>> = { success: 'positive', warning: 'caution', danger: 'critical' };

/** A run's state: Planned is not a state yet, so it is a neutral Tag; the rest are Pills. */
function RunStateMark({ state }: { readonly state: RunState }) {
  if (state === 'planned') return <Tag>{RUN_STATE_TEXT[state]}</Tag>;
  return <Pill tone={RUN_TONE[state]}>{RUN_STATE_TEXT[state]}</Pill>;
}

function SectionLabel({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{children}</p>;
}

function TodayBlock({ program, floor, date }: { readonly program: ProgramListItemDTO; readonly floor: FloorRow | undefined; readonly date: string }) {
  const runs = floor?.runs ?? [];
  const builds = runs.length > 0 ? runs.reduce((sum, run) => sum + run.builds, 0) : program.today.builds;
  const done = runs.length > 0 ? runs.reduce((sum, run) => sum + run.done, 0) : program.today.done;
  const { plannedUnits, builtUnits } = program.today;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SectionLabel>Today · {dayLabel(date)}</SectionLabel>
      {builds === 0 ? (
        <p className="text-sm text-fg-muted">No builds today</p>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <RunRing done={done} total={builds} size={28} label={doneOfText(done, builds)} color={DATA} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-fg tabular-nums">{qtyOfText(builtUnits, plannedUnits, program.unit)}</span>
                <span className="shrink-0 text-xs text-fg-muted tabular-nums">{Math.round(qtyPercent(builtUnits, plannedUnits))}%</span>
              </div>
              <Meter value={qtyPercent(builtUnits, plannedUnits) / 100} label={`${qtyOfText(builtUnits, plannedUnits, program.unit)} today`} />
            </div>
          </div>
          <p className="text-xs text-fg-secondary tabular-nums">{done >= builds ? (builds === 1 ? 'The build is done' : `All ${builds} builds done`) : doneOfText(done, builds)}</p>
          {runs.length === 1 && sameAsDay(runs[0]!, builds, plannedUnits, builtUnits) ? (
            <p className="flex min-w-0 items-center gap-1.5 border-t border-border-subtle pt-2 text-xs text-fg-secondary" data-testid="home-program-one-run">
              <span className="min-w-0 truncate">
                All in one run: <span className="font-medium text-fg">{runs[0]!.name}</span>
              </span>
              <span className="shrink-0">
                <RunStateMark state={runs[0]!.state} />
              </span>
            </p>
          ) : runs.length > 0 ? (
            <ul className="flex flex-col gap-1 border-t border-border-subtle pt-2">
              {runs.map((run) => (
                <li key={run.id} className="flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary">
                  <RunRing done={run.done} total={run.builds} size={14} label={`${run.done} of ${run.builds} builds done in ${run.name}`} color={DATA} />
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
          {hasTarget ? <Meter value={monthBarPercent(month.revenueCents, month.targetCents) / 100} label="Revenue so far against the month target" /> : null}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            {month.forecastCents !== null ? (
              <span>
                Forecast <MoneyText cents={month.forecastCents} className="font-medium text-fg-secondary" />
              </span>
            ) : null}
            {month.targetBp !== null ? (
              <Pill tone={TARGET_TONE[targetTone(month.targetBp)]} icon={<Target />}>
                {targetText(month.targetBp)}
              </Pill>
            ) : null}
          </div>
        </div>
      ) : program.moneyHidden ? (
        <MoneyHiddenNote />
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg tabular-nums">{unitLabel(month.units, program.unit)} built this month</span>
        <OutputSparkline points={program.sparkline} unit={program.unit} color={DATA} />
        <span className="text-2xs text-fg-muted">Each day of the last 30 days</span>
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
          <Tag>{program.key}</Tag>
        </span>
        <span className="truncate text-xs text-fg-muted">{[program.customer?.name, program.scheduleText].filter(Boolean).join(' · ') || 'Repeat kitting'}</span>
      </span>
    </span>
  );
  return (
    <li className="p-4" data-testid={`home-program-${program.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {href ? (
          <Link href={href} className="min-w-0 flex-1 rounded-sm outline-none hover:[&_.text-fg]:underline focus-visible:outline-2 focus-visible:outline-focus">
            {name}
          </Link>
        ) : (
          <div className="min-w-0 flex-1">{name}</div>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <Pill tone={STATUS_TONE[program.status]} dot>
            {PROGRAM_STATUS_LABELS[program.status]}
          </Pill>
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
    <DashSection
      title="Programs today"
      description={<span className="tabular-nums">{summary}</span>}
      action={floorHref ? { label: 'Open Floor today', href: floorHref } : { label: 'All programs', href: routes.programs() }}
      flush
      data-testid="home-programs"
    >
      <div>
        {floor.isPending && date ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton height={148} rounded="md" />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {ordered.map((program) => (
              <ProgramTile key={program.id} program={program} floor={floorByKey.get(program.key)} date={floor.data?.date ?? date} />
            ))}
          </ul>
        )}
      </div>
    </DashSection>
  );
}

