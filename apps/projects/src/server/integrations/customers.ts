/**
 * Shared customer registry (core.customers): pickers for projects and links.
 *
 * Same visibility rule as the CRM's "Linked WMS client" card: an org sees its own customers;
 * an org with none of its own (the bundled deployment, where the single WMS mirrors its clients
 * under the platform org) also sees the platform registry, so a CRM account, a WMS client and a
 * Projects project can all point at the same customer.
 */
import 'server-only';
import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { customers, organization } from '@kitstak/db/schema';
import { db } from '@/server/db';
import { env } from '@/server/env';
import type { DomainContext } from '@/server/domain/_shared';

const REGISTRY_TTL_MS = 60_000;
const registryCache = new Map<string, { at: number; ids: string[] }>();

/** Org ids whose customers this org may pick (own, plus the platform registry when it has none). */
export async function registryOrgIds(ctx: DomainContext): Promise<string[]> {
  const cached = registryCache.get(ctx.orgId);
  if (cached && Date.now() - cached.at < REGISTRY_TTL_MS) return cached.ids;
  let ids = [ctx.orgId];
  try {
    const own = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.orgId, ctx.orgId), isNull(customers.deletedAt))).limit(1);
    if (own.length === 0) {
      const [platform] = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, env.WMS_PLATFORM_ORG_SLUG)).limit(1);
      if (platform && platform.id !== ctx.orgId) ids = [ctx.orgId, platform.id];
    }
  } catch {
    ids = [ctx.orgId];
  }
  registryCache.set(ctx.orgId, { at: Date.now(), ids });
  return ids;
}

export interface CustomerRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
}

const COLUMNS = {
  id: customers.id,
  code: customers.code,
  name: customers.name,
  status: customers.status,
  contactName: customers.contactName,
  contactEmail: customers.contactEmail,
};

export async function searchCustomers(ctx: DomainContext, query = '', limit = 20): Promise<CustomerRef[]> {
  const term = `%${query.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const orgIds = await registryOrgIds(ctx);
  return db
    .select(COLUMNS)
    .from(customers)
    .where(and(inArray(customers.orgId, orgIds), isNull(customers.deletedAt), query.trim() ? or(ilike(customers.name, term), ilike(customers.code, term)) : undefined))
    .orderBy(asc(customers.name))
    .limit(Math.min(limit, 100));
}

export async function getCustomers(ctx: DomainContext, ids: readonly string[]): Promise<Map<string, CustomerRef>> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0) return new Map();
  const orgIds = await registryOrgIds(ctx);
  const rows = await db
    .select(COLUMNS)
    .from(customers)
    .where(and(inArray(customers.orgId, orgIds), inArray(customers.id, valid)));
  return new Map(rows.map((row) => [row.id, row]));
}
