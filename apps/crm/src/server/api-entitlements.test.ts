/**
 * Module entitlement gate in withApi() (BLUEPRINT.md §3.3), as an integration test against
 * the dev Postgres (embedded, port 5544): with allow-all off, a revoked `crm` entitlement
 * 402s every org-scoped route with the fixed envelope, a manual grant restores access, and
 * ENTITLEMENTS_DEV_ALLOW_ALL=1 bypasses the gate. Requires `core.entitlements` (created by
 * the @kitstak/db core migrations — `pnpm --filter @kitstak/db db:migrate`); skipped when
 * the database or that table is not available.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseAvailable } from './services/__tests__/db-fixture';

const sessionMock = vi.hoisted(() => ({
  getSessionFromHeaders: vi.fn(),
  findOrgMembership: vi.fn(),
}));
vi.mock('@/server/auth/session', () => sessionMock);
vi.mock('@/server/audit', () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
// The org IP allow-list stage is out of scope here; stub it as "disabled".
vi.mock('@/server/services/admin-org', () => ({
  enforceNetworkPolicy: vi.fn().mockResolvedValue(undefined),
}));

async function entitlementsTableAvailable(): Promise<boolean> {
  if (!(await databaseAvailable())) return false;
  const pg = (await import('pg')).default;
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 1_500,
  });
  try {
    await client.connect();
    const result = await client.query<{ ok: boolean }>(
      "select to_regclass('core.entitlements') is not null as ok",
    );
    return result.rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const available = await entitlementsTableAvailable();

// Real database round-trips can exceed the 5s default on a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe.skipIf(!available)('withApi entitlement gate (integration)', async () => {
  const { eq } = await import('drizzle-orm');
  const { entitlements } = await import('@kitstak/db/schema');
  const { clearEntitlementsCache, grantModule, revokeModule, setEntitlement } = await import('@kitstak/entitlements');
  type EntitlementsDbType = import('@kitstak/entitlements').EntitlementsDb;
  const { withApi } = await import('./api');
  const { db } = await import('@/server/db');
  const { createTestOrgs } = await import('./services/__tests__/db-fixture');

  const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana', email: 'ana@example.com' };
  const edb = db as unknown as EntitlementsDbType;
  let fixture: Awaited<ReturnType<typeof createTestOrgs>>;
  let orgId = '';

  const handler = withApi({ permission: 'board:read', rateLimit: false }, async (ctx) => ({
    orgId: ctx.org.organization.id,
  }));

  function request(): Request {
    return new Request('http://localhost:3100/api/v1/test', {
      method: 'GET',
      headers: { 'x-org-id': orgId },
    });
  }

  const noParams = { params: Promise.resolve({}) };

  const writeHandler = withApi({ permission: 'board:read', rateLimit: false }, async () => ({ wrote: true }));
  const exportHandler = withApi({ permission: 'board:read', rateLimit: false, planRead: true }, async () => ({
    exported: true,
  }));

  function post(): Request {
    return new Request('http://localhost:3100/api/v1/test', {
      method: 'POST',
      headers: { 'x-org-id': orgId, origin: 'http://localhost:3100' },
    });
  }

  /** A free trial that ended yesterday: the CRM is view only (docs/billing/SPEC.md P14). */
  async function endTrial(): Promise<void> {
    await db.delete(entitlements).where(eq(entitlements.orgId, orgId));
    await setEntitlement(edb, {
      orgId,
      module: 'crm',
      status: 'trialing',
      source: 'trial',
      periodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
      seats: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    });
    clearEntitlementsCache();
  }

  beforeAll(async () => {
    fixture = await createTestOrgs([{ key: 'ent', users: { owner: 'owner' } }]);
    orgId = fixture.orgs.ent!.orgId;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    clearEntitlementsCache();
    await db.delete(entitlements).where(eq(entitlements.orgId, orgId));
    await fixture.cleanup();
  });

  beforeEach(() => {
    sessionMock.getSessionFromHeaders.mockResolvedValue({ user: USER, session: { id: 's1' } });
    sessionMock.findOrgMembership.mockResolvedValue({
      organization: { id: orgId, name: 'Ent Test', slug: 'ent-test', logo: null },
      memberId: 'm1',
      roles: ['owner'],
      role: 'owner',
      roleString: 'owner',
      permissions: [],
    });
    clearEntitlementsCache();
    // NODE_ENV=test defaults to allow-all; the explicit override enforces the gate.
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '0');
  });

  it('402s org-scoped routes when the crm entitlement is revoked; a grant restores access', async () => {
    await revokeModule(edb, orgId, 'crm');

    const blocked = await handler(request(), noParams);
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toEqual({
      ok: false,
      error: {
        code: 'entitlement.missing',
        module: 'crm',
        message: 'CRM is not in your plan yet. Add it in the Portal to use it.',
      },
    });

    await grantModule(edb, orgId, 'crm');
    const allowed = await handler(request(), noParams);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true, data: { orgId } });
  });

  it('view only: reads pass, every write is refused with the one plain sentence', async () => {
    await endTrial();

    const read = await handler(request(), noParams);
    expect(read.status).toBe(200);

    const write = await writeHandler(post(), noParams);
    expect(write.status).toBe(402);
    expect(await write.json()).toEqual({
      ok: false,
      error: {
        code: 'plan.read_only',
        module: 'crm',
        message: 'Your plan is view only right now. Pick a plan in the Portal to make changes.',
      },
    });
  });

  it('view only: a route marked planRead (an export, a query sent as POST) keeps working', async () => {
    await endTrial();
    const exported = await exportHandler(post(), noParams);
    expect(exported.status).toBe(200);
    expect(await exported.json()).toEqual({ ok: true, data: { exported: true } });
  });

  it('view only ends the moment the plan is paid: the next write passes', async () => {
    await endTrial();
    expect((await writeHandler(post(), noParams)).status).toBe(402);
    await db.delete(entitlements).where(eq(entitlements.orgId, orgId));
    await setEntitlement(edb, {
      orgId,
      module: 'crm',
      status: 'active',
      source: 'stripe',
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      seats: 3,
      stripeSubscriptionId: 'sub_test_crm_gate',
      stripePriceId: 'price_test_crm_gate',
    });
    // No cache clear here: a "not full" answer is always read again.
    expect((await writeHandler(post(), noParams)).status).toBe(200);
  });

  it('a running free trial has full access', async () => {
    await db.delete(entitlements).where(eq(entitlements.orgId, orgId));
    await setEntitlement(edb, {
      orgId,
      module: 'crm',
      status: 'trialing',
      source: 'trial',
      periodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      seats: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    });
    clearEntitlementsCache();
    expect((await writeHandler(post(), noParams)).status).toBe(200);
  });

  it('ENTITLEMENTS_DEV_ALLOW_ALL=1 bypasses a revoked entitlement', async () => {
    await revokeModule(edb, orgId, 'crm');
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '1');

    const allowed = await handler(request(), noParams);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true, data: { orgId } });
  });
});
