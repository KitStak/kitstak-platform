import { describe, expect, it } from 'vitest';
import { NAV, chordTargets, landingPath, navFor, navMatches } from './nav';

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
    expect(chordTargets('owner')).toEqual({ h: '/', j: '/jobs', l: '/log', p: '/profit', a: '/alerts' });
    expect(chordTargets('supervisor')).toEqual({ j: '/jobs', l: '/log', a: '/alerts' });
  });

  it('never uses a dash that reads as a pause', () => {
    for (const item of NAV) {
      expect(`${item.label} ${item.description}`).not.toMatch(/[–—]|--/);
    }
  });
});
