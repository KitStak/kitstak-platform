/**
 * One-off: provision the Team1 organization for the monday.com migration.
 *
 * Creates (idempotently — safe to re-run):
 *  - users: Mike Lunsford (admin, credential login), Lauren Sage & Bryan King
 *    (members, no password yet — they set one later)
 *  - organization "Team1" (slug team1) with Mike as owner
 *  - workspaces "Project Tasks" (+ "Task Keeper" folder) and "Product Connections"
 *
 * Usage (from apps/crm):
 *   DATABASE_URL=<cloud-or-local-url> TEAM1_ADMIN_PASSWORD=<password> \
 *     pnpm tsx scripts/monday-migration/provision-team1.ts
 *
 * The CRM entitlement is granted separately via the entitlements CLI:
 *   pnpm --filter @kitstak/entitlements grant grant team1 crm
 */
import '../load-env';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { db } from '../../src/server/db';
import {
  account,
  folders,
  member,
  organization,
  user,
  workspaceMembers,
  workspaces,
} from '../../src/server/db/schema';
import { initialPositions } from '../../src/server/services/positions';

const ORG = { name: 'Team1', slug: 'team1' } as const;

interface UserSpec {
  readonly name: string;
  readonly email: string;
  readonly title: string;
  readonly role: 'owner' | 'admin' | 'member' | 'viewer';
  /** monday.com user id, recorded for the item people-column mapping. */
  readonly mondayId: string;
  readonly withCredential: boolean;
}

/** Every human monday.com account member (AI agent users are intentionally omitted). */
const USERS: readonly UserSpec[] = [
  {
    name: 'Mike Lunsford',
    email: 'mike@team-01.com',
    title: 'Managing Partner',
    role: 'owner',
    mondayId: '114709318',
    withCredential: true,
  },
  {
    name: 'Lauren Sage',
    email: 'lauren@team-01.com',
    title: 'Project Manager',
    role: 'member',
    mondayId: '117132050',
    withCredential: false,
  },
  {
    name: 'Bryan King',
    email: 'bryan@team-01.com',
    title: 'Projects',
    role: 'admin',
    mondayId: '114708967',
    withCredential: false,
  },
  { name: 'Franky Fuertes', email: 'franky@team-01.com', title: '', role: 'viewer', mondayId: '114716720', withCredential: false },
  { name: 'Josh Hooper', email: 'josh@team-01.com', title: '', role: 'viewer', mondayId: '114717426', withCredential: false },
  { name: 'Chris Harrison', email: 'chris@team-01.com', title: '', role: 'viewer', mondayId: '117357867', withCredential: false },
  { name: 'Tyler Bucholz', email: 'tyler.bucholz@team-01.com', title: '', role: 'viewer', mondayId: '117526038', withCredential: false },
];

const WORKSPACES: readonly { name: string; description: string; color: string; folders: readonly string[] }[] = [
  { name: 'Project Tasks', description: 'Client task boards (migrated from monday.com)', color: 'blue', folders: ['Task Keeper'] },
  { name: 'Product Connections', description: 'PCX and Mosaic Projects (migrated from monday.com)', color: 'teal', folders: [] },
];

async function ensureUser(spec: UserSpec, passwordHash: string | null): Promise<string> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, spec.email)).limit(1);
  if (existing) {
    console.log(`user exists: ${spec.email}`);
    return existing.id;
  }
  const [created] = await db
    .insert(user)
    .values({ name: spec.name, email: spec.email, emailVerified: true, title: spec.title })
    .returning({ id: user.id });
  if (!created) throw new Error(`User insert returned no row for ${spec.email}`);
  if (spec.withCredential) {
    if (!passwordHash) throw new Error('TEAM1_ADMIN_PASSWORD is required to create the admin credential');
    await db.insert(account).values({
      accountId: created.id,
      providerId: 'credential',
      userId: created.id,
      password: passwordHash,
      updatedAt: new Date(),
    });
  }
  console.log(`user created: ${spec.email}${spec.withCredential ? ' (credential login)' : ''}`);
  return created.id;
}

async function main(): Promise<void> {
  const adminPassword = process.env.TEAM1_ADMIN_PASSWORD;
  const passwordHash = adminPassword ? await hashPassword(adminPassword) : null;

  const userIds = new Map<string, string>();
  for (const spec of USERS) userIds.set(spec.email, await ensureUser(spec, passwordHash));
  const mikeId = userIds.get('mike@team-01.com');
  if (!mikeId) throw new Error('Admin user missing');

  let [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, ORG.slug))
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(organization)
      .values({
        name: ORG.name,
        slug: ORG.slug,
        createdAt: new Date(),
        metadata: JSON.stringify({ source: 'monday-migration', migratedAt: new Date().toISOString() }),
      })
      .returning({ id: organization.id });
    if (!org) throw new Error('Organization insert returned no row');
    console.log(`org created: ${ORG.slug} (${org.id})`);
  } else {
    console.log(`org exists: ${ORG.slug} (${org.id})`);
  }
  const orgId = org.id;

  for (const spec of USERS) {
    const userId = userIds.get(spec.email);
    if (!userId) continue;
    const [existing] = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1);
    if (existing) {
      if (existing.role !== spec.role) {
        await db.update(member).set({ role: spec.role }).where(eq(member.id, existing.id));
        console.log(`member role updated: ${spec.email} ${existing.role} -> ${spec.role}`);
      }
      continue;
    }
    await db.insert(member).values({ organizationId: orgId, userId, role: spec.role, createdAt: new Date() });
    console.log(`member added: ${spec.email} (${spec.role})`);
  }

  const wsPositions = initialPositions(WORKSPACES.length);
  for (const [index, spec] of WORKSPACES.entries()) {
    let [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.orgId, orgId), eq(workspaces.name, spec.name)))
      .limit(1);
    if (!ws) {
      [ws] = await db
        .insert(workspaces)
        .values({
          orgId,
          name: spec.name,
          description: spec.description,
          color: spec.color,
          kind: 'open',
          position: wsPositions[index] as string,
          createdBy: mikeId,
        })
        .returning({ id: workspaces.id });
      if (!ws) throw new Error(`Workspace insert returned no row for ${spec.name}`);
      console.log(`workspace created: ${spec.name} (${ws.id})`);
    } else {
      console.log(`workspace exists: ${spec.name} (${ws.id})`);
    }
    for (const userId of userIds.values()) {
      await db
        .insert(workspaceMembers)
        .values({ orgId, workspaceId: ws.id, userId, role: userId === mikeId ? 'owner' : 'member' })
        .onConflictDoNothing();
    }
    const folderPositions = initialPositions(Math.max(spec.folders.length, 1));
    for (const [folderIndex, folderName] of spec.folders.entries()) {
      const [existingFolder] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.workspaceId, ws.id), eq(folders.name, folderName)))
        .limit(1);
      if (existingFolder) continue;
      await db.insert(folders).values({
        orgId,
        workspaceId: ws.id,
        name: folderName,
        position: folderPositions[folderIndex] as string,
        createdBy: mikeId,
      });
      console.log(`folder created: ${spec.name} / ${folderName}`);
    }
  }

  console.log('\nDone. Summary:');
  console.log(`  org team1 = ${orgId}`);
  for (const [email, id] of userIds) console.log(`  ${email} = ${id}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
