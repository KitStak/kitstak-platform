/**
 * Automations center + webhooks: pure helpers, and service integration against the dev DB
 * (skipped when Postgres is not reachable). Webhook deliveries go to a local HTTP server.
 */
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrgs, ctxFor, databaseAvailable, type TestOrg } from './db-fixture';

process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-1234';

describe('webhook helpers (pure)', async () => {
  const { isPrivateAddress, signPayload, webhookEventsFor, encryptSecret, decryptSecret } =
    await import('../automations-webhooks');
  const { monthWindow } = await import('../automations-center');

  it('classifies private and public addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ])
      expect(isPrivateAddress(address), address).toBe(true);
    for (const address of ['8.8.8.8', '172.32.0.1', '2606:4700::1111'])
      expect(isPrivateAddress(address), address).toBe(false);
  });

  it('signs payloads as t=<ts>,v1=<hmac of "ts.body">', () => {
    const header = signPayload('whsec_x', '{"a":1}', 1700000000);
    const expected = createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex');
    expect(header).toBe(`t=1700000000,v1=${expected}`);
  });

  it('maps item events to webhook events', () => {
    expect(webhookEventsFor({ type: 'item_created', boardId: 'b', itemId: 'i' })).toEqual(['item.created']);
    expect(
      webhookEventsFor({
        type: 'column_changed',
        boardId: 'b',
        itemId: 'i',
        columnKey: 's',
        columnType: 'status',
        before: null,
        after: null,
      }),
    ).toEqual(['item.updated', 'item.status_changed']);
    expect(webhookEventsFor({ type: 'date_arrived', boardId: 'b', itemId: 'i', columnKey: 'd' })).toEqual([]);
  });

  it('encrypts secrets reversibly with a random IV', () => {
    const a = encryptSecret('whsec_abc');
    expect(a).not.toContain('whsec_abc');
    expect(encryptSecret('whsec_abc')).not.toBe(a);
    expect(decryptSecret(a)).toBe('whsec_abc');
  });

  it('computes the UTC month window', () => {
    const window = monthWindow(new Date('2026-02-14T10:00:00Z'));
    expect(window.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(window.daysInMonth).toBe(28);
    expect(window.dayOfMonth).toBe(14);
  });
});

