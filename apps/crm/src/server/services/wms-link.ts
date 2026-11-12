/**
 * "Linked WMS client" bridge (BLUEPRINT.md §2.3/§2.4): CRM account board items link to the
 * shared `core.customers` registry through `crm.customer_links`. Core tables are plain
 * Drizzle objects from `@kitstak/db`, queried over the app's own executor — both apps share
 * one Postgres, so no cross-service calls are involved.
 */
import { and, asc, count, eq, ilike, inArray, isNull, notInArray, or, sql, sum, type SQL } from 'drizzle-orm';
import { integer, pgSchema, text } from 'drizzle-orm/pg-core';
import { customerLinks, customers as coreCustomers } from '@kitstak/db/schema';
import { organization } from '@/server/db/schema';
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
 * The org that owns the WMS deployment's client registry. The WMS has no org column of its
 * own: `syncClientToCore` mirrors every wms.clients row into core.customers under the
 * platform organization (apps/wms `PLATFORM_ORG_SLUG` — keep in sync).
 */
const WMS_PLATFORM_ORG_SLUG = 'kitstak';

/**
 * Orgs whose core.customers rows the caller may see and link. Always the caller's own org;
 * when that org carries no registry rows of its own (the bundled deployment, where the one
 * WMS mirrors its clients under the platform org), the shared platform registry as well.
 * Orgs with their own rows (true multi-tenant setups) stay strictly org-scoped.
 */
async function registryOrgIds(ctx: ServiceContext): Promise<string[]> {
  const own = await ctx.db
    .select({ id: coreCustomers.id })
    .from(coreCustomers)
    .where(and(eq(coreCustomers.orgId, ctx.orgId), isNull(coreCustomers.deletedAt)))
    .limit(1);
  if (own.length > 0) return [ctx.orgId];
  const [platform] = await ctx.db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, WMS_PLATFORM_ORG_SLUG))
    .limit(1);
  return platform && platform.id !== ctx.orgId ? [ctx.orgId, platform.id] : [ctx.orgId];
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

const wmsOps = pgSchema('wms');
const wmsShipmentOrders = wmsOps.table('shipment_orders', {
  clientId: text('client_id').notNull(),
  status: text('status').notNull(),
});
const wmsInventory = wmsOps.table('inventory', {
  clientId: text('client_id'),
  onHand: integer('on_hand').notNull(),
});

/** Terminal shipment-order statuses (apps/wms `SO_STATUSES`); everything else counts as open. */
const CLOSED_SO_STATUSES = ['Shipped', 'Delivered', 'Cancelled'];

/** True when the WMS operational tables exist in this database (never throws). */
async function wmsTablesAvailable(ctx: ServiceContext): Promise<boolean> {
  const result = await ctx.db.execute<{ ok: boolean }>(
    sql`select to_regclass('wms.shipment_orders') is not null and to_regclass('wms.inventory') is not null as ok`,
  );
  return result.rows[0]?.ok === true;
}

/**
 * Open shipment orders + on-hand units for a linked client. `core.customers.id` equals
 * `wms.clients.id` (write-through sync), so the core customer id is the WMS client id.
 * Fails soft to null so the link card degrades to identity-only when the WMS is absent.
 */
async function loadOpsPeek(ctx: ServiceContext, coreCustomerId: string): Promise<WmsOpsPeekDto | null> {
  try {
    if (!(await wmsTablesAvailable(ctx))) return null;
    const [orders] = await ctx.db
      .select({ openOrders: count() })
      .from(wmsShipmentOrders)
      .where(
        and(
          eq(wmsShipmentOrders.clientId, coreCustomerId),
          notInArray(wmsShipmentOrders.status, CLOSED_SO_STATUSES),
        ),
      );
    const [stock] = await ctx.db
      .select({ onHandUnits: sum(wmsInventory.onHand) })
      .from(wmsInventory)
      .where(eq(wmsInventory.clientId, coreCustomerId));
    return {
      openOrders: Number(orders?.openOrders ?? 0),
      onHandUnits: Number(stock?.onHandUnits ?? 0),
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
