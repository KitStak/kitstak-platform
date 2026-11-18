import { describe, expect, it } from 'vitest';
import { NAV } from '@/lib/nav';
import { badgeFor, badgeLabel, drawerBadgeFor, drawerBadgeLabel } from './nav-model';

const alerts = NAV.find((entry) => entry.id === 'alerts')!;
const jobs = NAV.find((entry) => entry.id === 'jobs')!;

describe('navigation badges', () => {
  it('the phone menu shows the open alerts count on Alerts, with words for screen readers', () => {
    expect(drawerBadgeFor(alerts, { jobsAtRisk: 8, openAlerts: 23 })).toBe(23);
    expect(drawerBadgeLabel(alerts, 23)).toBe('Alerts, 23 open alerts');
    expect(drawerBadgeLabel(alerts, 1)).toBe('Alerts, 1 open alert');
  });

  it('the phone menu keeps the Jobs count', () => {
    expect(drawerBadgeFor(jobs, { jobsAtRisk: 8, openAlerts: 23 })).toBe(8);
    expect(drawerBadgeLabel(jobs, 8)).toBe('Jobs, 8 jobs need you');
  });

  it('the wide top nav leaves the alert count to the bell', () => {
    expect(badgeFor(alerts, { openAlerts: 23 })).toBe(0);
    expect(badgeLabel(alerts, 0)).toBeUndefined();
    expect(drawerBadgeFor(alerts, undefined)).toBe(0);
  });
});
