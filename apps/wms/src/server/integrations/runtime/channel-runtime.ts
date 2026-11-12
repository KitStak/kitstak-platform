/**
 * Channel methods runtime (M12, spec 06 §8): Download Orders · Download Products · Sync Inventory ·
 * Send Shipment Info. Each run writes `channel_runs` + `channel_run_items`; order failures upsert
 * `channel_missing_orders` with the error-catalog code. Orders go through `orders.createOrder`
 * (which runs workflows); products through `products.ensureProductForListing`.
 * Every order/listing is written in its own transaction so one failure never rolls back the run.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { channelSettingsSchema, type ChannelSettings } from '@/lib/domain-types';
import { CHANNEL_METHODS, ORDER_CHANNELS } from '@/lib/enums';
import type { AppDb } from '@/server/api/db';
import * as s from '@/server/db/schema';
import { recordUpdate } from '@/server/domain/change-log';
import { describeError } from '@/server/domain/errors';
import { notify } from '@/server/domain/notify';
import { catalogError } from '@/lib/grid-defs/integrations/monitoring';
import { brandText } from '@/lib/grid-defs/integrations/common';
import {
  classifyImportError,
  isInternalDbText,
  repeatedFailures,
  type ClassifiedImportError,
} from '@/lib/grid-defs/integrations/import-errors';
import { createOrder } from '@/server/domain/orders/create-update';
import { ensureProductForListing } from '@/server/domain/products';
import { systemCtx, type DomainCtx } from '@/server/domain/types';
import {
  ChannelApiError,
  type AdapterContext,
  type ChannelAdapter,
  type ChannelConnectionRow,
  type ChannelOrder,
} from '../channel-adapter';
import { decryptCredentials } from '../crypto';
import { sandboxAdapter } from '../sandbox';
import { shipstationAdapter } from '../shipstation';
import { shopifyAdapter } from '../shopify';
import { amazonAdapter } from '../amazon';
import { ebayAdapter } from '../ebay';
import { walmartAdapter } from '../walmart';
import { woocommerceAdapter } from '../woocommerce';
import { bigcommerceAdapter } from '../bigcommerce';
import { etsyAdapter } from '../etsy';
import { magentoAdapter } from '../magento';
import { tiktokAdapter } from '../tiktok';
import { forEachSeq, mapSeq, withWriteTx } from '@/server/db/sql';

export type ChannelMethod = (typeof CHANNEL_METHODS)[number];
export type MethodRow = typeof s.channelMethods.$inferSelect;
type RunStatus = (typeof s.channelRuns.$inferSelect)['status'];

export const DEFAULT_INTERVALS: Readonly<Record<ChannelMethod, number>> = {
  'Download Orders': 15,
  'Download Products': 1440,
  'Sync Inventory': 60,
  'Send Shipment Info': 30,
};

const LIVE_ADAPTERS: Readonly<Record<string, ChannelAdapter>> = {
  shopify: shopifyAdapter,
  shipstation: shipstationAdapter,
  amazon: amazonAdapter,
  walmart: walmartAdapter,
  woocommerce: woocommerceAdapter,
  ebay: ebayAdapter,
  tiktok: tiktokAdapter,
  magento: magentoAdapter,
  bigcommerce: bigcommerceAdapter,
  etsy: etsyAdapter,
};
export const LIVE_PROVIDERS: ReadonlySet<string> = new Set(Object.keys(LIVE_ADAPTERS));
export const isSandbox = (c: Pick<ChannelConnectionRow, 'distribution'>) => c.distribution === 'API';
/**
 * Demo feed: a store of a live channel saved without credentials (the seeded demo stores). It is
 * runnable: Run, Simulate error and the scheduler use KitStak's deterministic demo feed against the
 * client's real SKUs, until real credentials are saved and the live adapter takes over.
 * Connecting through the wizard always stores credentials, so a user's live store never falls back.
 */
export const isDemoFeed = (c: Pick<ChannelConnectionRow, 'distribution' | 'credentialsEnc'>) =>
  !isSandbox(c) && !c.credentialsEnc;
/** A sandbox or demo-feed store: simulated traffic, so Download Orders offers "Simulate error". */
export const isSimulated = (c: Pick<ChannelConnectionRow, 'distribution' | 'credentialsEnc'>) =>
  isSandbox(c) || isDemoFeed(c);

/** Why the scheduler can't run a connection (null = runnable). */
export function pauseReason(
  c: Pick<ChannelConnectionRow, 'distribution' | 'credentialsEnc' | 'provider' | 'isActive'>,
): string | null {
  if (!c.isActive) return 'The store connection is inactive';
  if (isSimulated(c)) return null;
  if (!LIVE_PROVIDERS.has(c.provider)) return 'This channel has no live API adapter yet';
  return null;
}

