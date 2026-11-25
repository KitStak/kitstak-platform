import { describe, expect, it } from 'vitest';
import { programPageLive } from '@/features/programs/kit/live-pages';
import { pickHref, programKeyFromPath, programMeta, programRowHref, todayText } from './program-commands';

describe('program commands', () => {
  it('reads the program key from the path', () => {
    expect(programKeyFromPath('/programs/glove')).toBe('GLOVE');
    expect(programKeyFromPath('/programs/GLOVE/builds/runs')).toBe('GLOVE');
    expect(programKeyFromPath('/programs/new')).toBeNull();
    expect(programKeyFromPath('/programs/today')).toBeNull();
    expect(programKeyFromPath('/programs')).toBeNull();
    expect(programKeyFromPath('/p/FRA')).toBeNull();
  });

  it('says today in words and links the picker', () => {
    const today = { date: '2026-11-25', builds: 8, done: 5, plannedUnits: '800', builtUnits: '560' };
    expect(todayText({ today })).toBe('5 of 8 builds today');
    expect(todayText({ today: { ...today, builds: 1, done: 0 } })).toBe('0 of 1 build today');
    expect(todayText({ today: { ...today, builds: 0, done: 0 } })).toBe('No builds today');
    const live = programPageLive('workspace') && programPageLive('overlays');
    expect(pickHref('log', { key: 'GLOVE', today })).toBe(live ? '/programs/GLOVE?log=2026-11-25' : null);
    expect(pickHref('plan', { key: 'GLOVE', today })).toBe(live ? '/programs/GLOVE?plan=week' : null);
  });

  it('always lists a program and sends it to search until its page exists', () => {
    const today = { date: '2026-11-25', builds: 8, done: 5, plannedUnits: '800', builtUnits: '560' };
    expect(programRowHref('GLOVE')).toBe(programPageLive('workspace') ? '/programs/GLOVE' : '/search?q=GLOVE&type=programs');
    expect(programMeta({ key: 'GLOVE', customer: { kind: 'crm_account', id: 'a', name: 'Bluestone Foods' }, today })).toBe('GLOVE · Bluestone Foods · 5 of 8 builds today');
    expect(programMeta({ key: 'GLOVE', customer: null, today })).toBe('GLOVE · 5 of 8 builds today');
  });
});
