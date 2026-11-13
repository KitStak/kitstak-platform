/** Seed: comment threads, reactions, read receipts, notifications, automations, favorites. */
import type { Executor } from '../index';
import {
  automationRuns,
  automations,
  favorites,
  invitation,
  notifications,
  recentVisits,
  updateReactions,
  updateReads,
  updates,
} from '../schema';
import { automationRecipeSchema } from '@/server/automations-engine/recipes';
import { initialPositions } from '@/server/services/positions';
import type { BoardTarget } from './writer';
import type { BoardKey, SeedItem, UserIds } from './crm-data';
import { DEMO_EMAIL_DOMAIN, REACTIONS, REPLY_TEXTS, UPDATE_TEXTS } from './fixtures';
import { daysAgo, type Rng } from './rng';

interface SeedContext {
  readonly db: Executor;
  readonly orgId: string;
  readonly rng: Rng;
  readonly users: UserIds;
  readonly today: Date;
  readonly targets: ReadonlyMap<BoardKey, BoardTarget>;
}

function doc(text: string, mention?: { id: string; label: string }) {
  const content: unknown[] = [];
  if (mention)
    content.push(
      { type: 'mention', attrs: { id: mention.id, label: mention.label } },
      { type: 'text', text: ' ' },
    );
  content.push({ type: 'text', text });
  return { type: 'doc' as const, content: [{ type: 'paragraph', content }] };
}

const between = (rng: Rng, from: Date, to: Date) =>
  new Date(from.getTime() + rng.next() * Math.max(0, to.getTime() - from.getTime()));

export async function seedUpdates(
  ctx: SeedContext,
  seedItems: readonly SeedItem[],
): Promise<{ threads: number; mentionsForMaya: string[] }> {
  const { rng, users } = ctx;
  const authors = [users.daniel, users.sofia, users.ethan, users.hannah, users.liam, users.maya];
  const deals = seedItems.filter((item) => item.board === 'crm-deals');
  const accounts = seedItems.filter((item) => item.board === 'crm-accounts' && item.group === 'customers');
  const projects = seedItems.filter((item) => item.board === 'cs-onboarding' && !item.parentId);
  const subjects = [...rng.sample(deals, 70), ...rng.sample(accounts, 18), ...rng.sample(projects, 14)];
  const mentionsForMaya: string[] = [];
  const updateRows: (typeof updates.$inferInsert)[] = [];
  const reactionRows: (typeof updateReactions.$inferInsert)[] = [];
  const readRows: (typeof updateReads.$inferInsert)[] = [];

  for (const item of subjects) {
    const boardId = ctx.targets.get(item.board)?.boardId as string;
    const threadCount = rng.int(1, 3);
    for (let thread = 0; thread < threadCount; thread += 1) {
      const author = rng.pick(authors);
      const at = between(rng, item.createdAt, daysAgo(ctx.today, 0.05));
      const mentionMaya = author !== users.maya && rng.chance(0.18);
      const text = rng.pick(UPDATE_TEXTS);
      const id = rng.uuid();
      updateRows.push({
        id,
        orgId: ctx.orgId,
        boardId,
        itemId: item.id,
        authorId: author,
        body: doc(text, mentionMaya ? { id: users.maya, label: 'Maya Chen' } : undefined),
        bodyText: mentionMaya ? `@Maya Chen ${text}` : text,
        mentionedUserIds: mentionMaya ? [users.maya] : [],
        pinned: thread === 0 && rng.chance(0.08),
        createdAt: at,
        updatedAt: at,
      });
      if (mentionMaya) mentionsForMaya.push(id);
      for (const emoji of rng.sample(REACTIONS, rng.int(0, 2))) {
        for (const userId of rng.sample(
          authors.filter((candidate) => candidate !== author),
          rng.int(1, 3),
        )) {
          reactionRows.push({ orgId: ctx.orgId, updateId: id, userId, emoji, createdAt: at, updatedAt: at });
        }
      }
      for (const userId of rng.sample(authors, rng.int(1, 4)))
        readRows.push({ orgId: ctx.orgId, updateId: id, userId, readAt: at });
      for (let reply = 0; reply < rng.int(0, 3); reply += 1) {
        const replyAuthor = rng.pick(authors.filter((candidate) => candidate !== author));
        const replyAt = between(rng, at, daysAgo(ctx.today, 0.01));
        const replyText = rng.pick(REPLY_TEXTS);
        updateRows.push({
          id: rng.uuid(),
          orgId: ctx.orgId,
          boardId,
          itemId: item.id,
          authorId: replyAuthor,
          parentUpdateId: id,
          body: doc(replyText),
          bodyText: replyText,
          createdAt: replyAt,
          updatedAt: replyAt,
        });
      }
    }
  }
  // Replies reference parents inserted in the same statement order (parents first).
  const parents = updateRows.filter((row) => !row.parentUpdateId);
  const replies = updateRows.filter((row) => row.parentUpdateId);
  for (let start = 0; start < parents.length; start += 300)
    await ctx.db.insert(updates).values(parents.slice(start, start + 300));
  for (let start = 0; start < replies.length; start += 300)
    await ctx.db.insert(updates).values(replies.slice(start, start + 300));
  for (let start = 0; start < reactionRows.length; start += 500) {
    await ctx.db
      .insert(updateReactions)
      .values(reactionRows.slice(start, start + 500))
      .onConflictDoNothing();
  }
  for (let start = 0; start < readRows.length; start += 500) {
    await ctx.db
      .insert(updateReads)
      .values(readRows.slice(start, start + 500))
      .onConflictDoNothing();
  }
  return { threads: parents.length, mentionsForMaya };
}

