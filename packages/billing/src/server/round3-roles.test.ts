/**
 * Review round 3, security: only an owner can add or remove a billing manager, at every door of the
 * shared sign in API (SPEC P15). Proven twice: against the rule itself (one case per door: admin
 * refused, owner allowed, nothing written on a refusal), and against the real endpoints of a real
 * auth instance, called as an admin with a real session cookie.
 *
 * Runs against the local dev Postgres. Skipped when the database is not reachable.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '@kitstak/auth';
import * as schema from '@kitstak/db/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { addPerson, createTestOrg, openTestDb, removeTestOrg, type TestOrg, type TestPerson } from '../testing/db';
import { addBillingManager } from './access';
import { BILLING_ROLE_OWNER_ONLY_MESSAGE, billingOrganizationOptions, guardBillingRoleChange } from './auth-hooks';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 60_000 });

const ORIGIN = 'http://localhost:3300';
const SECRET = 'round-three-test-secret-round-three-test-secret';
const orgs: TestOrg[] = [];

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org);
  await pool.end();
});

async function team(): Promise<{ org: TestOrg; owner: TestPerson; admin: TestPerson; member: TestPerson }> {
  const org = await createTestOrg(pool, ['admin', 'member']);
  orgs.push(org);
  const [owner, admin, member] = org.people;
  return { org, owner: owner!, admin: admin!, member: member! };
}

async function memberRow(orgId: string, userId: string): Promise<{ id: string; role: string }> {
  const { rows } = await pool.query<{ id: string; role: string }>(
    `select id, role from core.member where organization_id = $1 and user_id = $2`,
    [orgId, userId],
  );
  return rows[0]!;
}

const REFUSED = { status: 'FORBIDDEN', body: { code: 'BILLING_ROLE_OWNER_ONLY', message: BILLING_ROLE_OWNER_ONLY_MESSAGE } };

describe.skipIf(!available)('the rule: only an owner can add or remove a billing manager', () => {
  it('says it in one plain sentence', () => {
    expect(BILLING_ROLE_OWNER_ONLY_MESSAGE).toBe('Only an owner can add or remove a billing manager.');
  });

  it('invite: an admin cannot invite a billing manager, an owner can, and other invites pass', async () => {
    const { org, owner, admin } = await team();
    const invite = (actor: string, role: unknown) => guardBillingRoleChange(db, actor, { door: 'invite', orgId: org.orgId, role });
    await expect(invite(admin.id, 'billing')).rejects.toMatchObject(REFUSED);
    await expect(invite(admin.id, ['member', 'billing'])).rejects.toMatchObject(REFUSED);
    await expect(invite(admin.id, 'member, Billing')).rejects.toMatchObject(REFUSED);
    await expect(invite(owner.id, 'billing')).resolves.toBeUndefined();
    await expect(invite(admin.id, 'member')).resolves.toBeUndefined();
    await expect(invite(admin.id, ['admin', 'viewer'])).resolves.toBeUndefined();
  });

  it('role change: an admin cannot give the billing role to anyone or take it away, an owner can', async () => {
    const { org, owner, admin, member } = await team();
    const self = await memberRow(org.orgId, admin.id);
    const other = await memberRow(org.orgId, member.id);
    const change = (actor: string, memberId: string, role: unknown) =>
      guardBillingRoleChange(db, actor, { door: 'update_role', memberId, role });

    await expect(change(admin.id, self.id, ['admin', 'billing'])).rejects.toMatchObject(REFUSED);
    await expect(change(admin.id, other.id, 'member,billing')).rejects.toMatchObject(REFUSED);
    await expect(change(owner.id, other.id, 'member,billing')).resolves.toBeUndefined();
    // A change that leaves the billing role as it is passes: the other rules decide.
    await expect(change(admin.id, other.id, 'viewer')).resolves.toBeUndefined();

    await pool.query(`update core.member set role = 'member,billing' where id = $1`, [other.id]);
    await expect(change(admin.id, other.id, 'member')).rejects.toMatchObject(REFUSED);
    await expect(change(admin.id, other.id, ['viewer', 'billing'])).resolves.toBeUndefined();
    await expect(change(owner.id, other.id, 'member')).resolves.toBeUndefined();
  });

  it('role change: an owner of another organization, a deactivated owner and a stranger are refused', async () => {
    const { org, owner, member } = await team();
    const elsewhere = await team();
    const target = await memberRow(org.orgId, member.id);
    const change = (actor: string | null) => guardBillingRoleChange(db, actor, { door: 'update_role', memberId: target.id, role: 'billing' });
    await expect(change(elsewhere.owner.id)).rejects.toMatchObject(REFUSED);
    await expect(change(null)).rejects.toMatchObject(REFUSED);
    await pool.query(`update core.member set role = 'deactivated:owner' where organization_id = $1 and user_id = $2`, [org.orgId, owner.id]);
    await expect(change(owner.id)).rejects.toMatchObject(REFUSED);
  });

  it('remove: an admin cannot remove a billing manager (by role or by grant), an owner can', async () => {
    const { org, owner, admin, member } = await team();
    const bookkeeper = await addPerson(pool, org.orgId, 'billing');
    const books = await memberRow(org.orgId, bookkeeper.id);
    const plain = await memberRow(org.orgId, member.id);
    const remove = (actor: string, key: string) =>
      guardBillingRoleChange(db, actor, { door: 'remove_member', orgId: org.orgId, memberIdOrEmail: key });

    await expect(remove(admin.id, books.id)).rejects.toMatchObject(REFUSED);
    await expect(remove(admin.id, bookkeeper.email)).rejects.toMatchObject(REFUSED);
    await expect(remove(owner.id, books.id)).resolves.toBeUndefined();
    await expect(remove(admin.id, plain.id)).resolves.toBeUndefined();

    // A member who was made a billing manager in the Portal (core.billing_managers).
    const added = await addBillingManager(
      { db, portalUrl: ORIGIN, now: () => new Date() } as never,
      { orgId: org.orgId, userId: member.id, actor: { userId: owner.id, label: owner.name } },
    );
    expect(added.ok).toBe(true);
    await expect(remove(admin.id, plain.id)).rejects.toMatchObject(REFUSED);
    await expect(remove(owner.id, plain.id)).resolves.toBeUndefined();
    await pool.query(`delete from core."user" where id = $1`, [bookkeeper.id]);
  });

  it('cancel invite: an admin cannot cancel an open billing invite, an owner can', async () => {
    const { org, owner, admin } = await team();
    const { rows } = await pool.query<{ id: string }>(
      `insert into core.invitation (organization_id, email, role, status, expires_at, inviter_id)
       values ($1, 'books@kitstak-test.example', 'billing', 'pending', now() + interval '7 days', $2),
              ($1, 'teammate@kitstak-test.example', 'member', 'pending', now() + interval '7 days', $2)
       returning id`,
      [org.orgId, owner.id],
    );
    const cancel = (actor: string, invitationId: string) => guardBillingRoleChange(db, actor, { door: 'cancel_invite', invitationId });
    await expect(cancel(admin.id, rows[0]!.id)).rejects.toMatchObject(REFUSED);
    await expect(cancel(owner.id, rows[0]!.id)).resolves.toBeUndefined();
    await expect(cancel(admin.id, rows[1]!.id)).resolves.toBeUndefined();
  });

  it('the hooks: an invite for billing checks the inviter, and a direct add never hands out the role', async () => {
    const { org, owner, admin } = await team();
    const hooks = billingOrganizationOptions({ db, portalUrl: ORIGIN, allowAll: () => true }).organizationHooks!;
    const organization = { id: org.orgId, name: org.name, slug: 'x', createdAt: new Date() };
    const person = (who: TestPerson) => ({ id: who.id, name: who.name, email: who.email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    const invite = (who: TestPerson, role: string) =>
      hooks.beforeCreateInvitation!({
        invitation: { email: 'books@kitstak-test.example', role, organizationId: org.orgId, inviterId: who.id },
        inviter: person(who),
        organization,
      });
    await expect(invite(admin, 'billing')).rejects.toMatchObject(REFUSED);
    await expect(invite(owner, 'billing')).resolves.toBeUndefined();
    await expect(invite(admin, 'guest')).resolves.toBeUndefined();

    const add = (role: string) =>
      hooks.beforeAddMember!({ member: { userId: admin.id, organizationId: org.orgId, role }, user: person(admin), organization });
    await expect(add('admin,billing')).rejects.toMatchObject(REFUSED);
    await expect(add('guest')).resolves.toBeUndefined();
  });
});

describe.skipIf(!available)('the real endpoints, called as an admin with a real session', () => {
  const auth = createAuth({
    db: drizzle(pool, { schema }),
    schema,
    secret: SECRET,
    baseURL: ORIGIN,
    trustedOrigins: [ORIGIN],
    organization: billingOrganizationOptions({ db, portalUrl: ORIGIN, allowAll: () => true, inviteSecret: SECRET }),
  });

  /** A session row for this person, and the signed cookie a browser would hold for it. */
  async function signedIn(person: TestPerson, orgId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await pool.query(
      `insert into core.session (token, user_id, expires_at, created_at, updated_at, active_organization_id)
       values ($1, $2, now() + interval '1 day', now(), now(), $3)`,
      [token, person.id, orgId],
    );
    const signature = createHmac('sha256', SECRET).update(token).digest('base64');
    return `kitstak.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
  }

  async function call(path: string, body: unknown, cookie: string): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
        body: JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }

  it('the session cookie made here is a real one', async () => {
    const { org, admin } = await team();
    const cookie = await signedIn(admin, org.orgId);
    const response = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie, origin: ORIGIN } }));
    const session = (await response.json()) as { user?: { id?: string } } | null;
    expect(session?.user?.id).toBe(admin.id);
  });

  it('POST /organization/update-member-role: an admin cannot make themselves or anyone a billing manager', async () => {
    const { org, owner, admin, member } = await team();
    const adminCookie = await signedIn(admin, org.orgId);
    const self = await memberRow(org.orgId, admin.id);
    const other = await memberRow(org.orgId, member.id);

    const onSelf = await call('/organization/update-member-role', { memberId: self.id, role: ['admin', 'billing'], organizationId: org.orgId }, adminCookie);
    expect(onSelf.status).toBe(403);
    expect(onSelf.json).toMatchObject({ code: 'BILLING_ROLE_OWNER_ONLY', message: 'Only an owner can add or remove a billing manager.' });
    const onOther = await call('/organization/update-member-role', { memberId: other.id, role: ['member', 'billing'], organizationId: org.orgId }, adminCookie);
    expect(onOther.status).toBe(403);
    // With no organization named in the body, the active organization of the session counts.
    const noOrg = await call('/organization/update-member-role', { memberId: self.id, role: 'admin,billing' }, adminCookie);
    expect(noOrg.status).toBe(403);
    // Nothing was written.
    expect((await memberRow(org.orgId, admin.id)).role).toBe('admin');
    expect((await memberRow(org.orgId, member.id)).role).toBe('member');

    // An admin can still do an admin's job: a role change that has nothing to do with billing.
    const plain = await call('/organization/update-member-role', { memberId: other.id, role: 'viewer', organizationId: org.orgId }, adminCookie);
    expect(plain.status).toBe(200);
    expect((await memberRow(org.orgId, member.id)).role).toBe('viewer');

    // The owner can add the role, and then the admin cannot take it away again.
    const ownerCookie = await signedIn(owner, org.orgId);
    const byOwner = await call('/organization/update-member-role', { memberId: other.id, role: ['viewer', 'billing'], organizationId: org.orgId }, ownerCookie);
    expect(byOwner.status).toBe(200);
    expect((await memberRow(org.orgId, member.id)).role).toBe('viewer,billing');
    const takeAway = await call('/organization/update-member-role', { memberId: other.id, role: 'viewer', organizationId: org.orgId }, adminCookie);
    expect(takeAway.status).toBe(403);
    expect((await memberRow(org.orgId, member.id)).role).toBe('viewer,billing');
    const remove = await call('/organization/remove-member', { memberIdOrEmail: other.id, organizationId: org.orgId }, adminCookie);
    expect(remove.status).toBe(403);
    expect(remove.json).toMatchObject({ code: 'BILLING_ROLE_OWNER_ONLY' });
    expect((await memberRow(org.orgId, member.id)).role).toBe('viewer,billing');
  });

  it('POST /organization/invite-member: an admin cannot invite a billing manager, and no invite or email is made', async () => {
    const { org, owner, admin } = await team();
    const adminCookie = await signedIn(admin, org.orgId);
    const outside = `r3-outside-${Date.now().toString(36)}@kitstak-test.example`;

    const refused = await call('/organization/invite-member', { email: outside, role: 'billing', organizationId: org.orgId }, adminCookie);
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: 'BILLING_ROLE_OWNER_ONLY', message: 'Only an owner can add or remove a billing manager.' });
    const both = await call('/organization/invite-member', { email: outside, role: ['member', 'billing'], organizationId: org.orgId }, adminCookie);
    expect(both.status).toBe(403);
    expect((await pool.query(`select 1 from core.invitation where organization_id = $1`, [org.orgId])).rowCount).toBe(0);
    expect((await pool.query(`select 1 from core.billing_emails where to_email = $1`, [outside])).rowCount).toBe(0);

    // The same call by the owner works, and the admin cannot cancel that invite.
    const ownerCookie = await signedIn(owner, org.orgId);
    const sent = await call('/organization/invite-member', { email: outside, role: 'billing', organizationId: org.orgId }, ownerCookie);
    expect(sent.status).toBe(200);
    const canceled = await call('/organization/cancel-invitation', { invitationId: sent.json.id }, adminCookie);
    expect(canceled.status).toBe(403);
    const { rows } = await pool.query<{ status: string }>(`select status from core.invitation where id = $1`, [sent.json.id]);
    expect(rows[0]?.status).toBe('pending');
    // An admin can still invite a teammate.
    const teammate = await call('/organization/invite-member', { email: `r3-mate-${Date.now().toString(36)}@kitstak-test.example`, role: 'member', organizationId: org.orgId }, adminCookie);
    expect(teammate.status).toBe(200);
    await pool.query(`delete from core.billing_emails where org_id = $1`, [org.orgId]);
  });
});
