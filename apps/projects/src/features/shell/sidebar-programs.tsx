'use client';
/**
 * Programs in the sidebar (docs/programs/SPEC.md 5.2): the PROGRAMS section (up to 8 running or
 * paused programs, recents first, then by name) with today's progress per row, a hover `+` for
 * Plan builds and a `...` menu, "Show all programs", and the header `+` for New program. Also the
 * starred program rows used by the Starred section.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Check, ChevronDown, ChevronRight, ClipboardPen, Link2, MoreHorizontal, Plus, Star, StarOff, ArrowUpRight } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip, cn, toast } from '@/components/ui';
import { useRecents } from '@/lib/hooks/use-data';
import { usePrograms } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { ProgramListItemDTO } from '@/lib/program-types';
import { starProjectAction } from '@/server/actions/projects';
import { ProgramIcon } from '@/features/programs/kit/chips';
import { logOutputHref, newProgramHref, planBuildsHref, programHref, programsHref } from '@/features/programs/kit/live-pages';
import { useShellStore } from './store';

export const SIDEBAR_PROGRAM_LIMIT = 8;

/** Running or paused programs, the ones visited most recently first, then by name. */
export function sidebarPrograms(programs: readonly ProgramListItemDTO[], recentIds: readonly string[]): ProgramListItemDTO[] {
  const rank = new Map(recentIds.map((id, index) => [id, index]));
  return programs
    .filter((program) => (program.status === 'active' || program.status === 'on_hold') && !program.archivedAt)
    .sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });
}

/** The live programs list shared by the sidebar, palette and home (one cache entry). */
export function useSidebarPrograms() {
  return usePrograms({}, { staleTime: 60_000 });
}

const rowClass = [
  'relative flex h-7 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-sm text-fg outline-none',
  'transition-[background-color] duration-[var(--duration-instant)] ease-out',
  'hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
  'aria-[current=page]:bg-selected aria-[current=page]:font-medium aria-[current=page]:text-primary-text aria-[current=page]:hover:bg-selected-hover',
].join(' ');

const hoverButton = 'inline-flex size-6 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:opacity-100';

