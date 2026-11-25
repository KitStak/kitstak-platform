/**
 * Review round 5: after "Change email" on the verify step, mail queued for the old (mistyped)
 * address follows the person. Before the fix the welcome email of the trial still went to the old
 * address, which may be a stranger's mailbox, and the right address never got one.
 *
 * Runs against the local dev Postgres. Skipped when it is not reachable.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createTestOrg, openTestDb, removeTestOrg, type TestOrg } from '../testing/db';
import { enqueueEmail, moveQueuedEmails } from './outbox';

const { pool, db, available } = await openTestDb();
const orgs: TestOrg[] = [];

afterAll(async () => {
  for (const org of orgs) {
    await pool.query(`DELETE FROM core.billing_emails WHERE org_id = $1`, [org.orgId]);
    await removeTestOrg(pool, org);
  }
  await pool.query(`DELETE FROM core.billing_emails WHERE to_email LIKE 'r5outbox-%'`);
  await pool.end();
});

async function mailOf(orgId: string | null, like: string): Promise<{ to_email: string; template: string; status: string; dedupe_key: string }[]> {
  const result = await pool.query(
    `SELECT to_email, template, status, dedupe_key FROM core.billing_emails WHERE dedupe_key LIKE $1 AND ($2::uuid IS NULL OR org_id = $2) ORDER BY created_at, dedupe_key`,
    [like, orgId],
  );
  return result.rows;
}

describe.skipIf(!available)('moveQueuedEmails (review round 5)', () => {
  it('a queued welcome email moves to the new address, and mail to other people stays', async () => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    const tag = org.orgId.slice(0, 8);
    const typo = `r5outbox-${tag}-typo@kitstak-test.example`;
    const right = `r5outbox-${tag}-right@kitstak-test.example`;
    const other = `r5outbox-${tag}-other@kitstak-test.example`;
    const welcome = { orgName: 'Acme', portalUrl: 'http://localhost:3300', firstName: 'Maya', products: ['crm'], trialEndsAt: new Date().toISOString() };
    await enqueueEmail(db, { orgId: org.orgId, to: typo, template: 'welcome', payload: welcome as never, dedupeKey: `welcome:${org.orgId}` });
    await enqueueEmail(db, { orgId: org.orgId, to: other, template: 'welcome', payload: welcome as never, dedupeKey: `r5other:${org.orgId}` });
    await enqueueEmail(db, { orgId: null, to: typo, template: 'verify_email', payload: { code: '123456', minutes: 10 } as never, dedupeKey: `r5code:${tag}` });

    const done = await moveQueuedEmails(db, { orgIds: [org.orgId], from: ` ${typo.toUpperCase()} `, to: right });
    expect(done).toEqual({ moved: 1, skippedCodes: 1, resentWelcome: 0 });
    expect(await mailOf(org.orgId, `welcome:${org.orgId}`)).toEqual([{ to_email: right, template: 'welcome', status: 'queued', dedupe_key: `welcome:${org.orgId}` }]);
    expect((await mailOf(org.orgId, `r5other:${org.orgId}`))[0]?.to_email).toBe(other);
    // The code for the old address is not sent to anyone.
    expect((await mailOf(null, `r5code:${tag}`))[0]).toMatchObject({ to_email: typo, status: 'skipped' });
    // Nothing is left that would go to the old address.
    const waiting = await pool.query(`SELECT 1 FROM core.billing_emails WHERE to_email = $1 AND status = 'queued'`, [typo]);
    expect(waiting.rows).toHaveLength(0);
  });

  it('a welcome email that already left for the old address is queued once more for the new one, and only once', async () => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    const tag = org.orgId.slice(0, 8);
    const typo = `r5outbox-${tag}-typo@kitstak-test.example`;
    const right = `r5outbox-${tag}-right@kitstak-test.example`;
    const welcome = { orgName: 'Acme', portalUrl: 'http://localhost:3300', firstName: 'Maya', products: ['crm'], trialEndsAt: new Date().toISOString() };
    await enqueueEmail(db, { orgId: org.orgId, to: typo, template: 'welcome', payload: welcome as never, dedupeKey: `welcome:${org.orgId}` });
    await pool.query(`UPDATE core.billing_emails SET status = 'sent', sent_at = now() WHERE dedupe_key = $1`, [`welcome:${org.orgId}`]);

    expect(await moveQueuedEmails(db, { orgIds: [org.orgId], from: typo, to: right })).toEqual({ moved: 0, skippedCodes: 0, resentWelcome: 1 });
    expect(await moveQueuedEmails(db, { orgIds: [org.orgId], from: typo, to: right })).toEqual({ moved: 0, skippedCodes: 0, resentWelcome: 0 });
    const rows = await mailOf(org.orgId, `welcome:${org.orgId}%`);
    expect(rows).toEqual([
      { to_email: typo, template: 'welcome', status: 'sent', dedupe_key: `welcome:${org.orgId}` },
      { to_email: right, template: 'welcome', status: 'queued', dedupe_key: `welcome:${org.orgId}:moved:${right}` },
    ]);
    const payload = await pool.query(`SELECT payload FROM core.billing_emails WHERE dedupe_key = $1`, [`welcome:${org.orgId}:moved:${right}`]);
    expect(payload.rows[0]?.payload).toMatchObject({ orgName: 'Acme', firstName: 'Maya', orgId: org.orgId });
  });

  it('does nothing for the same address, an empty address, or another organization', async () => {
    const org = await createTestOrg(pool);
    orgs.push(org);
    const tag = org.orgId.slice(0, 8);
    const typo = `r5outbox-${tag}-typo@kitstak-test.example`;
    await enqueueEmail(db, { orgId: org.orgId, to: typo, template: 'welcome', payload: {} as never, dedupeKey: `welcome:${org.orgId}` });
    const none = { moved: 0, skippedCodes: 0, resentWelcome: 0 };
    expect(await moveQueuedEmails(db, { orgIds: [org.orgId], from: typo, to: typo })).toEqual(none);
    expect(await moveQueuedEmails(db, { orgIds: [org.orgId], from: typo, to: ' ' })).toEqual(none);
    expect(await moveQueuedEmails(db, { orgIds: ['00000000-0000-4000-8000-00000000abcd'], from: typo, to: `x-${typo}` })).toEqual(none);
    expect((await mailOf(org.orgId, `welcome:${org.orgId}`))[0]).toMatchObject({ to_email: typo, status: 'queued' });
  });
});
