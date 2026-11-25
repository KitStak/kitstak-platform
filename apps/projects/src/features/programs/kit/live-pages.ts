/**
 * Which program pages exist in this build (docs/programs/SPEC.md 10.2). The program UI ships in
 * layers: the shell, home, palette and search (L3) land before the pages they link to (L4a, L4b,
 * L4c). Every program link in the shared UI asks here first, so nothing links to a page that would
 * show "We couldn't find that", and no create entry opens the wrong form.
 *
 * `live-pages.test.ts` fails when a flag says true and its page is missing. A page that lands while
 * its flag is still false keeps the suite green; the orchestrator flips the flag when it merges
 * the layer that owns the page.
 */
import { routes } from '@/lib/routes';
import type { BuildView, IsoDate } from '@/lib/program-types';

export type ProgramPage = 'workspace' | 'builds' | 'buildPage' | 'directory' | 'newProgram' | 'floor' | 'overlays' | 'buildQuickAdd';

/** Typed as plain booleans so code behind a false flag still type checks. */
export const PROGRAM_PAGES: Readonly<Record<ProgramPage, boolean>> = {
  /** `app/(app)/programs/[key]/page.tsx`, the Overview tab (L4c). Gates every link to a program. */
  workspace: false,
  /** `app/(app)/programs/[key]/builds/**` (L4b). */
  builds: false,
  /** `app/(app)/programs/[key]/[number]/page.tsx`, the full build page (L4b). */
  buildPage: false,
  /** `app/(app)/programs/page.tsx`, the directory (L4a). Gates `G R` and "Programs" in the nav. */
  directory: false,
  /** `app/(app)/programs/new/page.tsx`, the wizard (L4a). Gates every "New program". */
  newProgram: false,
  /** `app/(app)/programs/today/page.tsx`, Floor today (L4b). Gates `G F` and "Floor today". */
  floor: false,
  /** `ProgramOverlaysHost` mounted in `features/shell/app-shell.tsx` (L4b): `?log` and `?plan`. */
  overlays: false,
  /** Quick add reads `mode: 'build'` (L4b `features/quick-add`). Gates every "New build". */
  buildQuickAdd: false,
};

export function programPageLive(page: ProgramPage): boolean {
  return PROGRAM_PAGES[page];
}

/** `/programs/KEY`, or null while the workspace page has not landed. */
export function programHref(key: string): string | null {
  return PROGRAM_PAGES.workspace ? routes.program(key) : null;
}

/** `/programs/KEY/builds/VIEW`, or null. */
export function programBuildsHref(key: string, view?: BuildView): string | null {
  return PROGRAM_PAGES.workspace && PROGRAM_PAGES.builds ? routes.programBuilds(key, view) : null;
}

/** `/programs/KEY?log=DATE` (the log dialog over the program), or null. */
export function logOutputHref(key: string, date: IsoDate): string | null {
  return PROGRAM_PAGES.workspace && PROGRAM_PAGES.overlays ? `${routes.program(key)}?log=${date}` : null;
}

/** `/programs/KEY?plan=week` (the planner over the program), or null. */
export function planBuildsHref(key: string): string | null {
  return PROGRAM_PAGES.workspace && PROGRAM_PAGES.overlays ? `${routes.program(key)}?plan=week` : null;
}

/** `/programs`, or null. */
export function programsHref(): string | null {
  return PROGRAM_PAGES.directory ? routes.programs() : null;
}

/** `/programs/new`, or null. */
export function newProgramHref(options?: Parameters<typeof routes.newProgram>[0]): string | null {
  return PROGRAM_PAGES.newProgram ? routes.newProgram(options) : null;
}

/** `/programs/today`, or null. */
export function floorTodayHref(date?: IsoDate): string | null {
  return PROGRAM_PAGES.floor ? routes.programsToday(date) : null;
}

/** A task or build page by the container kind (`routes.taskAny`), or null for a build page that has not landed. */
export function taskAnyHref(kind: 'project' | 'program' | null | undefined, key: string, number: number): string | null {
  return kind === 'program' && !PROGRAM_PAGES.buildPage ? null : routes.taskAny(kind, key, number);
}

const OVERLAY_PARAMS = ['log', 'plan', 'import', 'report'];

/**
 * Any in-app URL, or null when it points at a program page that does not exist yet. Use it for
 * URLs that come from the server (record links, notifications). Other URLs pass through.
 */
export function liveProgramUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('/programs')) return url;
  const [path = '', query = ''] = url.split(/[?#]/, 2);
  const parts = path.split('/').filter(Boolean).slice(1);
  const params = new URLSearchParams(query);
  const overlay = OVERLAY_PARAMS.some((name) => params.has(name));
  const ok = (live: boolean) => (live ? url : null);
  if (parts.length === 0) return ok(PROGRAM_PAGES.directory);
  if (parts[0] === 'new') return ok(PROGRAM_PAGES.newProgram);
  if (parts[0] === 'today') return ok(PROGRAM_PAGES.floor);
  if (overlay && !(PROGRAM_PAGES.workspace && PROGRAM_PAGES.overlays)) return null;
  if (parts.length === 1) return ok(PROGRAM_PAGES.workspace);
  if (parts[1] === 'builds') return ok(PROGRAM_PAGES.builds);
  if (/^\d+$/.test(parts[1] ?? '')) return ok(PROGRAM_PAGES.buildPage);
  // Other tabs (variants, price card, schedule, linked, activity, settings) land with the Overview (L4c).
  return ok(PROGRAM_PAGES.workspace);
}

/** New build needs quick add in build mode. */
export function newBuildLive(): boolean {
  return PROGRAM_PAGES.buildQuickAdd;
}
