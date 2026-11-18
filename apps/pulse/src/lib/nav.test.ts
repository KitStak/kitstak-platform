import { describe, expect, it } from 'vitest';
import { NAV, SUB_PAGES, chordTargets, landingPath, navFor, navMatches, subPagesFor } from './nav';

const entry = (id: string) => {
  const found = NAV.find((item) => item.id === id);
  if (!found) throw new Error(`no nav entry ${id}`);
  return found;
};

describe('navigation', () => {
  it('has seven main items and one More group', () => {
    expect(NAV.filter((item) => item.group === 'main').map((item) => item.label)).toEqual(['Home', 'Jobs', 'Log work', 'Profit', 'Labor', 'Alerts', 'Reports']);
    expect(NAV.filter((item) => item.group === 'more').map((item) => item.label)).toEqual(['Target pace', 'Calculator', 'Goals', 'Import and export', 'Settings']);
  });

  it('matches paths on a boundary', () => {
    expect(navMatches(entry('home'), '/')).toBe(true);
    expect(navMatches(entry('home'), '/jobs')).toBe(false);
    expect(navMatches(entry('jobs'), '/jobs/J-1042/plan')).toBe(true);
    expect(navMatches(entry('log'), '/login')).toBe(false);
    expect(navMatches(entry('profit'), '/clients/abc')).toBe(true);
    expect(navMatches(entry('import'), '/export')).toBe(true);
  });

  it('shows supervisors only the floor pages', () => {
    expect(navFor('supervisor').map((item) => item.id)).toEqual(['jobs', 'log', 'labor', 'alerts', 'target-pace', 'import']);
    expect(navFor('viewer')).toHaveLength(NAV.length);
    expect(navFor('none')).toEqual([]);
  });

  it('lands supervisors on the log', () => {
    expect(landingPath('supervisor')).toBe('/log');
    expect(landingPath('manager')).toBe('/');
  });

  it('builds go to shortcuts per role', () => {
    expect(chordTargets('owner')).toEqual({ h: '/', j: '/jobs', l: '/log', p: '/profit', a: '/alerts', b: '/labor', r: '/reports', t: '/target-pace', c: '/calculator', o: '/goals', i: '/import', s: '/settings' });
    expect(chordTargets('supervisor')).toEqual({ j: '/jobs', l: '/log', a: '/alerts', b: '/labor', t: '/target-pace', i: '/import' });
  });

  it('never uses a dash that reads as a pause', () => {
    for (const item of NAV) {
      expect(`${item.label} ${item.description}`).not.toMatch(/[–—]|--/);
    }
  });

  it('lists sub pages once each, under a real entry, and by role', () => {
    const ids = SUB_PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of SUB_PAGES) {
      expect(NAV.some((item) => item.id === page.parent)).toBe(true);
      expect(page.href.startsWith('/')).toBe(true);
      expect(`${page.label} ${page.description}`).not.toMatch(/[–—]|--/);
    }
    const floor = subPagesFor('supervisor', false).map((page) => page.id);
    expect(floor).toContain('log-bulk');
    expect(floor).not.toContain('log-review');
    expect(floor).not.toContain('labor-rates');
    expect(floor).not.toContain('settings-audit');
    expect(subPagesFor('owner', true)).toHaveLength(SUB_PAGES.length);
    expect(subPagesFor('none', false)).toEqual([]);
  });
});
