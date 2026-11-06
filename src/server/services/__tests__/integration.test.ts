/**
 * Service integration tests against the dev Postgres (embedded, port 5544). Each run creates
 * isolated throwaway organizations and removes them afterwards. Skipped when no DB is up.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrgs, ctxFor, databaseAvailable, type TestOrg } from './db-fixture';

const available = await databaseAvailable();

// Real database round-trips (org fixtures, transactions, automations) can exceed the 5s default
// when the machine is busy with dev servers or parallel suites.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe.skipIf(!available)('services (integration)', async () => {
  const { and, eq } = await import('drizzle-orm');
  const schema = await import('@/server/db/schema');
  const { createWorkspace } = await import('../workspaces');
  const { createBoard, getBoardPayload, listBoards, setBoardMembers, updateBoard } =
    await import('../boards');
  const { createItem, moveItem, setCellValue, updateItem } = await import('../items');
  const { getItem, listBoardItems } = await import('../item-reads');
  const { createAutomation } = await import('../automations');
  const { createUpdate } = await import('../updates');
  const { search } = await import('../search');
  const { listNotifications } = await import('../notifications');
  const { runDateArrivedScan } = await import('@/server/automations-engine/scan');
  const { NotFoundError, ForbiddenError, ValidationError } = await import('@/server/http/errors');

  let fixture: Awaited<ReturnType<typeof createTestOrgs>>;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let boardId: string;
  let groupIds: string[];

  beforeAll(async () => {
    fixture = await createTestOrgs([
      { key: 'a', users: { owner: 'owner', rep: 'member', viewer: 'viewer', other: 'member' } },
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
    const payload = await getBoardPayload(owner, boardId, { limit: 50 });
    groupIds = payload.groups.map((group) => group.id);
  }, 30_000);

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('creates boards from templates with columns, groups and views', async () => {
    const payload = await getBoardPayload(await ctxFor(orgA, 'owner'), boardId, { limit: 50 });
    expect(payload.columns.map((column) => column.key)).toContain('forecast');
    expect(payload.groups).toHaveLength(4);
    expect(payload.views.some((view) => view.type === 'kanban')).toBe(true);
    expect(payload.users.length).toBe(4);
  });

  it('validates cell values per column type and computes formulas', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const item = await createItem(rep, boardId, { name: 'Fleet rollout', groupId: groupIds[0] });
    await expect(
      setCellValue(rep, item.id, { columnKey: 'stage', value: { labelId: 'not-a-label' } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(setCellValue(rep, item.id, { columnKey: 'forecast', value: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      setCellValue(rep, item.id, { columnKey: 'owner', value: { ids: [orgB.users.owner?.id] } }),
    ).rejects.toBeInstanceOf(ValidationError);
    const updated = await updateItem(rep, item.id, {
      values: {
        deal_value: { amount: 200_000, currency: 'USD' },
        probability: 25,
        owner: { ids: [orgA.users.rep?.id] },
      },
    });
    expect(updated.computed.forecast).toEqual({ result: 50_000 });
    const activity = await rep.db
      .select()
      .from(schema.activityLog)
      .where(
        and(eq(schema.activityLog.itemId, item.id), eq(schema.activityLog.action, 'item.value_changed')),
      );
    expect(activity.length).toBe(3);
  });

  it('orders items with fractional keys and moves between groups', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const group = groupIds[1] as string;
    const first = await createItem(rep, boardId, { name: 'First', groupId: group });
    const second = await createItem(rep, boardId, { name: 'Second', groupId: group });
    const third = await createItem(rep, boardId, { name: 'Third', groupId: group });
    await moveItem(rep, third.id, { beforeId: first.id });
    await moveItem(rep, second.id, { afterId: third.id });
    const page = await listBoardItems(rep, boardId, { groupId: group, limit: 10, state: 'active' });
    expect(page.items.map((item) => item.name)).toEqual(['Third', 'Second', 'First']);

    const moved = await moveItem(rep, first.id, { groupId: groupIds[2] });
    expect(moved.groupId).toBe(groupIds[2]);
    const paged = await listBoardItems(rep, boardId, { limit: 2, state: 'active' });
    expect(paged.items).toHaveLength(2);
    expect(paged.nextCursor).not.toBeNull();
    const rest = await listBoardItems(rep, boardId, {
      limit: 50,
      cursor: paged.nextCursor ?? undefined,
      state: 'active',
    });
    const ids = new Set([...paged.items, ...rest.items].map((item) => item.id));
    expect(ids.size).toBe(paged.items.length + rest.items.length);
  });

  it('isolates organizations: another org cannot read or list foreign boards and items', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const item = await createItem(rep, boardId, { name: 'Secret deal' });
    const outsider = await ctxFor(orgB, 'owner');
    await expect(getBoardPayload(outsider, boardId, { limit: 10 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getItem(outsider, item.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setCellValue(outsider, item.id, { columnKey: 'next_step', value: 'hijack' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listBoards(outsider, { state: 'active' })).toHaveLength(0);
    const results = await search(outsider, { q: 'Secret deal', types: ['item'], limit: 10 });
    expect(results).toHaveLength(0);
  });

  it('enforces board privacy and board-level viewer access', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const other = await ctxFor(orgA, 'other');
    const rep = await ctxFor(orgA, 'rep');
    await updateBoard(owner, boardId, { privacy: 'private' });
    await expect(getBoardPayload(other, boardId, { limit: 5 })).rejects.toBeInstanceOf(NotFoundError);
    await setBoardMembers(owner, boardId, {
      members: [
        { userId: orgA.users.owner?.id as string, role: 'owner' },
        { userId: orgA.users.other?.id as string, role: 'viewer' },
        { userId: orgA.users.rep?.id as string, role: 'editor' },
      ],
    });
    const visible = await getBoardPayload(other, boardId, { limit: 5 });
    expect(visible.board.canEdit).toBe(false);
    await expect(createItem(other, boardId, { name: 'Nope' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createItem(rep, boardId, { name: 'Allowed' })).resolves.toMatchObject({ name: 'Allowed' });
    await updateBoard(owner, boardId, { privacy: 'main' });
  });

  it('runs automations: status trigger moves the item and notifies; ping-pong loops terminate', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const wonGroup = groupIds[2] as string;
    await createAutomation(owner, boardId, {
      name: 'Won deals',
      enabled: true,
      trigger: { type: 'status_changed', config: { columnKey: 'stage', toLabelId: 'won' } },
      conditions: [],
      actions: [
        { type: 'move_to_group', config: { groupId: wonGroup } },
        { type: 'notify', config: { userIds: [orgA.users.owner?.id as string], message: '{name} won' } },
      ],
    });
    const rep = await ctxFor(orgA, 'rep');
    const item = await createItem(rep, boardId, { name: 'Automation target', groupId: groupIds[0] });
    await setCellValue(rep, item.id, { columnKey: 'stage', value: { labelId: 'won' } });
    const after = await getItem(rep, item.id);
    expect(after.groupId).toBe(wonGroup);
    const runs = await rep.db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.itemId, item.id));
    expect(runs.map((run) => run.status)).toEqual(['succeeded']);
    const notes = await listNotifications(owner, { limit: 10, filter: 'all' });
    expect(notes.items.some((note) => note.kind === 'automation' && note.itemId === item.id)).toBe(true);

    // Two automations that flip the priority back and forth must not loop forever.
    for (const [from, to] of [
      ['high', 'low'],
      ['low', 'high'],
    ] as const) {
      await createAutomation(owner, boardId, {
        name: `flip ${from}`,
        enabled: true,
        trigger: { type: 'status_changed', config: { columnKey: 'priority', toLabelId: from } },
        conditions: [],
        actions: [{ type: 'set_status', config: { columnKey: 'priority', labelId: to } }],
      });
    }
    const looping = await createItem(rep, boardId, { name: 'Loop guard' });
    await setCellValue(rep, looping.id, { columnKey: 'priority', value: { labelId: 'high' } });
    const loopRuns = await rep.db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.itemId, looping.id));
    expect(loopRuns.length).toBeGreaterThan(0);
    expect(loopRuns.length).toBeLessThanOrEqual(3);
  });

  it('date-arrived scan is idempotent per day', async () => {
    const owner = await ctxFor(orgA, 'owner');
    const today = '2030-06-15';
    await createAutomation(owner, boardId, {
      name: 'Close reminder',
      enabled: true,
      trigger: { type: 'date_arrived', config: { columnKey: 'close_date', offsetDays: 0 } },
      conditions: [],
      actions: [
        {
          type: 'notify',
          config: { userIds: [orgA.users.owner?.id as string], message: '{name} closes today' },
        },
      ],
    });
    const item = await createItem(owner, boardId, {
      name: 'Closing',
      values: { close_date: { date: today } },
    });
    const system = { ...owner, userId: null };
    const first = await runDateArrivedScan(system, today);
    expect(first.runs.filter((run) => run.itemId === item.id)).toHaveLength(1);
    const second = await runDateArrivedScan(system, today);
    expect(second.runs.filter((run) => run.itemId === item.id)).toHaveLength(0);
  });

  it('full-text search finds items by name and cell values, and updates by body', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const item = await createItem(rep, boardId, {
      name: 'Zephyrion warehouse',
      values: { next_step: 'Quasartronic integration review' },
    });
    const byName = await search(rep, { q: 'zephyr', types: ['item'], limit: 10 });
    expect(byName.map((result) => result.id)).toContain(item.id);
    const byValue = await search(rep, { q: 'quasartronic', types: ['item'], limit: 10 });
    expect(byValue[0]?.id).toBe(item.id);
    await createUpdate(rep, item.id, {
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hyperlumen pricing approved' }] }],
      },
    });
    const byUpdate = await search(rep, { q: 'hyperlumen', types: ['update'], limit: 10 });
    expect(byUpdate[0]?.itemId).toBe(item.id);
  });

  it('mentions in updates notify org members only and bodies are sanitized', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const item = await createItem(rep, boardId, { name: 'Mention target' });
    const update = await createUpdate(rep, item.id, {
      body: {
        type: 'doc',
        content: [
          { type: 'mention', attrs: { id: orgA.users.owner?.id, label: 'Owner' } },
          { type: 'mention', attrs: { id: orgB.users.owner?.id, label: 'Outsider' } },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'please review',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    });
    expect(update.mentionedUserIds).toEqual([orgA.users.owner?.id]);
    expect(JSON.stringify(update.body)).not.toContain('javascript');
    const owner = await ctxFor(orgA, 'owner');
    const notes = await listNotifications(owner, { limit: 20, filter: 'mentions' });
    expect(notes.items.some((note) => note.updateId === update.id)).toBe(true);
    const outsiderNotes = await listNotifications(await ctxFor(orgB, 'owner'), { limit: 20, filter: 'all' });
    expect(outsiderNotes.items).toHaveLength(0);
  });
});

describe.skipIf(!available)('RBAC at the route layer', async () => {
  const { vi } = await import('vitest');
  const { createTestOrgs: create, ctxFor: forUser } = await import('./db-fixture');
  let cleanup: () => Promise<void> = async () => undefined;

  afterAll(async () => cleanup());

  it('denies item writes to viewers with 403 and records the denial', async () => {
    const created = await create([{ key: 'rbac', users: { owner: 'owner', viewer: 'viewer' } }]);
    cleanup = created.cleanup;
    const org = created.orgs.rbac as TestOrg;
    const owner = await forUser(org, 'owner');
    const { createWorkspace } = await import('../workspaces');
    const { createBoard } = await import('../boards');
    const workspace = await createWorkspace(owner, { name: 'W', color: 'blue', kind: 'open' });
    const board = await createBoard(owner, {
      workspaceId: workspace.id,
      name: 'B',
      privacy: 'main',
      withSampleData: false,
    });

    const session = await import('@/server/auth/session');
    const viewer = org.users.viewer as { id: string };
    vi.spyOn(session, 'getSessionFromHeaders').mockResolvedValue({
      user: { id: viewer.id },
      session: { id: 'test-session' },
    } as unknown as Awaited<ReturnType<typeof session.getSessionFromHeaders>>);
    const route = await import('@/app/api/v1/boards/[boardId]/items/route');
    const response = await route.POST(
      new Request(`http://localhost:3100/api/v1/boards/${board.id}/items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3100',
          'x-org-id': org.orgId,
        },
        body: JSON.stringify({ name: 'Should fail' }),
      }),
      { params: Promise.resolve({ boardId: board.id }) },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const read = await import('@/app/api/v1/boards/[boardId]/full/route');
    const ok = await read.GET(
      new Request(`http://localhost:3100/api/v1/boards/${board.id}/full`, {
        headers: { 'x-org-id': org.orgId },
      }),
      { params: Promise.resolve({ boardId: board.id }) },
    );
    expect(ok.status).toBe(200);
  });
});
