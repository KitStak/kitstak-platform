/**
 * Order Merge Rule policy (Data Setup › Order Merge Rule, read by Order Merge waves):
 *   - merge conditions → the group key (client always included; "orderTag" = the order's tag set);
 *   - data inheritance → which original order becomes the master:
 *       oldest = earliest order date (default), newest = latest order date,
 *       clean  = earliest order, whose free-text metadata is then cleared.
 * Pure helpers plus one tag loader; `waves-run.runOrderMerge` applies them.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import * as schema from '@/server/db/schema';
import type { DomainCtx } from '@/server/domain/types';
import { recordUpdate } from '@/server/domain/change-log';

export type MergeInheritanceMode = 'oldest' | 'newest' | 'clean';

export interface MergeRuleMetaShape {
  readonly criteria?: readonly string[];
  readonly inheritFrom?: string;
}

export const DEFAULT_MERGE_CRITERIA = ['client', 'customerName', 'shipAddress', 'shipZip'] as const;

export function mergeInheritance(meta: MergeRuleMetaShape | null | undefined): MergeInheritanceMode {
  const v = meta?.inheritFrom;
  return v === 'newest' || v === 'clean' ? v : 'oldest';
}

/** Group key; null when every criterion is blank (such orders never merge). */
export function mergeGroupKey(
  order: Readonly<Record<string, unknown>>,
  criteria: readonly string[],
  tagNames: readonly string[] = [],
): string | null {
  const parts = criteria
    .filter((k) => k !== 'client')
    .map((k) => {
      if (k === 'orderTag')
        return [...tagNames]
          .map((t) => t.trim().toLowerCase())
          .sort()
          .join(',');
      return String(order[k] ?? '')
        .trim()
        .toLowerCase();
    });
  if (parts.length > 0 && parts.every((p) => p === '')) return null;
  return [String(order.clientId ?? ''), ...parts].join('|');
}

/** Master first, then the children (stable on order code for equal dates). */
export function orderMergeGroup<T extends { readonly orderDate: string; readonly code: string }>(
  group: readonly T[],
  mode: MergeInheritanceMode,
): T[] {
  const sorted = [...group].sort(
    (a, b) => a.orderDate.localeCompare(b.orderDate) || a.code.localeCompare(b.code),
  );
  if (mode === 'newest') sorted.reverse();
  return sorted;
}

/** Fields a "Clean state" master starts without (free-text metadata of the original order). */
export const CLEAN_STATE_FIELDS = [
  'note',
  'extraNote1',
  'extraNote2',
  'extraNote3',
  'extraNote4',
  'extraNote5',
  'packingInstructions',
  'giftNote',
  'clientReferenceCode',
  'packingWarningTypeId',
] as const;

export function cleanStatePatch(order: Readonly<Record<string, unknown>>): {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const f of CLEAN_STATE_FIELDS) {
    if (order[f] === null || order[f] === undefined || order[f] === '') continue;
    before[f] = order[f];
    after[f] = null;
  }
  if (order.isGift === true || order.isGift === 1) {
    before.isGift = true;
    after.isGift = false;
  }
  return { before, after };
}

/** Tag names per order id (entity "shipment_order"). */
export async function orderTagNames(db: AppDb, orderIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .select({ id: schema.entityTags.entityId, name: schema.tags.name })
    .from(schema.entityTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.entityTags.tagId))
    .where(
      and(
        eq(schema.entityTags.entityType, 'shipment_order'),
        inArray(schema.entityTags.entityId, [...orderIds]),
      ),
    );
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.name]);
  return out;
}

/** Clears the master's metadata after a "Clean state" merge (change-logged). */
export async function applyCleanState(db: AppDb, ctx: DomainCtx, masterId: string): Promise<void> {
  const master = (
    await db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, masterId)).limit(1)
  )[0];
  if (!master) return;
  const { before, after } = cleanStatePatch(master as unknown as Record<string, unknown>);
  if (Object.keys(after).length === 0) return;
  await db
    .update(schema.shipmentOrders)
    .set({
      ...(after as Partial<typeof schema.shipmentOrders.$inferInsert>),
      updatedBy: ctx.userId,
      version: sql`${schema.shipmentOrders.version} + 1`,
    })
    .where(eq(schema.shipmentOrders.id, masterId));
  await recordUpdate(db, ctx, {
    entityType: 'shipment_order',
    entityId: master.id,
    entityCode: master.code,
    before,
    after,
  });
}
