/**
 * Seed helpers: load env, resolve orgs and users by slug and email, and build DomainContexts so
 * seeds write through the real domain layer (stamps, rollups, activity and numbering all stay
 * correct). Import this file first: it loads `.env.local` before the database client is made.
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

const APP_ROOT = path.resolve(__dirname, '../../../..');
loadDotenv({ path: path.join(APP_ROOT, '.env.local'), quiet: true });
loadDotenv({ path: path.join(APP_ROOT, '.env'), quiet: true });

import { and, eq, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { account, member, organization, user } from '@kitstak/db/schema';
import { db, getPool } from '@/server/db';
import { asSystem } from '@/server/db/scope';
import { memberRoles } from '@/server/db/schema';
import type { DomainContext } from '@/server/domain/_shared';
import { parseOrgRole } from '@/lib/permissions';

/**
 * A seed builds a workspace across schemas (core people, sibling records, raw pulse rows), so its
 * own statements run as the owner. The domain calls inside still run for their one workspace.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over any seed function shape
export function asSeed<F extends (...args: any[]) => unknown>(fn: F): F {
  return ((...args: unknown[]) => asSystem('demo seed (builds one workspace across schemas)', () => (fn as (...inner: unknown[]) => unknown)(...args))) as unknown as F;
}

export const orgBySlug = asSeed(async function orgBySlug(slug: string) {
  const [row] = await db.select().from(organization).where(eq(organization.slug, slug));
  return row ?? null;
});

export const userByEmail = asSeed(async function userByEmail(email: string) {
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row ?? null;
});

/** Members of an org (id, name, email, role). */
export const orgMembers = asSeed(async function orgMembers(orgId: string) {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId));
  return rows.filter((row) => parseOrgRole(row.role));
});

/** The first owner of an org, else its first admin, else any member: the person a seed acts as. */
export const defaultSeedEmail = asSeed(async function defaultSeedEmail(orgId: string): Promise<string | null> {
  const members = await orgMembers(orgId);
  const order: Readonly<Record<string, number>> = { owner: 0, admin: 1, member: 2 };
  const rank = (role: string): number => order[parseOrgRole(role) ?? 'guest'] ?? 3;
  return [...members].sort((a, b) => rank(a.role) - rank(b.role) || a.email.localeCompare(b.email))[0]?.email ?? null;
});

/** Acts as `email` in `orgSlug`. Throws when the org, the user or the membership is missing. */
export const seedContext = asSeed(async function seedContext(orgSlug: string, email?: string | null): Promise<DomainContext> {
  const org = await orgBySlug(orgSlug);
  if (!org) throw new Error(`Seed: org ${orgSlug} not found. Run the platform seeds first.`);
  const who = email ?? (await defaultSeedEmail(org.id));
  if (!who) throw new Error(`Seed: org ${orgSlug} has no members.`);
  const actor = await userByEmail(who);
  if (!actor) throw new Error(`Seed: user ${who} not found.`);
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, actor.id)));
  const orgRole = parseOrgRole(membership?.role);
  if (!orgRole) throw new Error(`Seed: ${who} is not a member of ${orgSlug}.`);
  return { orgId: org.id, orgSlug: org.slug, userId: actor.id, userName: actor.name, orgRole, actorKind: 'user' };
});

/**
 * Makes the seed actor the Pulse owner of the org with an explicit role row, so the demo login
 * can use every screen (close a month, set rates, reopen). This is the "Run Pulse for this
 * workspace" step, done ahead of time for demo data.
 */
export const ensurePulseOwner = asSeed(async function ensurePulseOwner(ctx: DomainContext): Promise<void> {
  await db
    .insert(memberRoles)
    .values({ orgId: ctx.orgId, userId: ctx.userId, role: 'owner', seesMoney: true, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { role: 'owner', seesMoney: true, updatedAt: new Date() } });
});

/** A demo sign in a seed makes sure exists. Local demo data only: never point a seed at production. */
export interface DemoLogin {
  readonly email: string;
  readonly name: string;
  readonly orgRole: 'member' | 'viewer';
  readonly password: string;
}

/**
 * Makes sure a demo person can sign in to the org: adds the user with an email and password
 * account and the org membership when they are missing. An existing user keeps their password
 * and their membership role, so the WMS and Projects seeds (which make the same people) win.
 */
export const ensureDemoLogin = asSeed(async function ensureDemoLogin(orgId: string, login: DemoLogin): Promise<string> {
  const email = login.email.trim().toLowerCase();
  let found = await userByEmail(email);
  if (!found) {
    [found] = await db.insert(user).values({ name: login.name, email, emailVerified: true }).returning();
    await db.insert(account).values({ accountId: found!.id, providerId: 'credential', userId: found!.id, password: await hashPassword(login.password), updatedAt: new Date() });
  }
  const userId = found!.id;
  const [membership] = await db.select({ id: member.id }).from(member).where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  if (!membership) await db.insert(member).values({ organizationId: orgId, userId, role: login.orgRole, createdAt: new Date() });
  return userId;
});

/** Every `pulse` table with an `org_id`, children before parents. `member_roles` is kept unless asked for. */
const WIPE_ORDER = [
  'activity',
  'notifications',
  'alerts',
  'alert_rules',
  'fact_days',
  'company_days',
  'day_reviews',
  'periods',
  'import_rows',
  'import_batches',
  'import_presets',
  'report_runs',
  'report_schedules',
  'sync_runs',
  'sync_state',
  'dismissals',
  'bridge_events',
  'saved_views',
  'user_prefs',
  'quote_scenarios',
  'device_links',
  'job_stats',
  'job_links',
  'job_plan_lines',
  'job_plans',
  'job_prices',
  'production_entries',
  'indirect_entries',
  'paid_hours',
  'time_punches',
  'material_usage',
  'cost_entries',
  'revenue_entries',
  'vas_entries',
  'standards',
  'targets',
  'jobs',
  'labor_rates',
  'items',
  'vas_services',
  'job_types',
  'labor_classes',
  'clients',
  'sites',
  'settings',
] as const;

/**
 * Removes the org's Pulse rows in one transaction under `pulse.allow_purge`, so closed months do
 * not block it. Seeds are idempotent: wipe, then rebuild through the domain layer.
 */
export const wipeOrg = asSeed(async function wipeOrg(orgId: string, options: { roles?: boolean } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL pulse.allow_purge = 'on'`);
    for (const table of WIPE_ORDER) await tx.execute(sql`DELETE FROM pulse.${sql.raw(table)} WHERE org_id = ${orgId}`);
    if (options.roles) await tx.execute(sql`DELETE FROM pulse.member_roles WHERE org_id = ${orgId}`);
    // Links to the jobs just removed (a program's bills_to and related edges), so the Pulse seed
    // runs again on its own without "already bills to another job".
    const links = await tx.execute<{ ok: boolean }>(sql`SELECT to_regclass('core.record_links') IS NOT NULL AS ok`);
    if (links.rows[0]?.ok) await tx.execute(sql`DELETE FROM core.record_links WHERE org_id = ${orgId}::uuid AND (from_type = 'pulse_job' OR to_type = 'pulse_job')`);
  });
});

export async function closeSeed(): Promise<void> {
  await getPool().end();
}
