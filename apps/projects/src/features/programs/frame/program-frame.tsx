'use client';
/**
 * Program workspace frame (docs/programs/SPEC.md 5.5): the header (icon, name, star, status pill,
 * health with its basis), the meta line (key · customer · unit · schedule · card version · lock),
 * the KPI pair (This month, Today), people, Plan builds (Shift B), Log output (O), the program
 * menu, the tab strip, and the range bar on Builds pages. The full build page is a focused
 * document with no header, like the full task page.
 */
import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ClipboardPen, Star, UserRound, Building2 } from 'lucide-react';
import { formatCents, shortDate, unitLabel } from '@kitstak/programs-engine';
import { AvatarGroup, Button, IconButton, Kbd, Tooltip, cn, toast } from '@/components/ui';
import { useHotkey } from '@/lib/hooks/use-hotkeys';
import { qk } from '@/lib/query-keys';
import { BUILD_VIEWS, routes } from '@/lib/routes';
import type { BuildView, ProgramDetailDTO, ProgramTab } from '@/lib/program-types';
import { starProjectAction } from '@/server/actions/projects';
import { useShellStore } from '@/features/shell/store';
import { useCurrentProgram } from '../program-context';
import { HealthWithBasis, LockBadge, ProgramIcon, ProgramStatusPill } from '../kit/chips';
import { doneOfText } from '../kit/format';
import { newBuildLive } from '../kit/live-pages';
import { ProgramMenu } from './program-menu';
import { ProgramTabs, programTabFor } from './program-tabs';
import { RangeBar } from './range-bar';

/** localStorage key for the last builds view (docs/programs/SPEC.md 5.1). */
export const buildsViewStorageKey = (key: string) => `ks-programs:builds-view:${key}`;

