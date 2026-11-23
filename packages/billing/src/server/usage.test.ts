/** Against the local dev Postgres (docs/billing/DEV.md). Skipped when it is not reachable. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { completeTestCheckout } from '../gateway/test';
import { addPerson, createTestOrg, openTestDb, removeTestOrg, testRuntime, type TestOrg } from '../testing/db';
import { addBillingManager, getBillingAccess, listBillingHolders, removeBillingManager } from './access';
import { createCheckout } from './checkout';
import { billingRecipients } from './outbox';
import { enforceRateLimit } from './rate-limit';
import { isFreeRole, usesSeat } from './roles';
import { checkSeatAvailable, checkWarehouseAvailable, countBillableSeats, countWarehouses } from './usage';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 30_000 });

describe('roles', () => {
  it('guests are free; everyone else who is active uses a seat', () => {
    expect(isFreeRole('guest')).toBe(true);
    expect(isFreeRole('guest,guest')).toBe(true);
    expect(isFreeRole('member,guest')).toBe(false);
    expect(isFreeRole('')).toBe(false);
    expect(usesSeat('owner')).toBe(true);
    expect(usesSeat('viewer')).toBe(true);
    expect(usesSeat('guest')).toBe(false);
    expect(usesSeat('deactivated:member')).toBe(false);
  });
});

describe.skipIf(!available)('seats, warehouses and billing roles (database)', () => {
  const orgs: TestOrg[] = [];
  const rt = testRuntime(db);
  let org: TestOrg;

  beforeAll(async () => {
    // owner, admin, member, viewer use seats. A guest and a deactivated member do not.
    org = await createTestOrg(pool, ['admin', 'member', 'viewer', 'guest', 'deactivated:member']);
    orgs.push(org);
    const inviter = org.owner.id;
    const invite = (email: string, role: string, status: string, expires: string) =>
      pool.query(
        `insert into core.invitation (organization_id, email, role, status, expires_at, inviter_id)
         values ($1, $2, $3, $4, now() + $5::interval, $6)`,
        [org.orgId, email, role, status, expires, inviter],
      );
    await invite('pending@kitstak-test.example', 'member', 'pending', '7 days');
    await invite('guest@kitstak-test.example', 'guest', 'pending', '7 days');
    await invite('expired@kitstak-test.example', 'member', 'pending', '-1 day');
    await invite('accepted@kitstak-test.example', 'member', 'accepted', '7 days');
  });

  afterAll(async () => {
    for (const made of orgs) await removeTestOrg(pool, made);
    await pool.end();
  });

  it('counts people who use a seat, and open invites that would', async () => {
    await expect(countBillableSeats(db, org.orgId)).resolves.toEqual({ used: 4, pendingInvites: 1 });
    await expect(countBillableSeats(db, org.orgId, { ignoreInviteEmail: 'PENDING@kitstak-test.example' })).resolves.toEqual({
      used: 4,
      pendingInvites: 0,
    });
  });

  it('has no warehouse count for an org with no WMS schema', async () => {
    await expect(countWarehouses(db, org.orgId)).resolves.toBeNull();
    await expect(countWarehouses(db, 'not-a-uuid')).resolves.toBeNull();
  });

  it('no limits without a paid plan', async () => {
    await expect(checkSeatAvailable(db, { orgId: org.orgId, adding: 50, role: 'member' })).resolves.toEqual({ ok: true });
    await expect(checkWarehouseAvailable(db, { orgId: org.orgId, adding: 9 })).resolves.toEqual({ ok: true });
  });

  it('checkout cannot be smaller than the people the org has', async () => {
    const small = await createCheckout(rt, {
      orgId: org.orgId,
      orgName: org.name,
      selection: { products: ['crm'], seats: 3, warehouses: 1, interval: 'monthly' },
      actor: { userId: org.owner.id, label: org.owner.name },
      actorEmail: org.owner.email,
    });
    // The org has 4 people and 1 open invite. The invite holds a seat, so 5 is the lowest.
    expect(small).toEqual({
      ok: false,
      error: {
        code: 'below_usage',
        message: 'You have 4 people and 1 open invite. Each open invite holds a seat. Pick 5 seats or more, or cancel an invite first.',
      },
    });
  });

  it('on a paid plan the seat limit holds; guests stay free', async () => {
    const checkout = await createCheckout(rt, {
      orgId: org.orgId,
      orgName: org.name,
      selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' },
      actor: { userId: org.owner.id, label: org.owner.name },
      actorEmail: org.owner.email,
    });
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) return;
    const paid = await completeTestCheckout(rt, {
      sessionId: checkout.data.sessionId,
      cardNumber: '4242 4242 4242 4242',
      expMonth: 12,
      expYear: 2031,
      cvc: '123',
      name: 'Maya Chen',
      postalCode: '60601',
    });
    expect(paid.ok).toBe(true);

    // 4 people + 1 open invite = 5 of 5 seats.
    await expect(checkSeatAvailable(db, { orgId: org.orgId, adding: 1, role: 'guest' })).resolves.toEqual({ ok: true });
    await expect(checkSeatAvailable(db, { orgId: org.orgId, adding: 1, role: 'member' })).resolves.toEqual({
      ok: false,
      code: 'seat_limit',
      message: 'All 5 seats are in use. Add a seat in Billing, then invite again.',
      limit: 5,
      used: 4,
      pulseOnly: false,
    });
    // Inviting the same address again replaces the open invite, so it fits.
    await expect(
      checkSeatAvailable(db, { orgId: org.orgId, adding: 1, role: 'member', ignoreInviteEmail: 'pending@kitstak-test.example' }),
    ).resolves.toEqual({ ok: true });

    // The plan pays for 1 warehouse and the org has none yet: one more fits, two do not.
    await expect(checkWarehouseAvailable(db, { orgId: org.orgId, adding: 1 })).resolves.toEqual({ ok: true });
    await expect(checkWarehouseAvailable(db, { orgId: org.orgId, adding: 2 })).resolves.toEqual({
      ok: false,
      code: 'warehouse_limit',
      message: 'Your plan covers 1 warehouse. Add one more for $279.20 more per month.',
      paid: 1,
      used: 0,
    });
  });

  it('billing access: owners and managers manage, admins see, members do not', async () => {
    const [owner, admin, member] = org.people;
    await expect(getBillingAccess(db, { orgId: org.orgId, userId: owner!.id, role: 'owner' })).resolves.toEqual({
      isOwner: true,
      isAdmin: false,
      isBillingManager: false,
      canView: true,
      canManage: true,
      canStartTrial: true,
      canAssignManagers: true,
      ownerName: 'Maya Chen',
    });
    await expect(getBillingAccess(db, { orgId: org.orgId, userId: admin!.id, role: 'admin' })).resolves.toMatchObject({
      canView: true,
      canManage: false,
      canStartTrial: true,
      canAssignManagers: false,
    });
    await expect(getBillingAccess(db, { orgId: org.orgId, userId: member!.id, role: 'member' })).resolves.toMatchObject({
      canView: false,
      canManage: false,
      canStartTrial: false,
      ownerName: 'Maya Chen',
    });
    await expect(getBillingAccess(db, { orgId: org.orgId, userId: owner!.id, role: 'deactivated:owner' })).resolves.toMatchObject({
      canView: false,
      canManage: false,
    });
  });

  it('a plain member can be made a billing manager, and removed again', async () => {
    const actor = { userId: org.owner.id, label: org.owner.name };
    const member = org.people[2]!;
    await expect(addBillingManager(rt, { orgId: org.orgId, userId: member.id, actor })).resolves.toEqual({ ok: true, data: null });
    // Adding twice changes nothing.
    await expect(addBillingManager(rt, { orgId: org.orgId, userId: member.id, actor })).resolves.toEqual({ ok: true, data: null });
    await expect(getBillingAccess(db, { orgId: org.orgId, userId: member.id, role: 'member' })).resolves.toMatchObject({
      isBillingManager: true,
      canView: true,
      canManage: true,
      canAssignManagers: false,
    });
    const holders = await listBillingHolders(db, org.orgId);
    expect(holders.map((holder) => [holder.name, holder.kind])).toEqual([
      ['Maya Chen', 'owner'],
      [member.name, 'manager'],
    ]);
    const recipients = await billingRecipients(db, org.orgId);
    expect([...recipients].sort()).toEqual([org.owner.email, member.email].sort());

    const stranger = await addPerson(pool, null, 'member');
    await expect(addBillingManager(rt, { orgId: org.orgId, userId: stranger.id, actor })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    await pool.query(`delete from core."user" where id = $1`, [stranger.id]);

    await expect(removeBillingManager(rt, { orgId: org.orgId, userId: member.id, actor })).resolves.toEqual({ ok: true, data: null });
    await expect(removeBillingManager(rt, { orgId: org.orgId, userId: member.id, actor })).resolves.toMatchObject({ ok: false });
    const audits = await pool.query(`select action, summary from core.billing_audit_log where org_id = $1 and action like 'manager.%' order by created_at`, [org.orgId]);
    expect(audits.rows).toEqual([
      { action: 'manager.added', summary: `Maya Chen made ${member.name} a billing manager.` },
      { action: 'manager.removed', summary: `Maya Chen removed ${member.name} as a billing manager.` },
    ]);
  });

  it('rate limits count per key inside one window', async () => {
    const key = `test:${org.orgId}`;
    const answers: boolean[] = [];
    for (let i = 0; i < 4; i += 1) answers.push(await enforceRateLimit(db, { key, windowSeconds: 600, max: 3 }));
    expect(answers).toEqual([true, true, true, false]);
    const stored = await pool.query(`select count from core.rate_limit where key = $1`, [`billing:${key}`]);
    expect(stored.rows[0].count).toBe(4);
    // A window that is already over starts again at 1.
    await pool.query(`update core.rate_limit set last_request = 0 where key = $1`, [`billing:${key}`]);
    await expect(enforceRateLimit(db, { key, windowSeconds: 600, max: 3 })).resolves.toBe(true);
  });
});
