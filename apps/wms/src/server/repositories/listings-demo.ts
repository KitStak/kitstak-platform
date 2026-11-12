/**
 * Demo channel listings for Product Listings' **Suggested** state (M09, Logiwa live capture §6).
 *
 * The Bluebird & Main Shopify store downloads listings whose seller SKU equals a Bluebird product
 * SKU (one in lower case), so they show as amber "Suggested" rows with Match / Don't match, plus
 * one listing with no matching product ("No match"). Idempotent on the listing natural key
 * (store + channel product id): only missing rows are inserted. `reset` puts the demo rows back
 * to unlinked and withdraws their "Don't match" dismissals, so the demo can be replayed.
 * Every insert / reset writes the change log.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { schema } from '@/server/db';
import { recordCreate, recordUpdate } from '@/server/domain/change-log';
import type { DomainCtx } from '@/server/domain/types';
import { DISMISSED_SUGGESTION_FIELD } from './listings';
import { dbGet } from '@/server/db/sql';

const l = schema.productListings;

export const DEMO_LISTING_STORE = 'Bluebird & Main Shopify';

/** [channel product id, seller SKU, listing name, store price]. Seller SKUs match BLB products except the last. */
export const DEMO_SUGGESTED_LISTINGS: readonly (readonly [string, string, string, number])[] = [
  ['7704100001', 'BLB-HOOD-BLK-M', 'Bluebird Pullover Hoodie - Black / M', 58],
  ['7704100002', 'BLB-HOOD-GRY-L', 'Bluebird Pullover Hoodie - Heather Grey / L', 58],
  ['7704100003', 'BLB-CAP-OS-BLK', 'Bluebird Dad Cap - Black', 26],
  ['7704100004', 'blb-cap-os-khk', 'Bluebird Dad Cap - Khaki', 26],
  ['7704100005', 'BLB-TOTE-NAT', 'Bluebird Canvas Tote - Natural', 22],
];

export interface DemoListingReport {
  readonly created: readonly string[];
  readonly reset: readonly string[];
  readonly skipped: readonly string[];
}

/** Inserts the missing demo listings (and with `reset`, returns existing ones to unlinked). Call inside a transaction. */
export async function ensureDemoSuggestedListings(
  tx: AppDb,
  ctx: DomainCtx,
  options: { readonly reset?: boolean } = {},
): Promise<DemoListingReport> {
  const created: string[] = [];
  const reset: string[] = [];
  const skipped: string[] = [];
  const store = (
    await tx
      .select({ id: schema.channelConnections.id, clientId: schema.channelConnections.clientId })
      .from(schema.channelConnections)
      .where(eq(schema.channelConnections.storeName, DEMO_LISTING_STORE))
      .limit(1)
  )[0];
  if (!store?.clientId) return { created, reset, skipped: [`store ${DEMO_LISTING_STORE} not found`] };
  const existing = new Map(
    (
      await tx
        .select()
        .from(l)
        .where(
          and(
            eq(l.channelConnectionId, store.id),
            inArray(
              l.channelProductId,
              DEMO_SUGGESTED_LISTINGS.map((d) => d[0]),
            ),
          ),
        )
    ).map((r) => [r.channelProductId, r] as const),
  );
  for (const [channelProductId, sellerSku, name, price] of DEMO_SUGGESTED_LISTINGS) {
    const row = existing.get(channelProductId);
    if (!row) {
      const inserted = (
        await tx
          .insert(l)
          .values({
            channelConnectionId: store.id,
            clientId: store.clientId,
            productId: null,
            sellerSku,
            channelProductId,
            name,
            storePrice: price,
            description: `${name}. Downloaded from ${DEMO_LISTING_STORE}.`,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning({ id: l.id })
      )[0];
      await recordCreate(tx, ctx, { entityType: 'listing', entityId: inserted.id, entityCode: sellerSku });
      created.push(sellerSku);
      continue;
    }
    if (!options.reset) {
      skipped.push(sellerSku);
      continue;
    }
    const dismissed =
      (
        await dbGet<{ v: string | null }>(
          tx,
          sql`SELECT cl.to_value AS v FROM change_log cl WHERE cl.entity_type = 'listing' AND cl.entity_id = ${row.id}
      AND cl.field = ${DISMISSED_SUGGESTION_FIELD} ORDER BY cl.at DESC, cl.rowid DESC LIMIT 1`,
        )
      )?.v ?? null;
    if (!row.productId && !dismissed) {
      skipped.push(sellerSku);
      continue;
    }
    await tx
      .update(l)
      .set({
        productId: null,
        linkedAt: null,
        dismissedSuggestionSku: null,
        version: row.version + 1,
        updatedBy: ctx.userId,
      })
      .where(eq(l.id, row.id));
    await recordUpdate(tx, ctx, {
      entityType: 'listing',
      entityId: row.id,
      entityCode: sellerSku,
      before: { productId: row.productId, [DISMISSED_SUGGESTION_FIELD]: dismissed },
      after: { productId: null, [DISMISSED_SUGGESTION_FIELD]: null },
    });
    reset.push(sellerSku);
  }
  return { created, reset, skipped };
}
