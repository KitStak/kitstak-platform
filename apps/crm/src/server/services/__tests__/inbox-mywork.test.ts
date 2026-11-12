/**
 * My work aggregation + Inbox feed: pure helpers, plus integration against the dev Postgres
 * (isolated throwaway orgs; skipped when no DB is reachable).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isTerminalLabelName,
  peopleIncludes,
  pickDateColumn,
  pickStatusColumn,
  statusLabelsOf,
} from '../inbox-mywork-my-work';
import { inboxQuerySchema, inboxReadSchema, myWorkQuerySchema } from '../contracts/inbox-mywork';
import { createTestOrgs, ctxFor, databaseAvailable, type TestOrg } from './db-fixture';

describe('my work helpers', () => {
  it('reads status labels defensively, sorted, without the default label', () => {
    expect(statusLabelsOf(null)).toEqual([]);
    expect(
      statusLabelsOf({
        labels: [
          { id: 'b', name: 'Done', color: 'green', position: 2, isDone: true },
          { id: 'a', name: 'Working', color: 'orange', position: 1 },
          { id: 'default', name: '', color: 'gray', position: 0, isDefault: true },
          { id: 1, name: 'bad' },
        ],
      }),
    ).toEqual([
      { id: 'a', name: 'Working', color: 'orange', isDone: false, isClosed: false },
      { id: 'b', name: 'Done', color: 'green', isDone: true, isClosed: true },
    ]);
  });

  it('flags closed outcomes (Lost, Cancelled, Closed) as terminal', () => {
    const labels = statusLabelsOf({
      labels: [
        { id: 'n', name: 'Negotiation', color: 'blue' },
        { id: 'w', name: 'Won', color: 'green', isDone: true },
        { id: 'l', name: 'Lost', color: 'red' },
        { id: 'c', name: 'Cancelled', color: 'gray' },
        { id: 'x', name: 'Closed', color: 'gray' },
      ],
    });
    expect(labels.map((label) => label.isClosed)).toEqual([false, true, true, true, true]);
    expect(isTerminalLabelName('Canceled')).toBe(true);
    expect(isTerminalLabelName('Working on it')).toBe(false);
  });

  it('only picks status columns that track progress', () => {
    const size = { key: 'size', title: 'Company size', labels: [] };
    const type = { key: 'type', title: 'Type', labels: [] };
    const stage = { key: 'stage', title: 'Stage', labels: [] };
    const done = { id: 'ok', name: 'Healthy', color: 'green', isDone: true, isClosed: true };
    const health = { key: 'health', title: 'Health', labels: [done] };
    const status = { key: 'status', title: 'Status', labels: [{ ...done, name: 'Done' }] };
    const custom = { key: 'phase_x', title: 'Delivery', labels: [{ ...done, name: 'Shipped' }] };
    expect(pickStatusColumn([])).toBeNull();
    expect(pickStatusColumn([size, stage])).toBe(stage);
    expect(pickStatusColumn([size, stage, health])).toBe(stage);
    expect(pickStatusColumn([stage, status])).toBe(status);
    expect(pickStatusColumn([size])).toBeNull();
    expect(pickStatusColumn([type, health])).toBeNull();
    expect(pickStatusColumn([type, custom])).toBe(custom);
  });

  it('prefers due-like date columns and skips historical ones', () => {
    const last = { key: 'last_contacted', title: 'Last contacted' };
    const close = { key: 'close_date', title: 'Expected close' };
    const plain = { key: 'date', title: 'Date' };
    expect(pickDateColumn([last])).toBeNull();
    expect(pickDateColumn([plain, close])).toBe(close);
    expect(pickDateColumn([last, plain])).toBe(plain);
  });

  it('matches people cells', () => {
    expect(peopleIncludes({ ids: ['u1', 'u2'] }, 'u2')).toBe(true);
    expect(peopleIncludes({ ids: [] }, 'u2')).toBe(false);
    expect(peopleIncludes('u2', 'u2')).toBe(false);
  });

  it('validates query and body schemas', () => {
    expect(inboxQuerySchema.parse({}).filter).toBe('all');
    expect(inboxQuerySchema.safeParse({ filter: 'nope' }).success).toBe(false);
    expect(inboxQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(inboxReadSchema.safeParse({ updateIds: [] }).success).toBe(false);
    expect(inboxReadSchema.safeParse({ updateIds: ['not-a-uuid'] }).success).toBe(false);
    expect(myWorkQuerySchema.safeParse({ boardId: 'x' }).success).toBe(false);
  });
});

const available = await databaseAvailable();
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe.skipIf(!available)('inbox + my work (integration)', async () => {
  const { createWorkspace } = await import('../workspaces');
  const { createBoard, getBoardPayload } = await import('../boards');
  const { createItem, updateItem } = await import('../items');
  const { createUpdate, deleteUpdate } = await import('../updates');
  const { listMyWork } = await import('../inbox-mywork-my-work');
  const { listInboxBoards, listInboxFeed, markInboxRead } = await import('../inbox-mywork-feed');
  const { deleteNotification, listNotifications, markNotifications } = await import('../notifications');

  let fixture: Awaited<ReturnType<typeof createTestOrgs>>;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let boardId: string;
  let assignedItemId: string;
  const doc = (text: string) => ({
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  beforeAll(async () => {
    fixture = await createTestOrgs([
      { key: 'a', users: { owner: 'owner', rep: 'member', other: 'member' } },
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
    const groupId = payload.groups[0]?.id as string;
    const rep = orgA.users.rep?.id as string;
    const assigned = await createItem(owner, boardId, { name: 'Assigned deal', groupId });
    assignedItemId = assigned.id;
    await updateItem(owner, assigned.id, {
      values: { owner: { ids: [rep] }, close_date: { date: '2026-01-15' }, stage: { labelId: 'proposal' } },
    });
    const done = await createItem(owner, boardId, { name: 'Won deal', groupId });
    await updateItem(owner, done.id, { values: { owner: { ids: [rep] }, stage: { labelId: 'won' } } });
    await createItem(owner, boardId, { name: 'Someone else', groupId });
    await createUpdate(owner, assigned.id, { body: doc('Kickoff call booked') });
  }, 60_000);

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('lists only items assigned to the caller, with status and date columns resolved', async () => {
    const result = await listMyWork(await ctxFor(orgA, 'rep'), {});
    expect(result.items.map((item) => item.name).sort()).toEqual(['Assigned deal', 'Won deal']);
    const board = result.boards[0];
    expect(board?.status?.key).toBe('stage');
    expect(board?.status?.labels.find((label) => label.isDone)?.id).toBe('won');
    expect(board?.date?.key).toBe('close_date');
    expect(board?.canEdit).toBe(true);
    const assigned = result.items.find((item) => item.id === assignedItemId);
    expect(assigned?.date).toBe('2026-01-15');
    expect(assigned?.statusLabelId).toBe('proposal');
    expect(result.truncated).toBe(false);
  });

  it('is empty for unassigned users and other orgs', async () => {
    expect((await listMyWork(await ctxFor(orgA, 'other'), {})).items).toEqual([]);
    expect((await listMyWork(await ctxFor(orgB, 'owner'), {})).items).toEqual([]);
  });

  it('feeds threads on followed items, tracks unread and honors read marks', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const feed = await listInboxFeed(rep, inboxQuerySchema.parse({}));
    expect(feed.items).toHaveLength(1);
    const thread = feed.items[0];
    expect(thread?.itemName).toBe('Assigned deal');
    expect(thread?.boardName).toBe('Deals');
    expect(thread?.unread).toBe(true);
    expect(feed.unreadCount).toBe(1);
    expect((await listInboxBoards(rep)).map((board) => board.id)).toEqual([boardId]);

    await markInboxRead(rep, { updateIds: [thread?.update.id as string], read: true });
    const after = await listInboxFeed(rep, inboxQuerySchema.parse({ filter: 'unread' }));
    expect(after.items).toHaveLength(0);
    expect(after.unreadCount).toBe(0);

    await markInboxRead(rep, { updateIds: [thread?.update.id as string], read: false });
    expect((await listInboxFeed(rep, inboxQuerySchema.parse({ filter: 'unread' }))).items).toHaveLength(1);
  });

  it('excludes threads with only my own posts and other orgs', async () => {
    const owner = await ctxFor(orgA, 'owner');
    expect((await listInboxFeed(owner, inboxQuerySchema.parse({}))).items).toHaveLength(0);
    expect((await listInboxFeed(await ctxFor(orgA, 'other'), inboxQuerySchema.parse({}))).items).toHaveLength(
      0,
    );
    expect((await listInboxFeed(await ctxFor(orgB, 'owner'), inboxQuerySchema.parse({}))).items).toHaveLength(
      0,
    );
    expect(
      await markInboxRead(await ctxFor(orgB, 'owner'), { updateIds: [assignedItemId], read: true }),
    ).toEqual({
      updated: 0,
    });
  });

  it('surfaces replies by others on my own thread and mentions', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const other = await ctxFor(orgA, 'other');
    const owner = await ctxFor(orgA, 'owner');
    const mine = await createUpdate(rep, assignedItemId, { body: doc('My status note') });
    await createUpdate(other, assignedItemId, { body: doc('Thanks!'), parentUpdateId: mine.id });
    const feed = await listInboxFeed(rep, inboxQuerySchema.parse({}));
    const thread = feed.items.find((entry) => entry.update.id === mine.id);
    expect(thread?.update.replies.map((reply) => reply.bodyText)).toEqual(['Thanks!']);
    expect(feed.items[0]?.update.id).toBe(mine.id); // newest activity first

    const otherId = orgA.users.other?.id as string;
    await createUpdate(owner, assignedItemId, {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { id: otherId, label: 'other' } },
              { type: 'text', text: ' please review' },
            ],
          },
        ],
      },
    });
    const mentions = await listInboxFeed(other, inboxQuerySchema.parse({ filter: 'mentions' }));
    expect(mentions.items.some((entry) => entry.mentionsMe)).toBe(true);
  });

  it('paginates by activity with a stable cursor', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const first = await listInboxFeed(rep, inboxQuerySchema.parse({ limit: 1 }));
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listInboxFeed(rep, inboxQuerySchema.parse({ limit: 1, cursor: first.nextCursor }));
    expect(second.items[0]?.update.id).not.toBe(first.items[0]?.update.id);
  });

  it('filters notifications by board and search and deletes only your own', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const all = await listNotifications(rep, { limit: 50, filter: 'all', boardId });
    expect(all.items.length).toBeGreaterThan(0);
    const none = await listNotifications(rep, { limit: 50, filter: 'all', q: 'zzz-no-match' });
    expect(none.items).toHaveLength(0);
    const target = all.items[0]?.id as string;
    await expect(deleteNotification(await ctxFor(orgA, 'other'), target)).rejects.toThrow();
    const removed = await deleteNotification(rep, target);
    expect(removed.id).toBe(target);
  });

  it('mark all returns exactly the ids it flipped, honoring board/search scope', async () => {
    const rep = await ctxFor(orgA, 'rep');
    await markNotifications(rep, { all: true, read: false });
    const unreadBefore = (await listNotifications(rep, { limit: 100, filter: 'unread' })).items.map((n) => n.id);
    expect(unreadBefore.length).toBeGreaterThan(0);

    const none = await markNotifications(rep, { all: true, read: true, q: 'zzz-no-match' });
    expect(none.ids).toEqual([]);
    expect(none.unreadCount).toBe(unreadBefore.length);

    const marked = await markNotifications(rep, { all: true, read: true });
    expect([...marked.ids].sort()).toEqual([...unreadBefore].sort());
    expect(marked.unreadCount).toBe(0);
    // Already-read rows are not touched again, so a second mark-all is a no-op.
    expect((await markNotifications(rep, { all: true, read: true })).ids).toEqual([]);

    const undone = await markNotifications(rep, { ids: marked.ids, read: false });
    expect(undone.unreadCount).toBe(unreadBefore.length);
  });

  it('skips update notifications for people who turned the item off, but not mentions', async () => {
    const { changeItemSubscribers } = await import('../item-panel');
    const rep = await ctxFor(orgA, 'rep');
    const owner = await ctxFor(orgA, 'owner');
    await changeItemSubscribers(rep, assignedItemId, { add: [], remove: [orgA.users.rep?.id as string] });
    const before = (await listNotifications(rep, { limit: 100, filter: 'all' })).items.length;
    await createUpdate(owner, assignedItemId, { body: doc('Muted update') });
    expect((await listNotifications(rep, { limit: 100, filter: 'all' })).items.length).toBe(before);
    await changeItemSubscribers(rep, assignedItemId, { add: [orgA.users.rep?.id as string], remove: [] });
  });

  it('matches the actor name in notification search', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const owner = await ctxFor(orgA, 'owner');
    await createUpdate(owner, assignedItemId, { body: doc('Actor search probe') });
    const ownerName = 'owner a'; // db-fixture names users `${key} ${org}`
    const byActor = await listNotifications(rep, { limit: 100, filter: 'all', q: ownerName });
    expect(byActor.items.length).toBeGreaterThan(0);
    expect(byActor.items.every((entry) => entry.actor?.name === ownerName)).toBe(true);
  });

  it('retracts the notifications of a deleted update (mention preview included)', async () => {
    const other = await ctxFor(orgA, 'other');
    const owner = await ctxFor(orgA, 'owner');
    const otherId = orgA.users.other?.id as string;
    const update = await createUpdate(owner, assignedItemId, {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { id: otherId, label: 'other' } },
              { type: 'text', text: ' retract probe' },
            ],
          },
        ],
      },
    });
    const hasIt = async () =>
      (await listNotifications(other, { limit: 100, filter: 'all' })).items.some(
        (entry) => entry.updateId === update.id,
      );
    expect(await hasIt()).toBe(true);
    await deleteUpdate(owner, update.id);
    expect(await hasIt()).toBe(false);
  });
});
