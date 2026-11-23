/** Against the local dev Postgres (docs/billing/DEV.md). Skipped when it is not reachable. */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { enqueueEmail } from '../server/outbox';
import { createTestOrg, openTestDb, removeTestOrg, type TestOrg } from '../testing/db';
import { MAX_EMAIL_ATTEMPTS, deliverQueuedEmails, getOutboxEmail, listOutbox, sendEmailNow } from './deliver';
import type { FetchLike } from './provider';
import { SAMPLE_EMAIL_PAYLOADS } from './samples';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 30_000 });

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;
const OUTBOX = env({ NODE_ENV: 'test' });
const RESEND = env({ NODE_ENV: 'production', RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'KitStak <billing@mail.example>' });
const NO_MAIL = env({ NODE_ENV: 'production' });
const MINUTE = 60_000;

const orgs: TestOrg[] = [];
const tag = `mailtest-${Math.random().toString(36).slice(2, 10)}`;
let counter = 0;
/** Every test address is unique to this run, so tests never see each other's rows. */
const address = () => `${tag}-${(counter += 1)}@kitstak-test.example`;

/** The outbox is one shared table. Each test only touches the rows it made, by their key prefix. */
function scope() {
  const prefix = `${tag}:${(counter += 1)}:`;
  return {
    key: (name: string) => `${prefix}${name}:${(counter += 1)}`,
    deliver: (options: Parameters<typeof deliverQueuedEmails>[1]) => deliverQueuedEmails(db, { ...options, keyPrefix: prefix }),
  };
}

async function newOrg(): Promise<TestOrg> {
  const org = await createTestOrg(pool);
  orgs.push(org);
  return org;
}

const rowOf = async (dedupeKey: string) =>
  (await pool.query(`select * from core.billing_emails where dedupe_key = $1`, [dedupeKey])).rows[0];

function resendFetch(script: readonly number[]) {
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const status = script[Math.min(calls.length, script.length - 1)]!;
    calls.push({ headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      status,
      text: async () => (status < 300 ? `{"id":"msg_${calls.length}"}` : '{"name":"oops","message":"Not now."}'),
    };
  };
  return { fetch, calls };
}

afterAll(async () => {
  await pool.query(`delete from core.billing_emails where dedupe_key like $1`, [`${tag}:%`]);
  for (const org of orgs) await removeTestOrg(pool, org);
  await pool.end();
});

