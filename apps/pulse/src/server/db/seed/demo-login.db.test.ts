/**
 * The seed's demo sign ins (CONTRACTS section 11): a missing person is added with a working
 * password and the org membership; a person another seed already made keeps their password.
 */
import { randomUUID } from 'node:crypto';
import { verifyPassword } from 'better-auth/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { ensureDemoLogin } from './context';

const ready = await databaseReady();

describe.skipIf(!ready)('seed demo sign ins', () => {
  let org: TestOrg;
  const email = `demo-${randomUUID()}@pulse-test.example`;

  beforeAll(async () => {
    org = await createTestOrg('pulse-demo-login');
  });
  afterAll(async () => {
    await org?.query('delete from core."user" where email = $1', [email]);
    await org?.destroy();
  });

  it('adds a missing person who can sign in, and never resets an existing password', async () => {
    const id = await ensureDemoLogin(org.orgId, { email, name: 'Demo Viewer', orgRole: 'viewer', password: 'Demo-Pass-2026!' });
    const [row] = await org.query<{ password: string; role: string; provider_id: string }>(
      'select a.password, a.provider_id, m.role from core.account a join core.member m on m.user_id = a.user_id where a.user_id = $1 and m.organization_id = $2',
      [id, org.orgId],
    );
    expect(row).toMatchObject({ provider_id: 'credential', role: 'viewer' });
    expect(await verifyPassword({ hash: row!.password, password: 'Demo-Pass-2026!' })).toBe(true);

    const again = await ensureDemoLogin(org.orgId, { email, name: 'Demo Viewer', orgRole: 'member', password: 'Something-Else-1!' });
    expect(again).toBe(id);
    const rows = await org.query<{ password: string; role: string }>('select a.password, m.role from core.account a join core.member m on m.user_id = a.user_id where a.user_id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(await verifyPassword({ hash: rows[0]!.password, password: 'Demo-Pass-2026!' })).toBe(true);
    expect(rows[0]!.role).toBe('viewer');
  });
});
