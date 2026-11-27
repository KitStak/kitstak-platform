'use client';
/**
 * Program commands in the palette (docs/programs/SPEC.md 5.2): the Create items (New program,
 * New build, Log output, Plan builds, Floor today), the "In {program}" group on /programs/KEY,
 * the Programs list with today's progress, remote program hits, and the program picker that
 * Log output and Plan builds open first.
 */
import { Command } from 'cmdk';
import { ArrowLeft, Boxes, CalendarCheck2, CalendarRange, ClipboardPen, Copy, Factory, FileUp, Plus, Receipt, Repeat2, Shapes } from 'lucide-react';
import { monthOf, shiftMonth } from '@kitstak/programs-engine';
import { Kbd } from '@/components/ui';
import { BUILD_VIEWS, routes } from '@/lib/routes';
import type { BuildView, ProgramDetailDTO, ProgramListItemDTO, ProgramTab } from '@/lib/program-types';
import type { ProgramSearchHit } from '@/lib/types';
import { ProgramIcon } from '@/features/programs/kit/chips';
import { PROGRAM_TAB_META } from '@/features/programs/frame/program-tabs';
import { floorTodayHref, logOutputHref, newBuildLive, newProgramHref, planBuildsHref, programBuildsHref, programHref, programPageLive } from '@/features/programs/kit/live-pages';
import { Item, REMOTE, groupClass } from './palette-item';

export type ProgramPick = 'log' | 'plan';

const VIEW_LABEL: Readonly<Record<BuildView, string>> = { runs: 'Runs', board: 'Board', list: 'List', table: 'Table', calendar: 'Calendar', timeline: 'Timeline' };