describe.skipIf(!available)('the dev outbox', () => {
  it('delivers a queued email once: stored with HTML and text, marked sent, logged in the activity', async () => {
    const { key, deliver } = scope();
    const org = await newOrg();
    const to = address();
    const dedupeKey = key('receipt');
    await enqueueEmail(db, { orgId: org.orgId, to, template: 'receipt', payload: { ...SAMPLE_EMAIL_PAYLOADS.receipt, orgName: org.name }, dedupeKey });
    // The same key again is the same email.
    await enqueueEmail(db, { orgId: org.orgId, to, template: 'receipt', payload: SAMPLE_EMAIL_PAYLOADS.receipt, dedupeKey });

    const now = new Date();
    const first = await deliver({ env: OUTBOX, now });
    expect(first).toEqual({ sent: 1, failed: 0, skipped: 0 });
    const second = await deliver({ env: OUTBOX, now: new Date(now.getTime() + 10 * MINUTE) });
    expect(second).toEqual({ sent: 0, failed: 0, skipped: 0 });

    const row = await rowOf(dedupeKey);
    expect(row).toMatchObject({ status: 'sent', provider: 'outbox', attempts: 1, subject: 'Your KitStak receipt for $395.20', error: null });
    expect(row.html).toContain('Total paid');
    expect(row.body_text).toContain('Total paid: $395.20');
    expect(row.sent_at).toEqual(now);

    const listed = await listOutbox(db, { to });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ to, template: 'receipt', status: 'sent', subject: 'Your KitStak receipt for $395.20' });
    expect(listed[0]!.text).toContain(org.name);
    expect(await getOutboxEmail(db, listed[0]!.id)).toMatchObject({ id: listed[0]!.id, to });
    expect(await getOutboxEmail(db, 'not-a-uuid')).toBeNull();

    const audit = (await pool.query(`select actor_label, summary, data from core.billing_audit_log where org_id = $1 and action = 'email.sent'`, [org.orgId])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_label: 'KitStak', summary: `We emailed a receipt to ${to}.` });
    expect(audit[0].data).toMatchObject({ template: 'receipt', to, invoiceId: 'in_test_sample', emailId: row.id });
  });

  it('waits for send_after', async () => {
    const { key, deliver } = scope();
    const to = address();
    const dedupeKey = key('later');
    const now = new Date();
    await enqueueEmail(db, { orgId: null, to, template: 'verify_email', payload: { code: '123456', minutes: 10 }, dedupeKey, sendAfter: new Date(now.getTime() + 30 * MINUTE) });
    await expect(deliver({ env: OUTBOX, now })).resolves.toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect((await rowOf(dedupeKey)).status).toBe('queued');
    await expect(deliver({ env: OUTBOX, now: new Date(now.getTime() + 31 * MINUTE) })).resolves.toEqual({ sent: 1, failed: 0, skipped: 0 });
  });

  it('sends a code right away, shows it in the outbox, wipes it from the payload and writes no activity row', async () => {
    const { key, deliver } = scope();
    const to = address();
    const dedupeKey = key('code');
    const result = await sendEmailNow(db, { orgId: null, to: `  ${to.toUpperCase()} `, template: 'verify_email', payload: { code: '482913', minutes: 10 }, dedupeKey }, { env: OUTBOX });
    expect(result).toEqual({ ok: true, provider: 'outbox' });
    const row = await rowOf(dedupeKey);
    expect(row).toMatchObject({ status: 'sent', to_email: to, subject: 'Your KitStak code: 482913', org_id: null });
    expect(row.body_text).toContain('482913');
    expect(row.payload).toEqual({ minutes: 10 });

    // The same key again sends nothing new.
    await expect(sendEmailNow(db, { orgId: null, to, template: 'verify_email', payload: { code: '999999', minutes: 10 }, dedupeKey }, { env: OUTBOX })).resolves.toEqual({ ok: true, provider: 'outbox' });
    expect((await rowOf(dedupeKey)).subject).toBe('Your KitStak code: 482913');
    expect(await listOutbox(db, { to })).toHaveLength(1);
  });

  it('marks a row it cannot render as failed, and an unknown template as skipped, without stopping the rest', async () => {
    const { key, deliver } = scope();
    const org = await newOrg();
    const bad = key('bad');
    const unknown = key('unknown');
    const good = key('good');
    await enqueueEmail(db, { orgId: org.orgId, to: address(), template: 'receipt', payload: { orgName: 'No amounts' } as never, dedupeKey: bad });
    await enqueueEmail(db, { orgId: org.orgId, to: address(), template: 'newsletter' as never, payload: {} as never, dedupeKey: unknown });
    await enqueueEmail(db, { orgId: org.orgId, to: address(), template: 'plan_ended', payload: SAMPLE_EMAIL_PAYLOADS.plan_ended, dedupeKey: good });
    const report = await deliver({ env: OUTBOX });
    expect(report).toEqual({ sent: 1, failed: 1, skipped: 1 });
    expect(await rowOf(bad)).toMatchObject({ status: 'failed' });
    expect((await rowOf(bad)).error).toContain('EmailPayloadError');
    expect(await rowOf(unknown)).toMatchObject({ status: 'skipped', error: 'Unknown email template "newsletter".' });
    expect(await rowOf(good)).toMatchObject({ status: 'sent' });
    const failedNow = await sendEmailNow(db, { orgId: org.orgId, to: address(), template: 'receipt', payload: {} as never, dedupeKey: bad }, { env: OUTBOX });
    expect(failedNow).toMatchObject({ ok: false, error: 'This email failed before and will not be sent again.' });
  });
});

