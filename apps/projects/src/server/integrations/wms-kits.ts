/**
 * WMS kit reads for Programs (docs/programs/SPEC.md 6.3, D11): kit capacity, component shortages
 * and billing fees, read only from the org's own WMS tenant schema. Fails soft: every read says
 * why it has nothing instead of throwing. A build never creates a WMS work order or movement.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { freeStockSql, wmsTable, type FreeStockSqlRow } from '@kitstak/db/wms-tenants';
import { db } from '@/server/db';
import { env } from '@/server/env';
import type { DomainContext } from '@/server/domain/_shared';
import { wmsSchemaFor, wmsTableExists } from './detect';

export type KitUnavailable = { readonly available: false; readonly reason: 'not_entitled' | 'no_tenant' | 'not_linked' | 'not_found' };

export interface KitProduct {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly url: string;
}

export interface KitCapacity {
  readonly available: true;
  readonly product: KitProduct;
  readonly warehouses: readonly { readonly id: string; readonly name: string; readonly netKittingCapacity: string; readonly currentInventoryQty: string; readonly pendingOrderQty: string; readonly asOf: string }[];
  readonly note: string | null;
}

export interface KitShortage {
  readonly component: { readonly sku: string; readonly name: string };
  readonly need: string;
  readonly free: string;
  readonly short: string;
}

const rows = async <T>(statement: ReturnType<typeof sql>): Promise<T[]> => ((await db.execute(statement)) as unknown as { rows: T[] }).rows;

async function schema(ctx: DomainContext): Promise<string | null> {
  try {
    return await wmsSchemaFor(ctx);
  } catch {
    return null;
  }
}

function productUrl(id: string): string {
  return `${env.NEXT_PUBLIC_WMS_URL.replace(/\/+$/, '')}/products/${encodeURIComponent(id)}`;
}

export async function resolveKitProduct(ctx: DomainContext, input: { readonly coreItemId?: string | null; readonly wmsProductId?: string | null }): Promise<KitProduct | KitUnavailable> {
  if (!input.coreItemId && !input.wmsProductId) return { available: false, reason: 'not_linked' };
  const name = await schema(ctx);
  if (!name) return { available: false, reason: 'no_tenant' };
  if (!(await wmsTableExists(name, 'products'))) return { available: false, reason: 'no_tenant' };
  try {
    const where = input.wmsProductId ? sql`p.id = ${input.wmsProductId}` : sql`p.core_item_id = ${input.coreItemId}::uuid and p.is_kit = true`;
    const [row] = await rows<{ id: string; sku: string; name: string }>(sql`select p.id, p.sku, p.name from ${wmsTable(name, 'products')} p where ${where} limit 1`);
    if (!row) return { available: false, reason: 'not_found' };
    return { id: row.id, sku: row.sku, name: row.name, url: productUrl(row.id) };
  } catch {
    return { available: false, reason: 'not_found' };
  }
}

export async function variantKitCapacity(ctx: DomainContext, variant: { readonly coreItemId: string | null; readonly wmsProductId: string | null }): Promise<KitCapacity | KitUnavailable> {
  const product = await resolveKitProduct(ctx, variant);
  if ('available' in product) return product;
  const name = (await schema(ctx))!;
  if (!(await wmsTableExists(name, 'kit_inventory_stats'))) return { available: true, product, warehouses: [], note: 'Kit stock is being updated. Check back in a few minutes.' };
  try {
    const hasWarehouses = await wmsTableExists(name, 'warehouses');
    const list = await rows<{ id: string; name: string | null; net: number; current: number; pending: number; updated_at: string }>(
      hasWarehouses
        ? sql`select s.warehouse_id as id, w.name, s.net_kitting_capacity as net, s.current_inventory_qty as current, s.pending_order_qty as pending, s.updated_at
                from ${wmsTable(name, 'kit_inventory_stats')} s left join ${wmsTable(name, 'warehouses')} w on w.id = s.warehouse_id
               where s.kit_product_id = ${product.id} order by w.name`
        : sql`select s.warehouse_id as id, null as name, s.net_kitting_capacity as net, s.current_inventory_qty as current, s.pending_order_qty as pending, s.updated_at
                from ${wmsTable(name, 'kit_inventory_stats')} s where s.kit_product_id = ${product.id}`,
    );
    return {
      available: true,
      product,
      warehouses: list.map((row) => ({ id: row.id, name: row.name ?? 'Warehouse', netKittingCapacity: String(row.net ?? 0), currentInventoryQty: String(row.current ?? 0), pendingOrderQty: String(row.pending ?? 0), asOf: row.updated_at })),
      note: list.length === 0 ? 'Kit stock is being updated. Check back in a few minutes.' : null,
    };
  } catch {
    return { available: true, product, warehouses: [], note: 'Kit stock is being updated. Check back in a few minutes.' };
  }
}

/** Components a planned qty needs, against usable free stock (the shared WMS free stock reader). */
export async function variantKitShortages(ctx: DomainContext, variant: { readonly coreItemId: string | null; readonly wmsProductId: string | null }, plannedQty: string): Promise<{ available: true; product: KitProduct; components: KitShortage[] } | KitUnavailable> {
  const product = await resolveKitProduct(ctx, variant);
  if ('available' in product) return product;
  const name = (await schema(ctx))!;
  if (!(await wmsTableExists(name, 'kit_components'))) return { available: true, product, components: [] };
  try {
    const parts = await rows<{ id: string; sku: string; name: string; quantity: number }>(
      sql`select c.component_product_id as id, p.sku, p.name, c.quantity from ${wmsTable(name, 'kit_components')} c join ${wmsTable(name, 'products')} p on p.id = c.component_product_id where c.kit_product_id = ${product.id}`,
    );
    if (parts.length === 0) return { available: true, product, components: [] };
    const free = await rows<FreeStockSqlRow>(freeStockSql(name, parts.map((p) => p.id)));
    const freeBy = new Map<string, number>();
    for (const row of free) {
      if (row.locked || row.prevent || Number(row.countLocked) > 0) continue;
      freeBy.set(row.productId, (freeBy.get(row.productId) ?? 0) + Number(row.free));
    }
    const qty = Math.ceil(Number(plannedQty));
    return {
      available: true,
      product,
      components: parts.map((part) => {
        const need = qty * part.quantity;
        const have = freeBy.get(part.id) ?? 0;
        return { component: { sku: part.sku, name: part.name }, need: String(need), free: String(have), short: String(Math.max(0, need - have)) };
      }),
    };
  } catch {
    return { available: true, product, components: [] };
  }
}

