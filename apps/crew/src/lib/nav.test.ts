import { describe, expect, it } from 'vitest';
import { chordTargets, landingPath, NAV, navFor, navMatches } from './nav';

const ids = (role: Parameters<typeof navFor>[0]) => navFor(role).map((entry) => entry.id);

describe('Crew navigation (SPEC 6)', () => {
  it('lists Home, Schedule, Time, People, Attendance, Plan, then More: Time off, Skills, Import and export, Settings', () => {
    expect(NAV.filter((entry) => entry.group === 'main').map((entry) => entry.label)).toEqual(['Home', 'Schedule', 'Time', 'People', 'Attendance', 'Plan']);
    expect(NAV.filter((entry) => entry.group === 'more').map((entry) => entry.label)).toEqual(['Time off', 'Skills', 'Import and export', 'Settings']);
    expect(NAV.filter((entry) => entry.group === 'primary').map((entry) => entry.label)).toEqual(['Today']);
  });

  it('an owner sees everything', () => {
    expect(ids('owner')).toEqual(NAV.map((entry) => entry.id));
  });

  it('leads see Today, Schedule, Time and Plan, and land on Today', () => {
    expect(ids('lead')).toEqual(['today', 'schedule', 'time', 'plan']);
    expect(landingPath('lead')).toBe('/today');
    expect(landingPath('supervisor')).toBe('/');
  });

  it('a viewer sees the read pages only', () => {
    expect(ids('viewer')).toEqual(['today', 'home', 'schedule', 'time', 'skills']);
  });

  it('a supervisor sees no Settings; role none sees nothing', () => {
    expect(ids('supervisor')).not.toContain('settings');
    expect(ids('supervisor')).toContain('people');
    expect(navFor('none')).toEqual([]);
  });

  it('matches paths with a boundary, and / only itself', () => {
    const home = NAV.find((entry) => entry.id === 'home')!;
    const time = NAV.find((entry) => entry.id === 'time')!;
    const timeOff = NAV.find((entry) => entry.id === 'time-off')!;
    expect(navMatches(home, '/')).toBe(true);
    expect(navMatches(home, '/people')).toBe(false);
    expect(navMatches(time, '/time/fixes')).toBe(true);
    expect(navMatches(time, '/time-off')).toBe(false);
    expect(navMatches(timeOff, '/time-off')).toBe(true);
  });

  it('every chord is unique and points at a nav entry', () => {
    const chords = NAV.map((entry) => entry.chord).filter(Boolean);
    expect(new Set(chords).size).toBe(chords.length);
    expect(chordTargets('owner').t).toBe('/time');
    expect(chordTargets('lead').p).toBeUndefined();
  });
});
