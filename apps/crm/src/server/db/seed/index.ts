/**
 * Development seed (`npm run db:seed`): the "Northwind Robotics" demo organization with a
 * full Sales CRM and Customer Success workspace.
 *
 * - Deterministic: content comes from a fixed-seed RNG (dates are relative to today).
 * - Idempotent: the demo org and demo users are deleted and recreated on every run; other
 *   organizations in the database are never touched.
 * - Refuses to run in production unless `ALLOW_DEMO_SEED=1` is set.
 *
 * Demo credentials are documented in ./README.md. They are dev-only and never used in UI code.
 */
import '../../../../scripts/load-env';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { loadEnv } from '../../env';
import { db, getPool } from '../index';
import {
  account,
  boardMembers,
  boards,
  folders,
  member,
  organization,
  team,
  teamMember,
  user,
  workspaceMembers,
} from '../schema';
import { recordAudit } from '@/server/audit';
import type { ServiceContext } from '@/server/services/context';
import { provisionCrmWorkspace } from '@/server/services/onboarding';
import { initialPositions } from '@/server/services/positions';
import { seedAutomations, seedNotifications, seedPersonal, seedUpdates } from './collaboration';
import { generateCrmData, type BoardKey, type UserIds } from './crm-data';
import { DEMO_EMAIL_DOMAIN, DEMO_ORG, DEMO_TEAMS, DEMO_USERS } from './fixtures';
import { addRateColumns, grantDemoApps, programItems } from './programs';
import { createRng, startOfDay } from './rng';
import { writeActivity, writeItems, writeLinks, writeWmsLinks, type BoardTarget } from './writer';

/** Dev-only demo password shared by every seeded user (documented in README.md). */
const DEMO_PASSWORD = 'Northwind-Demo-2026!';
const SEED = 20_261_105;
/** Fixed org id, so Projects and Pulse seed ids (uuidv5 of the org) stay the same across reseeds. */
const DEMO_ORG_ID = '0c4a7d2e-5b1f-4e8a-9d3c-6f2b8a1e4c70';

const demoEmail = (key: string): string => `${key}@${DEMO_EMAIL_DOMAIN}`;

