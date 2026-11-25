/**
 * Review round 4, the shared sign in layer. One case per blocker and per door:
 *
 *  - a switched off person (`core.sign_in_blocks`) is refused at every door of a real auth
 *    instance: password sign in, a new session by any road, a new password row, a reset code, a
 *    reset with a code, a sign in code. Each answer is the one an address with no account gets.
 *  - a session that was ended is refused on the very next request (no cookie cache),
 *  - a new session starts in the organization the person used last, or one they own,
 *  - an invite can only be accepted by a person whose mailbox is proven,
 *  - every billing link and every billing email names its organization,
 *  - the one front door: the address every app sends a signed out person to.
 *
 * The database parts run against the local dev Postgres. Skipped when it is not reachable.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '@kitstak/auth';
import { appEntryUrl, portalForgotPasswordUrl, portalSignInUrl, safeAppPath, staysOnLocalSignIn } from '@kitstak/auth/front-door';
import type { RawSqlExecutor } from '@kitstak/auth/password-policy';
import {
  blockSignIn,
  defaultOrgIdFor,
  isSignInBlocked,
  isSignInBlockedForEmail,
  pickDefaultOrg,
  unblockSignIn,
} from '@kitstak/auth/sign-in-block';
import * as schema from '@kitstak/db/schema';
import { emailOTP } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/node-postgres';
import { SAMPLE_EMAIL_PAYLOADS, renderEmail } from '../emails';
import { EMAIL_TEMPLATE_IDS } from '../email-types';
import { ORG_PARAM, billingLink, orgParamValue, withOrgParam } from '../links';
import { createTestOrg, openTestDb, removeTestOrg, type TestOrg, type TestPerson } from '../testing/db';
import { billingOrganizationOptions } from './auth-hooks';
import { payloadWithOrg } from './outbox';

const { pool, db, available } = await openTestDb();
vi.setConfig({ testTimeout: 60_000 });

const ORIGIN = 'http://localhost:3300';
const SECRET = 'round-four-test-secret-round-four-test-secret';
const PASSWORD = 'Harbor-Lantern-round-four-42!';
const raw = db as unknown as RawSqlExecutor;
const orgs: TestOrg[] = [];
const loose: string[] = [];

afterAll(async () => {
  for (const org of orgs) await removeTestOrg(pool, org);
  if (loose.length > 0) await pool.query(`delete from core."user" where id = any($1::uuid[])`, [loose]);
  await pool.query(`delete from core.rate_limit where key like '%kitstak-test.example%'`);
  await pool.end();
});

/* ===== pure parts ===== */

describe('the organization a new session starts in', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day));
  const rows = [
    { orgId: 'a', role: 'member', orgName: 'Alpha', joinedAt: at(1) },
    { orgId: 'z', role: 'owner', orgName: 'Zeta', joinedAt: at(5) },
    { orgId: 'm', role: 'admin,billing', orgName: 'Mid', joinedAt: at(3) },
  ];

  it('is the one used last, when the person is still in it', () => {
    expect(pickDefaultOrg(rows, 'm')).toBe('m');
  });
  it('is one they own when nothing is noted, never the first by name', () => {
    expect(pickDefaultOrg(rows, null)).toBe('z');
    // Gone from the organization used last: the one they own.
    expect(pickDefaultOrg(rows, 'not-a-member-any-more')).toBe('z');
  });
  it('is the one they joined first when they own none', () => {
    expect(pickDefaultOrg(rows.filter((row) => row.orgId !== 'z'), null)).toBe('a');
  });
  it('never counts a deactivated membership, and is null for a person in no organization', () => {
    expect(pickDefaultOrg([{ orgId: 'z', role: 'deactivated:owner', orgName: 'Zeta', joinedAt: at(1) }], 'z')).toBeNull();
    expect(pickDefaultOrg([], null)).toBeNull();
  });
});

