/**
 * Shared customer registry (core.customers): pickers for projects and links.
 *
 * Same visibility rule as the CRM's "Linked WMS client" card: an org sees only its own
 * customers. One separate warehouse per organization — each org's WMS mirrors ITS clients
 * under that org, so there is no shared platform registry to fall back to.
 */
import 'server-only';
import { and, asc, ilike, inArray, isNull, or } from 'drizzle-orm';
import { customers } from '@kitstak/db/schema';
import { db } from '@/server/db';
import type { DomainContext } from '@/server/domain/_shared';

/** Org ids whose customers this org may pick: its own. */
export async function registryOrgIds(ctx: DomainContext): Promise<string[]> {
  return [ctx.orgId];
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
