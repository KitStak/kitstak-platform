'use client';
/**
 * The wall display for a floor TV. One screen at a time, in type big enough to read from across
 * the room: today's units against the goal for each job, pace against the target, the day's
 * totals, what is due this week and who beat their target. Screens rotate on their own and the
 * numbers refresh every minute. Status is always a color plus a word plus a shape, never color
 * alone. No money unless a signed in person with money rights turns it on.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Check, ChevronLeft, ChevronRight, Hourglass, MonitorPlay, Pause, Play, ThumbsUp, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { PulseMark } from '@/features/shell/logo';
import { formatMoneyWhole, formatNumber, formatPace } from '@/lib/format';
import { weekdayName, shortDate } from '@/lib/profit/calendar';
import type { WallBoardDTO, WallJobDTO } from '@/server/domain/wall';
import { WALL_PANEL_LABELS, WALL_STATUS_WORDS, type WallPanel, type WallStatus } from './wall-math';
import { WallRefresh } from './wall-refresh';

const PER_SCREEN = 6;

const STATUS_STYLE: Readonly<Record<WallStatus, { band: string; icon: typeof Check; bar: string }>> = {
  green: { band: 'bg-[#15803d] text-white', icon: Check, bar: 'bg-[#16a34a]' },
  amber: { band: 'bg-[#f59e0b] text-[#1c1917]', icon: TriangleAlert, bar: 'bg-[#f59e0b]' },
  red: { band: 'bg-[#b91c1c] text-white', icon: X, bar: 'bg-[#dc2626]' },
  none: { band: 'bg-muted text-fg-secondary', icon: Hourglass, bar: 'bg-[color:var(--border-default)]' },
};

const WAITING_WORDS: Readonly<Record<WallJobDTO['reason'], string>> = { pace: '', goal: '', nothing_logged: 'Nothing logged yet', no_hours: 'Hours not in yet', no_target: 'No target pace set' };

interface Slide {
  readonly key: string;
  readonly panel: WallPanel;
  readonly title: string;
  readonly jobs?: readonly WallJobDTO[];
  readonly page?: string;
}

const units = (value: number): string => formatNumber(Math.round(value));
/** Unit labels are stored the way a job names them ("kits", "boxes"), so they are shown as they are. */
function unitWord(label: string, count?: number): string {
  void count;
  return label;
}
const percent = (bp: number | null): string => (bp === null ? '' : `${Math.round(bp / 100)}%`);

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

function buildSlides(board: WallBoardDTO, panels: readonly WallPanel[]): Slide[] {
  const logged = board.jobs.filter((job) => job.units > 0 || job.hours > 0);
  const shown = logged.length > 0 ? logged : board.jobs;
  const slides: Slide[] = [];
  for (const panel of panels) {
    if (panel === 'jobs' || panel === 'pace') {
      const list = panel === 'pace' ? shown.filter((job) => job.uph !== null || job.targetUph !== null) : shown;
      const pages = chunk(list, PER_SCREEN);
      pages.forEach((jobs, index) => slides.push({ key: `${panel}-${index}`, panel, title: WALL_PANEL_LABELS[panel], jobs, page: pages.length > 1 ? `${index + 1} of ${pages.length}` : undefined }));
    } else if (panel === 'totals') {
      if (logged.length > 0) slides.push({ key: 'totals', panel, title: WALL_PANEL_LABELS.totals });
    } else if (panel === 'due') {
      if (board.dueThisWeek.length > 0) slides.push({ key: 'due', panel, title: WALL_PANEL_LABELS.due });
    } else if (board.niceWork.length > 0) slides.push({ key: 'nice', panel, title: WALL_PANEL_LABELS.nice });
  }
  return slides;
}

export interface WallScreenProps {
  readonly board: WallBoardDTO;
  readonly panels: readonly WallPanel[];
  readonly rotateSeconds: number;
  /** Extra controls for a signed in person (site, money, TV link). Never rendered on a device link. */
  readonly controls?: ReactNode;
  /** Shown under the heading on a device link: the name the link was given. */
  readonly linkName?: string;
}

