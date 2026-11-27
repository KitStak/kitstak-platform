import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROGRAM_PAGES, floorTodayHref, liveProgramUrl, logOutputHref, newBuildLive, newProgramHref, planBuildsHref, programHref, programsHref, taskAnyHref, type ProgramPage } from './live-pages';

const src = path.resolve(__dirname, '../../..');
const app = path.join(src, 'app/(app)/programs');

function hasPage(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { recursive: true }).some((entry) => /(^|[/\\])page\.tsx$/.test(String(entry)));
}

function fileHas(file: string, pattern: RegExp): boolean {
  return existsSync(file) && pattern.test(readFileSync(file, 'utf8'));
}

/**
 * What is on disk for each flag. The check runs one way only: a flag that says true must have its
 * page on disk. A page that lands while its flag is still false is fine (the UI keeps hiding the
 * link), so a layer that lands a page stays green, and the flag flips when the orchestrator merges it.
 */
const ON_DISK: Record<ProgramPage, () => boolean> = {
  workspace: () => existsSync(path.join(app, '[key]/page.tsx')),
  builds: () => hasPage(path.join(app, '[key]/builds')),
  buildPage: () => existsSync(path.join(app, '[key]/[number]/page.tsx')),
  directory: () => existsSync(path.join(app, 'page.tsx')),
  newProgram: () => existsSync(path.join(app, 'new/page.tsx')),
  floor: () => existsSync(path.join(app, 'today/page.tsx')),
  overlays: () => fileHas(path.join(src, 'features/shell/app-shell.tsx'), /ProgramOverlaysHost/),
  buildQuickAdd: () => fileHas(path.join(src, 'features/quick-add/quick-add-dialog.tsx'), /mode\s*===\s*'build'|defaults\.mode/),
};

describe('live program pages', () => {
  for (const page of Object.keys(PROGRAM_PAGES) as ProgramPage[]) {
    it(`${page} is on disk when its flag is on`, () => {
      if (!PROGRAM_PAGES[page]) return;
      expect(ON_DISK[page](), `PROGRAM_PAGES.${page} is true but its page is missing. Set it to false in features/programs/kit/live-pages.ts`).toBe(true);
    });
  }

  it('gives a link only when the page is live', () => {
    expect(programHref('GLOVE')).toBe(PROGRAM_PAGES.workspace ? '/programs/GLOVE' : null);
    expect(logOutputHref('GLOVE', '2026-11-25')).toBe(PROGRAM_PAGES.workspace && PROGRAM_PAGES.overlays ? '/programs/GLOVE?log=2026-11-25' : null);
    expect(planBuildsHref('GLOVE')).toBe(PROGRAM_PAGES.workspace && PROGRAM_PAGES.overlays ? '/programs/GLOVE?plan=week' : null);
    expect(programsHref()).toBe(PROGRAM_PAGES.directory ? '/programs' : null);
    expect(newProgramHref()).toBe(PROGRAM_PAGES.newProgram ? '/programs/new' : null);
    expect(floorTodayHref()).toBe(PROGRAM_PAGES.floor ? '/programs/today' : null);
    expect(newBuildLive()).toBe(PROGRAM_PAGES.buildQuickAdd);
  });

  it('passes through other URLs and checks program URLs', () => {
    expect(liveProgramUrl('/p/FRA')).toBe('/p/FRA');
    expect(liveProgramUrl('https://pulse.example/jobs/1')).toBe('https://pulse.example/jobs/1');
    expect(liveProgramUrl(null)).toBeNull();
    expect(liveProgramUrl('/programs')).toBe(PROGRAM_PAGES.directory ? '/programs' : null);
    expect(liveProgramUrl('/programs/new?mode=quick')).toBe(PROGRAM_PAGES.newProgram ? '/programs/new?mode=quick' : null);
    expect(liveProgramUrl('/programs/today')).toBe(PROGRAM_PAGES.floor ? '/programs/today' : null);
    expect(liveProgramUrl('/programs/GLOVE')).toBe(PROGRAM_PAGES.workspace ? '/programs/GLOVE' : null);
    expect(liveProgramUrl('/programs/GLOVE/variants')).toBe(PROGRAM_PAGES.workspace ? '/programs/GLOVE/variants' : null);
    expect(liveProgramUrl('/programs/GLOVE/builds/runs')).toBe(PROGRAM_PAGES.builds ? '/programs/GLOVE/builds/runs' : null);
    expect(liveProgramUrl('/programs/GLOVE/212')).toBe(PROGRAM_PAGES.buildPage ? '/programs/GLOVE/212' : null);
    expect(liveProgramUrl('/programs/GLOVE?log=2026-11-25')).toBe(PROGRAM_PAGES.workspace && PROGRAM_PAGES.overlays ? '/programs/GLOVE?log=2026-11-25' : null);
    expect(taskAnyHref('project', 'FRA', 12)).toBe('/p/FRA/12');
    expect(taskAnyHref('program', 'GLOVE', 212)).toBe(PROGRAM_PAGES.buildPage ? '/programs/GLOVE/212' : null);
  });
});
