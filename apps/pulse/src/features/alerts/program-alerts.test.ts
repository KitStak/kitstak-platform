/** Program alerts on the Alerts page (PULSE_PROGRAMS_SPEC 6): each action goes to the right program tab. */
import { describe, expect, it } from 'vitest';
import type { ProgramAlertDTO } from '@/lib/program-types';
import { programAlertCount, programAlertHref, programAlertSeverity, sortProgramAlertGroups, type ProgramAlertGroupDTO } from './program-alerts';

const group = { key: 'GLOVE', projectsPath: '/programs/GLOVE' };
const alert = (rule: ProgramAlertDTO['rule']): ProgramAlertDTO => ({ rule, sentence: `${rule} fired.`, action: 'see_days', actionLabel: 'See days', variantId: null });
const row = (key: string, health: ProgramAlertGroupDTO['health'], alerts: ProgramAlertDTO[]): ProgramAlertGroupDTO => ({ key, name: key, health, path: `/programs/${key}`, projectsPath: `/programs/${key}`, alerts });

describe('program alerts', () => {
  it('sends each action to its program tab for the same month', () => {
    expect(programAlertHref('see_variants', group, '2026-11', null)).toEqual({ href: '/programs/GLOVE?month=2026-11&tab=variants', external: false });
    expect(programAlertHref('open_variant', group, '2026-11', null).href).toBe('/programs/GLOVE?month=2026-11&tab=variants');
    expect(programAlertHref('see_days', group, '2026-11', null).href).toBe('/programs/GLOVE?month=2026-11&tab=days');
    expect(programAlertHref('add_hours', group, '2026-11', null).href).toBe('/programs/GLOVE?month=2026-11&tab=days');
  });

  it('opens the program in Projects when Projects is there, else the program page', () => {
    expect(programAlertHref('open_in_projects', group, '2026-11', 'https://projects.test/')).toEqual({ href: 'https://projects.test/programs/GLOVE', external: true });
    expect(programAlertHref('open_in_projects', group, '2026-11', null)).toEqual({ href: '/programs/GLOVE?month=2026-11', external: false });
  });

  it('makes money alerts loud and the rest a heads up', () => {
    expect(programAlertSeverity('P1', 'at_risk')).toBe('warning');
    expect(programAlertSeverity('P2', 'losing')).toBe('critical');
    expect(programAlertSeverity('P6', 'losing')).toBe('info');
    expect(programAlertSeverity('P7', 'heads_up')).toBe('info');
  });

  it('lists programs with alerts worst first, and counts the alerts', () => {
    const groups = sortProgramAlertGroups([row('MAHCO', 'heads_up', [alert('P6')]), row('DUDE', 'on_track', []), row('GLOVE', 'at_risk', [alert('P1'), alert('P3')])]);
    expect(groups.map((item) => item.key)).toEqual(['GLOVE', 'MAHCO']);
    expect(programAlertCount(groups)).toBe('3 program alerts');
    expect(programAlertCount([row('GLOVE', 'heads_up', [alert('P6')])])).toBe('1 program alert');
  });
});
