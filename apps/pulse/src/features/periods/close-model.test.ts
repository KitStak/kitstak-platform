import { describe, expect, it } from 'vitest';
import { bridgeSteps, closableFrom, monthStatus, pickMonth } from './close-model';

const months = [
  { periodMonth: '2026-11-01', status: 'open' as const, inProgress: true },
  { periodMonth: '2026-10-01', status: 'open' as const, inProgress: false },
  { periodMonth: '2026-09-01', status: 'closed' as const, inProgress: false },
];

describe('pickMonth', () => {
  it('opens the month asked for when it exists', () => {
    expect(pickMonth(months, '2026-09-01')).toBe('2026-09-01');
  });
  it('falls back to the oldest finished month that is still open', () => {
    expect(pickMonth(months, null)).toBe('2026-10-01');
    expect(pickMonth(months, '2020-01-01')).toBe('2026-10-01');
  });
  it('falls back to the newest month when nothing waits', () => {
    expect(pickMonth([months[0]!, months[2]!], null)).toBe('2026-11-01');
    expect(pickMonth([], null)).toBeNull();
  });
});

describe('monthStatus', () => {
  it('shows one status at a time', () => {
    expect(monthStatus({ status: 'closed', inProgress: false }, null)).toMatchObject({ key: 'closed', label: 'Closed' });
    expect(monthStatus({ status: 'open', inProgress: true }, null)).toMatchObject({ key: 'in_progress', label: 'In progress' });
    expect(monthStatus({ status: 'open', inProgress: false }, 0)).toMatchObject({ key: 'ready', label: 'Ready to close' });
  });
  it('never says ready while a step needs fixing', () => {
    expect(monthStatus({ status: 'open', inProgress: false }, 1)).toMatchObject({ key: 'to_fix', label: '1 thing to fix', tone: 'danger' });
    expect(monthStatus({ status: 'open', inProgress: false }, 3)).toMatchObject({ key: 'to_fix', label: '3 things to fix' });
  });
});

describe('closableFrom', () => {
  it('names the day after the month ends', () => {
    expect(closableFrom('2026-11-01')).toBe('December 1');
    expect(closableFrom('2026-12-01')).toBe('January 1');
  });
});

describe('bridgeSteps', () => {
  const base = { sharedGapCents: 115000, missingCostCents: 236000, overheadGapCents: 480000, hasCompanyCosts: true };
  it('walks from job profit to company profit in the words of the spec (SPEC 4.9 worked example)', () => {
    const steps = bridgeSteps(base);
    expect(steps.map((step) => step.label)).toEqual(['Time not on a job that no job carried', 'Paid time not on any job', 'Overhead your hourly rate did not cover']);
    expect(steps.every((step) => !step.adds)).toBe(true);
    // $48,210.00 on jobs less the three steps is $39,900.00.
    expect(4821000 - steps.reduce((sum, step) => sum + step.cents, 0)).toBe(3990000);
  });
  it('leaves the overhead step out when no company costs were typed in', () => {
    expect(bridgeSteps({ ...base, hasCompanyCosts: false, overheadGapCents: null }).map((step) => step.key)).toEqual(['shared_gap', 'missing_time']);
  });
  it('says so when the hourly rate covered more overhead than was spent, which adds to profit', () => {
    const over = bridgeSteps({ ...base, overheadGapCents: -5000 })[2]!;
    expect(over).toMatchObject({ label: 'Your hourly rate covered more overhead than you spent', adds: true, cents: -5000 });
  });
  it('has no steps when money is hidden', () => {
    expect(bridgeSteps({ sharedGapCents: null, missingCostCents: null, overheadGapCents: null, hasCompanyCosts: true })).toEqual([]);
  });
});
