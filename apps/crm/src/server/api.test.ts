import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const sessionMock = vi.hoisted(() => ({
  getSessionFromHeaders: vi.fn(),
  findOrgMembership: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/server/auth/session', () => sessionMock);
vi.mock('@/server/audit', () => auditMock);
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/env', () => ({ trustedOrigins: () => ['http://localhost:3100'] }));
// The org IP allow-list stage reads org metadata through the real `db`; stub it as "disabled".
vi.mock('@/server/services/admin-org', () => ({
  enforceNetworkPolicy: vi.fn().mockResolvedValue(undefined),
}));

const { withApi, apiResult } = await import('./api');
const { NotFoundError } = await import('./http/errors');

const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana', email: 'ana@example.com' };
const ORG_ID = '22222222-2222-4222-8222-222222222222';

function membership(role: 'owner' | 'viewer') {
  return {
    organization: { id: ORG_ID, name: 'Acme', slug: 'acme', logo: null },
    memberId: 'm1',
    roles: [role],
    role,
    permissions: [],
  };
}

function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3100/api/v1/test?limit=5', {
    method,
    headers: {
      'x-org-id': ORG_ID,
      ...(body === undefined ? {} : { 'content-type': 'application/json', origin: 'http://localhost:3100' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const noParams = { params: Promise.resolve({}) };

async function json(response: Response) {
  return (await response.json()) as { ok: boolean; data?: unknown; meta?: unknown; error?: { code: string } };
}

beforeEach(() => {
  sessionMock.getSessionFromHeaders.mockResolvedValue({ user: USER, session: { id: 's1' } });
  sessionMock.findOrgMembership.mockResolvedValue(membership('owner'));
  auditMock.recordAudit.mockClear();
});

describe('withApi', () => {
  it('wraps handler output in the success envelope with request id and no-store', async () => {
    const handler = withApi({ permission: 'board:read', rateLimit: false }, async (ctx) => ({
      orgId: ctx.org.organization.id,
    }));
    const response = await handler(request('GET'), noParams);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(await json(response)).toEqual({ ok: true, data: { orgId: ORG_ID } });
  });

  it('supports meta and custom status via apiResult', async () => {
    const handler = withApi(
      { rateLimit: false, query: z.object({ limit: z.coerce.number() }) },
      async (ctx) => apiResult([ctx.query.limit], { meta: { nextCursor: null }, status: 201 }),
    );
    const response = await handler(request('GET'), noParams);
    expect(response.status).toBe(201);
    expect(await json(response)).toEqual({ ok: true, data: [5], meta: { nextCursor: null } });
  });

  it('returns 401 when unauthenticated', async () => {
    sessionMock.getSessionFromHeaders.mockResolvedValue(null);
    const response = await withApi({ rateLimit: false }, async () => 'x')(request('GET'), noParams);
    expect(response.status).toBe(401);
    expect((await json(response)).error?.code).toBe('UNAUTHENTICATED');
  });

  it('returns 404 for non-members so org ids cannot be probed', async () => {
    sessionMock.findOrgMembership.mockResolvedValue(null);
    const response = await withApi({ permission: 'board:read', rateLimit: false }, async () => 'x')(
      request('GET'),
      noParams,
    );
    expect(response.status).toBe(404);
  });

  it('returns 400 ORG_REQUIRED when an org-scoped call names no organization', async () => {
    const response = await withApi({ permission: 'board:read', rateLimit: false }, async () => 'x')(
      new Request('http://localhost:3100/api/v1/test'),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('ORG_REQUIRED');
    expect(sessionMock.findOrgMembership).not.toHaveBeenCalled();
  });

  it('enforces RBAC and audits the denial', async () => {
    sessionMock.findOrgMembership.mockResolvedValue(membership('viewer'));
    const response = await withApi({ permission: 'item:write', rateLimit: false }, async () => 'x')(
      request('POST', {}),
      noParams,
    );
    expect(response.status).toBe(403);
    expect(auditMock.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.forbidden' }));
  });

  it('blocks cross-origin mutations', async () => {
    const response = await withApi({ rateLimit: false }, async () => 'x')(
      request('POST', {}, { origin: 'https://evil.test' }),
      noParams,
    );
    expect(response.status).toBe(403);
  });

  it('validates params and body with Zod (422 with issues)', async () => {
    const handler = withApi(
      {
        permission: 'item:write',
        rateLimit: false,
        params: z.object({ id: z.uuid() }),
        body: z.object({ name: z.string().min(1) }),
      },
      async (ctx) => ({ id: ctx.params.id, name: ctx.body.name }),
    );
    const bad = await handler(request('POST', { name: '' }), { params: Promise.resolve({ id: 'nope' }) });
    expect(bad.status).toBe(422);
    const good = await handler(request('POST', { name: 'Deal' }), {
      params: Promise.resolve({ id: USER.id }),
    });
    expect(await json(good)).toEqual({ ok: true, data: { id: USER.id, name: 'Deal' } });
  });

  it('maps thrown AppErrors and hides unexpected errors', async () => {
    const notFound = await withApi({ rateLimit: false }, async () => {
      throw new NotFoundError('Board');
    })(request('GET'), noParams);
    expect(notFound.status).toBe(404);

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const crash = await withApi({ rateLimit: false }, async () => {
      throw new Error('db password=hunter2');
    })(request('GET'), noParams);
    expect(crash.status).toBe(500);
    expect(JSON.stringify(await json(crash))).not.toContain('hunter2');
    expect(stderr).toHaveBeenCalled();
  });

  it('records configured audit events on success', async () => {
    const handler = withApi(
      {
        permission: 'board:delete',
        rateLimit: false,
        audit: { action: 'board.deleted', target: () => ({ type: 'board', id: 'b1' }) },
      },
      async () => null,
    );
    const response = await handler(
      request('DELETE', undefined, { origin: 'http://localhost:3100' }),
      noParams,
    );
    expect(response.status).toBe(200);
    expect(auditMock.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'board.deleted',
        targetType: 'board',
        targetId: 'b1',
        orgId: ORG_ID,
        actorId: USER.id,
      }),
    );
  });

  it('rate limits per user and sets RateLimit headers', async () => {
    sessionMock.getSessionFromHeaders.mockResolvedValue({
      user: { ...USER, id: crypto.randomUUID() },
      session: {},
    });
    const handler = withApi({ rateLimit: 'auth' }, async () => 'ok');
    let last: Response | undefined;
    for (let i = 0; i < 11; i += 1) last = await handler(request('GET'), noParams);
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
  });

  it('passes raw Responses through', async () => {
    const response = await withApi(
      { auth: 'none', org: 'none', rateLimit: false },
      async () => new Response('stream'),
    )(request('GET'), noParams);
    expect(await response.text()).toBe('stream');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});