export async function seedNotifications(
  ctx: SeedContext,
  seedItems: readonly SeedItem[],
  mentionUpdateIds: readonly string[],
): Promise<number> {
  const { rng, users } = ctx;
  const maya = users.maya;
  const rows: (typeof notifications.$inferInsert)[] = [];
  const mentionRows = await ctx.db.query.updates.findMany({
    where: (table, { inArray }) => inArray(table.id, [...mentionUpdateIds]),
    columns: { id: true, itemId: true, boardId: true, authorId: true, bodyText: true, createdAt: true },
  });
  const itemName = new Map(seedItems.map((item) => [item.id, item.name]));
  for (const row of mentionRows) {
    rows.push({
      orgId: ctx.orgId,
      userId: maya,
      kind: 'mention',
      actorId: row.authorId,
      boardId: row.boardId,
      itemId: row.itemId,
      updateId: row.id,
      payload: { itemName: itemName.get(row.itemId), preview: row.bodyText.slice(0, 200) },
      readAt: rng.chance(0.4) ? row.createdAt : null,
      createdAt: row.createdAt,
    });
  }
  const deals = seedItems.filter((item) => item.board === 'crm-deals');
  const dealsBoard = ctx.targets.get('crm-deals')?.boardId ?? null;
  for (const deal of rng.sample(deals, 8)) {
    const at = daysAgo(ctx.today, rng.int(0, 10) + rng.next());
    rows.push({
      orgId: ctx.orgId,
      userId: maya,
      kind: rng.pick(['assigned', 'status_change', 'update_on_subscribed'] as const),
      actorId: rng.pick([users.daniel, users.sofia, users.ethan]),
      boardId: dealsBoard,
      itemId: deal.id,
      payload: { itemName: deal.name, columnTitle: 'Owner', boardName: 'Deals' },
      readAt: rng.chance(0.5) ? at : null,
      createdAt: at,
    });
  }
  const won = deals
    .filter((deal) => (deal.values.stage as { labelId: string }).labelId === 'won')
    .slice(0, 3);
  for (const deal of won) {
    const at = daysAgo(ctx.today, rng.int(0, 6));
    rows.push({
      orgId: ctx.orgId,
      userId: maya,
      kind: 'automation',
      actorId: null,
      boardId: dealsBoard,
      itemId: deal.id,
      payload: { message: `🎉 ${deal.name} was won`, itemName: deal.name, boardName: 'Deals' },
      createdAt: at,
    });
  }
  for (const key of ['daniel', 'sofia', 'hannah'] as const) {
    for (const deal of rng.sample(deals, 3)) {
      rows.push({
        orgId: ctx.orgId,
        userId: users[key],
        kind: 'assigned',
        actorId: maya,
        boardId: dealsBoard,
        itemId: deal.id,
        payload: { itemName: deal.name },
        createdAt: daysAgo(ctx.today, rng.int(0, 14)),
      });
    }
  }
  await ctx.db.insert(notifications).values(rows);
  return rows.length;
}

