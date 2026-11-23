/**
 * Against the local dev Postgres (docs/billing/DEV.md). Skipped when it is not reachable. Every org
 * and person made here is removed again.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { grantModule } from '@kitstak/entitlements';
import type { EntitlementsDb } from '@kitstak/entitlements';
import { addPerson, createTestOrg, openTestDb, removeTestOrg, testRuntime, type TestOrg } from '../testing/db';
import { canStartTrial, changeTrialProducts, startTrial } from './trial';
import { listAuditLog } from './audit';
import { getPlanState } from './state';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 30_000 });

const NOW = new Date('2026-11-23T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const CART = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' } as const;

describe.skipIf(!available)('free trial (database)', () => {
  const orgs: TestOrg[] = [];
  const extraUsers: string[] = [];
  const rt = testRuntime(db, { now: () => NOW });
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg(pool, ['admin']);
    orgs.push(org);
  });

  afterAll(async () => {
    for (const made of orgs) await removeTestOrg(pool, made, extraUsers);
    await pool.end();
  });

  const actorOf = (target: TestOrg) => ({ userId: target.owner.id, label: target.owner.name });

  it('refuses an empty cart', async () => {
    const result = await startTrial(rt, { orgId: org.orgId, selection: { ...CART, products: [] }, actor: actorOf(org) });
    expect(result).toEqual({ ok: false, error: { code: 'invalid_selection', message: 'Pick at least one app.' } });
  });

  it('starts a 14 day trial: trialing rows from source trial with a real end date', async () => {
    await expect(canStartTrial(db, { orgId: org.orgId, userId: org.owner.id })).resolves.toEqual({ ok: true });
    const result = await startTrial(rt, { orgId: org.orgId, selection: CART, actor: actorOf(org) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.phase).toBe('trial');
    expect(result.data.trial?.daysLeft).toBe(14);
    expect(result.data.trial?.endsAt.getTime()).toBe(NOW.getTime() + 14 * DAY);
    expect(result.data.modules.crm).toMatchObject({ access: 'full', inPlan: true, source: 'trial' });
    expect(result.data.modules.projects.access).toBe('locked');

    const { rows } = await pool.query(
      `select module, status, source, seats, current_period_end, stripe_subscription_id
         from core.entitlements where org_id = $1 order by module`,
      [org.orgId],
    );
    expect(rows.map((row) => [row.module, row.status, row.source, row.seats])).toEqual([
      ['crm', 'trialing', 'trial', 5],
      ['wms', 'trialing', 'trial', null],
    ]);
    for (const row of rows) {
      expect(new Date(row.current_period_end).getTime()).toBe(NOW.getTime() + 14 * DAY);
      expect(row.stripe_subscription_id).toBeNull();
    }

    const account = await pool.query(`select cart, trial_started_by, gateway from core.billing_accounts where org_id = $1`, [org.orgId]);
    expect(account.rows[0].cart).toEqual({ ...CART, products: ['crm', 'wms'] });
    expect(account.rows[0].trial_started_by).toBe(org.owner.id);
    // A trial needs no gateway object at all.
    expect(account.rows[0].gateway).toBeNull();
    const customers = await pool.query(`select 1 from core.stripe_customers where org_id = $1`, [org.orgId]);
    expect(customers.rowCount).toBe(0);
  });

  it('writes one audit sentence and queues the welcome email once', async () => {
    const log = await listAuditLog(db, { orgId: org.orgId });
    expect(log.map((entry) => [entry.action, entry.summary, entry.actorLabel])).toEqual([
      ['trial.started', 'Maya Chen started a free trial for CRM and WMS.', 'Maya Chen'],
    ]);
    const emails = await pool.query(`select to_email, template, payload, status from core.billing_emails where org_id = $1`, [org.orgId]);
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0]).toMatchObject({ to_email: org.owner.email, template: 'welcome', status: 'queued' });
    expect(emails.rows[0].payload).toMatchObject({ firstName: 'Maya', products: ['crm', 'wms'], orgName: org.name });
  });

  it('one free trial per organization', async () => {
    await expect(canStartTrial(db, { orgId: org.orgId, userId: org.people[1]!.id })).resolves.toEqual({ ok: false, reason: 'org_had_trial' });
    const again = await startTrial(rt, { orgId: org.orgId, selection: CART, actor: { userId: org.people[1]!.id, label: 'Admin' } });
    expect(again).toMatchObject({ ok: false, error: { code: 'trial_used' } });
    const rows = await pool.query(`select count(*)::int as n from core.entitlements where org_id = $1`, [org.orgId]);
    expect(rows.rows[0].n).toBe(2);
  });

  it('one free trial per person, also after their first organization is deleted', async () => {
    const second = await createTestOrg(pool);
    orgs.push(second);
    // The same person owns a second org.
    await pool.query(`insert into core.member (organization_id, user_id, role, created_at) values ($1, $2, 'owner', now())`, [second.orgId, org.owner.id]);
    await expect(canStartTrial(db, { orgId: second.orgId, userId: org.owner.id })).resolves.toEqual({ ok: false, reason: 'user_had_trial' });
    const refused = await startTrial(rt, { orgId: second.orgId, selection: CART, actor: actorOf(org) });
    expect(refused).toMatchObject({ ok: false, error: { code: 'trial_used', message: 'You already used your free trial. You can still pick a plan.' } });

    // Another person can still start the trial for that org.
    await expect(canStartTrial(db, { orgId: second.orgId, userId: second.owner.id })).resolves.toEqual({ ok: true });

    // A trial starter whose org was deleted is still remembered.
    const gone = await createTestOrg(pool);
    const starter = await addPerson(pool, gone.orgId, 'owner', 'Farm Er');
    extraUsers.push(starter.id);
    expect((await startTrial(rt, { orgId: gone.orgId, selection: CART, actor: { userId: starter.id, label: starter.name } })).ok).toBe(true);
    await pool.query(`delete from core.organization where id = $1`, [gone.orgId]);
    extraUsers.push(...gone.people.map((person) => person.id));
    const fresh = await createTestOrg(pool);
    orgs.push(fresh);
    await expect(canStartTrial(db, { orgId: fresh.orgId, userId: starter.id })).resolves.toEqual({ ok: false, reason: 'user_had_trial' });
  });

  it('never touches an app KitStak granted by hand', async () => {
    const granted = await createTestOrg(pool);
    orgs.push(granted);
    await grantModule(db as unknown as EntitlementsDb, granted.orgId, 'crm', 'manual');
    const result = await startTrial(rt, { orgId: granted.orgId, selection: CART, actor: actorOf(granted) });
    expect(result.ok).toBe(true);
    const { rows } = await pool.query(`select module, status, source from core.entitlements where org_id = $1 order by module`, [granted.orgId]);
    expect(rows).toEqual([
      { module: 'crm', status: 'active', source: 'manual' },
      { module: 'wms', status: 'trialing', source: 'trial' },
    ]);
    const state = await getPlanState(rt, granted.orgId);
    expect(state.modules.crm).toMatchObject({ access: 'full', source: 'manual', inPlan: false });
  });

  it('adds and removes apps during the trial; added apps share the end date', async () => {
    const changed = await changeTrialProducts(rt, { orgId: org.orgId, products: ['crm', 'pulse'], actor: actorOf(org) });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.data.modules.pulse).toMatchObject({ access: 'full', inPlan: true });
    // A removed app is view only: what was made in it can still be read.
    expect(changed.data.modules.wms).toMatchObject({ access: 'read_only', inPlan: false });
    expect(changed.data.selection.products).toEqual(['crm', 'pulse']);

    const { rows } = await pool.query(`select module, status, current_period_end from core.entitlements where org_id = $1 order by module`, [org.orgId]);
    const pulse = rows.find((row) => row.module === 'pulse');
    expect(pulse.status).toBe('trialing');
    expect(new Date(pulse.current_period_end).getTime()).toBe(NOW.getTime() + 14 * DAY);

    const empty = await changeTrialProducts(rt, { orgId: org.orgId, products: [], actor: actorOf(org) });
    expect(empty).toMatchObject({ ok: false, error: { code: 'invalid_selection' } });
  });

  it('access ends by itself when the end date passes, with no job', async () => {
    const later = testRuntime(db, { now: () => new Date(NOW.getTime() + 14 * DAY + 1000) });
    const state = await getPlanState(later, org.orgId);
    expect(state.phase).toBe('trial_ended');
    expect(state.modules.crm.access).toBe('read_only');
    expect(state.modules.projects.access).toBe('locked');
    const tooLate = await changeTrialProducts(later, { orgId: org.orgId, products: ['crm'], actor: actorOf(org) });
    expect(tooLate.ok).toBe(false);
  });

  it('works when billing is off: a trial needs no gateway', async () => {
    const off = testRuntime(db, { now: () => NOW, env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv });
    expect(off.mode).toBe('unavailable');
    const target = await createTestOrg(pool);
    orgs.push(target);
    const result = await startTrial(off, { orgId: target.orgId, selection: CART, actor: actorOf(target) });
    expect(result.ok).toBe(true);
  });
});
