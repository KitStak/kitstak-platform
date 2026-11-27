import { describe, expect, it } from 'vitest';
import { healthHint, healthProgressTone, projectHealth, type HealthSubject } from './health';

const base: HealthSubject = { health: 'on_track', status: 'active', startDate: '2026-11-01', dueDate: '2026-12-01', progress: { percent: 0 } };

describe('projectHealth', () => {
  it('is the owner health, with no hint when the numbers agree', () => {
    const view = projectHealth({ ...base, progress: { percent: 40 } }, '2026-11-13');
    expect(view.health).toBe('on_track');
    expect(view.suggested).toBeNull();
    expect(healthHint(view)).toBeNull();
  });

  it('adds a hint (never a second status) when the numbers disagree', () => {
    const view = projectHealth({ ...base, progress: { percent: 10 } }, '2026-11-20');
    expect(view.health).toBe('on_track');
    expect(view.suggested).toBe('off_track');
    expect(healthHint(view)).toBe('Numbers suggest Off track');
  });

  it('never flags a brand-new project (day zero, nothing expected yet)', () => {
    const view = projectHealth({ ...base, startDate: '2026-11-13', dueDate: '2026-12-18' }, '2026-11-13');
    expect(view.suggested).toBeNull();
    expect(view.expected).toBe(0);
  });

  it('has nothing to compare before the start date, without dates, or once finished', () => {
    expect(projectHealth({ ...base, startDate: '2026-12-01', dueDate: '2027-01-01' }, '2026-11-13').expected).toBeNull();
    expect(projectHealth({ ...base, startDate: null }, '2026-11-13').suggested).toBeNull();
    expect(projectHealth({ ...base, status: 'completed', progress: { percent: 0 } }, '2026-11-30').suggested).toBeNull();
  });

  it('suggests a better health too when the owner is more cautious than the numbers', () => {
    expect(projectHealth({ ...base, health: 'at_risk', progress: { percent: 60 } }, '2026-11-13').suggested).toBe('on_track');
  });
});

describe('healthProgressTone', () => {
  it('draws progress as a quantity: the data color for every health, the pill says the state', () => {
    expect(healthProgressTone('on_track')).toBe('primary');
    expect(healthProgressTone('at_risk')).toBe('primary');
    expect(healthProgressTone('off_track')).toBe('primary');
    expect(healthProgressTone('missed')).toBe('primary');
  });

  it('turns an achieved goal green', () => {
    expect(healthProgressTone('achieved')).toBe('success');
  });
});