async function sandboxSkus(db: AppDb, clientId: string) {
  return (
    await db
      .select({ sku: s.products.sku, title: s.products.name, price: s.products.price })
      .from(s.products)
      .where(and(eq(s.products.clientId, clientId), eq(s.products.status, 'Active')))
      .orderBy(asc(s.products.sku))
      .limit(24)
  ).map((p) => ({ sku: p.sku, title: p.title, price: p.price ?? 0 }));
}

/** A demo feed keeps the store's own mapped locations and listing ids. */
async function demoFeedOptions(db: AppDb, c: ChannelConnectionRow) {
  const locations = await db
    .select({
      id: s.channelLocationMappings.channelLocationId,
      name: s.channelLocationMappings.channelLocationName,
    })
    .from(s.channelLocationMappings)
    .where(eq(s.channelLocationMappings.connectionId, c.id));
  const listingIds = new Map(
    (
      await db
        .select({ sku: s.productListings.sellerSku, id: s.productListings.channelProductId })
        .from(s.productListings)
        .where(eq(s.productListings.channelConnectionId, c.id))
    ).map((x) => [x.sku, x.id] as const),
  );
  return { demo: true, locations, listingIds };
}

export async function adapterFor(db: AppDb, c: ChannelConnectionRow): Promise<ChannelAdapter | null> {
  if (isSandbox(c)) return sandboxAdapter(await sandboxSkus(db, c.clientId));
  if (isDemoFeed(c)) return sandboxAdapter(await sandboxSkus(db, c.clientId), await demoFeedOptions(db, c));
  return LIVE_ADAPTERS[c.provider] ?? null;
}

const CHANNEL_OF: Readonly<Record<string, (typeof ORDER_CHANNELS)[number]>> = {
  shopify: 'Shopify',
  amazon: 'Amazon',
  tiktok: 'TikTok Shop',
  walmart: 'Walmart',
  ebay: 'eBay',
  woocommerce: 'WooCommerce',
  shipstation: 'ShipStation',
  etsy: 'Etsy',
  bigcommerce: 'BigCommerce',
};
const PREFIX: Readonly<Record<string, string>> = {
  shopify: 'SPY',
  shipstation: 'SS',
  amazon: 'AMZ',
  woocommerce: 'WOO',
  walmart: 'WMT',
  tiktok: 'TTS',
  ebay: 'EBY',
  etsy: 'ETS',
};
const refOf = (c: ChannelConnectionRow, o: ChannelOrder) =>
  `${isSandbox(c) ? 'SBX' : (PREFIX[c.provider] ?? 'CH')}-${o.id.replace(/\D/g, '').slice(-13) || o.id}`;
const channelOrderIdOf = (raw: unknown): string | null => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const v = r.kitstaks_ref ?? r.id ?? r.orderId;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
};

/** Error text safe to show operators: database/driver internals are replaced by a plain-language message. */
function safeMessage(error: unknown): string {
  const { message } = describeError(error);
  return isInternalDbText(message) ? classifyImportError(error).message : message;
}

class OrderSkip extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

interface RunCounters {
  success: number;
  error: number;
  total: number;
}

async function addItem(
  db: AppDb,
  runId: string,
  item: {
    success: boolean;
    properties: Record<string, unknown>;
    error?: string | null;
    storeOrderNumber?: string | null;
    sellerSku?: string | null;
    qty?: number | null;
  },
) {
  await db.insert(s.channelRunItems).values({
    runId,
    success: item.success,
    properties: JSON.stringify(item.properties),
    errorMessage: item.error ? brandText(item.error) : null,
    storeOrderNumber: item.storeOrderNumber ?? null,
    sellerSku: item.sellerSku ?? null,
    qty: item.qty ?? null,
  });
}

async function upsertMissing(db: AppDb, c: ChannelConnectionRow, o: ChannelOrder, code: string) {
  const m = s.channelMissingOrders;
  const raw = o.raw && typeof o.raw === 'object' ? o.raw : { order: o.raw };
  const existing = (
    await db
      .select()
      .from(m)
      .where(and(eq(m.connectionId, c.id), eq(m.channelOrderNumber, o.number)))
      .limit(1)
  )[0];
  const values = {
    lastErrorCode: brandText(code),
    payload: JSON.stringify(raw),
    lastUpdated: new Date().toISOString(),
    status: 'Error' as const,
  };
  if (existing) await db.update(m).set(values).where(eq(m.id, existing.id));
  else
    await db
      .insert(m)
      .values({
        connectionId: c.id,
        orderCode: refOf(c, o),
        channelOrderNumber: o.number,
        orderDate: o.createdAt,
        ...values,
      });
}

async function resolveMissing(db: AppDb, c: ChannelConnectionRow, number: string) {
  const m = s.channelMissingOrders;
  await db
    .update(m)
    .set({ status: 'Resolved', lastUpdated: new Date().toISOString() })
    .where(and(eq(m.connectionId, c.id), eq(m.channelOrderNumber, number), sql`${m.status} <> 'Resolved'`));
}