async function seed(): Promise<void> {
  const rng = createRng(SEED);
  const now = new Date();
  const today = startOfDay(now);
  const emails = DEMO_USERS.map((entry) => demoEmail(entry.key));
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const summary = await db.transaction(async (tx) => {
    // Reset: org cascade removes all domain data; deleting users removes sessions/accounts.
    await tx.delete(organization).where(eq(organization.slug, DEMO_ORG.slug));
    await tx.delete(user).where(inArray(user.email, emails));

    const userIds = {} as Record<(typeof DEMO_USERS)[number]['key'], string>;
    for (const entry of DEMO_USERS) {
      const id = rng.uuid();
      userIds[entry.key] = id;
      await tx.insert(user).values({
        id,
        name: entry.name,
        email: demoEmail(entry.key),
        emailVerified: true,
        title: entry.title,
        timezone: entry.timezone,
        createdAt: new Date(today.getTime() - 400 * 86_400_000),
      });
      await tx.insert(account).values({
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: passwordHash,
        updatedAt: now,
      });
    }
    const users = userIds as UserIds;

    const [org] = await tx
      .insert(organization)
      .values({
        id: DEMO_ORG_ID,
        name: DEMO_ORG.name,
        slug: DEMO_ORG.slug,
        createdAt: new Date(today.getTime() - 400 * 86_400_000),
        metadata: JSON.stringify({ teamSize: '21-100', useCase: 'sales_crm', demo: true }),
      })
      .returning();
    if (!org) throw new Error('Organization insert returned no row');
    await tx.insert(member).values(
      DEMO_USERS.map((entry) => ({
        organizationId: org.id,
        userId: users[entry.key],
        role: entry.role,
        createdAt: new Date(today.getTime() - 380 * 86_400_000),
      })),
    );
    for (const definition of DEMO_TEAMS) {
      const [created] = await tx
        .insert(team)
        .values({
          name: definition.name,
          organizationId: org.id,
          memberCount: definition.members.length,
          createdAt: now,
        })
        .returning({ id: team.id });
      if (created)
        await tx
          .insert(teamMember)
          .values(
            definition.members.map((key) => ({ teamId: created.id, userId: users[key], createdAt: now })),
          );
    }

    const ctx: ServiceContext = {
      db: tx,
      orgId: org.id,
      userId: users.maya,
      roles: ['owner'],
      skipAutomations: true,
    };
    const sales = await provisionCrmWorkspace(ctx, {
      workspaceName: 'Sales CRM',
      withSampleData: false,
      icon: 'Briefcase',
      color: 'blue',
    });
    const success = await provisionCrmWorkspace(ctx, {
      workspaceName: 'Customer Success',
      templateIds: ['cs-onboarding', 'cs-renewals'],
      withSampleData: false,
      icon: 'HeartHandshake',
      color: 'green',
      existingBoardIdByTemplate: sales.boardIdByTemplate,
      withDashboard: false,
    });

    // Folders in Sales CRM: Pipeline (Leads, Deals) and Relationships (Accounts, Contacts).
    const folderPositions = initialPositions(2);
    const [pipeline, relationships] = await tx
      .insert(folders)
      .values([
        {
          orgId: org.id,
          workspaceId: sales.workspaceId,
          name: 'Pipeline',
          color: 'blue',
          position: folderPositions[0] as string,
          createdBy: users.maya,
        },
        {
          orgId: org.id,
          workspaceId: sales.workspaceId,
          name: 'Relationships',
          color: 'purple',
          position: folderPositions[1] as string,
          createdBy: users.maya,
        },
      ])
      .returning({ id: folders.id });
    const boardIdOf = (key: BoardKey) =>
      (sales.boardIdByTemplate.get(key) ?? success.boardIdByTemplate.get(key)) as string;
    await tx
      .update(boards)
      .set({ folderId: pipeline?.id })
      .where(inArray(boards.id, [boardIdOf('crm-leads'), boardIdOf('crm-deals')]));
    await tx
      .update(boards)
      .set({ folderId: relationships?.id })
      .where(inArray(boards.id, [boardIdOf('crm-accounts'), boardIdOf('crm-contacts')]));

    // Memberships: everyone (except the guest) in both workspaces; sellers edit sales boards.
    const staff = DEMO_USERS.filter((entry) => entry.role !== 'guest').map((entry) => users[entry.key]);
    for (const workspaceId of [sales.workspaceId, success.workspaceId]) {
      await tx
        .insert(workspaceMembers)
        .values(staff.map((userId) => ({ orgId: org.id, workspaceId, userId, role: 'member' as const })))
        .onConflictDoNothing();
    }
    const allBoards = [...sales.boards, ...success.boards];
    for (const entry of allBoards) {
      const editors = [users.daniel, users.sofia, users.liam, users.ethan, users.hannah];
      await tx
        .insert(boardMembers)
        .values([
          ...editors.map((userId) => ({
            orgId: org.id,
            boardId: entry.board.id,
            userId,
            role: 'editor' as const,
          })),
          { orgId: org.id, boardId: entry.board.id, userId: users.aisha, role: 'viewer' as const },
        ])
        .onConflictDoNothing();
    }
    // The channel partner (guest) collaborates on Leads only.
    await tx
      .insert(boardMembers)
      .values({ orgId: org.id, boardId: boardIdOf('crm-leads'), userId: users.lucas, role: 'editor' })
      .onConflictDoNothing();

    const targets = new Map<BoardKey, BoardTarget>(
      allBoards.map((entry) => [
        entry.template.id as BoardKey,
        { boardId: entry.board.id, groupIds: entry.groupIds },
      ]),
    );
    const dataset = generateCrmData(rng, users, today);
    // Program accounts and deals (docs/programs/SPEC.md 7.1) with the rate columns on Deals.
    dataset.items.push(...programItems(users, today));
    await addRateColumns(tx, org.id, boardIdOf('crm-deals'), users.maya);
    await grantDemoApps(tx, org.id);
    await writeItems(tx, org.id, targets, dataset.items);
    const connectKeys = new Set(
      allBoards.flatMap((entry) =>
        entry.template.columns
          .filter((column) => column.type === 'connect_boards')
          .map((column) => column.key),
      ),
    );
    const links = await writeLinks(tx, org.id, dataset.items, connectKeys);
    const wmsLinks = await writeWmsLinks(
      tx,
      org.id,
      targets.get('crm-accounts')?.boardId,
      dataset.byBoard('crm-accounts'),
    );
    const activity = await writeActivity(tx, org.id, targets, dataset.items);
    const seedCtx = { db: tx, orgId: org.id, rng, users, today, targets };
    const updatesResult = await seedUpdates(seedCtx, dataset.items);
    const notificationCount = await seedNotifications(seedCtx, dataset.items, updatesResult.mentionsForMaya);
    const automationCount = await seedAutomations(seedCtx, dataset.items);
    await seedPersonal(seedCtx, sales.dashboardId);
    await recordAudit(
      {
        orgId: org.id,
        actorId: users.maya,
        action: 'org.created',
        targetType: 'organization',
        targetId: org.id,
        metadata: { source: 'seed' },
      },
      tx,
    );
    await recordAudit(
      {
        orgId: org.id,
        actorId: users.maya,
        action: 'member.invited',
        targetType: 'invitation',
        metadata: { role: 'member', source: 'seed' },
      },
      tx,
    );

    const count = (key: BoardKey, sub = false) =>
      dataset.items.filter((item) => item.board === key && Boolean(item.parentId) === sub).length;
    return {
      org: org.slug,
      users: DEMO_USERS.length,
      leads: count('crm-leads'),
      deals: count('crm-deals'),
      accounts: count('crm-accounts'),
      contacts: count('crm-contacts'),
      activities: count('crm-activities'),
      onboardingProjects: count('cs-onboarding'),
      onboardingTasks: count('cs-onboarding', true),
      renewals: count('cs-renewals'),
      links,
      wmsLinks,
      activity,
      updateThreads: updatesResult.threads,
      notifications: notificationCount,
      automations: automationCount,
    };
  });

  process.stdout.write(`Seed complete: ${JSON.stringify(summary)}\n`);
  process.stdout.write(`Demo login: ${demoEmail('maya')} (password in src/server/db/seed/README.md)\n`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  // `ALLOW_DEMO_SEED=1` is the explicit opt-in for demo data on a deployed test environment.
  const production = env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  if (production && process.env.ALLOW_DEMO_SEED !== '1') {
    throw new Error('Refusing to seed in production (set ALLOW_DEMO_SEED=1 to load demo data)');
  }
  try {
    await seed();
  } finally {
    await getPool().end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `db:seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