/** Active contract fees for VAS and kitting for a WMS client ("Other prices for this customer"). */
export async function clientBillingFees(ctx: DomainContext, input: { readonly wmsClientId: string }): Promise<{ available: true; fees: { id: string; name: string; operationType: string; standardRate: number | null }[] } | KitUnavailable> {
  const name = await schema(ctx);
  if (!name) return { available: false, reason: 'no_tenant' };
  if (!(await wmsTableExists(name, 'billing_fees')) || !(await wmsTableExists(name, 'billing_contracts'))) return { available: false, reason: 'no_tenant' };
  try {
    const fees = await rows<{ id: string; name: string; operation_type: string; standard_rate: number | null }>(
      sql`select f.id, f.name, f.operation_type, f.standard_rate from ${wmsTable(name, 'billing_fees')} f join ${wmsTable(name, 'billing_contracts')} c on c.id = f.contract_id
           where c.client_id = ${input.wmsClientId} and c.approval_status = 'Approved' and f.operation_type in ('VAS', 'Kitting', 'Value Added Service') order by f.name`,
    );
    return { available: true, fees: fees.map((f) => ({ id: f.id, name: f.name, operationType: f.operation_type, standardRate: f.standard_rate })) };
  } catch {
    return { available: true, fees: [] };
  }
}
