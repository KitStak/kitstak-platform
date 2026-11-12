/**
 * Webhook outbox + transport: pure retry / concurrency helpers, DNS-pinned private-address
 * blocking, capped response reads, and (against the dev DB, skipped when unreachable) that a
 * rolled-back item mutation never reaches the endpoint while a committed one does.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrgs, ctxFor, databaseAvailable, type TestOrg } from './db-fixture';

process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-1234';

describe('outbox helpers (pure)', async () => {
  const { afterFailure, mapLimit, MAX_ATTEMPTS, RETRY_BACKOFF_MS } = await import(
    '../automations-webhooks-outbox'
  );

  it('backs off 1m / 5m / 30m / 2h, then gives up', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const delays = [1, 2, 3, 4].map((attempt) => {
      const next = afterFailure(attempt, now);
      return next.giveUp ? null : next.nextAttemptAt.getTime() - now.getTime();
    });
    expect(delays).toEqual([...RETRY_BACKOFF_MS]);
    expect(afterFailure(MAX_ATTEMPTS, now)).toEqual({ giveUp: true });
  });

  it('runs at most N tasks at once', async () => {
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push(n);
      active -= 1;
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('transport', async () => {
  const { postWebhook, pinnedLookup, EgressBlockedError } = await import('../automations-webhooks-transport');
  const { isPrivateAddress } = await import('../automations-webhooks');
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/big') {
        response.end('x'.repeat(50_000));
        return;
      }
      if (request.url === '/redirect') {
        response.statusCode = 302;
        response.setHeader('location', 'http://example.com');
        response.end();
        return;
      }
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const options = { timeoutMs: 2_000, maxResponseBytes: 1_000, blockPrivate: false, isPrivateAddress };

  it('posts, caps the response body and never follows redirects', async () => {
    expect(await postWebhook(new URL(`${base}/ok`), {}, '{}', options)).toEqual({ status: 200, body: 'ok' });
    const big = await postWebhook(new URL(`${base}/big`), {}, '{}', options);
    expect(big.body).toHaveLength(1_000);
    expect((await postWebhook(new URL(`${base}/redirect`), {}, '{}', options)).status).toBe(302);
  });

  it('blocks private targets when strict, including names that resolve privately', async () => {
    await expect(
      postWebhook(new URL(`${base}/ok`), {}, '{}', { ...options, blockPrivate: true }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    const lookup = pinnedLookup(isPrivateAddress);
    const error = await new Promise<unknown>((resolve) =>
      lookup('localhost', {}, (err) => resolve(err)),
    );
    expect(error).toBeInstanceOf(EgressBlockedError);
  });
});

const available = await databaseAvailable();
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe.skipIf(!available)('outbox delivery (integration)', async () => {
  const { createWorkspace } = await import('../workspaces');
  const { createBoard } = await import('../boards');
  const { createItem } = await import('../items');
  const { inTransaction } = await import('../context');
  const hooks = await import('../automations-webhooks');
  const { drainWebhookOutbox } = await import('../automations-webhooks-outbox');

  let fixture: Awaited<ReturnType<typeof createTestOrgs>>;
  let org: TestOrg;
  let boardId: string;
  let server: Server;
  let endpoint: string;
  const received: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        received.push(body);
        response.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    fixture = await createTestOrgs([{ key: 'a', users: { owner: 'owner' } }]);
    org = fixture.orgs.a as TestOrg;
    const owner = await ctxFor(org, 'owner');
    const workspace = await createWorkspace(owner, { name: 'Ops', color: 'blue', kind: 'open' });
    const board = await createBoard(owner, {
      workspaceId: workspace.id,
      name: 'Outbox',
      templateId: 'crm-deals',
      privacy: 'main',
      withSampleData: false,
    });
    boardId = board.id;
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('does not deliver events from a rolled-back transaction, delivers committed ones', async () => {
    const owner = await ctxFor(org, 'owner');
    const created = await hooks.createWebhook(owner, boardId, { url: endpoint, events: ['item.created'] });
    const before = received.length;
    await expect(
      inTransaction(owner, async (tx) => {
        await createItem(tx, boardId, { name: 'Rolled back' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    await drainWebhookOutbox();
    expect(received.slice(before).some((body) => body.includes('Rolled back'))).toBe(false);

    const item = await createItem(owner, boardId, { name: 'Committed' });
    await vi.waitFor(
      async () => {
        await drainWebhookOutbox();
        expect(received.slice(before).some((body) => body.includes(item.id))).toBe(true);
      },
      { timeout: 5_000 },
    );
    await hooks.deleteWebhook(owner, created.webhook.id);
  });
});
