import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV } from './nav';
import { arrivesIn, CREW_PAGES, PHASE_NAMES } from './pages';

const APP = path.resolve(__dirname, '../app');

/** Every route of SPEC 6.1 with the folder its page lives in. */
const SPEC_ROUTES: readonly [route: string, folder: string][] = [
  ['/', '(app)'],
  ['/today', '(app)/today'],
  ['/people', '(app)/people'],
  ['/people/new', '(app)/people/new'],
  ['/people/[id]', '(app)/people/[id]'],
  ['/people/agencies', '(app)/people/agencies'],
  ['/people/agencies/[vendorId]', '(app)/people/agencies/[vendorId]'],
  ['/join/a/[token]', 'join/a/[token]'],
  ['/schedule', '(app)/schedule'],
  ['/schedule/templates', '(app)/schedule/templates'],
  ['/schedule/requests', '(app)/schedule/requests'],
  ['/kiosk/t/[token]', 'kiosk/t/[token]'],
  ['/clock', '(app)/clock'],
  ['/me', '(app)/me'],
  ['/time', '(app)/time'],
  ['/time/[personId]', '(app)/time/[personId]'],
  ['/time/fixes', '(app)/time/fixes'],
  ['/time/export', '(app)/time/export'],
  ['/attendance', '(app)/attendance'],
  ['/time-off', '(app)/time-off'],
  ['/skills', '(app)/skills'],
  ['/plan', '(app)/plan'],
  ['/plan/paces', '(app)/plan/paces'],
  ['/import', '(app)/import'],
  ['/import/[batchId]', '(app)/import/[batchId]'],
  ['/export', '(app)/export'],
  ['/settings', '(app)/settings'],
  ['/settings/rules', '(app)/settings/rules'],
  ['/settings/kiosks', '(app)/settings/kiosks'],
  ['/settings/apps', '(app)/settings/apps'],
  ['/welcome', '(app)/welcome'],
  ['/search', '(app)/search'],
  ['/login', '(auth)/login'],
  ['/forgot-password', '(auth)/forgot-password'],
  ['/no-workspace', 'no-workspace'],
];

describe('every route of SPEC 6.1 exists', () => {
  it.each(SPEC_ROUTES)('%s has a page', (_route, folder) => {
    expect(fs.existsSync(path.join(APP, folder, 'page.tsx'))).toBe(true);
  });

  it('every teaching page is a route in the spec list, with a phase and an empty state', () => {
    const routes = new Set(SPEC_ROUTES.map(([route]) => route));
    for (const page of CREW_PAGES) {
      expect(routes.has(page.path), page.path).toBe(true);
      expect(page.phase).toBeGreaterThan(0);
      expect(page.why.length).toBeGreaterThan(20);
      expect(page.points.length).toBeGreaterThanOrEqual(3);
      expect(page.points.length).toBeLessThanOrEqual(4);
    }
    expect(new Set(CREW_PAGES.map((page) => page.id)).size).toBe(CREW_PAGES.length);
  });

  it('every page under (app) that is not built yet renders its teaching state through PhasePage', () => {
    for (const page of CREW_PAGES) {
      const folder = SPEC_ROUTES.find(([route]) => route === page.path)![1];
      const source = fs.readFileSync(path.join(APP, folder, 'page.tsx'), 'utf8');
      expect(source, page.path).toContain(`<PhasePage id="${page.id}"`);
    }
  });

  it('every navigation entry opens a route in the list', () => {
    const routes = new Set(SPEC_ROUTES.map(([route]) => route));
    for (const entry of NAV) expect(routes.has(entry.href), entry.href).toBe(true);
  });

  it('says which phase a page arrives in', () => {
    expect(arrivesIn(3)).toBe('Arrives in phase 3: Time clock');
    expect(Object.keys(PHASE_NAMES)).toHaveLength(9);
  });
});