describe('links that name their organization', () => {
  const ORG = '8e75ae62-ce76-4fbf-9b6f-7087f95dc7c3';

  it('billingLink adds org=<id> and keeps every other part', () => {
    expect(billingLink('https://portal.kitstak.io/', { to: 'fix_payment' }, undefined, ORG)).toBe(`https://portal.kitstak.io/billing?fix=payment&org=${ORG}`);
    expect(billingLink('https://portal.kitstak.io', { to: 'add', product: 'wms' }, 'wms', ORG)).toBe(`https://portal.kitstak.io/billing/plan?add=wms&from=wms&org=${ORG}`);
    expect(billingLink('https://portal.kitstak.io', { to: 'home' })).toBe('https://portal.kitstak.io/billing');
  });
  it('only an organization id ever goes into a link', () => {
    expect(orgParamValue(ORG.toUpperCase())).toBe(ORG);
    for (const bad of ['northwind', `${ORG}&x=1`, '', null, undefined, "'; drop table"]) {
      expect(orgParamValue(bad)).toBeNull();
      expect(billingLink('https://p.example', { to: 'home' }, undefined, bad)).toBe('https://p.example/billing');
    }
    expect(withOrgParam('https://p.example/billing/invoices/in_1', ORG)).toBe(`https://p.example/billing/invoices/in_1?${ORG_PARAM}=${ORG}`);
    expect(withOrgParam('https://p.example/x?a=1#top', ORG)).toBe(`https://p.example/x?a=1&org=${ORG}#top`);
    expect(withOrgParam('https://p.example/x', 'nope')).toBe('https://p.example/x');
  });
  it('the outbox writes the organization into every payload that has a portal address', () => {
    expect(payloadWithOrg({ orgName: 'A', portalUrl: 'https://p.example' }, ORG)).toEqual({ orgName: 'A', portalUrl: 'https://p.example', orgId: ORG });
    // Codes belong to no organization and carry no portal address.
    expect(payloadWithOrg({ code: '123456', minutes: 10 }, null)).toEqual({ code: '123456', minutes: 10 });
    expect(payloadWithOrg({ code: '123456', minutes: 10 }, ORG)).toEqual({ code: '123456', minutes: 10 });
  });
  it('every billing email has the organization in every link back to the Portal', () => {
    let checked = 0;
    for (const template of EMAIL_TEMPLATE_IDS) {
      const sample = SAMPLE_EMAIL_PAYLOADS[template] as unknown as Record<string, unknown>;
      // Codes have no link, and the invite link carries its own proof and its own organization.
      if (typeof sample.portalUrl !== 'string' || template === 'invitation') continue;
      const rendered = renderEmail(template, payloadWithOrg(sample, ORG) as never);
      const portal = sample.portalUrl.replace(/\/+$/, '');
      const links = [...rendered.text.matchAll(/https?:\/\/[^\s)>"]+/g)].map((match) => match[0]).filter((link) => link.startsWith(portal));
      expect(links.length, `${template} has a link to the Portal`).toBeGreaterThan(0);
      for (const link of links) expect(new URL(link).searchParams.get(ORG_PARAM), `${template}: ${link}`).toBe(ORG);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });
});

describe('the one front door', () => {
  const portalUrl = 'https://portal.kitstak.io';
  const appUrl = 'https://crm.kitstak.io';

  it('an app sends a signed out person to the Portal sign in, with the full address to come back to', () => {
    expect(portalSignInUrl({ portalUrl, appUrl, next: '/northwind/deals?view=board' })).toBe(
      `https://portal.kitstak.io/login?next=${encodeURIComponent('https://crm.kitstak.io/northwind/deals?view=board')}`,
    );
    expect(portalSignInUrl({ portalUrl, appUrl })).toBe(`https://portal.kitstak.io/login?next=${encodeURIComponent('https://crm.kitstak.io/')}`);
    expect(portalSignInUrl({ portalUrl, appUrl, next: '/x', notice: 'signed-out' })).toContain('&notice=signed-out');
    // A notice the Portal does not know is dropped.
    expect(portalSignInUrl({ portalUrl, appUrl, next: '/x', notice: '<script>' })).not.toContain('notice');
    expect(portalForgotPasswordUrl(portalUrl, appUrl)).toBe('https://portal.kitstak.io/forgot-password');
  });
  it('a path that could be read as another site is never carried', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/a\tb', '/a b', '', null]) expect(safeAppPath(bad)).toBeNull();
    expect(portalSignInUrl({ portalUrl, appUrl, next: '//evil.example/x' })).toBe(`https://portal.kitstak.io/login?next=${encodeURIComponent('https://crm.kitstak.io/')}`);
  });
  it('an app with no Portal address, or the Portal itself, keeps its own form', () => {
    expect(portalSignInUrl({ portalUrl: undefined, appUrl })).toBeNull();
    expect(portalSignInUrl({ portalUrl: '', appUrl })).toBeNull();
    expect(portalSignInUrl({ portalUrl, appUrl: portalUrl })).toBeNull();
    expect(portalForgotPasswordUrl(null, appUrl)).toBeNull();
  });
  it('the two can never bounce a person: the Portal enters an app through its door, marked, and the app then stays', () => {
    expect(appEntryUrl('https://crm.kitstak.io/northwind/deals?view=board')).toBe(
      `https://crm.kitstak.io/login?from=portal&next=${encodeURIComponent('/northwind/deals?view=board')}`,
    );
    expect(appEntryUrl('https://crm.kitstak.io/')).toBe('https://crm.kitstak.io/login?from=portal');
    expect(staysOnLocalSignIn({ from: 'portal' })).toBe(true);
    expect(staysOnLocalSignIn({ local: '1' })).toBe(true);
    expect(staysOnLocalSignIn({ next: '/x' })).toBe(false);
    expect(staysOnLocalSignIn({ from: 'elsewhere', local: '0' })).toBe(false);
  });
});

/* ===== a real auth instance on the real database ===== */

describe.skipIf(!available)('a real auth instance (database)', () => {
  /** Every code the instance tried to mail: address, kind and code. */
  const mailed: { email: string; type: string; otp: string }[] = [];
  const auth = createAuth({
    db: drizzle(pool, { schema }),
    schema,
    secret: SECRET,
    baseURL: ORIGIN,
    trustedOrigins: [ORIGIN],
    organization: billingOrganizationOptions({ db, portalUrl: ORIGIN, allowAll: () => true, inviteSecret: SECRET }),
    extraPlugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        disableSignUp: true,
        sendVerificationOTP: async (data) => {
          mailed.push(data);
        },
      }),
    ],
  });

  let caller = 0;
  /** Calls a real endpoint. Each call comes from its own address, so the per address limits never mix tests. */
  async function call(path: string, body: unknown, cookie?: string): Promise<{ status: number; json: Record<string, unknown>; cookie: string | null }> {
    caller += 1;
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': `198.51.100.${(caller % 250) + 1}`, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
    const text = await response.text();
    const setCookie = response.headers.getSetCookie().find((line) => line.startsWith('kitstak.session_token=')) ?? null;
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {}, cookie: setCookie ? (setCookie.split(';')[0] ?? null) : null };
  }

  async function getSession(cookie: string): Promise<{ user?: { id?: string }; session?: { activeOrganizationId?: string | null } } | null> {
    const response = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie, origin: ORIGIN } }));
    return (await response.json()) as { user?: { id?: string }; session?: { activeOrganizationId?: string | null } } | null;
  }

  /** A person with a real password, made through the real sign up. Not in any organization. */
  async function signedUp(label: string, verified = true): Promise<{ id: string; email: string; cookie: string }> {
    const email = `r4-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@kitstak-test.example`;
    const made = await call('/sign-up/email', { name: `Round Four ${label}`, email, password: PASSWORD });
    expect(made.status, `sign up ${label}`).toBe(200);
    const id = (made.json.user as { id: string }).id;
    loose.push(id);
    if (verified) await pool.query(`update core."user" set email_verified = true where id = $1`, [id]);
    return { id, email, cookie: made.cookie ?? '' };
  }

  const count = async (query: string, params: unknown[]): Promise<number> => Number((await pool.query<{ n: string }>(query, params)).rows[0]?.n ?? 0);
  const sessions = (userId: string) => count(`select count(*)::text as n from core.session where user_id = $1`, [userId]);
  const accounts = (userId: string) => count(`select count(*)::text as n from core.account where user_id = $1`, [userId]);
  const codesFor = (email: string, type: string) => mailed.filter((mail) => mail.email === email && mail.type === type);

  describe('a switched off person', () => {
    it('blockSignIn writes the fact and ends every session; unblockSignIn takes it away', async () => {
      const person = await signedUp('block');
      expect(await sessions(person.id)).toBe(1);
      expect(await isSignInBlocked(raw, person.id)).toBe(false);
      await blockSignIn(raw, { userId: person.id, blockedBy: person.id });
      await blockSignIn(raw, { userId: person.id });
      expect(await isSignInBlocked(raw, person.id)).toBe(true);
      expect(await isSignInBlockedForEmail(raw, person.email.toUpperCase())).toBe(true);
      expect(await sessions(person.id)).toBe(0);
      // The session cookie the person still holds is refused at once.
      expect(await getSession(person.cookie)).toBeNull();
      await unblockSignIn(raw, person.id);
      expect(await isSignInBlocked(raw, person.id)).toBe(false);
      // Not an id, or nobody: not blocked, and no error.
      expect(await isSignInBlocked(raw, 'not-an-id')).toBe(false);
      expect(await isSignInBlocked(raw, null)).toBe(false);
      expect(await isSignInBlockedForEmail(raw, 'nobody@kitstak-test.example')).toBe(false);
    });

    it('door: password sign in. Refused with the one generic answer, even with a password row that is right', async () => {
      const person = await signedUp('pw');
      // The block row alone: the right password and its row are still there.
      await blockSignIn(raw, { userId: person.id });
      expect(await accounts(person.id)).toBe(1);
      const refused = await call('/sign-in/email', { email: person.email, password: PASSWORD });
      const unknown = await call('/sign-in/email', { email: 'nobody-r4@kitstak-test.example', password: PASSWORD });
      expect([refused.status, refused.json]).toEqual([401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }]);
      expect([unknown.status, unknown.json.code]).toEqual([401, 'INVALID_EMAIL_OR_PASSWORD']);
      expect(await sessions(person.id)).toBe(0);
      // Switched on again: the same password signs in.
      await unblockSignIn(raw, person.id);
      const back = await call('/sign-in/email', { email: person.email, password: PASSWORD });
      expect(back.status).toBe(200);
      expect(await sessions(person.id)).toBe(1);
    });

    it('door: any road to a session. The database hook refuses the session row itself', async () => {
      const person = await signedUp('hook');
      await blockSignIn(raw, { userId: person.id });
      const context = await auth.$context;
      await expect(context.internalAdapter.createSession(person.id)).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
      expect(await sessions(person.id)).toBe(0);
    });

    it('door: a new password row or a Google link. The database hook refuses the account row itself', async () => {
      const person = await signedUp('acct');
      await pool.query(`delete from core.account where user_id = $1`, [person.id]);
      await blockSignIn(raw, { userId: person.id });
      const context = await auth.$context;
      const hash = await context.password.hash(PASSWORD);
      await expect(context.internalAdapter.createAccount({ userId: person.id, providerId: 'credential', accountId: person.id, password: hash })).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
      await expect(context.internalAdapter.linkAccount({ userId: person.id, providerId: 'google', accountId: 'google-sub-1' })).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
      expect(await accounts(person.id)).toBe(0);
    });

    it('door: "Forgot password". No reset code is mailed, and the answer is the one an unknown address gets', async () => {
      const person = await signedUp('forgot');
      await pool.query(`delete from core.account where user_id = $1`, [person.id]);
      await blockSignIn(raw, { userId: person.id });
      for (const path of ['/email-otp/request-password-reset', '/forget-password/email-otp']) {
        const blocked = await call(path, { email: person.email });
        const unknown = await call(path, { email: 'nobody-r4@kitstak-test.example' });
        expect([blocked.status, blocked.json], path).toEqual([unknown.status, unknown.json]);
        expect(blocked.json).toEqual({ success: true });
      }
      const verify = await call('/email-otp/send-verification-otp', { email: person.email, type: 'forget-password' });
      expect(verify.json).toEqual({ success: true });
      expect(codesFor(person.email, 'forget-password')).toHaveLength(0);
      // The same person, switched on: the code is mailed.
      await unblockSignIn(raw, person.id);
      await call('/email-otp/request-password-reset', { email: person.email });
      expect(codesFor(person.email, 'forget-password')).toHaveLength(1);
    });

    it('door: reset with a code. A code that was mailed before the person was switched off is worth nothing', async () => {
      const person = await signedUp('reset');
      await call('/email-otp/request-password-reset', { email: person.email });
      const code = codesFor(person.email, 'forget-password').at(-1)?.otp ?? '';
      expect(code).toMatch(/^\d{6}$/);
      // Switched off the way the WMS does it: the block row and no password row.
      await pool.query(`delete from core.account where user_id = $1`, [person.id]);
      await blockSignIn(raw, { userId: person.id });
      const refused = await call('/email-otp/reset-password', { email: person.email, otp: code, password: `New-${PASSWORD}` });
      const unknown = await call('/email-otp/reset-password', { email: 'nobody-r4@kitstak-test.example', otp: '123456', password: `New-${PASSWORD}` });
      expect([refused.status, refused.json.code]).toEqual([400, 'INVALID_OTP']);
      expect([unknown.status, unknown.json.code]).toEqual([400, 'INVALID_OTP']);
      expect(await accounts(person.id), 'no password row came back').toBe(0);
      expect((await call('/sign-in/email', { email: person.email, password: `New-${PASSWORD}` })).status).toBe(401);
    });

    it('door: sign in with a code. No code is mailed and none is taken', async () => {
      const person = await signedUp('otp');
      await call('/email-otp/send-verification-otp', { email: person.email, type: 'sign-in' });
      const code = codesFor(person.email, 'sign-in').at(-1)?.otp ?? '';
      expect(code).toMatch(/^\d{6}$/);
      await blockSignIn(raw, { userId: person.id });
      const asked = await call('/email-otp/send-verification-otp', { email: person.email, type: 'sign-in' });
      expect(asked.json).toEqual({ success: true });
      expect(codesFor(person.email, 'sign-in')).toHaveLength(1);
      const refused = await call('/sign-in/email-otp', { email: person.email, otp: code });
      expect([refused.status, refused.json.code]).toEqual([400, 'INVALID_OTP']);
      expect(await sessions(person.id)).toBe(0);
    });
  });

  describe('a person who signs in with a code', () => {
    it('can do it again and again: no password row is needed, and none comes back', async () => {
      // Never confirmed, with a password: the first code sign in removes that password on purpose.
      const person = await signedUp('twice', false);
      expect(await accounts(person.id)).toBe(1);
      for (const round of [1, 2, 3]) {
        await call('/email-otp/send-verification-otp', { email: person.email, type: 'sign-in' });
        const code = codesFor(person.email, 'sign-in').at(-1)?.otp ?? '';
        expect(codesFor(person.email, 'sign-in'), `code ${round} is mailed`).toHaveLength(round);
        const signedIn = await call('/sign-in/email-otp', { email: person.email, otp: code });
        expect(signedIn.status, `code sign in ${round}`).toBe(200);
        expect(await getSession(signedIn.cookie ?? '')).toMatchObject({ user: { id: person.id } });
      }
      expect(await accounts(person.id)).toBe(0);
      expect((await pool.query(`select email_verified from core."user" where id = $1`, [person.id])).rows).toEqual([{ email_verified: true }]);
      // Having no password row is not being switched off.
      expect(await isSignInBlocked(raw, person.id)).toBe(false);
    });
  });

  describe('a session that was ended', () => {
    it('is refused on the very next request: nothing is believed from a cookie alone', async () => {
      const person = await signedUp('ended');
      expect(await getSession(person.cookie)).toMatchObject({ user: { id: person.id } });
      // No cached copy of the session is handed to the browser.
      const again = await call('/sign-in/email', { email: person.email, password: PASSWORD });
      expect(again.status).toBe(200);
      const response = await auth.handler(
        new Request(`${ORIGIN}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '198.51.100.251' },
          body: JSON.stringify({ email: person.email, password: PASSWORD }),
        }),
      );
      expect(response.headers.getSetCookie().some((line) => line.includes('session_data'))).toBe(false);
      // What a password reset does to the old sessions.
      await pool.query(`delete from core.session where user_id = $1`, [person.id]);
      expect(await getSession(person.cookie)).toBeNull();
      expect(await getSession(again.cookie ?? '')).toBeNull();
    });
  });

  describe('the organization of a new session', () => {
    async function memberOf(person: { id: string }, role: string): Promise<TestOrg> {
      const org = await createTestOrg(pool);
      orgs.push(org);
      await pool.query(`insert into core.member (organization_id, user_id, role, created_at) values ($1, $2, $3, now())`, [org.orgId, person.id, role]);
      return org;
    }

    it('starts in one they own, then in the one they picked last, and never in one they left', async () => {
      const person = await signedUp('orgs');
      const asMember = await memberOf(person, 'member');
      const asOwner = await memberOf(person, 'owner');
      await pool.query(`update core.organization set name = 'AAA First By Name ' || id where id = $1`, [asMember.orgId]);
      expect(await defaultOrgIdFor(raw, person.id)).toBe(asOwner.orgId);

      const first = await call('/sign-in/email', { email: person.email, password: PASSWORD });
      expect((await getSession(first.cookie ?? ''))?.session?.activeOrganizationId).toBe(asOwner.orgId);

      // Picking the other one is remembered for the next sign in.
      const picked = await call('/organization/set-active', { organizationId: asMember.orgId }, first.cookie ?? '');
      expect(picked.status).toBe(200);
      await expect.poll(async () => (await pool.query(`select org_id from core.user_last_org where user_id = $1`, [person.id])).rows[0]?.org_id).toBe(asMember.orgId);
      const second = await call('/sign-in/email', { email: person.email, password: PASSWORD });
      expect((await getSession(second.cookie ?? ''))?.session?.activeOrganizationId).toBe(asMember.orgId);

      // Removed from that organization: the next session is back in the one they own.
      await pool.query(`delete from core.member where organization_id = $1 and user_id = $2`, [asMember.orgId, person.id]);
      const third = await call('/sign-in/email', { email: person.email, password: PASSWORD });
      expect((await getSession(third.cookie ?? ''))?.session?.activeOrganizationId).toBe(asOwner.orgId);
    });

    it('a person in no organization signs in with none', async () => {
      const person = await signedUp('none');
      expect(await defaultOrgIdFor(raw, person.id)).toBeNull();
      const signedIn = await call('/sign-in/email', { email: person.email, password: PASSWORD });
      expect(signedIn.status).toBe(200);
      expect((await getSession(signedIn.cookie ?? ''))?.session?.activeOrganizationId ?? null).toBeNull();
    });
  });

  describe('accepting an invite needs a proven mailbox', () => {
    async function ownerCookie(owner: TestPerson, orgId: string): Promise<string> {
      const context = await auth.$context;
      const session = await context.internalAdapter.createSession(owner.id, false, { activeOrganizationId: orgId });
      const { createHmac } = await import('node:crypto');
      return `kitstak.session_token=${encodeURIComponent(`${session.token}.${createHmac('sha256', SECRET).update(session.token).digest('base64')}`)}`;
    }

    it('an account made for the invited address by someone else is refused, for the billing role and for a member', async () => {
      const org = await createTestOrg(pool, ['admin']);
      orgs.push(org);
      const cookie = await ownerCookie(org.owner, org.orgId);
      for (const role of ['billing', 'member'] as const) {
        const taker = await signedUp(`take-${role}`, false);
        const invite = await call('/organization/invite-member', { email: taker.email, role, organizationId: org.orgId }, cookie);
        expect(invite.status, `owner invites a ${role}`).toBe(200);
        const invitationId = invite.json.id as string;

        // The account exists, the address matches, the id is known. The mailbox was never proven.
        const refused = await call('/organization/accept-invitation', { invitationId }, taker.cookie);
        expect([refused.status, refused.json]).toEqual([
          403,
          { code: 'INVITE_NEEDS_PROVEN_MAILBOX', message: 'Open the link in your invite email to join. That shows the email is yours.' },
        ]);
        expect(await count(`select count(*)::text as n from core.member where organization_id = $1 and user_id = $2`, [org.orgId, taker.id])).toBe(0);
        expect((await pool.query(`select status from core.invitation where id = $1`, [invitationId])).rows).toEqual([{ status: 'pending' }]);

        // Proven (the emailed code, or the proof in the invite link, which marks it the same way): in.
        await pool.query(`update core."user" set email_verified = true where id = $1`, [taker.id]);
        const accepted = await call('/organization/accept-invitation', { invitationId }, taker.cookie);
        expect(accepted.status, `the proven person joins as ${role}`).toBe(200);
        expect((await pool.query(`select role from core.member where organization_id = $1 and user_id = $2`, [org.orgId, taker.id])).rows).toEqual([{ role }]);
      }
      await pool.query(`delete from core.billing_emails where org_id = $1`, [org.orgId]);
    });
  });
});

describe.skipIf(available)('a real auth instance (database)', () => {
  it('needs the dev database: run deploy/dev/db-setup.sh, then this file again', () => {
    // Named, so a run with no database says what it did not prove instead of passing silently.
    expect(available).toBe(false);
  });
});