function tagBlocked(settings: ChannelSettings, tags: readonly string[]): boolean {
  const wanted = settings.tagFilter.tags.map((t) => t.toLowerCase());
  if (wanted.length === 0) return false;
  const have = new Set(tags.map((t) => t.toLowerCase()));
  const all = wanted.every((t) => have.has(t));
  const any = wanted.some((t) => have.has(t));
  const hit = settings.tagFilter.condition === 'All Following Tags' ? all : any;
  return settings.tagFilter.method === 'Included' ? !hit : hit;
}

async function importOrder(
  db: AppDb,
  ctx: DomainCtx,
  c: ChannelConnectionRow,
  settings: ChannelSettings,
  o: ChannelOrder,
): Promise<{ code: string; lines: number }> {
  const so = s.shipmentOrders;
  const dup = (
    await db
      .select({ code: so.code })
      .from(so)
      .where(
        and(
          eq(so.storeOrderNumber, o.number),
          sql`(${so.channelConnectionId} = ${c.id} OR (${so.channelConnectionId} IS NULL AND ${so.storeName} = ${c.storeName}))`,
        ),
      )
      .limit(1)
  )[0];
  if (dup) throw new OrderSkip('__duplicate', `Already downloaded as ${dup.code}`);
  if (tagBlocked(settings, o.tags)) throw new OrderSkip('Order is Blocked by Tag Filter');
  if (o.lines.length === 0) throw new OrderSkip('Line details not found in the Order');
  if (!o.hasFulfillmentOrders) throw new OrderSkip('Fulfillment Orders not found in the Order');
  const shippable = o.lines.filter((l) => l.requiresShipping);
  if (shippable.length === 0) throw new OrderSkip('All products are Digital');
  const open = shippable.filter((l) => l.quantity - l.fulfilledQuantity > 0);
  if (open.length === 0) throw new OrderSkip('Order lines are already fulfilled on the Store');
  if (open.some((l) => l.isCustom)) throw new OrderSkip('The Order includes custom products');
  if (open.some((l) => !l.sku)) throw new OrderSkip('The Order includes products without an SKU');
  if (!o.shipTo || !o.shipTo.line1 || !o.shipTo.city || !o.shipTo.zip)
    throw new OrderSkip('Unexpected Error', 'The order has no complete shipping address');
  const maps = await db
    .select()
    .from(s.channelLocationMappings)
    .where(eq(s.channelLocationMappings.connectionId, c.id));
  const mapping = o.locationId ? maps.find((m) => m.channelLocationId === o.locationId) : maps[0];
  if (!mapping) throw new OrderSkip('Fulfillment Orders not found in the specified location');
  const products = new Map<string, string>();
  const missing: string[] = [];
  for (const l of open) {
    const sku = l.sku as string;
    const p = (
      await db
        .select({ id: s.products.id })
        .from(s.products)
        .where(and(eq(s.products.clientId, c.clientId), eq(s.products.sku, sku)))
        .limit(1)
    )[0];
    if (p) {
      products.set(sku, p.id);
      continue;
    }
    if (settings.orders.createNonexistentProducts) {
      try {
        products.set(
          sku,
          (
            await ensureProductForListing(db, ctx, {
              clientId: c.clientId,
              sellerSku: sku,
              name: l.title,
              price: l.price,
            })
          ).product.id,
        );
      } catch {
        throw new OrderSkip(
          'One or more SKUs could not be created in KitStak',
          `'${sku}' could not be created`,
        );
      }
    } else missing.push(sku);
  }
  if (missing.length > 0 && (!settings.orders.partialOrders || missing.length === open.length)) {
    throw new OrderSkip(
      'One or more SKUs in the order were not found in KitStak',
      `SKU not found: ${missing.join(', ')}`,
    );
  }
  const lines = open
    .filter((l) => products.has(l.sku as string))
    .map((l) => ({
      productId: products.get(l.sku as string) as string,
      quantity: l.quantity - l.fulfilledQuantity,
      unitPrice: l.price,
    }));
  const type = settings.orders.shipmentOrderType.toUpperCase().includes('B2B') ? 'B2B' : 'D2C';
  const created = await createOrder(
    db,
    ctx,
    {
      channel: CHANNEL_OF[c.provider] ?? (isSandbox(c) ? 'Shopify' : 'Wholesale'),
      storeName: c.storeName,
      storeOrderNumber: o.number,
      customerName: o.shipTo.name,
      customerEmail: o.email ?? '',
      customerPhone: o.shipTo.phone ?? null,
      customerFirstName: o.shipTo.firstName ?? null,
      customerLastName: o.shipTo.lastName ?? null,
      companyName: o.shipTo.company ?? null,
      shipAddress: o.shipTo.line1,
      shipAddress2: o.shipTo.line2 ?? null,
      shipCity: o.shipTo.city,
      shipState: o.shipTo.state ?? '',
      shipZip: o.shipTo.zip,
      shipCountry: o.shipTo.country || 'United States',
      orderType: type,
      priority: 'None',
      orderDate: o.createdAt,
      note:
        [o.note, missing.length > 0 ? `Partial order: ${missing.join(', ')} not found` : null]
          .filter(Boolean)
          .join('\n') || null,
      skipAddressVerification: settings.orders.skipAddressVerification,
      isGift: o.isGift,
      warehouseId: mapping.warehouseId,
      clientId: c.clientId,
      lines,
      channelConnectionId: c.id,
      channelPaymentStatus: o.financialStatus ? o.financialStatus.slice(0, 50) : null,
    },
    { trigger: 'Shipment Order Imported' },
  );
  return { code: created.code, lines: lines.length };
}

