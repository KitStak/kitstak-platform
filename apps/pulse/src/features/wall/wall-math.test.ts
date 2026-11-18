import { describe, expect, it } from 'vitest';
import { dailyGoal, readPanels, readRotate, wallCall } from './wall-math';

describe('wall display rules', () => {
  it('sets the daily goal from crew, shift and target pace first', () => {
    expect(dailyGoal({ crew: 4, shiftHours: 8, targetUph: 42, unitsLeft: 9000, workDaysLeft: 3 })).toEqual({ units: 1344, basis: 'crew' });
    expect(dailyGoal({ crew: 3, shiftHours: 7.5, targetUph: 40.5, unitsLeft: null, workDaysLeft: null })).toEqual({ units: 911, basis: 'crew' });
  });

  it('falls back to units left over work days left, then to none', () => {
    expect(dailyGoal({ crew: 0, shiftHours: 8, targetUph: 42, unitsLeft: 1000, workDaysLeft: 3 })).toEqual({ units: 334, basis: 'due' });
    expect(dailyGoal({ crew: 4, shiftHours: 8, targetUph: null, unitsLeft: 0, workDaysLeft: 3 })).toBeNull();
    expect(dailyGoal({ crew: 0, shiftHours: 8, targetUph: null, unitsLeft: null, workDaysLeft: null })).toBeNull();
  });

  it('calls green, amber and red from pace', () => {
    expect(wallCall({ units: 420, paceHours: 10, targetUph: 42, goalUnits: 1000, dayIsOver: false })).toMatchObject({ status: 'green', uph: 42, scoreBp: 10000, reason: 'pace' });
    expect(wallCall({ units: 360, paceHours: 10, targetUph: 42, goalUnits: 1000, dayIsOver: false }).status).toBe('amber');
    expect(wallCall({ units: 310, paceHours: 10, targetUph: 42, goalUnits: 1000, dayIsOver: false }).status).toBe('red');
  });

  it('uses the goal when a finished day has units and no hours', () => {
    expect(wallCall({ units: 900, paceHours: 0, targetUph: 42, goalUnits: 1000, dayIsOver: true })).toMatchObject({ status: 'amber', reason: 'goal' });
    expect(wallCall({ units: 900, paceHours: 0, targetUph: 42, goalUnits: 1000, dayIsOver: false })).toMatchObject({ status: 'none', reason: 'no_hours' });
    expect(wallCall({ units: 0, paceHours: 0, targetUph: 42, goalUnits: 1000, dayIsOver: true })).toMatchObject({ status: 'none', reason: 'nothing_logged' });
    expect(wallCall({ units: 100, paceHours: 4, targetUph: null, goalUnits: null, dayIsOver: true })).toMatchObject({ status: 'none', uph: 25, reason: 'no_target' });
  });

  it('reads the URL options', () => {
    expect(readPanels('pace,jobs,nope')).toEqual(['jobs', 'pace']);
    expect(readPanels(undefined)).toHaveLength(5);
    expect(readRotate('30')).toBe(30);
    expect(readRotate('2')).toBe(15);
    expect(readRotate(undefined)).toBe(15);
  });
});
