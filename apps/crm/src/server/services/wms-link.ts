/**
 * "Linked WMS client" bridge (BLUEPRINT.md §2.3/§2.4): CRM account board items link to the
 * shared `core.customers` registry through `crm.customer_links`. Core tables are plain
 * Drizzle objects from `@kitstak/db`, queried over the app's own executor — both apps share
 * one Postgres, so no cross-service calls are involved.
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { customerLinks, customers as coreCustomers } from '@kitstak/db/schema';
import { findWmsTenantSchema, wmsTable } from '@kitstak/db/wms-tenants';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { requireItem } from './access';
import { inTransaction, type ServiceContext } from './context';
import type {
  CoreCustomerDto,
  CoreCustomersQuery,
  SetCustomerLinkInput,
  WmsLinkDto,
  WmsOpsPeekDto,
} from './wms-link-contracts';

const SEARCH_LIMIT = 50;

/**
 * Orgs whose core.customers rows the caller may see and link: only the caller's own org.
 * One separate warehouse per organization — each org's WMS mirrors ITS clients into
 * core.customers under that org (apps/wms `syncClientToCore` → `warehouseOrgId`), so there
 * is no shared platform registry to fall back to any more.
 */
async function registryOrgIds(ctx: ServiceContext): Promise<string[]> {
  return [ctx.orgId];
}

const customerColumns = {
  id: coreCustomers.id,
  code: coreCustomers.code,
  name: coreCustomers.name,
  status: coreCustomers.status,
};

// ---------------------------------------------------------------------------------------------
// Operational peek: minimal read-only mirrors of the WMS tables (apps/wms owns the schema; both
// apps share one Postgres, same pattern as the core.customers joins above). Only the columns
// this service reads are declared.
// ---------------------------------------------------------------------------------------------

/** Terminal shipment-order statuses (apps/wms `SO_STATUSES`); everything else counts as open. */
const CLOSED_SO_STATUSES = ['Shipped', 'Delivered', 'Cancelled'];

/**
 * Open shipment orders + on-hand units for a linked client, read from the caller org's OWN
 * warehouse schema (core.wms_tenants). `core.customers.id` equals the WMS `clients.id`
 * (write-through sync), so the core customer id is the WMS client id. Fails soft to null so
 * the link card degrades to identity-only when the org has no warehouse.
 */
async function loadOpsPeek(ctx: ServiceContext, coreCustomerId: string): Promise<WmsOpsPeekDto | null> {
  try {
    const schema = await findWmsTenantSchema(ctx.db, ctx.orgId);
    if (!schema) return null;
    const closed = sql.join(CLOSED_SO_STATUSES.map((status) => sql`${status}`), sql`, `);
    const orders = await ctx.db.execute<{ n: unknown }>(
      sql`select count(*) as n from ${wmsTable(schema, 'shipment_orders')}
          where client_id = ${coreCustomerId} and status not in (${closed})`,
    );
    const stock = await ctx.db.execute<{ n: unknown }>(
      sql`select coalesce(sum(on_hand), 0) as n from ${wmsTable(schema, 'inventory')} where client_id = ${coreCustomerId}`,
    );
    return {
      openOrders: Number(orders.rows[0]?.n ?? 0),
      onHandUnits: Number(stock.rows[0]?.n ?? 0),
    };
  } catch {
    // Identity-only beats a broken card: swallow WMS-side read errors.
    return null;
  }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Core customers visible to the caller's org, filtered by name/code, ordered by name. */
export async function searchCoreCustomers(
  ctx: ServiceContext,
  query: CoreCustomersQuery,
): Promise<CoreCustomerDto[]> {
  const orgIds = await registryOrgIds(ctx);
  const conditions: SQL[] = [inArray(coreCustomers.orgId, orgIds), isNull(coreCustomers.deletedAt)];
  const term = query.search?.trim();
  if (term) {
    const pattern = `%${escapeLike(term)}%`;
    conditions.push(or(ilike(coreCustomers.name, pattern), ilike(coreCustomers.code, pattern)) as SQL);
  }
  return ctx.db
    .select(customerColumns)
    .from(coreCustomers)
    .where(and(...conditions))
    .orderBy(asc(coreCustomers.name))
    .limit(SEARCH_LIMIT);
}

/** The WMS client linked to `itemId` (org-scoped; `customer: null` when unlinked). */
export async function getCustomerLink(ctx: ServiceContext, itemId: string): Promise<WmsLinkDto> {
  await requireItem(ctx, itemId, 'read');
  const [row] = await ctx.db
    .select(customerColumns)
    .from(customerLinks)
    .innerJoin(coreCustomers, eq(coreCustomers.id, customerLinks.coreCustomerId))
    .where(
      and(
        eq(customerLinks.itemId, itemId),
        eq(customerLinks.orgId, ctx.orgId),
        isNull(coreCustomers.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return { customer: null, ops: null };
  return { customer: row, ops: await loadOpsPeek(ctx, row.id) };
}

/**
 * Create or remove the link between an account board item and a core customer. One link per
 * item: linking replaces any existing link; `coreCustomerId: null` removes it.
 */
export async function setCustomerLink(
  ctx: ServiceContext,
  itemId: string,
  input: SetCustomerLinkInput,
): Promise<WmsLinkDto> {
  const { item, board } = await requireItem(ctx, itemId, 'write');
  const unlinkScope = and(eq(customerLinks.itemId, itemId), eq(customerLinks.orgId, ctx.orgId));

  if (input.coreCustomerId === null) {
    await ctx.db.delete(customerLinks).where(unlinkScope);
    return { customer: null, ops: null };
  }

  if (board.kind !== 'accounts') {
    throw new ValidationError(
      [{ path: 'coreCustomerId', message: 'Only items on an accounts board can link to a WMS client' }],
      'Only items on an accounts board can link to a WMS client',
    );
  }
  const [customer] = await ctx.db
    .select(customerColumns)
    .from(coreCustomers)
    .where(
      and(
        eq(coreCustomers.id, input.coreCustomerId),
        inArray(coreCustomers.orgId, await registryOrgIds(ctx)),
        isNull(coreCustomers.deletedAt),
      ),
    )
    .limit(1);
  if (!customer) throw new NotFoundError('Customer');

  await inTransaction(ctx, async (tx) => {
    await tx.db.delete(customerLinks).where(unlinkScope);
    await tx.db.insert(customerLinks).values({
      coreCustomerId: customer.id,
      orgId: ctx.orgId,
      boardId: item.boardId,
      itemId,
    });
  });
  return { customer, ops: await loadOpsPeek(ctx, customer.id) };
}