describe.skipIf(!available)('sending with Resend', () => {
  it('sends, keeps the message id, and does not keep the body or the code', async () => {
    const { key, deliver } = scope();
    const to = address();
    const dedupeKey = key('resend-code');
    const { fetch, calls } = resendFetch([200]);
    const result = await sendEmailNow(db, { orgId: null, to, template: 'reset_password', payload: { code: '715204', minutes: 10 }, dedupeKey }, { env: RESEND, fetch });
    expect(result).toEqual({ ok: true, provider: 'resend' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ to: [to], from: 'KitStak <billing@mail.example>', subject: 'Reset your KitStak password' });
    expect(String(calls[0]!.body.text)).toContain('715204');
    const row = await rowOf(dedupeKey);
    expect(row).toMatchObject({ status: 'sent', provider: 'resend', provider_message_id: 'msg_1', html: null, body_text: null });
    expect(row.payload).toEqual({ minutes: 10 });
    expect(JSON.stringify(row)).not.toContain('715204');
  });

  it('tries a failing email 3 times, 5 minutes apart, then marks it failed', async () => {
    const { key, deliver } = scope();
    const org = await newOrg();
    const dedupeKey = key('retry');
    await enqueueEmail(db, { orgId: org.orgId, to: address(), template: 'plan_ended', payload: SAMPLE_EMAIL_PAYLOADS.plan_ended, dedupeKey });
    const { fetch, calls } = resendFetch([500]);
    const start = new Date();
    const run = (minutes: number) => deliver({ env: RESEND, fetch, now: new Date(start.getTime() + minutes * MINUTE) });

    await expect(run(0)).resolves.toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(await rowOf(dedupeKey)).toMatchObject({ status: 'queued', attempts: 1, error: 'Resend answered 500. oops: Not now.' });
    // Too soon: the row is held for 5 minutes after a try.
    await expect(run(2)).resolves.toEqual({ sent: 0, failed: 0, skipped: 0 });
    await expect(run(6)).resolves.toEqual({ sent: 0, failed: 1, skipped: 0 });
    await expect(run(12)).resolves.toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(await rowOf(dedupeKey)).toMatchObject({ status: 'failed', attempts: MAX_EMAIL_ATTEMPTS });
    await expect(run(30)).resolves.toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(calls).toHaveLength(MAX_EMAIL_ATTEMPTS);
    // Every try used the same idempotency key, so a lost answer could not cause a second email.
    expect(new Set(calls.map((call) => call.headers['Idempotency-Key'])).size).toBe(1);
    const audit = (await pool.query(`select 1 from core.billing_audit_log where org_id = $1 and action = 'email.sent'`, [org.orgId])).rowCount;
    expect(audit).toBe(0);
  });

  it('a retry that works sends the email once', async () => {
    const { key, deliver } = scope();
    const org = await newOrg();
    const dedupeKey = key('retry-ok');
    await enqueueEmail(db, { orgId: org.orgId, to: address(), template: 'plan_ended', payload: SAMPLE_EMAIL_PAYLOADS.plan_ended, dedupeKey });
    const { fetch } = resendFetch([503, 200]);
    const start = new Date();
    await deliver({ env: RESEND, fetch, now: start });
    await expect(deliver({ env: RESEND, fetch, now: new Date(start.getTime() + 6 * MINUTE) })).resolves.toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await rowOf(dedupeKey)).toMatchObject({ status: 'sent', attempts: 2, error: null, provider_message_id: 'msg_2' });
  });

  it('a wrong key or sender stops the run and costs no email a try', async () => {
    const { key, deliver } = scope();
    const org = await newOrg();
    const first = key('config-1');
    const second = key('config-2');
    await enqueueEmail(db, { orgId: org.orgId, to: address(), template: 'plan_ended', payload: SAMPLE_EMAIL_PAYLOADS.plan_ended, dedupeKey: first });
    await enqueueEmail(db, { orgId: org.orgId, to: address(), template: 'plan_ended', payload: SAMPLE_EMAIL_PAYLOADS.plan_ended, dedupeKey: second });
    const { fetch, calls } = resendFetch([403]);
    await expect(deliver({ env: RESEND, fetch })).resolves.toEqual({ sent: 0, failed: 0, skipped: 2 });
    expect(calls).toHaveLength(1);
    for (const dedupeKey of [first, second]) {
      expect(await rowOf(dedupeKey)).toMatchObject({ status: 'queued', attempts: 0, error: 'Resend answered 403. oops: Not now.' });
    }
    // A bad request is this email's own fault: failed at once, the next one still goes out.
    const mixed = resendFetch([422, 200]);
    const later = new Date(Date.now() + 6 * MINUTE);
    await expect(deliver({ env: RESEND, fetch: mixed.fetch, now: later })).resolves.toEqual({ sent: 1, failed: 1, skipped: 0 });
  });
});

describe.skipIf(!available)('production with no mail key', () => {
  it('keeps mail queued, reports it as waiting, and sends nothing', async () => {
    const { key, deliver } = scope();
    const org = await newOrg();
    const dedupeKey = key('none');
    await enqueueEmail(db, { orgId: org.orgId, to: address(), template: 'plan_ended', payload: SAMPLE_EMAIL_PAYLOADS.plan_ended, dedupeKey });
    const report = await deliver({ env: NO_MAIL });
    expect(report).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(await rowOf(dedupeKey)).toMatchObject({ status: 'queued', attempts: 0 });

    const now = await sendEmailNow(db, { orgId: null, to: address(), template: 'verify_email', payload: { code: '111111', minutes: 10 }, dedupeKey: key('none-now') }, { env: NO_MAIL });
    expect(now).toEqual({ ok: false, provider: 'none', error: 'No mail provider is set. The email stays queued.' });
  });
});
