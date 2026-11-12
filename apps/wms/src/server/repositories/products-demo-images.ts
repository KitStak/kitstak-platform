/**
 * Demo product images for the seed catalog (M09). Sets `imageUrl` to the built-in demo
 * illustration (`demoImageUrl`) on products that have no image. Test SKUs (KS-CRIT-/KS-E2E-)
 * and products with a real image are never touched. Each change bumps the version and writes
 * a change-log entry, so an open edit form gets the normal stale-version 409 instead of
 * silently overwriting it.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { schema } from '@/server/db';
import { rowCount } from '@/server/db/sql';
import { recordUpdate } from '@/server/domain/change-log';
import type { DomainCtx } from '@/server/domain/types';
import { demoImageUrl } from '@/lib/grid-defs/products/demo-images';
import { isTestSku } from './products-test-data';

const p = schema.products;

export interface DemoImagePlanRow {
  readonly id: string;
  readonly sku: string;
  readonly imageUrl: string;
}

export async function planDemoImages(db: AppDb): Promise<DemoImagePlanRow[]> {
  const rows = await db
    .select({ id: p.id, sku: p.sku, category: p.category, version: p.version })
    .from(p)
    .where(or(isNull(p.imageUrl), eq(p.imageUrl, '')));
  return rows
    .filter((r) => !isTestSku(r.sku))
    .map((r) => ({ id: r.id, sku: r.sku, imageUrl: demoImageUrl(r.sku, r.category) }));
}

/** Applies the plan (call inside a transaction). Re-checks each row so a concurrent image wins. */
export async function applyDemoImages(tx: AppDb, ctx: DomainCtx): Promise<DemoImagePlanRow[]> {
  const applied: DemoImagePlanRow[] = [];
  for (const row of await planDemoImages(tx)) {
    const current = (
      await tx.select({ version: p.version, imageUrl: p.imageUrl }).from(p).where(eq(p.id, row.id)).limit(1)
    )[0];
    if (!current || (current.imageUrl ?? '') !== '') continue;
    const res = await tx
      .update(p)
      .set({ imageUrl: row.imageUrl, updatedBy: ctx.userId, version: current.version + 1 })
      .where(and(eq(p.id, row.id), eq(p.version, current.version)));
    if (rowCount(res) !== 1) continue;
    await recordUpdate(tx, ctx, {
      entityType: 'product',
      entityId: row.id,
      entityCode: row.sku,
      before: { imageUrl: null },
      after: { imageUrl: row.imageUrl },
    });
    applied.push(row);
  }
  return applied;
}
