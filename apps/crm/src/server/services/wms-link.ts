/**
 * "Linked WMS client" bridge (BLUEPRINT.md §2.3/§2.4): CRM account board items link to the
 * shared `core.customers` registry through `crm.customer_links`. Core tables are plain
 * Drizzle objects from `@kitstak/db`, queried over the app's own executor — both apps share
 * one Postgres, so no cross-service calls are involved.
 */
import { and, asc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { customerLinks, customers as coreCustomers } from '@kitstak/db/schema';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { requireItem } from './access';
import { inTransaction, type ServiceContext } from './context';
import type { CoreCustomerDto, CoreCustomersQuery, SetCustomerLinkInput, WmsLinkDto } from './wms-link-contracts';

const SEARCH_LIMIT = 50;

const customerColumns = {
  id: coreCustomers.id,
  code: coreCustomers.code,
  name: coreCustomers.name,
  status: coreCustomers.status,
};

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Core customers in the caller's org, filtered by name/code, ordered by name. */
export async function searchCoreCustomers(
  ctx: ServiceContext,
  query: CoreCustomersQuery,
): Promise<CoreCustomerDto[]> {
  const conditions: SQL[] = [eq(coreCustomers.orgId, ctx.orgId), isNull(coreCustomers.deletedAt)];
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
  return { customer: row ?? null };
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
    return { customer: null };
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
        eq(coreCustomers.orgId, ctx.orgId),
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
  return { customer };
}
