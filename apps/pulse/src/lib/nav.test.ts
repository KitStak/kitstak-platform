import { describe, expect, it } from 'vitest';
import { NAV, SUB_PAGES, chordTargets, landingPath, navFor, navMatches, subPagesFor } from './nav';

const entry = (id: string) => {
  const found = NAV.find((item) => item.id === id);
  if (!found) throw new Error(`no nav entry ${id}`);
  return found;
};

describe('navigation', () => {
  it('has eight main items and one More group', () => {
    expect(NAV.filter((item) => item.group === 'main').map((item) => item.label)).toEqual(['Home', 'Jobs', 'Programs', 'Log work', 'Profit', 'Labor', 'Alerts', 'Reports']);
    expect(NAV.filter((item) => item.group === 'more').map((item) => item.label)).toEqual(['Target pace', 'Calculator', 'Goals', 'Import and export', 'Settings']);
  });

  it('matches paths on a boundary', () => {
    expect(navMatches(entry('home'), '/')).toBe(true);
    expect(navMatches(entry('home'), '/jobs')).toBe(false);
    expect(navMatches(entry('jobs'), '/jobs/J-1042/plan')).toBe(true);
    expect(navMatches(entry('log'), '/login')).toBe(false);
    expect(navMatches(entry('profit'), '/clients/abc')).toBe(true);
    expect(navMatches(entry('import'), '/export')).toBe(true);
    expect(navMatches(entry('programs'), '/programs/GLOVE')).toBe(true);
    expect(navMatches(entry('jobs'), '/programs')).toBe(false);
  });

  it('shows Programs only where the program tracker is on, between Jobs and Profit', () => {
    expect(navFor('owner').map((item) => item.id)).not.toContain('programs');
    expect(navFor('owner', true, { programs: false }).map((item) => item.id)).not.toContain('programs');
    const ids = navFor('owner', true, { programs: true }).map((item) => item.id);
    expect(ids.indexOf('programs')).toBe(ids.indexOf('jobs') + 1);
    expect(ids.indexOf('programs')).toBeLessThan(ids.indexOf('profit'));
    expect(navFor('viewer', false, { programs: true }).map((item) => item.id)).toContain('programs');
    expect(chordTargets('owner', true, { programs: true })).toMatchObject({ r: '/programs', e: '/reports' });
    expect(chordTargets('owner')).not.toHaveProperty('r');
  });

  it('shows supervisors only the floor pages', () => {
    expect(navFor('supervisor').map((item) => item.id)).toEqual(['jobs', 'log', 'labor', 'alerts', 'target-pace', 'import']);
    expect(navFor('supervisor', false, { programs: true }).map((item) => item.id)).toEqual(['jobs', 'programs', 'log', 'labor', 'alerts', 'target-pace', 'import']);
    expect(navFor('viewer')).toHaveLength(NAV.length - 1);
    expect(navFor('viewer', true, { programs: true })).toHaveLength(NAV.length);
    expect(navFor('none')).toEqual([]);
    expect(navFor('viewer', false).map((item) => item.id)).not.toContain('profit');
    expect(chordTargets('viewer', false)).not.toHaveProperty('p');
  });

  it('lands supervisors on the log', () => {
    expect(landingPath('supervisor')).toBe('/log');
    expect(landingPath('manager')).toBe('/');
  });

  it('builds go to shortcuts per role', () => {
    expect(chordTargets('owner')).toEqual({ h: '/', j: '/jobs', l: '/log', p: '/profit', a: '/alerts', b: '/labor', e: '/reports', t: '/target-pace', c: '/calculator', o: '/goals', i: '/import', s: '/settings' });
    expect(chordTargets('owner', true, { programs: true })).toHaveProperty('r', '/programs');
    // Every chord is used once.
    const chords = NAV.map((item) => item.chord).filter(Boolean);
    expect(new Set(chords).size).toBe(chords.length);
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