/** Board automations (validated against the engine's recipe schema before insert). */
export async function seedAutomations(ctx: SeedContext, seedItems: readonly SeedItem[]): Promise<number> {
  const { users } = ctx;
  const deals = ctx.targets.get('crm-deals') as BoardTarget;
  const leads = ctx.targets.get('crm-leads') as BoardTarget;
  const onboarding = ctx.targets.get('cs-onboarding') as BoardTarget;
  const definitions = [
    {
      boardId: deals.boardId,
      name: 'Celebrate and file won deals',
      description: 'When a deal is won, move it to "Closed won" and notify its owner.',
      recipe: {
        trigger: { type: 'status_changed', config: { columnKey: 'stage', toLabelId: 'won' } },
        conditions: [],
        actions: [
          { type: 'move_to_group', config: { groupId: deals.groupIds.get('closed_won') } },
          {
            type: 'notify',
            config: { userIds: [users.maya], peopleColumnKey: 'owner', message: '🎉 {name} was won' },
          },
        ],
      },
    },
    {
      boardId: deals.boardId,
      name: 'File lost deals',
      description: 'When a deal is lost, move it to "Closed lost".',
      recipe: {
        trigger: { type: 'status_changed', config: { columnKey: 'stage', toLabelId: 'lost' } },
        conditions: [],
        actions: [{ type: 'move_to_group', config: { groupId: deals.groupIds.get('closed_lost') } }],
      },
    },
    {
      boardId: deals.boardId,
      name: 'New deals start in Lead stage',
      description: 'When a deal is created without a stage, set it to Lead and assign the creator.',
      recipe: {
        trigger: { type: 'item_created', config: {} },
        conditions: [{ type: 'column_is_empty', config: { columnKey: 'stage' } }],
        actions: [
          { type: 'set_status', config: { columnKey: 'stage', labelId: 'lead' } },
          { type: 'assign_person', config: { columnKey: 'owner', assignActor: true, mode: 'add' } },
        ],
      },
    },
    {
      boardId: deals.boardId,
      name: 'Close date reminder',
      description: 'Seven days before the expected close date, remind the deal owner.',
      recipe: {
        trigger: { type: 'date_arrived', config: { columnKey: 'close_date', offsetDays: -7 } },
        conditions: [
          {
            type: 'status_is',
            config: { columnKey: 'stage', labelIds: ['lead', 'discovery', 'proposal', 'negotiation'] },
          },
        ],
        actions: [
          {
            type: 'notify',
            config: { peopleColumnKey: 'owner', message: '{name} is expected to close in 7 days' },
          },
        ],
      },
    },
    {
      boardId: leads.boardId,
      name: 'Convert qualified leads to deals',
      description:
        'When a lead is qualified, create a deal on the Deals board and move the lead to "Qualified".',
      recipe: {
        trigger: { type: 'status_changed', config: { columnKey: 'status', toLabelId: 'qualified' } },
        conditions: [],
        actions: [
          { type: 'move_to_group', config: { groupId: leads.groupIds.get('qualified') } },
          {
            type: 'create_item',
            config: {
              boardId: deals.boardId,
              groupId: deals.groupIds.get('this_quarter'),
              nameTemplate: '{name} · new opportunity',
              copyValues: { owner: 'owner', source: 'source' },
            },
          },
        ],
      },
    },
    {
      boardId: onboarding.boardId,
      name: 'Move finished onboardings to Live',
      description: 'When an onboarding project is done, move it to "Live customers".',
      recipe: {
        trigger: { type: 'status_changed', config: { columnKey: 'status', toLabelId: 'done' } },
        conditions: [],
        actions: [{ type: 'move_to_group', config: { groupId: onboarding.groupIds.get('live') } }],
      },
    },
  ];
  const wonDeals = seedItems.filter(
    (item) => item.board === 'crm-deals' && (item.values.stage as { labelId: string }).labelId === 'won',
  );
  let index = 0;
  for (const definition of definitions) {
    const recipe = automationRecipeSchema.parse(definition.recipe);
    const runs = index === 0 ? wonDeals.slice(0, 12) : [];
    const [row] = await ctx.db
      .insert(automations)
      .values({
        orgId: ctx.orgId,
        boardId: definition.boardId,
        name: definition.name,
        description: definition.description,
        trigger: recipe.trigger,
        conditions: recipe.conditions,
        actions: recipe.actions,
        enabled: true,
        runCount: runs.length,
        lastRunAt: runs.length ? daysAgo(ctx.today, 1) : null,
        createdBy: users.maya,
        createdAt: daysAgo(ctx.today, 200 - index * 10),
      })
      .returning({ id: automations.id });
    if (row && runs.length) {
      await ctx.db.insert(automationRuns).values(
        runs.map((deal, runIndex) => {
          const at = daysAgo(ctx.today, runIndex * 4 + 1);
          return {
            orgId: ctx.orgId,
            automationId: row.id,
            boardId: definition.boardId,
            itemId: deal.id,
            status: 'succeeded' as const,
            triggerEvent: { type: 'column_changed', columnKey: 'stage', after: { labelId: 'won' } },
            result: { actions: [{ type: 'move_to_group' }, { type: 'notify', detail: { notified: 2 } }] },
            startedAt: at,
            finishedAt: at,
            durationMs: 40 + runIndex * 3,
            createdAt: at,
          };
        }),
      );
    }
    index += 1;
  }
  return definitions.length;
}

