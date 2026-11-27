import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/env', () => ({ appUrl: () => 'https://projects.kitstak.app' }));

const { deliverNotificationEmails, EMAIL_KINDS, sortRows } = await import('./notification-emails');

const row = (over: Partial<Parameters<typeof sortRows>[0][number]> = {}) => ({
  id: crypto.randomUUID(),
  kind: 'assigned',
  title: 'Mike assigned you OPS-12',
  body: null,
  url: '/p/OPS/12',
  read_at: null,
  archived_at: null,
  ...over,
});
const active = { email: 'lauren@team-01.com', member: true, active: true, digest: null };

describe('sortRows', () => {
  it('emails unread rows of the emailed kinds', () => {
    const rows = EMAIL_KINDS.map((kind) => row({ kind }));
    expect(sortRows(rows, active).send).toHaveLength(EMAIL_KINDS.length);
  });

  it('sets aside read, archived and inbox only rows', () => {
    const rows = [row({ read_at: new Date() }), row({ archived_at: new Date() }), row({ kind: 'automation' }), row()];
    const result = sortRows(rows, active);
    expect(result.send).toHaveLength(1);
    expect(result.settle).toHaveLength(3);
  });

  it('sets everything aside for people who never signed in, left, or turned email off', () => {
    const rows = [row(), row()];
    expect(sortRows(rows, { ...active, active: false }).send).toHaveLength(0);
    expect(sortRows(rows, { ...active, member: false }).send).toHaveLength(0);
    expect(sortRows(rows, { ...active, digest: 'off' }).send).toHaveLength(0);
    expect(sortRows(rows, { ...active, email: null }).settle).toHaveLength(2);
  });
});

describe('deliverNotificationEmails', () => {
  it('does nothing when mail is not set up', async () => {
    const result = await deliverNotificationEmails({ ready: false });
    expect(result).toMatchObject({ sent: 0, handled: 0 });
    expect(result.stopped).toMatch(/not set up/);
  });
});
