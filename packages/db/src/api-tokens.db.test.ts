/**
 * core.api_tokens against the live database (docs/integration/AGENT_WRITE_API.md W1 to W6): make,
 * list, revoke and authenticate, the org and membership rules, the per person limit, and the event
 * log. Skips when DATABASE_URL does not answer or 0012 is not applied.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_TOKEN_EVENT_TARGET_MAX,
  API_TOKEN_MAX_ACTIVE,
  ApiTokenError,
  authenticateApiToken,
  createApiToken,
  listApiTokens,
  recordApiTokenEvent,
  revokeApiToken,
} from './api-tokens';
import { createTestOrg, databaseReady, type TestOrg } from './programs/test-support';

const ready = await databaseReady(['core.organization', 'core.api_tokens', 'core.api_token_events', 'core.sign_in_blocks']);

const bearer = (token: string) => `Bearer ${token}`;

describe.skipIf(!ready)('core.api_tokens (database)', () => {
  let org: TestOrg;
  let other: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg('api-tokens');
    other = await createTestOrg('api-tokens-other');
  });

  afterAll(async () => {
    await org?.destroy();
    await other?.destroy();
  });

  it('makes a token, stores only its hash, and authenticates it with its scopes', async () => {
    const made = await createApiToken(org.db, { orgId: org.orgId, userId: org.userId, name: 'Migration', scopes: ['projects:write'], days: 30 });
    expect(made.token).toMatch(/^ks_pat_/);
    const stored = await org.query('select token_hash, token_prefix, scopes from core.api_tokens where id = $1', [made.record.id]);
    expect(stored[0]?.token_hash).not.toBe(made.token);
    expect(stored[0]?.token_prefix).toBe(made.token.slice(0, 11));
    expect(stored[0]?.scopes).toEqual(['projects:read', 'projects:write']);

    const principal = await authenticateApiToken(org.db, bearer(made.token), { app: 'projects', level: 'write' });
    expect(principal).toMatchObject({ tokenId: made.record.id, orgId: org.orgId, userId: org.userId });
    const read = await authenticateApiToken(org.db, bearer(made.token), { app: 'projects', level: 'read' });
    expect(read.tokenId).toBe(made.record.id);
  });

  it('refuses an app the token has no scope for', async () => {
    const made = await createApiToken(org.db, { orgId: org.orgId, userId: org.userId, name: 'Read CRM', scopes: ['crm:read'], days: 7 });
    await expect(authenticateApiToken(org.db, bearer(made.token), { app: 'crm', level: 'write' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authenticateApiToken(org.db, bearer(made.token), { app: 'pulse', level: 'read' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses unknown, revoked and expired tokens', async () => {
    await expect(authenticateApiToken(org.db, bearer(`ks_pat_${'A'.repeat(43)}`), { app: 'crm', level: 'read' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(authenticateApiToken(org.db, null, { app: 'crm', level: 'read' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const revoked = await createApiToken(org.db, { orgId: org.orgId, userId: org.userId, name: 'Revoke me', scopes: ['crm:read'], days: 7 });
    await revokeApiToken(org.db, { orgId: org.orgId, tokenId: revoked.record.id, actorId: org.userId, actorIsManager: false });
    await expect(authenticateApiToken(org.db, bearer(revoked.token), { app: 'crm', level: 'read' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const expired = await createApiToken(org.db, { orgId: org.orgId, userId: org.userId, name: 'Old', scopes: ['crm:read'], days: 1 });
    const later = new Date(Date.now() + 2 * 86_400_000);
    await expect(authenticateApiToken(org.db, bearer(expired.token), { app: 'crm', level: 'read', now: later })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('stops working when the owner leaves, is deactivated or is switched off', async () => {
    const memberId = await org.addUser('member');
    const made = await createApiToken(org.db, { orgId: org.orgId, userId: memberId, name: 'Member token', scopes: ['crm:read'], days: 7 });
    await expect(authenticateApiToken(org.db, bearer(made.token), { app: 'crm', level: 'read' })).resolves.toMatchObject({ userId: memberId });

    await org.query("update core.member set role = 'deactivated:member' where user_id = $1 and organization_id = $2", [memberId, org.orgId]);
    await expect(authenticateApiToken(org.db, bearer(made.token), { app: 'crm', level: 'read' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    await org.query("update core.member set role = 'member' where user_id = $1 and organization_id = $2", [memberId, org.orgId]);
    await org.query('insert into core.sign_in_blocks (user_id, reason) values ($1, $2)', [memberId, 'deactivated']);
    await expect(authenticateApiToken(org.db, bearer(made.token), { app: 'crm', level: 'read' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await org.query('delete from core.sign_in_blocks where user_id = $1', [memberId]);

    await org.query('delete from core.member where user_id = $1 and organization_id = $2', [memberId, org.orgId]);
    await expect(authenticateApiToken(org.db, bearer(made.token), { app: 'crm', level: 'read' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('never brings a token back when a deactivated, removed or switched off person returns', async () => {
    const dead = (token: string) => expect(authenticateApiToken(org.db, bearer(token), { app: 'crm', level: 'read' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const revokedAt = async (id: string) => (await org.query('select revoked_at, revoked_by from core.api_tokens where id = $1', [id]))[0];

    const a = await org.addUser('member');
    const deactivated = await createApiToken(org.db, { orgId: org.orgId, userId: a, name: 'Deactivated', scopes: ['crm:read'], days: 7 });
    await org.query("update core.member set role = 'deactivated:member' where user_id = $1 and organization_id = $2", [a, org.orgId]);
    await org.query("update core.member set role = 'member' where user_id = $1 and organization_id = $2", [a, org.orgId]);
    await dead(deactivated.token);
    expect(await revokedAt(deactivated.record.id)).toMatchObject({ revoked_by: null });
    expect((await revokedAt(deactivated.record.id))?.revoked_at).toBeTruthy();

    const removed = await createApiToken(org.db, { orgId: org.orgId, userId: a, name: 'Removed', scopes: ['crm:read'], days: 7 });
    await org.query('delete from core.member where user_id = $1 and organization_id = $2', [a, org.orgId]);
    await org.query("insert into core.member (id, organization_id, user_id, role, created_at) values (gen_random_uuid(), $1, $2, 'member', now())", [org.orgId, a]);
    await dead(removed.token);

    const blocked = await createApiToken(org.db, { orgId: org.orgId, userId: a, name: 'Blocked', scopes: ['crm:read'], days: 7 });
    await org.query('insert into core.sign_in_blocks (user_id, reason) values ($1, $2)', [a, 'deactivated']);
    await org.query('delete from core.sign_in_blocks where user_id = $1', [a]);
    await dead(blocked.token);
  });

  it('holds the live token limit when requests arrive at the same moment', async () => {
    const racer = await org.addUser('member');
    for (let i = 0; i < API_TOKEN_MAX_ACTIVE - 1; i += 1) {
      await createApiToken(org.db, { orgId: org.orgId, userId: racer, name: `R${i}`, scopes: ['crm:read'], days: 1 });
    }
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => createApiToken(org.db, { orgId: org.orgId, userId: racer, name: `Race ${i}`, scopes: ['crm:read'], days: 1 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'LIMIT' });
    const live = await org.query('select count(*)::int as n from core.api_tokens where user_id = $1 and revoked_at is null', [racer]);
    expect(live[0]?.n).toBe(API_TOKEN_MAX_ACTIVE);
  });

  it('only makes tokens for active members, within the limit', async () => {
    await expect(
      createApiToken(org.db, { orgId: other.orgId, userId: org.userId, name: 'Not mine', scopes: ['crm:read'], days: 7 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const busy = await org.addUser('member');
    for (let i = 0; i < API_TOKEN_MAX_ACTIVE; i += 1) {
      await createApiToken(org.db, { orgId: org.orgId, userId: busy, name: `T${i}`, scopes: ['crm:read'], days: 1 });
    }
    await expect(createApiToken(org.db, { orgId: org.orgId, userId: busy, name: 'One more', scopes: ['crm:read'], days: 1 })).rejects.toMatchObject({ code: 'LIMIT' });
  });

  it('lists a person their own tokens, and managers everyone in the org', async () => {
    const memberId = await org.addUser('member');
    const mine = await createApiToken(org.db, { orgId: org.orgId, userId: memberId, name: 'Mine', scopes: ['pulse:read'], days: 7 });
    const own = await listApiTokens(org.db, { orgId: org.orgId, userId: memberId, includeOthers: false });
    expect(own.map((t) => t.id)).toEqual([mine.record.id]);
    expect(JSON.stringify(own)).not.toContain(mine.token);

    const all = await listApiTokens(org.db, { orgId: org.orgId, userId: org.userId, includeOthers: true });
    expect(all.map((t) => t.id)).toContain(mine.record.id);
    expect(all.find((t) => t.id === mine.record.id)?.ownerName).toBe('Test member');

    const otherOrg = await listApiTokens(other.db, { orgId: other.orgId, userId: other.userId, includeOthers: true });
    expect(otherOrg.map((t) => t.id)).not.toContain(mine.record.id);
  });

  it('lets the owner or a manager revoke, nobody else, and never across orgs', async () => {
    const a = await org.addUser('member');
    const b = await org.addUser('member');
    const made = await createApiToken(org.db, { orgId: org.orgId, userId: a, name: 'A', scopes: ['crm:read'], days: 7 });
    await expect(revokeApiToken(org.db, { orgId: org.orgId, tokenId: made.record.id, actorId: b, actorIsManager: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(revokeApiToken(other.db, { orgId: other.orgId, tokenId: made.record.id, actorId: other.userId, actorIsManager: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await revokeApiToken(org.db, { orgId: org.orgId, tokenId: made.record.id, actorId: org.userId, actorIsManager: true });
    const row = await org.query('select revoked_by from core.api_tokens where id = $1', [made.record.id]);
    expect(row[0]?.revoked_by).toBe(org.userId);
    await expect(revokeApiToken(org.db, { orgId: org.orgId, tokenId: made.record.id, actorId: a, actorIsManager: false })).resolves.toBeUndefined();
    await expect(revokeApiToken(org.db, { orgId: org.orgId, tokenId: randomUUID(), actorId: a, actorIsManager: false })).rejects.toBeInstanceOf(ApiTokenError);
  });

  it('writes last used at most once a minute', async () => {
    const made = await createApiToken(org.db, { orgId: org.orgId, userId: org.userId, name: 'Touch', scopes: ['crm:read'], days: 7 });
    const now = new Date();
    await authenticateApiToken(org.db, bearer(made.token), { app: 'crm', level: 'read', now });
    const first = (await org.query('select last_used_at from core.api_tokens where id = $1', [made.record.id]))[0]?.last_used_at as Date;
    expect(first).toBeTruthy();
    await authenticateApiToken(org.db, bearer(made.token), { app: 'crm', level: 'read', now: new Date(now.getTime() + 10_000) });
    const second = (await org.query('select last_used_at from core.api_tokens where id = $1', [made.record.id]))[0]?.last_used_at as Date;
    expect(second.getTime()).toBe(first.getTime());
  });

  it('logs an event for a token of the same org only', async () => {
    const made = await createApiToken(org.db, { orgId: org.orgId, userId: org.userId, name: 'Events', scopes: ['projects:write'], days: 7 });
    await recordApiTokenEvent(org.db, { tokenId: made.record.id, orgId: org.orgId, app: 'projects', action: 'tasks.create', ok: true, dryRun: true, target: { taskId: 'x' } });
    const rows = await org.query('select app, action, ok, dry_run, target from core.api_token_events where token_id = $1', [made.record.id]);
    expect(rows).toEqual([{ app: 'projects', action: 'tasks.create', ok: true, dry_run: true, target: { taskId: 'x' } }]);
    await recordApiTokenEvent(org.db, { tokenId: made.record.id, orgId: org.orgId, app: 'projects', action: 'big', ok: false, errorCode: 'X'.repeat(200), target: { blob: 'y'.repeat(API_TOKEN_EVENT_TARGET_MAX) } });
    const big = await org.query("select error_code, target from core.api_token_events where token_id = $1 and action = 'big'", [made.record.id]);
    expect(big[0]?.target).toEqual({ truncated: true });
    expect((big[0]?.error_code as string).length).toBe(80);
    await expect(
      recordApiTokenEvent(other.db, { tokenId: made.record.id, orgId: other.orgId, app: 'projects', action: 'tasks.create', ok: true }),
    ).rejects.toBeInstanceOf(ApiTokenError);
  });
});