function readBuildsView(key: string): BuildView | null {
  try {
    const value = window.localStorage.getItem(buildsViewStorageKey(key));
    return value && (BUILD_VIEWS as readonly string[]).includes(value) ? (value as BuildView) : null;
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => undefined;

function buildsViewFor(pathname: string, key: string): BuildView | null {
  const match = new RegExp(`^/programs/${key}/builds/([a-z]+)`).exec(pathname);
  const view = match?.[1];
  return view && (BUILD_VIEWS as readonly string[]).includes(view) ? (view as BuildView) : null;
}

/** "Card v2 since Nov 1", "Card v3 starts Dec 1", or "No price card yet". */
export function cardText(program: Pick<ProgramDetailDTO, 'currentVersion' | 'nextVersion' | 'setup' | 'moneyHidden'>): string | null {
  const current = program.currentVersion;
  if (current?.number) return `Card v${current.number} since ${shortDate(current.effectiveFrom)}`;
  const next = program.nextVersion;
  if (next?.number) return `Card v${next.number} starts ${shortDate(next.effectiveFrom)}`;
  return program.setup.hasPriceCard ? null : 'No price card yet';
}

function MetaDot() {
  return (
    <span aria-hidden className="text-fg-muted">
      ·
    </span>
  );
}

/** The meta line: `GLOVE` · customer · kits · Every weekday · Card v2 since Nov 1 · lock. */
function MetaLine({ program, className }: { readonly program: ProgramDetailDTO; readonly className?: string }) {
  const card = cardText(program);
  const closedBy = [...(program.locks.programClosed.length ? (['program'] as const) : []), ...(program.locks.pulseClosed.length ? (['pulse'] as const) : [])];
  return (
    <p className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted', className)} data-testid="program-meta">
      <span className="font-key text-fg-secondary">{program.key}</span>
      {program.customer ? (
        <>
          <MetaDot />
          <span className="inline-flex min-w-0 items-center gap-1 text-fg-secondary" title={program.customer.kind === 'crm_account' ? 'CRM account' : 'Customer'}>
            {program.customer.kind === 'crm_account' ? <Building2 aria-hidden className="size-3.5 shrink-0" /> : <UserRound aria-hidden className="size-3.5 shrink-0" />}
            <span className="truncate">{program.customer.name}</span>
          </span>
        </>
      ) : null}
      <MetaDot />
      <span>{program.unit.plural}</span>
      {program.scheduleText ? (
        <>
          <MetaDot />
          <span>{program.scheduleText}</span>
        </>
      ) : null}
      {card ? (
        <>
          <MetaDot />
          {program.moneyHidden ? <span>{card}</span> : (
            <Link href={routes.programTab(program.key, 'price-card')} className="rounded-xs hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              {card}
            </Link>
          )}
        </>
      ) : null}
      {program.locks.lockedThrough ? (
        <>
          <MetaDot />
          <LockBadge lockedThrough={program.locks.lockedThrough} closedBy={closedBy.length ? closedBy : ['program']} />
        </>
      ) : null}
    </p>
  );
}

/** The compact KPI pair at the header right (md and up; under the title on phones). */
function KpiPair({ program, className }: { readonly program: ProgramDetailDTO; readonly className?: string }) {
  const money = !program.moneyHidden && program.month.revenueCents !== null;
  const today = program.today;
  const allDone = today.builds > 0 && today.done >= today.builds;
  return (
    <div className={cn('flex items-stretch gap-0 divide-x divide-border-subtle', className)} data-testid="program-kpis">
      <Link href={`${routes.program(program.key)}#month`} className="group flex flex-col justify-center rounded-l-md px-3 py-0.5 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
        <span className="text-2xs font-medium text-fg-muted">This month</span>
        <span className="text-sm font-semibold text-fg tabular-nums" data-testid="program-kpi-month">
          {money ? formatCents(program.month.revenueCents, { cents: true }) : unitLabel(program.month.units, program.unit)}
        </span>
      </Link>
      <Link href={`${routes.program(program.key)}#today`} className="group flex flex-col justify-center rounded-r-md px-3 py-0.5 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
        <span className="text-2xs font-medium text-fg-muted">Today</span>
        <span className={cn('text-sm font-semibold tabular-nums', allDone ? 'text-success-text' : 'text-fg')} data-testid="program-kpi-today">
          {today.builds === 0 ? 'No builds' : doneOfText(today.done, today.builds).replace(' done', '')}
        </span>
      </Link>
    </div>
  );
}

export function ProgramFrame({ children }: { readonly children: React.ReactNode }) {
  const { program, capabilities, today } = useCurrentProgram();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const tab = programTabFor(pathname, program.key);
  const buildPage = new RegExp(`^/programs/${program.key}/\\d+(?:[/?#]|$)`).test(pathname);
  const view = buildsViewFor(pathname, program.key);
  // Remember the last builds view, and point the Builds tab at it (no redirect hop).
  useEffect(() => {
    if (!view) return;
    try {
      window.localStorage.setItem(buildsViewStorageKey(program.key), view);
    } catch {
      // Private windows can refuse storage; the tab then opens the default view.
    }
  }, [view, program.key]);
  const storedView = useSyncExternalStore(
    noopSubscribe,
    () => readBuildsView(program.key),
    () => null,
  );
  const lastView = view ?? storedView;
  const buildsHref = lastView ? routes.programBuilds(program.key, lastView) : undefined;

  const withParam = (name: string, value: string) => {
    const search = new URLSearchParams(params?.toString() ?? '');
    search.set(name, value);
    return `${pathname}?${search.toString()}`;
  };
  const openLog = () => router.push(withParam('log', today), { scroll: false });
  const openPlanner = () => router.push(withParam('plan', 'week'), { scroll: false });

  useHotkey('o', openLog, { enabled: capabilities.canLog && !buildPage });
  useHotkey('shift+b', openPlanner, { enabled: capabilities.canPlan && !buildPage });
  useHotkey('b', () => openQuickAdd({ projectId: program.id, mode: 'build' }), { enabled: capabilities.canPlan && !buildPage && newBuildLive() });

  const toggleStar = async () => {
    const result = await starProjectAction({ projectId: program.id, starred: !program.starred });
    if (!result.ok) {
      toast.error("Couldn't update the star", result.error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: qk.program(program.key) });
    void queryClient.invalidateQueries({ queryKey: ['programs'] });
    void queryClient.invalidateQueries({ queryKey: qk.projects() });
  };

  const tabs: ProgramTab[] = ['overview', 'builds', 'variants', 'price-card', 'schedule', 'linked', 'activity', ...(capabilities.canEdit ? (['settings'] as const) : [])];
  const priceDot = !program.moneyHidden && (program.pendingRateChanges || program.draftsCount > 0)
    ? program.pendingRateChanges
      ? `${program.pendingRateChanges.count} rate ${program.pendingRateChanges.count === 1 ? 'change waits' : 'changes wait'} for review`
      : `${program.draftsCount} price ${program.draftsCount === 1 ? 'draft waits' : 'drafts wait'} for review`
    : undefined;

  if (buildPage) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="program-frame" data-focus="build">
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="program-frame">
      <header className="shrink-0 border-b border-border-subtle bg-panel">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 sm:px-6 sm:pt-4">
          <span className="max-sm:hidden">
            <ProgramIcon icon={program.icon} color={program.color} size={32} />
          </span>
          <div className="min-w-0 flex-1 basis-[calc(100%-56px)] max-sm:basis-full sm:basis-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="min-w-0 truncate text-xl font-semibold tracking-[-0.01em] text-fg max-sm:text-lg max-sm:leading-snug" title={program.name} data-testid="program-title">
                {program.name}
              </h1>
              <IconButton
                label={program.starred ? 'Remove star' : 'Star this program'}
                icon={<Star aria-hidden className={cn(program.starred && 'fill-warning text-warning')} />}
                size="sm"
                onClick={() => void toggleStar()}
                data-testid="program-star"
              />
              <ProgramStatusPill status={program.status} className="shrink-0" />
              <span className="max-sm:hidden">
                <HealthWithBasis health={program.health} basis={program.healthBasis} auto={program.healthAuto} />
              </span>
            </div>
            <MetaLine program={program} className="mt-0.5" />
          </div>
          {/* Phones: the KPI pair sits under the title, full width. */}
          <KpiPair program={program} className="w-full justify-start rounded-md border border-border-subtle md:hidden [&>a]:flex-1" />
          <div className="flex items-center gap-2 max-md:w-full">
            <KpiPair program={program} className="hidden md:flex" />
            <AvatarGroup className="hidden -space-x-1 lg:flex" people={program.members.map((m) => ({ id: m.userId, name: m.person.name, src: m.person.image }))} max={4} size="md" />
            {capabilities.canPlan ? (
              <Tooltip content={<span className="flex items-center gap-1.5">Plan builds <Kbd>Shift</Kbd><Kbd>B</Kbd></span>}>
                <Button variant="secondary" size="sm" leadingIcon={<CalendarRange aria-hidden />} onClick={openPlanner} aria-keyshortcuts="Shift+B" className="max-md:flex-1" data-testid="program-plan">
                  Plan builds
                </Button>
              </Tooltip>
            ) : null}
            {capabilities.canLog ? (
              <Tooltip content={<span className="flex items-center gap-1.5">Log output for today <Kbd>O</Kbd></span>}>
                <Button size="sm" leadingIcon={<ClipboardPen aria-hidden />} onClick={openLog} aria-keyshortcuts="O" className="max-md:flex-1" data-testid="program-log">
                  Log output
                </Button>
              </Tooltip>
            ) : null}
            <ProgramMenu program={program} className="size-8" />
          </div>
        </div>
        <ProgramTabs programKey={program.key} tabs={tabs} active={tab} dots={priceDot ? { 'price-card': priceDot } : {}} buildsHref={buildsHref} />
        {tab === 'builds' ? <RangeBar view={view} /> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
