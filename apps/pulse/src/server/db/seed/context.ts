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
import { member, organization, user } from '@kitstak/db/schema';
import { db, getPool } from '@/server/db';
import { memberRoles } from '@/server/db/schema';
import type { DomainContext } from '@/server/domain/_shared';
import { parseOrgRole } from '@/lib/permissions';

export async function orgBySlug(slug: string) {
  const [row] = await db.select().from(organization).where(eq(organization.slug, slug));
  return row ?? null;
}

export async function userByEmail(email: string) {
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row ?? null;
}

/** Members of an org (id, name, email, role). */
export async function orgMembers(orgId: string) {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId));
  return rows.filter((row) => parseOrgRole(row.role));
}

/** The first owner of an org, else its first admin, else any member: the person a seed acts as. */
export async function defaultSeedEmail(orgId: string): Promise<string | null> {
  const members = await orgMembers(orgId);
  const order: Readonly<Record<string, number>> = { owner: 0, admin: 1, member: 2 };
  const rank = (role: string): number => order[parseOrgRole(role) ?? 'guest'] ?? 3;
  return [...members].sort((a, b) => rank(a.role) - rank(b.role) || a.email.localeCompare(b.email))[0]?.email ?? null;
}

/** Acts as `email` in `orgSlug`. Throws when the org, the user or the membership is missing. */
export async function seedContext(orgSlug: string, email?: string | null): Promise<DomainContext> {
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
}

/**
 * Makes the seed actor the Pulse owner of the org with an explicit role row, so the demo login
 * can use every screen (close a month, set rates, reopen). This is the "Run Pulse for this
 * workspace" step, done ahead of time for demo data.
 */
export async function ensurePulseOwner(ctx: DomainContext): Promise<void> {
  await db
    .insert(memberRoles)
    .values({ orgId: ctx.orgId, userId: ctx.userId, role: 'owner', seesMoney: true, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { role: 'owner', seesMoney: true, updatedAt: new Date() } });
}

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
export async function wipeOrg(orgId: string, options: { roles?: boolean } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL pulse.allow_purge = 'on'`);
    for (const table of WIPE_ORDER) await tx.execute(sql`DELETE FROM pulse.${sql.raw(table)} WHERE org_id = ${orgId}`);
    if (options.roles) await tx.execute(sql`DELETE FROM pulse.member_roles WHERE org_id = ${orgId}`);
  });
}

export async function closeSeed(): Promise<void> {
  await getPool().end();
}
