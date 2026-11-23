/**
 * What the product apps and the signup lane lean on: the app plan view, the shared organization
 * hooks, signup intents and the billing profile. Against the local dev Postgres (docs/billing/DEV.md);
 * skipped when it is not reachable.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type EntitlementsDb, grantModule } from '@kitstak/entitlements';
import { completeTestCheckout } from '../gateway/test';
import { addPerson, createTestOrg, openTestDb, removeTestOrg, testRuntime, TEST_PORTAL_URL, type TestOrg } from '../testing/db';
import { billingOrganizationOptions } from './auth-hooks';
import { createCheckout } from './checkout';
import { completeSignupIntent, getOpenSignupIntent, upsertSignupIntent } from './intents';
import { getBillingProfile, updateBillingProfile, validateBillingProfile } from './profile';
import { clearPlanCache, getAppPlanView } from './state';
import { startTrial } from './trial';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
const CRM_WMS = { products: ['crm', 'wms'], seats: 2, warehouses: 1, interval: 'monthly' } as const;

describe('validateBillingProfile', () => {
  it('cleans a good profile', () => {
    const checked = validateBillingProfile({
      billingEmail: ' Billing@Northwind.example ',
      companyName: '  Northwind Robotics ',
      address: { line1: '1 Main St', city: 'Chicago', state: 'IL', postalCode: '60601', country: 'us', extra: 'x' },
      taxIdType: 'EU_VAT',
      taxIdValue: 'DE123456789',
    });
    expect(checked).toEqual({
      ok: true,
      profile: {
        billingEmail: 'billing@northwind.example',
        companyName: 'Northwind Robotics',
        address: { line1: '1 Main St', city: 'Chicago', state: 'IL', postalCode: '60601', country: 'US' },
        taxIdType: 'eu_vat',
        taxIdValue: 'DE123456789',
      },
    });
  });

  it.each([
    [{ billingEmail: 'not-an-email' }, 'Enter a valid billing email.'],
    [{ companyName: 'x'.repeat(121) }, 'Use 120 characters or fewer for the company name.'],
    [{ address: { country: 'USA' } }, 'Pick a country from the list.'],
    [{ taxIdType: 'eu_vat' }, 'Enter both the tax ID type and the number, or leave both empty.'],
    [{ taxIdType: 'eu vat!', taxIdValue: '1' }, 'That tax ID does not look right. Check it and try again.'],
  ])('refuses %o with a plain sentence', (input, message) => {
    expect(validateBillingProfile(input)).toEqual({ ok: false, message });
  });

  it('an empty profile is fine', () => {
    expect(validateBillingProfile({})).toEqual({
      ok: true,
      profile: { billingEmail: null, companyName: null, address: {}, taxIdType: null, taxIdValue: null },
    });
  });
});

describe.skipIf(!available)('app plan view, organization hooks, intents and profile (database)', () => {
  const orgs: TestOrg[] = [];
  const extraUsers: string[] = [];
  const rt = testRuntime(db);
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg(pool, ['admin', 'member']);
    orgs.push(org);
  });

  afterAll(async () => {
    for (const made of orgs) await removeTestOrg(pool, made, extraUsers);
    await pool.end();
  });

  const view = (target: TestOrg, module: 'crm' | 'wms' | 'projects' | 'pulse', person: { id: string; role: string }, allowAll = false, now?: Date) =>
    getAppPlanView(db, {
      orgId: target.orgId,
      module,
      userId: person.id,
      role: person.role,
      portalUrl: TEST_PORTAL_URL,
      allowAll,
      ...(now ? { now } : {}),
    });

  it('an org with nothing: locked with a "start free trial" lock; quiet under the dev switch', async () => {
    const owner = org.people[0]!;
    const locked = await view(org, 'crm', owner);
    expect(locked.access).toBe('locked');
    expect(locked.notice).toBeNull();
    expect(locked.lock).toMatchObject({ kind: 'trial_available', primary: { label: 'Start free trial', href: 'http://localhost:3300/billing/plan?add=crm&from=crm' } });
    expect(locked.badges).toEqual({ crm: 'not_in_plan', wms: 'not_in_plan', projects: 'not_in_plan', pulse: 'not_in_plan' });

    const dev = await view(org, 'crm', owner, true);
    expect(dev).toMatchObject({ access: 'full', notice: null, lock: null });
    expect(dev.badges.crm).toBe('included');
  });

  it('in a trial: full access with the trial banner; other apps are locked; a new trial shows at once', async () => {
    const [owner, admin, member] = org.people;
    // The "locked" answer above is in the cache. A new trial must still show on the next request.
    const started = await startTrial(rt, { orgId: org.orgId, selection: CRM_WMS, actor: { userId: owner!.id, label: owner!.name } });
    expect(started.ok).toBe(true);

    const crm = await view(org, 'crm', owner!);
    expect(crm.access).toBe('full');
    expect(crm.lock).toBeNull();
    // Day one has no banner (nobody is asked to pick a plan in their first session). The badges
    // already say "Trial", so the new trial does show at once.
    expect(crm.notice).toBeNull();
    expect(crm.badges).toEqual({ crm: 'trial', wms: 'trial', projects: 'not_in_plan', pulse: 'not_in_plan' });
    const dayTwo = await view(org, 'crm', owner!, false, new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(dayTwo.notice).toMatchObject({ kind: 'trial', tone: 'info', action: { label: 'Pick a plan', href: 'http://localhost:3300/billing/plan?from=crm' } });
    expect(dayTwo.notice?.text).toMatch(/^Free trial\. 13 days left\. Ends [A-Z][a-z]{2} \d{1,2}\.$/);
    expect(crm.usage).toMatchObject({ seatsUsed: 3, seatLimit: null });

    // Every app says the same words for the same plan.
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect((await view(org, 'wms', owner!, false, later)).notice?.text).toBe(dayTwo.notice?.text);
    expect((await view(org, 'crm', admin!, false, later)).notice?.kind).toBe('trial');
    expect((await view(org, 'crm', member!, false, later)).notice).toBeNull();

    const projects = await view(org, 'projects', owner!);
    expect(projects.access).toBe('locked');
    expect(projects.notice).toBeNull();
    expect(projects.lock).toMatchObject({ title: 'Projects is not in your trial yet', primary: { label: 'Add Projects to my trial' } });
    expect((await view(org, 'projects', member!)).lock).toMatchObject({ body: 'Ask Maya Chen to add it.', primary: null });

    // Under the dev switch the real banner still shows, and access is full everywhere.
    const dev = await view(org, 'projects', owner!, true);
    expect(dev).toMatchObject({ access: 'full', lock: null });
    expect((await view(org, 'crm', owner!, true)).notice?.kind).toBe('trial');
  });

  it('after the trial: view only with a danger banner for everyone; a manual grant stays full', async () => {
    const [owner, , member] = org.people;
    await grantModule(db as unknown as EntitlementsDb, org.orgId, 'pulse', 'manual');
    clearPlanCache(org.orgId);
    const later = new Date(Date.now() + 15 * DAY);
    const crm = await view(org, 'crm', owner!, false, later);
    expect(crm.access).toBe('read_only');
    expect(crm.lock).toBeNull();
    expect(crm.notice).toMatchObject({ kind: 'trial_ended', tone: 'danger', action: { label: 'Pick a plan' } });
    expect(crm.badges.crm).toBe('view_only');
    expect((await view(org, 'crm', member!, false, later)).notice).toMatchObject({
      text: 'This app is view only right now. Ask Maya Chen to pick a plan.',
      action: null,
    });
    const pulse = await view(org, 'pulse', owner!, false, later);
    expect(pulse).toMatchObject({ access: 'full', notice: null, lock: null });
    expect(pulse.badges.pulse).toBe('included');
  });

  it('good news is never served stale: a payment shows on the next call', async () => {
    const paidOrg = await createTestOrg(pool);
    orgs.push(paidOrg);
    const owner = paidOrg.people[0]!;
    expect((await view(paidOrg, 'crm', owner)).access).toBe('locked');
    const checkout = await createCheckout(rt, {
      orgId: paidOrg.orgId,
      orgName: paidOrg.name,
      selection: { products: ['crm'], seats: 1, warehouses: 1, interval: 'monthly' },
      actor: { userId: owner.id, label: owner.name },
      actorEmail: owner.email,
    });
    if (!checkout.ok) throw new Error(checkout.error.message);
    await completeTestCheckout(rt, { sessionId: checkout.data.sessionId, cardNumber: '4242424242424242', expMonth: 12, expYear: 2031, cvc: '123', name: 'Maya Chen', postalCode: '60601' });
    const after = await view(paidOrg, 'crm', owner);
    expect(after).toMatchObject({ access: 'full', notice: null, lock: null });
    expect(after.badges.crm).toBe('active');
    expect((await view(paidOrg, 'wms', owner)).lock).toMatchObject({
      title: 'WMS is not in your plan yet',
      body: 'Add WMS for $279.20 per warehouse each month.',
      primary: { label: 'Add WMS to my plan', href: 'http://localhost:3300/billing/plan?add=wms&from=wms' },
    });
  });

  it('organization hooks: the seat limit, the invite email and the delete guard hold at every door', async () => {
    const seatOrg = await createTestOrg(pool, ['member']);
    orgs.push(seatOrg);
    const owner = seatOrg.people[0]!;
    const options = billingOrganizationOptions({ db, portalUrl: `${TEST_PORTAL_URL}/`, allowAll: () => true });
    const hooks = options.organizationHooks!;
    const organization = { id: seatOrg.orgId, name: seatOrg.name, slug: 'x', createdAt: new Date() };
    const ownerUser = { id: owner.id, name: owner.name, email: owner.email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() };
    const invite = (email: string, role: string) =>
      hooks.beforeCreateInvitation!({ invitation: { email, role, organizationId: seatOrg.orgId, inviterId: owner.id }, inviter: ownerUser, organization });

    // No paid plan: no limits, and an org with no plan can be deleted.
    await expect(invite('one@kitstak-test.example', 'member')).resolves.toBeUndefined();
    await expect(hooks.beforeDeleteOrganization!({ organization, user: ownerUser })).resolves.toBeUndefined();

    // A plan with exactly the 2 seats in use.
    const checkout = await createCheckout(rt, {
      orgId: seatOrg.orgId,
      orgName: seatOrg.name,
      selection: { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' },
      actor: { userId: owner.id, label: owner.name },
      actorEmail: owner.email,
    });
    if (!checkout.ok) throw new Error(checkout.error.message);
    await completeTestCheckout(rt, { sessionId: checkout.data.sessionId, cardNumber: '4242424242424242', expMonth: 12, expYear: 2031, cvc: '123', name: 'Maya Chen', postalCode: '60601' });

    const refused = await invite('two@kitstak-test.example', 'member').catch((error: unknown) => error);
    expect(refused).toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'SEAT_LIMIT_REACHED', message: 'All 2 seats are in use. Add a seat in Billing, then invite again.' },
    });
    // Guests are free.
    await expect(invite('guest@kitstak-test.example', 'guest')).resolves.toBeUndefined();

    const stranger = await addPerson(pool, null, 'member');
    extraUsers.push(stranger.id);
    const strangerUser = { ...ownerUser, id: stranger.id, name: stranger.name, email: stranger.email };
    await expect(
      hooks.beforeAddMember!({ member: { userId: stranger.id, organizationId: seatOrg.orgId, role: 'member' }, user: strangerUser, organization }),
    ).rejects.toMatchObject({ body: { code: 'SEAT_LIMIT_REACHED' } });
    await expect(
      hooks.beforeAddMember!({ member: { userId: stranger.id, organizationId: seatOrg.orgId, role: 'guest' }, user: strangerUser, organization }),
    ).resolves.toBeUndefined();

    const memberRow = { id: 'm1', organizationId: seatOrg.orgId, userId: stranger.id, role: 'guest', createdAt: new Date() };
    await expect(hooks.beforeUpdateMemberRole!({ member: memberRow, newRole: 'member', user: strangerUser, organization })).rejects.toMatchObject({
      body: { code: 'SEAT_LIMIT_REACHED' },
    });
    // A change between two paid roles needs no new seat.
    await expect(hooks.beforeUpdateMemberRole!({ member: { ...memberRow, role: 'member' }, newRole: 'admin', user: strangerUser, organization })).resolves.toBeUndefined();

    await expect(hooks.beforeDeleteOrganization!({ organization, user: ownerUser })).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'PLAN_ACTIVE', message: 'Cancel your plan before you delete this organization.' },
    });

    const expiresAt = new Date(Date.now() + 7 * DAY);
    await options.sendInvitationEmail!({
      id: 'inv_123',
      role: 'member',
      email: 'New.Person@kitstak-test.example',
      organization,
      invitation: { id: 'inv_123', organizationId: seatOrg.orgId, email: 'new.person@kitstak-test.example', role: 'member', status: 'pending', inviterId: owner.id, expiresAt, createdAt: new Date() },
      inviter: { id: 'm0', organizationId: seatOrg.orgId, userId: owner.id, role: 'owner', createdAt: new Date(), user: ownerUser },
    } as never);
    const emails = (await pool.query(`select to_email, template, payload, dedupe_key from core.billing_emails where org_id = $1 and template = 'invitation'`, [seatOrg.orgId])).rows;
    expect(emails).toEqual([
      {
        to_email: 'new.person@kitstak-test.example',
        template: 'invitation',
        dedupe_key: 'invite:inv_123',
        payload: { orgName: seatOrg.name, portalUrl: TEST_PORTAL_URL, inviterName: 'Maya Chen', acceptUrl: `${TEST_PORTAL_URL}/invite/inv_123`, expiresAt: expiresAt.toISOString() },
      },
    ]);
  });

  it('signup intents: one open intent per person, merged, read back clean, then closed', async () => {
    const person = await addPerson(pool, null, 'member');
    extraUsers.push(person.id);
    expect(await getOpenSignupIntent(db, person.id)).toBeNull();

    const first = await upsertSignupIntent(db, {
      userId: person.id,
      handoff: { selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' }, profile: { businessType: '3pl', guided: true }, source: 'wizard' },
    });
    expect(first).toMatchObject({ userId: person.id, orgId: null, step: 'company', source: 'wizard', verifySkippedAt: null });
    expect(first.selection).toEqual({ products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' });

    // A revisit with a plain link keeps the cart and where the person came from, and adds answers.
    const second = await upsertSignupIntent(db, {
      userId: person.id,
      orgId: org.orgId,
      step: 'plan',
      handoff: { selection: null, profile: { teamSize: 'small' }, source: 'direct' },
    });
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ orgId: org.orgId, step: 'plan', source: 'wizard', profile: { businessType: '3pl', guided: true, teamSize: 'small' } });
    expect(second.selection?.products).toEqual(['crm', 'wms']);

    const skipped = await upsertSignupIntent(db, { userId: person.id, verifySkipped: true, step: 'welcome' });
    expect(skipped.step).toBe('welcome');
    expect(skipped.verifySkippedAt).toBeInstanceOf(Date);
    expect(skipped.orgId).toBe(org.orgId);

    // Stored JSON is untrusted: junk is dropped on the way out.
    await pool.query(`update core.signup_intents set selection = $2, profile = $3 where id = $1`, [
      first.id,
      JSON.stringify({ products: ['crm', 'hack'], seats: 99999, price: 1 }),
      JSON.stringify({ businessType: 'bank', teamSize: 'small', role: 'admin' }),
    ]);
    const read = await getOpenSignupIntent(db, person.id);
    expect(read?.selection).toEqual({ products: ['crm'], seats: 500, warehouses: 1, interval: 'monthly' });
    expect(read?.profile).toEqual({ teamSize: 'small' });

    await completeSignupIntent(db, person.id);
    expect(await getOpenSignupIntent(db, person.id)).toBeNull();
    await completeSignupIntent(db, person.id);
    // A later signup step starts a new open intent.
    const fresh = await upsertSignupIntent(db, { userId: person.id });
    expect(fresh.id).not.toBe(first.id);
    expect(fresh).toMatchObject({ selection: null, source: 'direct', step: 'company' });
  });

  it('billing profile: saved, read back, and audited', async () => {
    const actor = { userId: org.owner.id, label: org.owner.name };
    await expect(getBillingProfile(db, org.orgId)).resolves.toEqual({ billingEmail: null, companyName: null, address: {}, taxIdType: null, taxIdValue: null });
    const bad = await updateBillingProfile(rt, { orgId: org.orgId, profile: { billingEmail: 'nope', companyName: null, address: {}, taxIdType: null, taxIdValue: null }, actor });
    expect(bad).toEqual({ ok: false, error: { code: 'invalid_input', message: 'Enter a valid billing email.' } });

    const profile = { billingEmail: 'billing@northwind.example', companyName: 'Northwind Robotics', address: { line1: '1 Main St', country: 'US' }, taxIdType: 'us_ein', taxIdValue: '12-3456789' };
    await expect(updateBillingProfile(rt, { orgId: org.orgId, profile, actor })).resolves.toEqual({ ok: true, data: profile });
    await expect(getBillingProfile(db, org.orgId)).resolves.toEqual(profile);
    const audits = (await pool.query(`select summary from core.billing_audit_log where org_id = $1 and action = 'profile.updated'`, [org.orgId])).rows;
    expect(audits).toEqual([{ summary: 'Maya Chen updated the billing details.' }]);
    // The trial dates on the same row were not touched.
    const account = (await pool.query(`select trial_ends_at from core.billing_accounts where org_id = $1`, [org.orgId])).rows[0];
    expect(account.trial_ends_at).not.toBeNull();
  });
});
