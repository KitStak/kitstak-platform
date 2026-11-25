/**
 * Admin / profile / trash services against the dev Postgres (isolated throwaway orgs).
 * Skipped when the database is not reachable.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrgs, ctxFor, databaseAvailable, type TestOrg } from './db-fixture';

const available = await databaseAvailable();
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe.skipIf(!available)('admin services (integration)', async () => {
  const { eq } = await import('drizzle-orm');
  const schema = await import('@/server/db/schema');
  const { findOrgMembership } = await import('@/server/auth/session');
  const { ForbiddenError, BadRequestError } = await import('@/server/http/errors');
  const org = await import('../admin-org');
  const users = await import('../admin-users');
  const security = await import('../admin-security');
  const trash = await import('../admin-trash');
  const { createWorkspace } = await import('../workspaces');
  const { createBoard, changeBoardLifecycle, getBoardPayload } = await import('../boards');
  const { createItem, changeItemLifecycle } = await import('../items');
  const { deleteGroup } = await import('../groups');
  const { createInvitation } = await import('../members');
  const { recordAudit } = await import('@/server/audit');

  let fixture: Awaited<ReturnType<typeof createTestOrgs>>;
  let orgA: TestOrg;
  let workspaceId: string;

  beforeAll(async () => {
    // Integration flows, not the billing gate: keep modules open even under ENTITLEMENTS_DEV_ALLOW_ALL=0.
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '1');
    fixture = await createTestOrgs([
      { key: 'adm', users: { owner: 'owner', admin: 'admin', rep: 'member', viewer: 'viewer' } },
    ]);
    orgA = fixture.orgs.adm as TestOrg;
    const owner = await ctxFor(orgA, 'owner');
    workspaceId = (await createWorkspace(owner, { name: 'Ops', color: 'blue', kind: 'open' })).id;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    org.__test.policyCache.clear();
    await fixture?.cleanup();
  });

  it('stores policy in org metadata without clobbering other keys', async () => {
    const owner = await ctxFor(orgA, 'owner');
    await owner.db
      .update(schema.organization)
      .set({ metadata: JSON.stringify({ teamSize: '1-10' }) })
      .where(eq(schema.organization.id, orgA.orgId));
    const result = await org.updateOrgPolicy(owner, { boardCreation: 'admins', allowedEmailDomains: ['acme.test'] }, null);
    expect(result.settings.boardCreation).toBe('admins');
    const [row] = await owner.db.select().from(schema.organization).where(eq(schema.organization.id, orgA.orgId));
    expect(JSON.parse(row?.metadata ?? '{}').teamSize).toBe('1-10');
  });

  it('rejects policy changes from non-admins', async () => {
    const rep = await ctxFor(orgA, 'rep');
    await expect(org.updateOrgPolicy(rep, { boardCreation: 'members' }, null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('enforces board-creation restriction and allowed invite domains', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const owner = await ctxFor(orgA, 'owner');
    await expect(createBoard(rep, { workspaceId, name: 'Nope', privacy: 'main', withSampleData: false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(createInvitation(owner, { email: 'x@other.test', role: 'member' })).rejects.toBeInstanceOf(ForbiddenError);
    const inviteEmail = `new-${orgA.orgId.slice(0, 8)}@eu.acme.test`;
    const invite = await createInvitation(owner, { email: inviteEmail, role: 'member' });
    expect(invite.email).toBe(inviteEmail);

    // Billing review round 5: the CRM door is the shared invite door. The invite email is written to
    // the outbox with a link to the Portal's invite page that carries the proof of the mailbox...
    const { sql } = await import('drizzle-orm');
    const mailed = await owner.db.execute(
      sql`SELECT template, payload->>'acceptUrl' AS url FROM core.billing_emails WHERE dedupe_key = ${`invite:${invite.id}`}`,
    );
    const mail = (mailed as unknown as { rows: { template: string; url: string }[] }).rows[0];
    expect(mail?.template).toBe('invitation');
    expect(mail?.url).toMatch(new RegExp(`/invite/${invite.id}\\?t=[A-Za-z0-9_-]{43}$`));
    // ...and an inviter whose own email nobody verified is refused, as at every other door.
    await owner.db.update(schema.user).set({ emailVerified: false, createdAt: new Date() }).where(eq(schema.user.id, owner.userId as string));
    const refused = await createInvitation(owner, { email: `second-${orgA.orgId.slice(0, 8)}@eu.acme.test`, role: 'member' }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ForbiddenError);
    expect((refused as { details?: { code?: string } }).details?.code).toBe('EMAIL_NOT_VERIFIED');
    await owner.db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, owner.userId as string));
    await owner.db.execute(sql`DELETE FROM core.billing_emails WHERE org_id = ${orgA.orgId}`);
    await owner.db.execute(sql`DELETE FROM core.rate_limit WHERE key = ${`billing:invite-day:${orgA.orgId}`}`);
    await org.updateOrgPolicy(owner, { boardCreation: 'members', allowedEmailDomains: [] }, null);
  });

  it('refuses to enable an IP allow-list that locks out the requester', async () => {
    const owner = await ctxFor(orgA, 'owner');
    await expect(
      org.updateOrgPolicy(owner, { ipAllowListEnabled: true, ipAllowList: ['10.0.0.0/8'] }, '203.0.113.9'),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(org.updateOrgPolicy(owner, { ipAllowList: ['999.0.0.0/8'] }, null)).rejects.toBeInstanceOf(BadRequestError);
    const ok = await org.updateOrgPolicy(owner, { ipAllowListEnabled: true, ipAllowList: ['203.0.113.0/24'] }, '203.0.113.9');
    expect(ok.settings.ipAllowListEnabled).toBe(true);
    await expect(org.enforceNetworkPolicy(orgA.orgId, '198.51.100.1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(org.enforceNetworkPolicy(orgA.orgId, '203.0.113.50')).resolves.toBeUndefined();
    await org.updateOrgPolicy(owner, { ipAllowListEnabled: false }, null);
    await expect(org.enforceNetworkPolicy(orgA.orgId, '198.51.100.1')).resolves.toBeUndefined();
  });

  it('deactivates members (locking them out) and reactivates them with their role', async () => {
    const admin = await ctxFor(orgA, 'admin');
    const { users: list } = await users.listAdminUsers(admin);
    const rep = list.find((entry) => entry.userId === orgA.users.rep?.id);
    const owner = list.find((entry) => entry.userId === orgA.users.owner?.id);
    expect(rep?.status).toBe('active');
    const result = await users.bulkUpdateUsers(admin, {
      action: 'deactivate',
      memberIds: [rep?.memberId as string, owner?.memberId as string],
    });
    expect(result.updated).toEqual([rep?.memberId]);
    expect(result.failed[0]?.id).toBe(owner?.memberId);
    expect(await findOrgMembership(orgA.users.rep?.id as string, orgA.orgId)).toBeNull();
    await users.bulkUpdateUsers(admin, { action: 'reactivate', memberIds: [rep?.memberId as string] });
    const membership = await findOrgMembership(orgA.users.rep?.id as string, orgA.orgId);
    expect(membership?.role).toBe('member');
    await expect(users.setMemberActive(admin, list.find((e) => e.userId === admin.userId)?.memberId as string, false)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it('exports users as CSV', async () => {
    const { csv, count } = await users.exportUsersCsv(await ctxFor(orgA, 'owner'));
    expect(count).toBeGreaterThanOrEqual(4);
    expect(csv.split('\r\n')[0]).toContain('Name,Email,Title,Role,Status');
  });

  it('creates API tokens hashed at rest, lists and revokes them', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const created = await security.createApiToken(rep, { name: 'Sync', scopes: ['boards:read'], expiresInDays: 30 });
    expect(created.token.startsWith('ks_live_')).toBe(true);
    const [row] = await rep.db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, created.id));
    expect(row?.tokenHash).toBe(security.hashToken(created.token));
    expect(row?.tokenHash).not.toContain(created.token);
    await expect(security.createApiToken(rep, { name: 'Audit', scopes: ['audit:read'], expiresInDays: 30 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(security.listApiTokens(rep, 'org')).rejects.toBeInstanceOf(ForbiddenError);
    const viewerCtx = await ctxFor(orgA, 'viewer');
    await expect(security.revokeApiToken(viewerCtx, created.id)).rejects.toThrow();
    const revoked = await security.revokeApiToken(await ctxFor(orgA, 'admin'), created.id);
    expect(revoked.status).toBe('revoked');
    expect((await security.listApiTokens(rep, 'mine'))[0]?.status).toBe('revoked');
  });

  it('filters the audit log by category and search', async () => {
    const owner = await ctxFor(orgA, 'owner');
    await recordAudit({ orgId: orgA.orgId, actorId: owner.userId, action: 'member.role_changed', targetType: 'member', targetId: 'x' });
    await recordAudit({ orgId: orgA.orgId, actorId: owner.userId, action: 'api_token.created', ipAddress: '203.0.113.7' });
    const members = await security.listAdminAudit(owner, { category: 'member', limit: 50, order: 'desc' });
    expect(members.items.every((entry) => entry.action.startsWith('member.'))).toBe(true);
    const byIp = await security.listAdminAudit(owner, { q: '203.0.113.7', limit: 50, order: 'desc' });
    expect(byIp.items.map((entry) => entry.action)).toContain('api_token.created');
    const { csv } = await security.exportAuditCsv(owner, {});
    expect(csv).toContain('api_token.created');
  });

  it('reports usage with seats by role', async () => {
    const usage = await security.getUsage(await ctxFor(orgA, 'owner'));
    expect(usage.seats.active).toBe(4);
    expect(usage.seats.byRole.owner).toBe(1);
    expect(usage.plan.demo).toBe(true);
  });

  it('lists, restores and purges trash entries', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const board = await createBoard(owner, { workspaceId, name: 'Trash test', privacy: 'main', withSampleData: false });
    const payload = await getBoardPayload(owner, board.id, { limit: 10 });
    const [g1, g2] = payload.groups;
    const loose = await createItem(owner, board.id, { name: 'Loose item', groupId: g1?.id });
    const grouped = await createItem(owner, board.id, { name: 'Grouped item', groupId: g2?.id });
    await changeItemLifecycle(owner, loose.id, 'delete');
    await deleteGroup(owner, board.id, g2?.id as string);

    let entries = await trash.listTrash(owner, { boardId: board.id });
    expect(entries.map((entry) => entry.type).sort()).toEqual(['group', 'item']);
    expect(entries.find((entry) => entry.type === 'group')?.itemCount).toBeGreaterThanOrEqual(1);
    expect(entries.find((entry) => entry.type === 'item')?.deletedBy?.id).toBe(owner.userId);

    // Permanent delete needs board ownership; a member who didn't create the board is refused.
    const rep0 = await ctxFor(orgA, 'rep');
    const denied = await trash.purgeFromTrash(rep0, { entries: [{ type: 'item', id: loose.id }] });
    expect(denied.failed).toHaveLength(1);

    const restored = await trash.restoreFromTrash(owner, {
      entries: [
        { type: 'group', id: g2?.id as string },
        { type: 'item', id: loose.id },
      ],
    });
    expect(restored.done).toHaveLength(2);
    const [back] = await owner.db.select().from(schema.items).where(eq(schema.items.id, grouped.id));
    expect(back?.deletedAt).toBeNull();

    await changeBoardLifecycle(owner, board.id, 'delete');
    entries = await trash.listTrash(owner, { type: 'board' });
    expect(entries.some((entry) => entry.id === board.id)).toBe(true);
    const rep = await ctxFor(orgA, 'rep');
    expect((await trash.listTrash(rep, { type: 'board' })).some((entry) => entry.id === board.id)).toBe(false);
    const purged = await trash.purgeFromTrash(owner, { entries: [{ type: 'board', id: board.id }] });
    expect(purged.done).toHaveLength(1);
    const gone = await owner.db.select().from(schema.boards).where(eq(schema.boards.id, board.id));
    expect(gone).toHaveLength(0);
  });

  it('updates profile fields and per-member preferences', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const updated = await org.updateProfile(rep, {
      title: 'AE',
      timezone: 'Europe/Berlin',
      phone: '+49 30 1234567',
      theme: 'dark',
      notifications: { mention: { email: true } },
    });
    expect(updated.user.title).toBe('AE');
    expect(updated.prefs.theme).toBe('dark');
    expect(updated.prefs.notifications.mention).toEqual({ inApp: true, email: true });
    await expect(org.updateProfile(rep, { timezone: 'Mars/Olympus' })).rejects.toBeInstanceOf(BadRequestError);
    const other = await org.getProfile(await ctxFor(orgA, 'viewer'));
    expect(other.prefs.theme).toBe('system');
  });

  it('team owners must be org members and need admin or owner rights', async () => {
    const admin = await ctxFor(orgA, 'admin');
    const [teamRow] = await admin.db
      .insert(schema.team)
      .values({ name: 'Ops team', organizationId: orgA.orgId, createdAt: new Date() })
      .returning();
    const settings = await org.setTeamOwners(admin, teamRow?.id as string, [orgA.users.rep?.id as string]);
    expect(settings.teamOwners[teamRow?.id as string]).toEqual([orgA.users.rep?.id]);
    await expect(org.setTeamOwners(admin, teamRow?.id as string, [crypto.randomUUID()])).rejects.toBeInstanceOf(BadRequestError);
    await expect(org.setTeamOwners(await ctxFor(orgA, 'viewer'), teamRow?.id as string, [])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('authenticates personal API tokens on /api/v1 and honours scopes, org and revocation', async () => {
    const { GET: listBoardsRoute } = await import('@/app/api/v1/boards/route');
    const { withApi } = await import('@/server/api');
    const rep = await ctxFor(orgA, 'rep');
    const created = await security.createApiToken(rep, { name: 'CI read', scopes: ['boards:read'], expiresInDays: 30 });
    const call = (handler: typeof listBoardsRoute, token: string, path = '/api/v1/boards') =>
      handler(new Request(`http://localhost:3100${path}`, { headers: { authorization: `Bearer ${token}` } }), {
        params: Promise.resolve({}),
      });

    const ok = await call(listBoardsRoute, created.token);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { ok: boolean }).ok).toBe(true);
    const [touched] = await rep.db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, created.id));
    await vi.waitFor(async () => {
      const [row] = await rep.db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, created.id));
      expect(row?.lastUsedAt).not.toBeNull();
    });
    expect(touched).toBeDefined();

    // Scope not granted → 403 (audited); route without a permission → 403.
    const writeRoute = withApi({ permission: 'item:write' }, () => ({ wrote: true }));
    expect((await call(writeRoute, created.token)).status).toBe(403);
    const plainRoute = withApi({}, () => ({ plain: true }));
    expect((await call(plainRoute, created.token)).status).toBe(403);

    // Garbage and revoked tokens → 401.
    expect((await call(listBoardsRoute, 'ks_live_notarealtokennotarealtoken')).status).toBe(401);
    await security.revokeApiToken(rep, created.id);
    expect((await call(listBoardsRoute, created.token)).status).toBe(401);
  });

  it('resolves audit target names and marks deleted targets', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const board = await createBoard(owner, { workspaceId, name: 'Audit named board', privacy: 'main', withSampleData: false });
    await recordAudit({ orgId: orgA.orgId, actorId: owner.userId, action: 'data.exported', targetType: 'board', targetId: board.id });
    await recordAudit({
      orgId: orgA.orgId,
      actorId: owner.userId,
      action: 'automation.deleted',
      targetType: 'automation',
      targetId: crypto.randomUUID(),
    });
    await recordAudit({ orgId: orgA.orgId, actorId: owner.userId, action: 'auth.forbidden', targetType: 'permission', targetId: 'dashboard:write' });
    const page = await security.listAdminAudit(owner, { limit: 10, order: 'desc' });
    const named = page.items.find((entry) => entry.targetId === board.id);
    expect(named).toMatchObject({ targetLabel: 'Audit named board', targetState: 'resolved' });
    expect(page.items.find((entry) => entry.action === 'automation.deleted')?.targetState).toBe('deleted');
    expect(page.items.find((entry) => entry.targetId === 'dashboard:write')?.targetLabel).toBe('dashboard:write');
    const oldest = await security.listAdminAudit(owner, { limit: 1, order: 'asc' });
    expect(new Date(oldest.items[0]?.createdAt ?? 0).getTime()).toBeLessThanOrEqual(new Date(page.items[0]?.createdAt ?? 0).getTime());
  });

  it('permanently removes trash older than the retention window (audited)', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const board = await createBoard(owner, { workspaceId, name: 'Retention board', privacy: 'main', withSampleData: false });
    const payload = await getBoardPayload(owner, board.id, { limit: 10 });
    const fresh = await createItem(owner, board.id, { name: 'Fresh deleted', groupId: payload.groups[0]?.id });
    const stale = await createItem(owner, board.id, { name: 'Stale deleted', groupId: payload.groups[0]?.id });
    await changeItemLifecycle(owner, fresh.id, 'delete');
    await owner.db
      .update(schema.items)
      .set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(schema.items.id, stale.id));
    const swept = await trash.purgeExpiredTrash(owner);
    expect(swept.items).toBeGreaterThanOrEqual(1);
    const remaining = await owner.db.select({ id: schema.items.id }).from(schema.items).where(eq(schema.items.boardId, board.id));
    expect(remaining.map((row) => row.id)).toContain(fresh.id);
    expect(remaining.map((row) => row.id)).not.toContain(stale.id);
    const audit = await security.listAdminAudit(owner, { q: 'trash.retention_purged', limit: 5, order: 'desc' });
    expect(audit.items[0]?.actorId).toBeNull();
  });

  it('flags trash entries a viewer cannot restore', async () => {
    trash.__test.lastSweep.clear();
    const viewer = await ctxFor(orgA, 'viewer');
    const entries = await trash.listTrash(viewer, {});
    expect(entries.every((entry) => entry.canRestore === false)).toBe(true);
  });
});