export async function seedPersonal(ctx: SeedContext, dashboardId: string | null): Promise<void> {
  const maya = ctx.users.maya;
  const entries: { entityType: 'board' | 'dashboard'; entityId: string }[] = [];
  const dealsId = ctx.targets.get('crm-deals')?.boardId;
  const leadsId = ctx.targets.get('crm-leads')?.boardId;
  const accountsId = ctx.targets.get('crm-accounts')?.boardId;
  if (dealsId) entries.push({ entityType: 'board', entityId: dealsId });
  if (dashboardId) entries.push({ entityType: 'dashboard', entityId: dashboardId });
  if (leadsId) entries.push({ entityType: 'board', entityId: leadsId });
  const positions = initialPositions(entries.length);
  await ctx.db
    .insert(favorites)
    .values(
      entries.map((entry, index) => ({
        orgId: ctx.orgId,
        userId: maya,
        ...entry,
        position: positions[index] as string,
      })),
    );
  const visits = [dealsId, accountsId, leadsId, ctx.targets.get('cs-onboarding')?.boardId].filter(
    (id): id is string => Boolean(id),
  );
  await ctx.db.insert(recentVisits).values(
    visits.map((entityId, index) => ({
      orgId: ctx.orgId,
      userId: maya,
      entityType: 'board' as const,
      entityId,
      visitCount: 12 - index * 3,
      visitedAt: daysAgo(ctx.today, index * 0.3),
    })),
  );
  await ctx.db.insert(invitation).values({
    organizationId: ctx.orgId,
    email: `jordan.lee@${DEMO_EMAIL_DOMAIN}`,
    role: 'member',
    status: 'pending',
    expiresAt: new Date(ctx.today.getTime() + 6 * 86_400_000),
    inviterId: maya,
  });
}
