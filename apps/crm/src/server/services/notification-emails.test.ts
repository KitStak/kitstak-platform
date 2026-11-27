import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE_PREFS, type ProfilePrefs } from './admin-contracts';

vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/env', () => ({ appUrl: () => 'https://crm.kitstak.app' }));

const { deliverNotificationEmails, emailsKind, lineFor, sortRows } = await import('./notification-emails');

const row = (over: Partial<Parameters<typeof lineFor>[0]> = {}): Parameters<typeof lineFor>[0] => ({
  id: crypto.randomUUID(),
  kind: 'assigned',
  board_id: '11111111-1111-4111-8111-111111111111',
  board_name: 'Sales',
  item_id: '22222222-2222-4222-8222-222222222222',
  item_name: 'Frida trend pod trays',
  update_id: null,
  actor_id: '33333333-3333-4333-8333-333333333333',
  actor_name: 'Mike Lunsford',
  payload: { columnTitle: 'Owner' },
  read_at: null,
  created_at: new Date('2026-11-27T15:00:00Z'),
  ...over,
});
const person = { email: 'bryan@team-01.com', member: true, active: true };
const prefs = (over: Partial<ProfilePrefs> = {}): ProfilePrefs => ({ ...DEFAULT_PROFILE_PREFS, ...over });

describe('emailsKind', () => {
  it('emails mentions, assignments and item updates by default', () => {
    const base = prefs();
    expect(emailsKind(base, 'mention')).toBe(true);
    expect(emailsKind(base, 'assigned')).toBe(true);
    expect(emailsKind(base, 'update_reply')).toBe(true);
    expect(emailsKind(base, 'update_on_subscribed')).toBe(true);
    expect(emailsKind(base, 'status_change')).toBe(false);
    expect(emailsKind(base, 'reaction')).toBe(false);
  });

  it('follows the Email switch in Profile, Notifications', () => {
    const custom = prefs({ notifications: { assigned: { inApp: true, email: false }, status_change: { inApp: true, email: true } } });
    expect(emailsKind(custom, 'assigned')).toBe(false);
    expect(emailsKind(custom, 'status_change')).toBe(true);
  });
});

describe('sortRows', () => {
  it('sets aside read rows and switched off events', () => {
    const result = sortRows([row(), row({ read_at: new Date() }), row({ kind: 'reaction' })], person, prefs());
    expect(result.send).toHaveLength(1);
    expect(result.settle).toHaveLength(2);
  });

  it('sets everything aside when email is off or the person never signed in', () => {
    expect(sortRows([row()], person, prefs({ emailDigest: 'off' })).send).toHaveLength(0);
    expect(sortRows([row()], { ...person, active: false }, prefs()).send).toHaveLength(0);
  });
});

describe('lineFor', () => {
  it('uses the inbox sentence and a deep link to the item', () => {
    const line = lineFor(row(), 'https://crm.kitstak.app', 'team-1');
    expect(line.title).toBe('Mike Lunsford assigned you to Frida trend pod trays as Owner');
    expect(line.url).toBe(
      'https://crm.kitstak.app/team-1/boards/11111111-1111-4111-8111-111111111111?item=22222222-2222-4222-8222-222222222222',
    );
  });

  it('carries the update preview for replies', () => {
    const line = lineFor(row({ kind: 'update_reply', payload: { preview: 'Trays land Monday' } }), 'https://crm.kitstak.app', 'team-1');
    expect(line.detail).toBe('Trays land Monday');
  });
});

describe('deliverNotificationEmails', () => {
  it('does nothing when mail is not set up', async () => {
    const result = await deliverNotificationEmails({ ready: false });
    expect(result.stopped).toMatch(/not set up/);
  });
});