export function WallScreen({ board, panels, rotateSeconds, controls, linkName }: WallScreenProps) {
  const slides = useMemo(() => buildSlides(board, panels), [board, panels]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const count = slides.length;
  const current = count > 0 ? slides[index % count] : null;

  const move = useCallback((step: number) => setIndex((value) => (count === 0 ? 0 : (((value + step) % count) + count) % count)), [count]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (paused || count <= 1) return;
    const timer = window.setInterval(() => move(1), rotateSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [paused, count, rotateSeconds, move]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [role="dialog"], [role="menu"], [role="listbox"]') || target.isContentEditable)) return;
      if (event.key === 'ArrowRight') move(1);
      else if (event.key === 'ArrowLeft') move(-1);
      else if (event.key === ' ' && !(target instanceof HTMLButtonElement) && !(target instanceof HTMLAnchorElement)) {
        event.preventDefault();
        setPaused((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  const ageMinutes = now ? Math.max(0, Math.floor((now.getTime() - new Date(board.generatedAt).getTime()) / 60_000)) : 0;
  const stale = ageMinutes >= 3;
  const clock = now ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(now) : '';
  const dayNote = board.date !== board.today ? `Showing ${weekdayName(board.date)}, ${shortDate(board.date)}. Nothing is logged yet today.` : null;

  return (
    <div data-testid="wall" className="flex min-h-dvh flex-col bg-app text-fg">
      <WallRefresh seconds={60} />
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-[clamp(1rem,2.5vw,3rem)] pt-[clamp(0.75rem,1.6vw,2rem)]">
        <span className="flex min-w-0 items-center gap-3">
          <PulseMark size={40} />
          <span className="min-w-0">
            <span className="block truncate text-[clamp(1.1rem,1.7vw,2rem)] leading-tight font-semibold tracking-[-0.01em]">{board.orgName}</span>
            <span className="block truncate text-[clamp(0.85rem,1.1vw,1.25rem)] text-fg-secondary">{linkName ? `${board.siteName} · ${linkName}` : board.siteName}</span>
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[clamp(1.4rem,2.4vw,3rem)] leading-none font-semibold tabular-nums" data-testid="wall-clock" suppressHydrationWarning>
            {clock}
          </span>
          <span className="block text-[clamp(0.85rem,1.1vw,1.25rem)] text-fg-secondary">
            {weekdayName(board.today)}, {shortDate(board.today)}
          </span>
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-[clamp(0.6rem,1vw,1.25rem)] px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.6rem,1vw,1.25rem)]">
        {current ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h1 className="text-[clamp(1.4rem,2.5vw,3.25rem)] leading-tight font-semibold tracking-[-0.02em]" data-testid="wall-title">
                {current.title}
                {current.page ? <span className="ml-3 text-[0.55em] font-medium text-fg-muted">{current.page}</span> : null}
              </h1>
              {dayNote ? (
                <p className="text-[clamp(0.9rem,1.3vw,1.5rem)] text-fg-secondary" data-testid="wall-day-note">
                  {dayNote}
                </p>
              ) : null}
            </div>
            <section key={current.key} aria-label={current.title} className="flex flex-1 flex-col motion-safe:animate-[wall-in_300ms_ease-out]" data-testid={`wall-panel-${current.panel}`}>
              {current.panel === 'jobs' ? <JobTiles jobs={current.jobs ?? []} mode="units" showMoney={board.showMoney} /> : null}
              {current.panel === 'pace' ? <JobTiles jobs={current.jobs ?? []} mode="pace" showMoney={false} /> : null}
              {current.panel === 'totals' ? <Totals board={board} /> : null}
              {current.panel === 'due' ? <DueList board={board} /> : null}
              {current.panel === 'nice' ? <NiceWork board={board} /> : null}
            </section>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center" data-testid="wall-empty">
            <span aria-hidden className="flex size-24 items-center justify-center rounded-3xl bg-primary-subtle text-primary-text">
              <MonitorPlay className="size-12" strokeWidth={1.5} />
            </span>
            <p className="text-[clamp(1.75rem,3.5vw,4rem)] font-semibold tracking-[-0.02em]">No jobs are running today</p>
            <p className="max-w-3xl text-[clamp(1rem,1.6vw,1.75rem)] text-fg-secondary">
              {"When work is logged, this screen shows each job's units against today's goal and the crew's pace against the target. It refreshes on its own every minute."}
            </p>
          </div>
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[clamp(1rem,2.5vw,3rem)] pb-[clamp(0.75rem,1.4vw,1.5rem)] text-sm text-fg-muted">
        <div className="flex items-center gap-1.5">
          {count > 1 ? (
            <>
              <WallButton label="Screen before" onClick={() => move(-1)} testId="wall-prev">
                <ChevronLeft aria-hidden className="size-4" />
              </WallButton>
              <WallButton label={paused ? 'Start rotating again' : 'Stop rotating'} onClick={() => setPaused((value) => !value)} pressed={paused} testId="wall-pause">
                {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
              </WallButton>
              <WallButton label="Next screen" onClick={() => move(1)} testId="wall-next">
                <ChevronRight aria-hidden className="size-4" />
              </WallButton>
              <ol className="ml-2 flex items-center gap-1.5" aria-label="Screens">
                {slides.map((slide, slideIndex) => (
                  <li key={slide.key}>
                    <button
                      type="button"
                      onClick={() => setIndex(slideIndex)}
                      aria-label={`${slide.title}${slide.page ? `, ${slide.page}` : ''}`}
                      aria-current={slideIndex === index % count ? 'true' : undefined}
                      className={cn('block h-2.5 rounded-full transition-[width,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', slideIndex === index % count ? 'w-7 bg-primary' : 'w-2.5 bg-[color:var(--border-default)] hover:bg-fg-muted')}
                    />
                  </li>
                ))}
              </ol>
              <span className="ml-2 hidden sm:inline" aria-live="polite">
                {paused ? 'Paused' : `Changes every ${rotateSeconds} seconds`}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={cn('tabular-nums', stale && 'font-semibold text-[var(--label-orange-text)]')} data-testid="wall-updated" suppressHydrationWarning>
            {stale ? `Last updated ${ageMinutes} minutes ago. Check the connection.` : ageMinutes === 0 ? 'Updated just now' : `Updated ${ageMinutes} ${ageMinutes === 1 ? 'minute' : 'minutes'} ago`}
          </span>
          <span key="controls" className="contents">
            {controls}
          </span>
        </div>
      </footer>
      <style>{'@keyframes wall-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }'}</style>
    </div>
  );
}

function WallButton({ label, onClick, pressed, testId, children }: { readonly label: string; readonly onClick: () => void; readonly pressed?: boolean; readonly testId: string; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-testid={testId}
      className="inline-flex size-8 items-center justify-center rounded-md border border-border-subtle bg-panel text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ panels */

function StatusBand({ status, word }: { readonly status: WallStatus; readonly word: string }) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <div className={cn('flex items-center gap-[0.4em] px-[0.5em] py-[0.28em] text-[clamp(1.5rem,3.3vw,4.5rem)] leading-none font-extrabold tracking-[-0.01em] uppercase', style.band)} data-testid="wall-status" data-status={status}>
      <Icon aria-hidden className="size-[0.9em] shrink-0" strokeWidth={3} />
      {word}
    </div>
  );
}

function JobTiles({ jobs, mode, showMoney }: { readonly jobs: readonly WallJobDTO[]; readonly mode: 'units' | 'pace'; readonly showMoney: boolean }) {
  const columns = jobs.length <= 1 ? 'grid-cols-1' : jobs.length <= 4 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
  return (
    <ul className={cn('grid flex-1 auto-rows-fr gap-[clamp(0.75rem,1.2vw,1.5rem)]', columns)}>
      {jobs.map((job) => {
        const goalShare = job.goal && job.goal > 0 ? Math.min(100, Math.round((job.units / job.goal) * 100)) : null;
        const word = job.status === 'none' ? WAITING_WORDS[job.reason] || WALL_STATUS_WORDS.none : WALL_STATUS_WORDS[job.status];
        return (
          <li key={job.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-panel shadow-xs" data-testid="wall-job" data-job={job.number}>
            <StatusBand status={job.status} word={word} />
            <div className="flex flex-1 flex-col justify-between gap-[clamp(0.4rem,0.6vw,1rem)] px-[clamp(0.75rem,1.2vw,1.5rem)] py-[clamp(0.6rem,0.9vw,1.2rem)]">
              <div className="min-w-0">
                <p className="truncate text-[clamp(1.1rem,1.7vw,2.25rem)] leading-tight font-semibold">
                  <span className="text-fg-muted">{job.number}</span> {job.name}
                </p>
                {job.clientName && jobs.length <= 4 ? <p className="truncate text-[clamp(0.85rem,1.1vw,1.4rem)] text-fg-secondary">{job.clientName}</p> : null}
              </div>
              {mode === 'units' ? (
                <div>
                  <p className="flex flex-wrap items-baseline gap-x-[0.3em] leading-none tabular-nums">
                    <span className="text-[clamp(2.5rem,4.6vw,6.5rem)] font-bold tracking-[-0.03em]" data-testid="wall-units">
                      {units(job.units)}
                    </span>
                    <span className="text-[clamp(1.05rem,1.6vw,2.2rem)] font-medium text-fg-secondary">{job.goal !== null ? `of ${units(job.goal)} ${unitWord(job.unitLabel, job.goal)}` : unitWord(job.unitLabel, job.units)}</span>
                  </p>
                  {goalShare !== null ? (
                    <div className="mt-[0.6em] h-[clamp(0.6rem,0.9vw,1.1rem)] overflow-hidden rounded-full bg-muted" role="img" aria-label={`${goalShare}% of today's goal`}>
                      <div className={cn('h-full rounded-full', STATUS_STYLE[job.status].bar)} style={{ width: `${goalShare}%` }} />
                    </div>
                  ) : null}
                  <p className="mt-[0.4em] text-[clamp(0.8rem,0.95vw,1.2rem)] leading-snug text-fg-muted [@media(max-height:760px)_and_(min-width:768px)]:hidden">
                    {job.goal === null
                      ? 'No goal today: no usual crew, target pace or due date.'
                      : `${goalShare}% of today's goal (${job.goalBasis === 'crew' ? 'usual crew x shift hours x target pace' : 'units left over the work days to the due date'}).`}
                    {showMoney && job.earnedCents !== null ? ` Earned today: ${formatMoneyWhole(job.earnedCents)}.` : ''}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="flex flex-wrap items-baseline gap-x-[0.3em] leading-none tabular-nums">
                    <span className="text-[clamp(2.5rem,4.6vw,6.5rem)] font-bold tracking-[-0.03em]" data-testid="wall-pace">
                      {job.uph === null ? 'No pace' : formatPace(job.uph)}
                    </span>
                    {job.targetUph !== null ? <span className="text-[clamp(1.05rem,1.6vw,2.2rem)] font-medium text-fg-secondary">target {formatPace(job.targetUph)}</span> : null}
                  </p>
                  <p className="mt-[0.4em] text-[clamp(0.8rem,0.95vw,1.2rem)] leading-snug text-fg-muted [@media(max-height:760px)_and_(min-width:768px)]:hidden">
                    {job.uph === null
                      ? 'Pace shows once hours are logged.'
                      : `${unitWord(job.unitLabel, 2)} per person per hour${job.reason === 'pace' && job.scoreBp !== null ? `, ${percent(job.scoreBp)} of target` : ''}. ${units(job.units)} ${unitWord(job.unitLabel, job.units)} in ${formatNumber(job.hours, { maxDigits: 1 })} labor hours.`}
                  </p>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function BigStat({ label, value, sub, testId }: { readonly label: string; readonly value: string; readonly sub?: string; readonly testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center rounded-2xl border border-border-subtle bg-panel p-[clamp(1rem,1.6vw,2rem)] shadow-xs">
      <p className="text-[clamp(1rem,1.5vw,2rem)] font-medium text-fg-secondary">{label}</p>
      <p className="text-[clamp(2.75rem,6vw,8rem)] leading-none font-bold tracking-[-0.03em] tabular-nums" data-testid={testId}>
        {value}
      </p>
      {sub ? <p className="mt-[0.6em] text-[clamp(0.9rem,1.2vw,1.5rem)] leading-snug text-fg-muted">{sub}</p> : null}
    </div>
  );
}

function Totals({ board }: { readonly board: WallBoardDTO }) {
  const { totals } = board;
  const share = totals.goal && totals.goal > 0 ? Math.round((totals.units / totals.goal) * 100) : null;
  const calls: readonly { status: WallStatus; count: number }[] = [
    { status: 'green', count: totals.green },
    { status: 'amber', count: totals.amber },
    { status: 'red', count: totals.red },
  ];
  return (
    <div className="grid flex-1 gap-[clamp(0.75rem,1.2vw,1.5rem)] md:grid-cols-2 xl:grid-cols-3">
      <BigStat label="Units done" value={units(totals.units)} sub={totals.goal !== null ? `${share}% of the goal of ${units(totals.goal)}, for the jobs that have a goal` : 'No job has a goal for today'} testId="wall-total-units" />
      <BigStat label="People on jobs" value={formatNumber(totals.people, { maxDigits: 1 })} sub={`${formatNumber(totals.hours, { maxDigits: 1 })} labor hours logged`} />
      <BigStat label="Jobs with work logged" value={String(totals.jobsLogged)} sub={`out of ${totals.jobsActive} active ${totals.jobsActive === 1 ? 'job' : 'jobs'}`} />
      {board.showMoney && totals.earnedCents !== null ? <BigStat label="Earned" value={formatMoneyWhole(totals.earnedCents)} sub="Revenue from the units and extra services logged that day" testId="wall-earned" /> : null}
      <ul className={cn('grid gap-[clamp(0.75rem,1.2vw,1.5rem)] sm:grid-cols-3 md:col-span-2', board.showMoney ? 'xl:col-span-2' : 'xl:col-span-3')} aria-label="Jobs by status">
        {calls.map((call) => {
          const style = STATUS_STYLE[call.status];
          const Icon = style.icon;
          return (
            <li key={call.status} className={cn('flex items-center justify-between gap-4 rounded-2xl px-[clamp(1rem,1.6vw,2rem)] py-[clamp(0.75rem,1.2vw,1.5rem)]', style.band)}>
              <span className="flex items-center gap-[0.4em] text-[clamp(1.2rem,2vw,2.75rem)] leading-none font-bold uppercase">
                <Icon aria-hidden className="size-[0.9em]" strokeWidth={3} />
                {WALL_STATUS_WORDS[call.status]}
              </span>
              <span className="text-[clamp(2rem,4vw,5.5rem)] leading-none font-bold tabular-nums">{call.count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DueList({ board }: { readonly board: WallBoardDTO }) {
  return (
    <ul className="flex flex-1 flex-col gap-[clamp(0.5rem,0.9vw,1.1rem)]">
      {board.dueThisWeek.map((job) => {
        const share = job.plannedUnits > 0 ? Math.min(100, Math.round((job.unitsDone / job.plannedUnits) * 100)) : null;
        return (
          <li key={job.id} className="flex flex-wrap items-center gap-x-[clamp(1rem,2vw,2.5rem)] gap-y-2 rounded-2xl border border-border-subtle bg-panel px-[clamp(1rem,1.6vw,2rem)] py-[clamp(0.6rem,1vw,1.25rem)] shadow-xs" data-testid="wall-due">
            <span className="flex w-[9ch] shrink-0 items-center gap-[0.35em] text-[clamp(1.1rem,1.8vw,2.4rem)] font-bold">
              <CalendarClock aria-hidden className="size-[0.9em] text-icon" />
              {job.dueDate === board.today ? 'Today' : weekdayName(job.dueDate).slice(0, 3)}
            </span>
            <span className="min-w-0 flex-1 basis-[240px]">
              <span className="block truncate text-[clamp(1.1rem,1.8vw,2.4rem)] leading-tight font-semibold">
                <span className="text-fg-muted">{job.number}</span> {job.name}
              </span>
              {job.clientName ? <span className="block truncate text-[clamp(0.85rem,1.1vw,1.4rem)] text-fg-secondary">{job.clientName}</span> : null}
            </span>
            <span className="text-right text-[clamp(1.1rem,1.8vw,2.4rem)] leading-tight font-semibold tabular-nums">
              {units(job.unitsDone)}
              {job.plannedUnits > 0 ? <span className="font-medium text-fg-secondary"> of {units(job.plannedUnits)}</span> : null}
              <span className="block text-[0.6em] font-normal text-fg-muted">{share !== null ? `${share}% done` : unitWord(job.unitLabel, job.unitsDone)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function NiceWork({ board }: { readonly board: WallBoardDTO }) {
  return (
    <ul className="flex flex-1 flex-col gap-[clamp(0.5rem,0.9vw,1.1rem)]">
      {board.niceWork.map((job) => (
        <li key={job.id} className="flex flex-wrap items-center gap-x-[clamp(1rem,2vw,2.5rem)] gap-y-2 rounded-2xl border border-border-subtle bg-panel px-[clamp(1rem,1.6vw,2rem)] py-[clamp(0.6rem,1vw,1.25rem)] shadow-xs" data-testid="wall-nice">
          <span aria-hidden className="flex size-[clamp(2.5rem,4vw,5rem)] shrink-0 items-center justify-center rounded-full bg-[#15803d] text-white">
            <ThumbsUp className="size-1/2" />
          </span>
          <span className="min-w-0 flex-1 basis-[240px] truncate text-[clamp(1.1rem,1.8vw,2.4rem)] font-semibold">
            <span className="text-fg-muted">{job.number}</span> {job.name}
          </span>
          <span className="text-right text-[clamp(1.1rem,1.8vw,2.4rem)] leading-tight font-bold tabular-nums">
            {percent(job.scoreBp)} of target
            <span className="block text-[0.6em] font-normal text-fg-muted">
              {formatPace(job.uph)} an hour per person, target {formatPace(job.targetUph)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