/** "5 of 8" in muted tabular text; a check and "8 of 8" in success tone when all are done. */
function TodayProgress({ program }: { readonly program: ProgramListItemDTO }) {
  const { builds, done } = program.today;
  if (builds === 0) return null;
  const all = done >= builds;
  const label = `${done} of ${builds} builds done today`;
  return (
    <Tooltip content={label} side="right">
      <span aria-label={label} className={cn('inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums group-hover/row:hidden group-focus-within/row:hidden', all ? 'font-medium text-success-text' : 'text-fg-muted')} data-testid={`sidebar-program-progress-${program.key}`}>
        {all ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
        {done} of {builds}
      </span>
    </Tooltip>
  );
}

function ProgramRowMenu({ program }: { readonly program: ProgramListItemDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const open = programHref(program.key);
  const log = logOutputHref(program.key, program.today.date);
  const plan = planBuildsHref(program.key);
  const toggleStar = async () => {
    const result = await starProjectAction({ projectId: program.id, starred: !program.starred });
    if (!result.ok) {
      toast.error("Couldn't update the star", result.error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['programs'] });
    void queryClient.invalidateQueries({ queryKey: qk.program(program.key) });
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${routes.program(program.key)}`);
      toast.success('Link copied');
    } catch {
      toast.error("Couldn't copy the link", 'Your browser blocked the clipboard.');
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`More for ${program.name}`} className={cn(hoverButton, 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100')}>
          <MoreHorizontal aria-hidden className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-52">
        {open ? (
          <DropdownMenuItem icon={<ArrowUpRight aria-hidden />} onSelect={() => router.push(open)}>
            Open
          </DropdownMenuItem>
        ) : null}
        {log ? (
          <DropdownMenuItem icon={<ClipboardPen aria-hidden />} onSelect={() => router.push(log)}>
            Log output
          </DropdownMenuItem>
        ) : null}
        {plan ? (
          <DropdownMenuItem icon={<CalendarRange aria-hidden />} onSelect={() => router.push(plan)}>
            Plan builds
          </DropdownMenuItem>
        ) : null}
        {open || log || plan ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem icon={program.starred ? <StarOff aria-hidden /> : <Star aria-hidden />} onSelect={() => void toggleStar()}>
          {program.starred ? 'Unstar' : 'Star'}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => void copyLink()}>
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One 28px program row: icon, name, today's progress; hover shows Plan builds and the menu. Renders nothing until the program page exists. */
export function ProgramRow({ program }: { readonly program: ProgramListItemDTO }) {
  const pathname = usePathname() ?? '/';
  const href = programHref(program.key);
  const plan = planBuildsHref(program.key);
  if (!href) return null;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <div className="group/row relative" data-testid={`sidebar-program-${program.key}`}>
      <Link href={href} aria-current={active ? 'page' : undefined} className={cn(rowClass, 'pr-14')} title={program.name}>
        <ProgramIcon icon={program.icon} color={program.color} size={18} />
        <span className="min-w-0 flex-1 truncate">{program.name}</span>
      </Link>
      <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-0.5 [&>*]:pointer-events-auto">
        <TodayProgress program={program} />
        {plan ? (
          <Tooltip content="Plan builds" side="right">
            <Link href={plan} aria-label={`Plan builds for ${program.name}`} className={cn(hoverButton, 'hidden group-hover/row:inline-flex group-focus-within/row:inline-flex')}>
              <Plus aria-hidden className="size-3.5" />
            </Link>
          </Tooltip>
        ) : null}
        <span className="hidden group-hover/row:inline-flex group-focus-within/row:inline-flex has-[[data-state=open]]:inline-flex">
          <ProgramRowMenu program={program} />
        </span>
      </span>
    </div>
  );
}

function SectionHeading({ children, action, open, onToggle }: { readonly children: React.ReactNode; readonly action?: React.ReactNode; readonly open: boolean; readonly onToggle: () => void }) {
  return (
    <div className="group/heading flex h-7 items-center justify-between pr-1 pl-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1 rounded-xs text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
        {children}
        {open ? <ChevronDown aria-hidden className="size-3 opacity-0 group-hover/heading:opacity-100" /> : <ChevronRight aria-hidden className="size-3" />}
      </button>
      {action}
    </div>
  );
}

/** The PROGRAMS sidebar section. Renders nothing when the org has no running or paused program, or before the program page exists. */
export function SidebarProgramsSection({ canCreate }: { readonly canCreate: boolean }) {
  const programs = useSidebarPrograms();
  const recents = useRecents({ staleTime: 60_000 });
  const open = useShellStore((state) => state.programsOpen);
  const toggle = useShellStore((state) => state.toggleProgramsOpen);
  const recentIds = useMemo(() => (recents.data ?? []).filter((r) => r.entityType === 'project').map((r) => r.entityId), [recents.data]);
  const list = useMemo(() => sidebarPrograms(programs.data ?? [], recentIds), [programs.data, recentIds]);
  const newHref = newProgramHref();
  const allHref = programsHref();
  if (list.length === 0 || !programHref(list[0]!.key)) return null;
  const shown = list.slice(0, SIDEBAR_PROGRAM_LIMIT);
  return (
    <div data-testid="sidebar-programs">
      <SectionHeading
        open={open}
        onToggle={toggle}
        action={
          canCreate && newHref ? (
            <Tooltip content="New program">
              <Link href={newHref} aria-label="New program" className="inline-flex size-6 items-center justify-center rounded-sm text-icon opacity-70 hover:bg-hover hover:opacity-100 focus-visible:outline-2 focus-visible:outline-focus">
                <Plus aria-hidden className="size-3.5" />
              </Link>
            </Tooltip>
          ) : null
        }
      >
        Programs
      </SectionHeading>
      {open ? (
        <ul className="flex flex-col gap-px">
          {shown.map((program) => (
            <li key={program.id}>
              <ProgramRow program={program} />
            </li>
          ))}
          {list.length > shown.length && allHref ? (
            <li>
              <Link href={allHref} className="flex h-7 items-center rounded-sm px-2 text-xs font-medium text-fg-link hover:bg-hover hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                Show all programs
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Starred programs for the Starred section (none until the program page exists). */
export function useStarredPrograms(): ProgramListItemDTO[] {
  const programs = useSidebarPrograms();
  return useMemo(() => (programs.data ?? []).filter((program) => program.starred && !program.archivedAt && programHref(program.key) !== null), [programs.data]);
}

/** Program counts for the primary nav: running programs (badge) and whether Floor today shows. */
export function useProgramNavCounts(): { readonly running: number } {
  const programs = useSidebarPrograms();
  const running = (programs.data ?? []).filter((program) => program.status === 'active' && !program.archivedAt).length;
  return { running };
}
