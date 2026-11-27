import { describe, expect, it } from 'vitest';
import { emailDue, inQuietHours, localClock, renderNotificationEmail } from './notifications';

const CHICAGO = 'America/Chicago';
// 2026-11-30 is a Monday. 15:00 UTC is 9:00 AM in Chicago.
const MONDAY_9AM = new Date('2026-11-30T15:00:00Z');
const MONDAY_6AM = new Date('2026-11-30T12:00:00Z');
const TUESDAY_9AM = new Date('2026-12-01T15:00:00Z');
const hoursAgo = (from: Date, hours: number) => new Date(from.getTime() - hours * 3_600_000);

describe('localClock', () => {
  it('reads the local weekday and time', () => {
    expect(localClock(MONDAY_9AM, CHICAGO)).toEqual({ weekday: 1, minutes: 9 * 60 });
  });
  it('falls back to Chicago for an unknown zone', () => {
    expect(localClock(MONDAY_9AM, 'Not/AZone')).toEqual({ weekday: 1, minutes: 9 * 60 });
  });
});

describe('inQuietHours', () => {
  const night = { enabled: true, from: '19:00', to: '08:00' };
  it('handles a window past midnight', () => {
    expect(inQuietHours(22 * 60, night)).toBe(true);
    expect(inQuietHours(7 * 60, night)).toBe(true);
    expect(inQuietHours(12 * 60, night)).toBe(false);
  });
  it('is off when disabled', () => {
    expect(inQuietHours(22 * 60, { ...night, enabled: false })).toBe(false);
  });
});

describe('emailDue', () => {
  it('never sends when off', () => {
    expect(emailDue({ frequency: 'off', now: MONDAY_9AM, lastSentAt: null, timeZone: CHICAGO })).toBe(false);
  });
  it('sends instant mail every run outside quiet hours', () => {
    expect(emailDue({ frequency: 'instant', now: MONDAY_6AM, lastSentAt: hoursAgo(MONDAY_6AM, 0.1), timeZone: CHICAGO })).toBe(true);
    expect(
      emailDue({
        frequency: 'instant',
        now: MONDAY_6AM,
        lastSentAt: null,
        timeZone: CHICAGO,
        quietHours: { enabled: true, from: '19:00', to: '08:00' },
      }),
    ).toBe(false);
  });
  it('sends daily mail once, from 8 AM local', () => {
    expect(emailDue({ frequency: 'daily', now: MONDAY_6AM, lastSentAt: null, timeZone: CHICAGO })).toBe(false);
    expect(emailDue({ frequency: 'daily', now: MONDAY_9AM, lastSentAt: null, timeZone: CHICAGO })).toBe(true);
    expect(emailDue({ frequency: 'daily', now: MONDAY_9AM, lastSentAt: hoursAgo(MONDAY_9AM, 1), timeZone: CHICAGO })).toBe(false);
    expect(emailDue({ frequency: 'daily', now: TUESDAY_9AM, lastSentAt: MONDAY_9AM, timeZone: CHICAGO })).toBe(true);
  });
  it('sends weekly mail on Monday only', () => {
    expect(emailDue({ frequency: 'weekly', now: MONDAY_9AM, lastSentAt: null, timeZone: CHICAGO })).toBe(true);
    expect(emailDue({ frequency: 'weekly', now: TUESDAY_9AM, lastSentAt: null, timeZone: CHICAGO })).toBe(false);
    expect(emailDue({ frequency: 'weekly', now: MONDAY_9AM, lastSentAt: hoursAgo(MONDAY_9AM, 48), timeZone: CHICAGO })).toBe(false);
  });
});

describe('renderNotificationEmail', () => {
  const base = {
    app: 'Projects',
    recipientName: 'Lauren Smith',
    orgName: 'Team 1',
    inboxUrl: 'https://projects.kitstak.app/team-1/inbox',
    settingsUrl: 'https://projects.kitstak.app/team-1/settings',
    frequency: 'instant' as const,
  };

  it('uses the one update as the subject and button', () => {
    const email = renderNotificationEmail({
      ...base,
      lines: [{ title: 'Mike assigned you OPS-12', url: 'https://projects.kitstak.app/team-1/p/OPS/12' }],
    });
    expect(email.subject).toBe('Projects: Mike assigned you OPS-12');
    expect(email.text).toContain('Hi Lauren');
    expect(email.html).toContain('https://projects.kitstak.app/team-1/p/OPS/12');
  });

  it('counts several updates and caps the list', () => {
    const lines = Array.from({ length: 20 }, (_, index) => ({ title: `Update ${index + 1}` }));
    const email = renderNotificationEmail({ ...base, lines });
    expect(email.subject).toBe('Projects: 20 new updates for you');
    expect(email.text).toContain('And 5 more in your inbox.');
    expect(email.text).not.toContain('Update 16');
  });

  it('escapes names in the HTML', () => {
    const email = renderNotificationEmail({ ...base, lines: [{ title: '<b>x</b> commented' }] });
    expect(email.html).not.toContain('<b>x</b>');
  });

  it('has no em or en dashes in its copy', () => {
    const email = renderNotificationEmail({ ...base, lines: [{ title: 'One' }, { title: 'Two' }] });
    expect(email.text).not.toMatch(/[–—]/);
  });
});