const available = await databaseAvailable();
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe.skipIf(!available)('automations center services (integration)', async () => {
  const { createWorkspace } = await import('../workspaces');
  const { createBoard, getBoardPayload } = await import('../boards');
  const { createItem, setCellValue } = await import('../items');
  const { createAutomation, deleteAutomation } = await import('../automations');
  const center = await import('../automations-center');
  const hooks = await import('../automations-webhooks');
  const { NotFoundError, ValidationError } = await import('@/server/http/errors');

  let fixture: Awaited<ReturnType<typeof createTestOrgs>>;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let boardId: string;
  let wonGroup: string;
  let server: Server;
  let endpoint: string;
  const received: { headers: IncomingMessage['headers']; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        received.push({ headers: request.headers, body });
        response.statusCode = request.url === '/fail' ? 500 : 200;
        response.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

    fixture = await createTestOrgs([
      { key: 'a', users: { owner: 'owner', rep: 'member', viewer: 'viewer' } },
      { key: 'b', users: { owner: 'owner' } },
    ]);
    orgA = fixture.orgs.a as TestOrg;
    orgB = fixture.orgs.b as TestOrg;
    const owner = await ctxFor(orgA, 'owner');
    const workspace = await createWorkspace(owner, { name: 'Sales', color: 'blue', kind: 'open' });
    const board = await createBoard(owner, {
      workspaceId: workspace.id,
      name: 'Deals',
      templateId: 'crm-deals',
      privacy: 'main',
      withSampleData: false,
    });
    boardId = board.id;
    const payload = await getBoardPayload(owner, boardId, { limit: 5 });
    wonGroup = payload.groups.at(-1)?.id as string;
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('lists board runs with names, filters by status, and reports usage', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const automation = await createAutomation(owner, boardId, {
      name: 'Won to group',
      enabled: true,
      trigger: { type: 'status_changed', config: { columnKey: 'stage', toLabelId: 'won' } },
      conditions: [],
      actions: [{ type: 'move_to_group', config: { groupId: wonGroup } }],
    });
    const item = await createItem(owner, boardId, { name: 'Big deal' });
    await setCellValue(owner, item.id, { columnKey: 'stage', value: { labelId: 'won' } });

    const page = await center.listBoardRuns(owner, boardId, { limit: 10 });
    expect(page.items[0]).toMatchObject({
      automationName: 'Won to group',
      itemName: 'Big deal',
      status: 'succeeded',
    });
    expect((await center.listBoardRuns(owner, boardId, { limit: 10, status: 'failed' })).items).toEqual([]);

    const usage = await center.getAutomationUsage(owner);
    const row = usage.automations.find((entry) => entry.id === automation.id);
    expect(row).toMatchObject({ boardName: 'Deals', runsThisMonth: 1, failuresThisMonth: 0 });
    expect(usage.runsThisMonth).toBeGreaterThanOrEqual(1);
    expect(usage.daily.reduce((sum, value) => sum + value, 0)).toBe(usage.runsThisMonth);

    // Other orgs see nothing of it.
    const other = await ctxFor(orgB, 'owner');
    expect((await center.getAutomationUsage(other)).automations).toEqual([]);
    await expect(center.listBoardRuns(other, boardId, { limit: 10 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('restores a deleted automation with its server-recorded enabled state', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const make = (name: string, enabled: boolean) =>
      createAutomation(owner, boardId, {
        name,
        enabled,
        trigger: { type: 'item_created', config: {} },
        conditions: [],
        actions: [{ type: 'archive_item', config: {} }],
      });
    const off = await make('Restore me (off)', false);
    const on = await make('Restore me (on)', true);
    await deleteAutomation(owner, off.id);
    await deleteAutomation(owner, on.id);
    // The client cannot ask for a different state: input is ignored.
    const restoredOff = await center.restoreAutomation(owner, off.id, { enabled: true } as never);
    const restoredOn = await center.restoreAutomation(owner, on.id, {});
    expect(restoredOff.enabled).toBe(false);
    expect(restoredOn.enabled).toBe(true);
    // Too late to undo.
    await deleteAutomation(owner, on.id);
    await expect(
      center.restoreAutomation(owner, on.id, {}, new Date(Date.now() + center.RESTORE_WINDOW_MS + 60_000)),
    ).rejects.toBeInstanceOf(ValidationError);
    // Other orgs cannot see it.
    await expect(center.restoreAutomation(await ctxFor(orgB, 'owner'), off.id, {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('previews (dry run) and runs an automation on an item, then retries a run', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const automation = await createAutomation(owner, boardId, {
      name: 'Only if won',
      enabled: false,
      trigger: { type: 'item_created', config: {} },
      conditions: [{ type: 'status_is', config: { columnKey: 'stage', labelIds: ['won'] } }],
      actions: [{ type: 'create_update', config: { body: 'Closed {name}' } }],
    });
    const item = await createItem(owner, boardId, { name: 'Preview me' });
    const preview = await center.runAutomationOnItem(owner, automation.id, { itemId: item.id, dryRun: true });
    expect(preview).toMatchObject({
      dryRun: true,
      conditionsMet: false,
      actions: [{ type: 'create_update' }],
    });

    const skipped = await center.runAutomationOnItem(owner, automation.id, {
      itemId: item.id,
      dryRun: false,
    });
    expect(skipped).toMatchObject({ status: 'skipped' });

    await setCellValue({ ...owner, skipAutomations: true }, item.id, {
      columnKey: 'stage',
      value: { labelId: 'won' },
    });
    const ran = await center.runAutomationOnItem(owner, automation.id, { itemId: item.id, dryRun: false });
    expect(ran).toMatchObject({ status: 'succeeded' });

    const runs = await center.listBoardRuns(owner, boardId, { limit: 5, automationId: automation.id });
    expect(runs.items).toHaveLength(1);
    const retried = await center.retryRun(owner, runs.items[0]?.id as string);
    expect(retried.status).toBe('succeeded');

    // Org viewers are stopped by RBAC at the route (automation:write), as for every automation write.
    const { hasPermission } = await import('@/server/rbac/permissions');
    expect(hasPermission('viewer', 'automation:write')).toBe(false);
    expect(hasPermission('member', 'webhook:manage')).toBe(false);
  });

  it('creates a webhook, shows the secret once, signs test deliveries and logs them', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const created = await hooks.createWebhook(owner, boardId, { url: endpoint, events: ['item.created'] });
    expect(created.secret).toMatch(/^whsec_/);
    expect(JSON.stringify(await hooks.listWebhooks(owner, boardId))).not.toContain(created.secret);

    const delivery = await hooks.testWebhook(owner, created.webhook.id);
    expect(delivery).toMatchObject({ ok: true, status: 200, kind: 'test', event: 'webhook.test' });
    const last = received.at(-1);
    const signature = String(last?.headers['x-kitstak-signature']);
    const [t, v1] = signature.split(',').map((part) => part.split('=')[1]);
    expect(createHmac('sha256', created.secret).update(`${t}.${last?.body}`).digest('hex')).toBe(v1);

    const log = await hooks.listWebhookDeliveries(owner, created.webhook.id, { limit: 10 });
    expect(log.items[0]).toMatchObject({ ok: true, status: 200 });

    // Failing endpoint is recorded with the HTTP status and bumps the failure counter.
    await hooks.updateWebhook(owner, created.webhook.id, { url: endpoint.replace('/hook', '/fail') });
    const failed = await hooks.testWebhook(owner, created.webhook.id);
    expect(failed).toMatchObject({ ok: false, status: 500 });
    const [row] = await hooks.listWebhooks(owner, boardId);
    expect(row?.failureCount).toBe(1);

    const rotated = await hooks.rotateWebhookSecret(owner, created.webhook.id);
    expect(rotated.secret).not.toBe(created.secret);

    const other = await ctxFor(orgB, 'owner');
    await expect(hooks.testWebhook(other, created.webhook.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      hooks.createWebhook(owner, boardId, { url: 'ftp://x', events: ['item.created'] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await hooks.deleteWebhook(owner, created.webhook.id);
    expect(await hooks.listWebhooks(owner, boardId)).toEqual([]);
  });

  it('delivers real item events to subscribed webhooks', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const created = await hooks.createWebhook(owner, boardId, { url: endpoint, events: ['item.created'] });
    const before = received.length;
    const item = await createItem(owner, boardId, { name: 'Webhook item' });
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(before), { timeout: 5_000 });
    const body = JSON.parse(received.at(-1)?.body ?? '{}') as { event: string; data: { itemId: string } };
    expect(body).toMatchObject({ event: 'item.created', data: { itemId: item.id } });
    await hooks.deleteWebhook(owner, created.webhook.id);
  });
});
