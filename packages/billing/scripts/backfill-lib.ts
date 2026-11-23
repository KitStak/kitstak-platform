/**
 * The logic of the entitlement backfill (docs/billing/CONTRACTS.md section 20), kept apart from the
 * command line so it can be tested.
 *
 * Before billing is enforced, every organization could open every app (the allow all switch). When
 * that switch is removed, an organization with no rows in core.entitlements would be locked out of
 * everything. The backfill gives each of those organizations rows first:
 *
 *  - `manual`: a manual grant for all four apps. Never billed, never changed by billing. This keeps
 *    today's behavior exactly.
 *  - `trial`: a 14 day free trial of all four apps, started in the name of the organization's owner.
 *
 * Only organizations with no entitlement row at all are touched, so running it again changes nothing.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { billingEmails, entitlements, member, organization, user } from '@kitstak/db/schema';
import { type EntitlementsDb, grantModule } from '@kitstak/entitlements';
import { CATALOG, PRODUCT_IDS, type PlanSelection } from '../src/catalog';
import type { BillingDb, BillingReadDb, BillingRuntime } from '../src/server/db';
import { rows } from '../src/server/db';
import { startTrial } from '../src/server/trial';

export interface BackfillOrg {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly members: number;
}

/** Every organization with no row in core.entitlements, oldest first. */
export async function findOrgsWithoutEntitlements(db: BillingReadDb, options?: { onlyOrgIds?: readonly string[] }): Promise<readonly BackfillOrg[]> {
  const result = await db.execute(sql`
    SELECT o."id", o."name", o."slug",
           (SELECT count(*)::int FROM "core"."member" m WHERE m."organization_id" = o."id") AS members
      FROM "core"."organization" o
     WHERE NOT EXISTS (SELECT 1 FROM "core"."entitlements" e WHERE e."org_id" = o."id")
     ORDER BY o."created_at", o."id"
  `);
  const found = rows<BackfillOrg>(result);
  if (!options?.onlyOrgIds) return found;
  const only = new Set(options.onlyOrgIds);
  return found.filter((org) => only.has(org.id));
}

export interface BackfillLine {
  readonly org: BackfillOrg;
  readonly outcome: 'granted' | 'trial_started' | 'skipped';
  readonly note: string;
}

/** A manual grant for all four apps, for every organization that has no rows. */
export async function backfillManual(db: BillingDb, options?: { onlyOrgIds?: readonly string[] }): Promise<readonly BackfillLine[]> {
  const orgs = await findOrgsWithoutEntitlements(db, options);
  const lines: BackfillLine[] = [];
  for (const org of orgs) {
    await db.transaction(async (tx) => {
      for (const product of PRODUCT_IDS) await grantModule(tx as unknown as EntitlementsDb, org.id, product, 'manual');
    });
    lines.push({ org, outcome: 'granted', note: `Manual grant for ${PRODUCT_IDS.join(', ')}.` });
  }
  return lines;
}

async function ownersOf(db: BillingReadDb, orgId: string): Promise<{ userId: string; name: string }[]> {
  const found = await db
    .select({ userId: member.userId, role: member.role, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(member.createdAt));
  return found
    .filter((row) => row.role.split(',').map((part) => part.trim()).includes('owner'))
    .map((row) => ({ userId: row.userId, name: row.name.trim() || row.email }));
}

/**
 * A free trial of all four apps for every organization that has no rows, started in the name of an
 * owner. An organization is skipped, with the reason, when it has no owner or when every owner has
 * already used their one free trial on another organization. `quiet` holds back the welcome email.
 */
export async function backfillTrial(
  rt: BillingRuntime,
  options?: { onlyOrgIds?: readonly string[]; quiet?: boolean },
): Promise<readonly BackfillLine[]> {
  const orgs = await findOrgsWithoutEntitlements(rt.db, options);
  const lines: BackfillLine[] = [];
  for (const org of orgs) {
    const owners = await ownersOf(rt.db, org.id);
    if (owners.length === 0) {
      lines.push({ org, outcome: 'skipped', note: 'No owner. Use "apply manual" or grant by hand.' });
      continue;
    }
    const selection: PlanSelection = {
      products: [...PRODUCT_IDS],
      seats: Math.max(1, org.members),
      warehouses: 1,
      interval: 'monthly',
    };
    let started = false;
    let reason = '';
    for (const owner of owners) {
      const result = await startTrial(rt, { orgId: org.id, selection, actor: { userId: owner.userId, label: owner.name } });
      if (result.ok) {
        started = true;
        const endsAt = result.data.trial?.endsAt;
        lines.push({
          org,
          outcome: 'trial_started',
          note: `${CATALOG.trialDays} day trial in the name of ${owner.name}${endsAt ? `, ends ${endsAt.toISOString().slice(0, 10)}` : ''}.`,
        });
        break;
      }
      reason = result.error.message;
    }
    if (!started) {
      lines.push({ org, outcome: 'skipped', note: `${reason} Use "apply manual" or grant by hand.` });
      continue;
    }
    if (options?.quiet) {
      // The trial is real. Only the "your trial has started" email is held back.
      await rt.db
        .update(billingEmails)
        .set({ status: 'skipped', error: 'Held back by the backfill (quiet).' })
        .where(sql`${billingEmails.dedupeKey} = ${`welcome:${org.id}`} AND ${billingEmails.status} = 'queued'`);
    }
  }
  return lines;
}

/** How many organizations and entitlement rows exist. Printed after a run as a sanity line. */
export async function entitlementCounts(db: BillingReadDb): Promise<{ orgs: number; withRows: number }> {
  const [orgCount] = await db.select({ count: sql<number>`count(*)::int` }).from(organization);
  const [withRows] = await db.select({ count: sql<number>`count(distinct ${entitlements.orgId})::int` }).from(entitlements);
  return { orgs: orgCount?.count ?? 0, withRows: withRows?.count ?? 0 };
}