async function downloadOrders(
  db: AppDb,
  c: ChannelConnectionRow,
  adapter: ChannelAdapter,
  actx: AdapterContext,
  runId: string,
  method: MethodRow,
  onlyOrders?: readonly ChannelOrder[],
): Promise<RunCounters> {
  const counters: RunCounters = { success: 0, error: 0, total: 0 };
  const settings = actx.settings;
  const since = settings.orders.downloadFrom ?? method.lastSuccessAt ?? null;
  const orders = onlyOrders ?? (await adapter.fetchOrders(actx, since));
  const ctx = systemCtx('Integration');
  const failedCodes: string[] = [];
  for (const o of orders) {
    if (
      settings.paymentStatuses.length > 0 &&
      !settings.paymentStatuses.map((p) => p.toLowerCase()).includes(o.financialStatus.toLowerCase())
    )
      continue;
    try {
      const res = await importWithRetry(db, ctx, c, settings, o);
      counters.success++;
      counters.total++;
      await withWriteTx(db, async (tx) => {
        await resolveMissing(tx, c, o.number);
        await addItem(tx, runId, {
          success: true,
          properties: { orderCode: res.code, storeOrderNumber: o.number, lines: res.lines },
          storeOrderNumber: o.number,
        });
      });
    } catch (error) {
      if (error instanceof OrderSkip && error.code === '__duplicate') continue;
      // Never surface SQL/driver text: classify into a catalog code + plain-language message.
      const classified: ClassifiedImportError =
        error instanceof OrderSkip
          ? { code: error.code, message: error.message, retryable: false }
          : classifyImportError(error);
      const { code, message } = classified;
      counters.error++;
      counters.total++;
      failedCodes.push(code);
      await withWriteTx(db, async (tx) => {
        await upsertMissing(tx, c, o, code);
        await addItem(tx, runId, {
          success: false,
          properties: { storeOrderNumber: o.number, channelOrderId: o.id },
          error: message === code ? code : `${code}: ${message}`,
          storeOrderNumber: o.number,
        });
      });
    }
  }
  await alertRepeatedFailures(db, c, failedCodes);
  return counters;
}

const IMPORT_ATTEMPTS = 3;
const ALERT_DEDUPE_HOURS = 6;
const ALERT_KIND = 'integration.repeated_failure';

/** Imports one order in its own transaction; transient failures (order-code collision, busy DB) are retried. */
async function importWithRetry(
  db: AppDb,
  ctx: DomainCtx,
  c: ChannelConnectionRow,
  settings: ChannelSettings,
  o: ChannelOrder,
): Promise<{ code: string; lines: number }> {
  let last: unknown = null;
  for (let attempt = 0; attempt < IMPORT_ATTEMPTS; attempt++) {
    try {
      return await withWriteTx(db, async (tx) => await importOrder(tx, ctx, c, settings, o));
    } catch (error) {
      if (error instanceof OrderSkip || !classifyImportError(error).retryable) throw error;
      last = error;
    }
  }
  throw last;
}

/** One alert per store + code every few hours when the same failure repeats within a run. */
async function alertRepeatedFailures(db: AppDb, c: ChannelConnectionRow, codes: readonly string[]) {
  for (const { code, count } of repeatedFailures(codes)) {
    const marker = `[${c.id}:${code}]`;
    const since = new Date(Date.now() - ALERT_DEDUPE_HOURS * 3_600_000).toISOString();
    try {
      const n = s.notifications;
      const recent = (
        await db
          .select({ id: n.id })
          .from(n)
          .where(
            and(
              eq(n.kind, ALERT_KIND),
              sql`strpos(${n.body}, ${marker}) > 0`,
              sql`${n.createdAt} >= ${since}`,
            ),
          )
          .limit(1)
      )[0];
      if (recent) continue;
      await withWriteTx(
        db,
        async (tx) =>
          await notify(
            tx,
            { roleKey: 'admin' },
            {
              kind: ALERT_KIND,
              severity: 'error',
              title: `${c.storeName}: ${count} orders failed with "${code}"`.slice(0, 200),
              body: `${catalogError(code).recommendedAction} ${marker}`.slice(0, 2000),
              href: `/integrations/monitoring/missing-orders?f.connectionId=in:${encodeURIComponent(c.id)}`,
            },
          ),
      );
    } catch {
      // Alerting must never fail the run.
    }
  }
}