/** The program key in `/programs/KEY/...`, or null (Programs, New program and Floor today are not programs). */
export function programKeyFromPath(pathname: string): string | null {
  const match = /^\/programs\/([^/?#]+)/.exec(pathname);
  const key = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!key || key === 'new' || key === 'today') return null;
  return key.toUpperCase();
}

/** "5 of 8 builds today", or "No builds today". */
export function todayText(program: Pick<ProgramListItemDTO, 'today'>): string {
  const { builds, done } = program.today;
  return builds === 0 ? 'No builds today' : `${done} of ${builds} ${builds === 1 ? 'build' : 'builds'} today`;
}

/**
 * Where a program row goes: its workspace, or (while the workspace page has not landed, see
 * kit/live-pages.ts) the Programs tab of search, which lists it with its customer and today.
 */
export function programRowHref(key: string): string {
  return programHref(key) ?? routes.search(key, 'programs');
}

/** "GLOVE · Bluestone Foods · 5 of 8 builds today". */
export function programMeta(program: Pick<ProgramListItemDTO, 'key' | 'customer' | 'today'>): string {
  return [program.key, program.customer?.name, todayText(program)].filter(Boolean).join(' · ');
}

/** Where a pick goes, or null while the log dialog and planner have not landed (kit/live-pages.ts). */
export function pickHref(pick: ProgramPick, program: Pick<ProgramListItemDTO, 'key' | 'today'>): string | null {
  return pick === 'log' ? logOutputHref(program.key, program.today.date) : planBuildsHref(program.key);
}

/** Whether the program picker can lead anywhere (both picks need the program page and its overlays). */
export function programPicksLive(): boolean {
  return programPageLive('workspace') && programPageLive('overlays');
}

/** Whether ProgramCreateItems would show anything. */
export function programCreateLive(canCreate: boolean, hasPrograms: boolean): boolean {
  return (canCreate && newProgramHref() !== null) || (hasPrograms && (newBuildLive() || programPicksLive() || floorTodayHref() !== null));
}

export function ProgramCreateItems({ canCreate, hasPrograms, go, onNewBuild, onPick }: { readonly canCreate: boolean; readonly hasPrograms: boolean; readonly go: (href: string) => void; readonly onNewBuild: () => void; readonly onPick: (pick: ProgramPick) => void }) {
  // Each entry shows only once the page or form it opens exists (kit/live-pages.ts).
  const newProgram = canCreate ? newProgramHref() : null;
  const floor = floorTodayHref();
  const picks = programPicksLive();
  return (
    <>
      {newProgram ? (
        <Item value="new-program" keywords={['create', 'program', 'recurring', 'kitting', 'repeat']} onSelect={() => go(newProgram)} icon={<Repeat2 aria-hidden className="size-4" />} meta="Repeat kitting for one customer">
          New program
        </Item>
      ) : null}
      {hasPrograms ? (
        <>
          {newBuildLive() ? (
            <Item value="new-build" keywords={['create', 'build', 'batch', 'kit']} onSelect={onNewBuild} icon={<Boxes aria-hidden className="size-4" />} meta="A batch of one kit for one day">
              New build
            </Item>
          ) : null}
          {picks ? (
            <>
              <Item value="log-output" keywords={['log', 'output', 'built', 'count', 'program']} onSelect={() => onPick('log')} icon={<ClipboardPen aria-hidden className="size-4" />} meta="Pick a program, then log today's output">
                Log output
              </Item>
              <Item value="plan-builds" keywords={['plan', 'builds', 'planner', 'week']} onSelect={() => onPick('plan')} icon={<CalendarRange aria-hidden className="size-4" />} meta="Pick a program, then open the planner">
                Plan builds
              </Item>
            </>
          ) : null}
          {floor ? (
            <Item value="floor-today" keywords={['floor', 'today', 'runs', 'production']} onSelect={() => go(floor)} icon={<Factory aria-hidden className="size-4" />} meta="Every run on the floor today">
              Floor today
            </Item>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** "In {program}" on /programs/KEY: tabs, each builds view, and program actions. */
export function ProgramWorkspaceGroup({ program, typing, go, onNewBuild }: { readonly program: ProgramDetailDTO; readonly typing: boolean; readonly go: (href: string) => void; readonly onNewBuild: () => void }) {
  const caps = program.capabilities;
  const tabs: ProgramTab[] = ['overview', 'builds', 'variants', 'price-card', 'schedule', 'linked', 'activity', ...(caps.canEdit ? (['settings'] as const) : [])];
  const icon = <ProgramIcon icon={program.icon} color={program.color} size={20} />;
  const today = program.calendar.today;
  const thisMonth = monthOf(today);
  const lastMonth = shiftMonth(thisMonth, -1);
  const base = routes.program(program.key);
  const log = logOutputHref(program.key, today);
  const plan = planBuildsHref(program.key);
  const copy = newProgramHref({ mode: 'copy', copy: program.key });
  const buildsLive = programBuildsHref(program.key) !== null;
  return (
    <Command.Group heading={`In ${program.name}`} className={groupClass} data-testid="palette-program-group">
      {tabs
        .filter((tab) => tab !== 'builds')
        .map((tab) => (
          <Item key={tab} value={`program-tab-${tab}`} keywords={[PROGRAM_TAB_META[tab].label, 'tab', program.key]} onSelect={() => go(routes.programTab(program.key, tab))} icon={icon}>
            {PROGRAM_TAB_META[tab].label}
          </Item>
        ))}
      {(buildsLive ? BUILD_VIEWS : []).map((view) => (
        <Item key={view} value={`program-builds-${view}`} keywords={['builds', VIEW_LABEL[view], 'view', program.key]} onSelect={() => go(routes.programBuilds(program.key, view))} icon={<Boxes aria-hidden className="size-4" />}>
          Builds: {VIEW_LABEL[view]}
        </Item>
      ))}
      {caps.canLog && log ? (
        <Item value="program-log" keywords={['log', 'output', 'today']} onSelect={() => go(log)} icon={<ClipboardPen aria-hidden className="size-4" />} hint={<Kbd>O</Kbd>}>
          Log output
        </Item>
      ) : null}
      {caps.canPlan && plan ? (
        <Item value="program-plan" keywords={['plan', 'builds', 'planner']} onSelect={() => go(plan)} icon={<CalendarRange aria-hidden className="size-4" />} hint={<><Kbd>Shift</Kbd><Kbd>B</Kbd></>}>
          Plan builds
        </Item>
      ) : null}
      {caps.canPlan && newBuildLive() ? (
        <Item value="program-new-build" keywords={['new', 'build', 'add']} onSelect={onNewBuild} icon={<Plus aria-hidden className="size-4" />} hint={<Kbd>B</Kbd>}>
          New build
        </Item>
      ) : null}
      {typing && caps.canEdit ? (
        <Item value="program-add-variants" keywords={['add', 'variants', 'kits', 'sku']} onSelect={() => go(`${routes.programTab(program.key, 'variants')}?add=1`)} icon={<Shapes aria-hidden className="size-4" />}>
          Add variants
        </Item>
      ) : null}
      {typing && caps.canPropose && !program.moneyHidden ? (
        <Item value="program-new-version" keywords={['new', 'price', 'version', 'card', 'rates']} onSelect={() => go(`${routes.programTab(program.key, 'price-card')}?new=1`)} icon={<Receipt aria-hidden className="size-4" />}>
          New price version
        </Item>
      ) : null}
      {typing && !program.moneyHidden ? (
        <Item value="program-statement" keywords={['statement', 'invoice', 'month', 'bill']} onSelect={() => go(`${base}?statement=${thisMonth}`)} icon={<Receipt aria-hidden className="size-4" />}>
          This month&apos;s statement
        </Item>
      ) : null}
      {typing && caps.canClose && !program.locks.programClosed.includes(lastMonth) ? (
        <Item value="program-close" keywords={['close', 'month', 'lock', 'last month']} onSelect={() => go(`${base}?close=${lastMonth}`)} icon={<CalendarCheck2 aria-hidden className="size-4" />}>
          Close last month
        </Item>
      ) : null}
      {typing && caps.canLog && log ? (
        <Item value="program-import" keywords={['import', 'output', 'csv', 'paste']} onSelect={() => go(`${base}?import=output`)} icon={<FileUp aria-hidden className="size-4" />}>
          Import output
        </Item>
      ) : null}
      {typing && copy ? (
        <Item value="program-copy" keywords={['copy', 'duplicate', 'program']} onSelect={() => go(copy)} icon={<Copy aria-hidden className="size-4" />}>
          Copy program
        </Item>
      ) : null}
    </Command.Group>
  );
}

/** Programs with key chips and today's progress ("5 of 8 builds today"). */
export function ProgramsGroup({ programs, typing, go }: { readonly programs: readonly ProgramListItemDTO[]; readonly typing: boolean; readonly go: (href: string) => void }) {
  const shown = typing ? programs : programs.slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <Command.Group heading={typing ? 'Programs' : 'Jump to a program'} className={groupClass}>
      {shown.map((program) => (
        <Item
          key={program.id}
          value={`program-${program.key}`}
          keywords={[program.name, program.key, program.customer?.name ?? '', 'program']}
          onSelect={() => go(programRowHref(program.key))}
          icon={<ProgramIcon icon={program.icon} color={program.color} size={22} />}
          meta={programMeta(program)}
          hint={programHref(program.key) ? undefined : <span className="text-2xs">Show in search</span>}
          testId="palette-program"
        >
          {program.name}
        </Item>
      ))}
    </Command.Group>
  );
}

/** Remote program hits (search by name or key), shown with the server results. */
export function RemoteProgramsGroup({ hits, known, go }: { readonly hits: readonly ProgramSearchHit[]; readonly known: ReadonlySet<string>; readonly go: (href: string) => void }) {
  const fresh = hits.filter((hit) => !known.has(hit.key));
  if (fresh.length === 0) return null;
  return (
    <Command.Group heading="Programs" className={groupClass} forceMount>
      {fresh.map((hit) => (
        <Item key={hit.id} value={`${REMOTE}program-${hit.id}`} forceMount onSelect={() => go(programRowHref(hit.key))} icon={<ProgramIcon icon={hit.icon} color={hit.color} size={22} />} meta={hit.key} hint={programHref(hit.key) ? undefined : <span className="text-2xs">Show in search</span>}>
          {hit.name}
        </Item>
      ))}
    </Command.Group>
  );
}

/** The program picker for Log output and Plan builds. */
export function ProgramPickerGroup({ pick, programs, go, onBack }: { readonly pick: ProgramPick; readonly programs: readonly ProgramListItemDTO[]; readonly go: (href: string) => void; readonly onBack: () => void }) {
  const running = programs.filter((program) => program.status === 'active' || program.status === 'on_hold');
  return (
    <Command.Group heading={pick === 'log' ? 'Log output for which program?' : 'Plan builds for which program?'} className={groupClass} data-testid="palette-program-picker">
      {running.map((program) => (
        <Item
          key={program.id}
          value={`pick-${program.key}`}
          keywords={[program.name, program.key]}
          onSelect={() => {
            const href = pickHref(pick, program);
            if (href) go(href);
          }}
          icon={<ProgramIcon icon={program.icon} color={program.color} size={22} />}
          meta={`${program.key} · ${todayText(program)}`}
          testId="palette-program-pick"
        >
          {program.name}
        </Item>
      ))}
      {running.length === 0 ? <p className="px-6 py-4 text-sm text-fg-muted">No running programs. Start one from New program.</p> : null}
      <Item value="pick-back" keywords={['back']} onSelect={onBack} icon={<ArrowLeft aria-hidden className="size-4" />} hint={<Kbd>Backspace</Kbd>}>
        Back to all commands
      </Item>
    </Command.Group>
  );
}