async function downloadProducts(
  db: AppDb,
  c: ChannelConnectionRow,
  adapter: ChannelAdapter,
  actx: AdapterContext,
  runId: string,
): Promise<RunCounters> {
  const counters: RunCounters = { success: 0, error: 0, total: 0 };
  const products = await adapter.fetchProducts(actx);
  const ctx = systemCtx('Integration');
  const l = s.productListings;
  for (const p of products) {
    counters.total++;
    if (!p.sku) {
      counters.error++;
      await addItem(db, runId, {
        success: false,
        properties: { channelProductId: p.id, title: p.title },
        error: 'The listing has no SKU',
        sellerSku: null,
      });
      continue;
    }
    try {
      await withWriteTx(db, async (tx) => {
        const product = actx.settings.products.download
          ? (
              await ensureProductForListing(tx, ctx, {
                clientId: c.clientId,
                sellerSku: p.sku as string,
                name: p.title,
                price: p.price,
                barcode: p.barcode ?? undefined,
                weightOz: p.weightOz,
              })
            ).product
          : ((
              await tx
                .select()
                .from(s.products)
                .where(and(eq(s.products.clientId, c.clientId), eq(s.products.sku, p.sku as string)))
                .limit(1)
            )[0] ?? null);
        const existing = (
          await tx
            .select()
            .from(l)
            .where(and(eq(l.channelConnectionId, c.id), eq(l.channelProductId, p.id)))
            .limit(1)
        )[0];
        const values = {
          sellerSku: p.sku as string,
          name: p.title,
          storePrice: p.price,
          imageUrl: p.imageUrl,
          productId: product?.id ?? null,
          linkedAt: product ? new Date().toISOString() : null,
        };
        if (existing)
          await tx
            .update(l)
            .set({
              ...values,
              productId: existing.productId ?? values.productId,
              linkedAt: existing.linkedAt ?? values.linkedAt,
            })
            .where(eq(l.id, existing.id));
        else
          await tx
            .insert(l)
            .values({ channelConnectionId: c.id, clientId: c.clientId, channelProductId: p.id, ...values });
        await addItem(tx, runId, {
          success: true,
          properties: { sku: p.sku, channelProductId: p.id, linked: Boolean(product) },
          sellerSku: p.sku,
        });
      });
      counters.success++;
    } catch (error) {
      counters.error++;
      await addItem(db, runId, {
        success: false,
        properties: { sku: p.sku, channelProductId: p.id },
        error: `'${p.sku}' could not be created: ${safeMessage(error)}`,
        sellerSku: p.sku,
      });
    }
  }
  return counters;
}

/** Quantity to publish for one listing (on hand or available, sync-prevented locations excluded, channel allocation rules). */
export async function listingQty(
  db: AppDb,
  c: ChannelConnectionRow,
  settings: ChannelSettings,
  productId: string,
): Promise<number> {
  const whIds = (
    await db
      .select({ id: s.channelLocationMappings.warehouseId })
      .from(s.channelLocationMappings)
      .where(eq(s.channelLocationMappings.connectionId, c.id))
  ).map((x) => x.id);
  if (whIds.length === 0) return 0;
  const i = s.inventory;
  const row = (
    await db
      .select({
        onHand: sql<number>`COALESCE(SUM(${i.onHand} - ${i.damaged}), 0)`,
        allocated: sql<number>`COALESCE(SUM(${i.allocated}), 0)`,
      })
      .from(i)
      .innerJoin(s.locations, eq(s.locations.id, i.locationId))
      .where(
        and(
          eq(i.productId, productId),
          eq(i.clientId, c.clientId),
          inArray(i.warehouseId, whIds),
          eq(i.status, 'Stock'),
          eq(s.locations.preventInventorySync, false),
        ),
      )
      .limit(1)
  )[0];
  const base = Math.max(
    0,
    settings.inventory.method === 'On Hand'
      ? Number(row?.onHand ?? 0)
      : Number(row?.onHand ?? 0) - Number(row?.allocated ?? 0),
  );
  const alloc = (
    await db
      .select()
      .from(s.productChannelAllocations)
      .where(
        and(
          eq(s.productChannelAllocations.productId, productId),
          eq(s.productChannelAllocations.channelConnectionId, c.id),
        ),
      )
      .limit(1)
  )[0];
  if (!alloc) return base;
  if (alloc.staticQty !== null && alloc.staticQty !== undefined) return Math.max(0, alloc.staticQty);
  const afterReserve = Math.max(0, base - (alloc.reserveQty ?? 0));
  return alloc.allocationPct !== null && alloc.allocationPct !== undefined
    ? Math.floor((afterReserve * alloc.allocationPct) / 100)
    : afterReserve;
}

async function syncInventory(
  db: AppDb,
  c: ChannelConnectionRow,
  adapter: ChannelAdapter,
  actx: AdapterContext,
  runId: string,
): Promise<RunCounters> {
  const counters: RunCounters = { success: 0, error: 0, total: 0 };
  const l = s.productListings;
  const listings = await db
    .select()
    .from(l)
    .where(and(eq(l.channelConnectionId, c.id), eq(l.neverSync, false), sql`${l.productId} IS NOT NULL`));
  const pushes = await mapSeq(listings, async (x) => ({
    listing: x,
    qty: await listingQty(db, c, actx.settings, x.productId as string),
  }));
  const results = await adapter.pushInventory(
    actx,
    pushes.map((p) => ({
      sellerSku: p.listing.sellerSku,
      channelProductId: p.listing.channelProductId,
      qty: p.qty,
    })),
  );
  await forEachSeq(pushes, async (p, idx) => {
    const r = results[idx];
    counters.total++;
    if (r?.ok) {
      counters.success++;
      await db.update(l).set({ lastSyncedQty: p.qty }).where(eq(l.id, p.listing.id));
      await addItem(db, runId, {
        success: true,
        properties: { sku: p.listing.sellerSku, qty: p.qty },
        sellerSku: p.listing.sellerSku,
        qty: p.qty,
      });
    } else {
      counters.error++;
      await addItem(db, runId, {
        success: false,
        properties: { sku: p.listing.sellerSku, qty: p.qty },
        error: r?.error ?? 'Inventory update failed',
        sellerSku: p.listing.sellerSku,
        qty: p.qty,
      });
    }
  });
  return counters;
}

async function sendShipments(
  db: AppDb,
  c: ChannelConnectionRow,
  adapter: ChannelAdapter,
  actx: AdapterContext,
  runId: string,
): Promise<RunCounters> {
  const counters: RunCounters = { success: 0, error: 0, total: 0 };
  const so = s.shipmentOrders;
  const ol = s.orderLines;
  const orders = await db
    .select()
    .from(so)
    .where(
      and(
        eq(so.channelConnectionId, c.id),
        inArray(so.status, ['Shipped', 'Partially Shipped', 'Delivered']),
      ),
    );
  for (const o of orders) {
    const lines = await db
      .select({ l: ol, sku: s.products.sku })
      .from(ol)
      .innerJoin(s.products, eq(s.products.id, ol.productId))
      .where(and(eq(ol.orderId, o.id), gt(ol.shippedQuantity, 0), eq(ol.isStoreUpdated, false)));
    if (lines.length === 0) continue;
    const ship = (
      await db
        .select()
        .from(s.shipments)
        .where(and(eq(s.shipments.orderId, o.id), eq(s.shipments.labelStatus, 'Active')))
        .orderBy(sql`${s.shipments.labelCreatedAt} DESC`)
        .limit(1)
    )[0];
    counters.total++;
    const tracking = ship?.trackingNumber ?? null;
    if (!tracking) {
      counters.error++;
      await addItem(db, runId, {
        success: false,
        properties: { orderCode: o.code },
        error: 'No active label with a tracking number',
        storeOrderNumber: o.storeOrderNumber,
      });
      continue;
    }
    const missing = (
      await db
        .select({ payload: s.channelMissingOrders.payload })
        .from(s.channelMissingOrders)
        .where(
          and(
            eq(s.channelMissingOrders.connectionId, c.id),
            eq(s.channelMissingOrders.channelOrderNumber, o.storeOrderNumber ?? ''),
          ),
        )
        .limit(1)
    )[0];
    const channelOrderId =
      (missing ? channelOrderIdOf(JSON.parse(missing.payload)) : null) ?? o.storeOrderNumber ?? o.code;
    try {
      const r = await adapter.pushShipment(actx, {
        channelOrderId,
        storeOrderNumber: o.storeOrderNumber ?? o.code,
        trackingNumber: tracking,
        carrier: ship?.carrierCode ?? o.carrier ?? 'Other',
        lines: lines.map((x) => ({ sku: x.sku, quantity: x.l.shippedQuantity })),
      });
      if (!r.ok) throw new Error(r.error ?? 'The store rejected the fulfillment');
      await withWriteTx(db, async (tx) => {
        await tx
          .update(ol)
          .set({
            isStoreUpdated: true,
            storeUpdateNotes: `Tracking ${tracking} sent ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          })
          .where(
            inArray(
              ol.id,
              lines.map((x) => x.l.id),
            ),
          );
        await recordUpdate(tx, systemCtx('Integration'), {
          entityType: 'shipment_order',
          entityId: o.id,
          entityCode: o.code,
          before: { storeUpdated: 'No' },
          after: { storeUpdated: `Yes · ${tracking}` },
        });
        await addItem(tx, runId, {
          success: true,
          properties: { orderCode: o.code, trackingNumber: tracking },
          storeOrderNumber: o.storeOrderNumber,
        });
      });
      counters.success++;
    } catch (error) {
      counters.error++;
      await db
        .update(ol)
        .set({ storeUpdateNotes: safeMessage(error).slice(0, 300) })
        .where(
          inArray(
            ol.id,
            lines.map((x) => x.l.id),
          ),
        );
      await addItem(db, runId, {
        success: false,
        properties: { orderCode: o.code, trackingNumber: tracking },
        error: safeMessage(error),
        storeOrderNumber: o.storeOrderNumber,
      });
    }
  }
  return counters;
}

export interface RunSummary {
  readonly runId: string | null;
  readonly method: ChannelMethod;
  readonly storeName: string;
  readonly status: RunStatus;
  readonly success: number;
  readonly error: number;
  readonly total: number;
  readonly message: string | null;
}

const statusOf = (c: RunCounters): RunStatus =>
  c.total === 0
    ? 'No Data'
    : c.error === 0
      ? 'Successful'
      : c.success === 0
        ? 'Failed'
        : 'Partially Successful';

function nextRunAt(intervalMinutes: number, from: Date): string {
  return new Date(from.getTime() + intervalMinutes * 60_000).toISOString();
}

/** Runs one channel method now (scheduler or manual Run). Never throws; failures become a run row. */
export async function runChannelMethod(
  db: AppDb,
  methodId: string,
  opts: {
    readonly manual: boolean;
    readonly now?: Date;
    readonly onlyOrders?: readonly ChannelOrder[];
    readonly simulateError?: boolean;
  } = { manual: true },
): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const m = s.channelMethods;
  const method = (await db.select().from(m).where(eq(m.id, methodId)).limit(1))[0];
  if (!method) throw new ChannelApiError('Channel method not found', 404);
  const c = (
    await db
      .select()
      .from(s.channelConnections)
      .where(eq(s.channelConnections.id, method.connectionId))
      .limit(1)
  )[0];
  if (!c) throw new ChannelApiError('Store connection not found', 404);
  const base = { method: method.method, storeName: c.storeName };
  const startRun = async (status: RunStatus) =>
    (
      await db
        .insert(s.channelRuns)
        .values({
          methodId: method.id,
          connectionId: c.id,
          method: method.method,
          status,
          startedAt: now.toISOString(),
          endedAt: status === 'Processing' ? null : new Date().toISOString(),
        })
        .returning()
    )[0];
  if (method.jobStatus === 'Processing') {
    const run = await startRun('Already Processing');
    return {
      ...base,
      runId: run.id,
      status: 'Already Processing',
      success: 0,
      error: 0,
      total: 0,
      message: 'This method is already running; try again in a moment.',
    };
  }
  const reason = pauseReason(c);
  const adapter = await adapterFor(db, c);
  if (reason || !adapter) {
    const run = await startRun(reason?.includes('credentials') ? 'Unauthorized' : 'Failed');
    await addItem(db, run.id, {
      success: false,
      properties: { method: method.method },
      error: reason ?? 'No adapter',
    });
    await db.update(s.channelRuns).set({ errorCount: 1, totalCount: 1 }).where(eq(s.channelRuns.id, run.id));
    await db
      .update(m)
      .set({
        lastRunAt: now.toISOString(),
        nextRunAt: nextRunAt(method.intervalMinutes, now),
        jobStatus: opts.manual ? method.jobStatus : 'Paused',
      })
      .where(eq(m.id, method.id));
    return {
      ...base,
      runId: run.id,
      status: run.status,
      success: 0,
      error: 1,
      total: 1,
      message: reason ?? 'No adapter',
    };
  }
  await db.update(m).set({ jobStatus: 'Processing' }).where(eq(m.id, method.id));
  const run = await startRun('Processing');
  const settings = channelSettingsSchema.parse(c.settings ?? {});
  const runNumber =
    (
      await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(s.channelRuns)
        .where(eq(s.channelRuns.methodId, method.id))
        .limit(1)
    )[0]?.n ?? 1;
  const actx: AdapterContext = {
    connection: c,
    credentials: decryptCredentials(c.credentialsEnc),
    settings,
    runNumber: Number(runNumber),
    now,
    simulateError: opts.simulateError === true && isSimulated(c),
    manual: opts.manual,
  };
  let counters: RunCounters = { success: 0, error: 0, total: 0 };
  let status: RunStatus;
  let message: string | null = null;
  try {
    counters =
      method.method === 'Download Orders'
        ? await downloadOrders(db, c, adapter, actx, run.id, method, opts.onlyOrders)
        : method.method === 'Download Products'
          ? await downloadProducts(db, c, adapter, actx, run.id)
          : method.method === 'Sync Inventory'
            ? await syncInventory(db, c, adapter, actx, run.id)
            : await sendShipments(db, c, adapter, actx, run.id);
    status = statusOf(counters);
  } catch (error) {
    const unauthorized = error instanceof ChannelApiError && (error.status === 401 || error.status === 403);
    status = unauthorized ? 'Unauthorized' : 'Failed';
    message = safeMessage(error);
    counters = { success: counters.success, error: counters.error + 1, total: counters.total + 1 };
    await addItem(db, run.id, { success: false, properties: { method: method.method }, error: message });
  }
  const ended = new Date().toISOString();
  await db
    .update(s.channelRuns)
    .set({
      status,
      successCount: counters.success,
      errorCount: counters.error,
      totalCount: counters.total,
      endedAt: ended,
    })
    .where(eq(s.channelRuns.id, run.id));
  await db
    .update(m)
    .set({
      jobStatus: 'Waiting For Next',
      lastRunAt: now.toISOString(),
      nextRunAt: nextRunAt(method.intervalMinutes, now),
      ...(status === 'Successful' || status === 'No Data' || status === 'Partially Successful'
        ? { lastSuccessAt: now.toISOString() }
        : {}),
    })
    .where(eq(m.id, method.id));
  if (status === 'Unauthorized')
    await db.update(s.channelConnections).set({ status: 'Error' }).where(eq(s.channelConnections.id, c.id));
  return { ...base, runId: run.id, status, ...counters, message };
}

/** Retry Download for missing orders: re-fetch from the channel and import again. */
export async function retryMissingOrders(
  db: AppDb,
  ids: readonly string[],
): Promise<{ succeeded: string[]; failed: { id: string; code: string; message: string }[] }> {
  const mo = s.channelMissingOrders;
  const rows = await db
    .select()
    .from(mo)
    .where(inArray(mo.id, [...ids]));
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  const byConn = new Map<string, typeof rows>();
  for (const r of rows) byConn.set(r.connectionId, [...(byConn.get(r.connectionId) ?? []), r]);
  for (const missingId of ids)
    if (!rows.some((r) => r.id === missingId))
      failed.push({ id: missingId, code: 'NOT_FOUND', message: 'Missing order not found' });
  for (const [connectionId, list] of byConn) {
    const method = (
      await db
        .select()
        .from(s.channelMethods)
        .where(
          and(
            eq(s.channelMethods.connectionId, connectionId),
            eq(s.channelMethods.method, 'Download Orders'),
          ),
        )
        .limit(1)
    )[0];
    const c = (
      await db.select().from(s.channelConnections).where(eq(s.channelConnections.id, connectionId)).limit(1)
    )[0];
    const adapter = c ? await adapterFor(db, c) : null;
    const reason = c ? pauseReason(c) : 'Store connection not found';
    if (!method || !c || !adapter || reason) {
      for (const r of list)
        failed.push({
          id: r.id,
          code: 'INVALID_STATE',
          message: reason ?? 'The store has no Download Orders method',
        });
      continue;
    }
    for (const r of list)
      await db
        .update(mo)
        .set({ status: 'Retrying', lastUpdated: new Date().toISOString() })
        .where(eq(mo.id, r.id));
    const settings = channelSettingsSchema.parse(c.settings ?? {});
    const actx: AdapterContext = {
      connection: c,
      credentials: decryptCredentials(c.credentialsEnc),
      settings,
      runNumber: 0,
      now: new Date(),
      manual: true,
    };
    let orders: readonly ChannelOrder[] = [];
    try {
      orders = await adapter.fetchOrdersById(
        actx,
        list.map((r) => channelOrderIdOf(JSON.parse(r.payload)) ?? r.channelOrderNumber),
      );
    } catch (error) {
      for (const r of list) {
        await db.update(mo).set({ status: 'Error' }).where(eq(mo.id, r.id));
        failed.push({ id: r.id, code: 'INVALID_STATE', message: safeMessage(error) });
      }
      continue;
    }
    await runChannelMethod(db, method.id, { manual: true, onlyOrders: orders });
    for (const r of list) {
      const after = (await db.select().from(mo).where(eq(mo.id, r.id)).limit(1))[0];
      if (after?.status === 'Resolved') succeeded.push(r.id);
      else {
        if (after?.status === 'Retrying') await db.update(mo).set({ status: 'Error' }).where(eq(mo.id, r.id));
        failed.push({
          id: r.id,
          code: 'INVALID_STATE',
          message: `${r.channelOrderNumber}: ${after?.lastErrorCode ?? 'still failing'}`,
        });
      }
    }
  }
  return { succeeded, failed };
}

/** Scheduler entry: runs every due, active, runnable method. */
export async function runDueChannelMethods(db: AppDb, now: Date): Promise<{ ran: number; skipped: number }> {
  const m = s.channelMethods;
  const due = await db
    .select({ m, c: s.channelConnections })
    .from(m)
    .innerJoin(s.channelConnections, eq(s.channelConnections.id, m.connectionId))
    .where(
      and(
        eq(m.status, 'Active'),
        sql`(${m.nextRunAt} IS NULL OR ${m.nextRunAt} <= ${now.toISOString()})`,
        sql`${m.jobStatus} <> 'Processing'`,
      ),
    );
  let ran = 0;
  let skipped = 0;
  for (const { m: row, c } of due) {
    const reason = pauseReason(c);
    if (reason) {
      if (row.jobStatus !== 'Paused') await db.update(m).set({ jobStatus: 'Paused' }).where(eq(m.id, row.id));
      skipped++;
      continue;
    }
    await runChannelMethod(db, row.id, { manual: false, now });
    ran++;
  }
  return { ran, skipped };
}
