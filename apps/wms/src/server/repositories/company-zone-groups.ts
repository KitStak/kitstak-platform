/**
 * Data Setup › Location Zone › "Match With Product Groups" (Logiwa parity): which product groups
 * each zone stores, kept in the zone's `meta.productGroupIds` for put-away and picking rules.
 * Scope-checked (warehouse of the zone, client of the group) and change-logged per zone.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient, hasWarehouse } from '@/server/auth/scope';
import * as s from '@/server/db/schema';
import { sameIdSet, zoneGroupIds, type ZoneGroupsSave } from '@/lib/grid-defs/admin/lookups';
import { LOOKUP_ENTITY } from './company-lookups';
import { domainCtxOf, logUpdate, type Actor } from './users-shared';

const l = s.lookupValues;

export interface ZoneGroupRow {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly warehouseId: string | null;
  readonly warehouseCode: string | null;
  readonly isActive: boolean;
  readonly productGroupIds: readonly string[];
  readonly version: number;
}

export interface ProductGroupOption {
  readonly id: string;
  readonly name: string;
  readonly clientName: string | null;
  readonly isActive: boolean;
}

export async function zoneProductGroups(
  db: AppDb,
  auth: AuthContext,
): Promise<{ zones: ZoneGroupRow[]; groups: ProductGroupOption[] }> {
  const zones = (
    await db
      .select({
        id: l.id,
        name: l.name,
        code: l.code,
        warehouseId: l.warehouseId,
        warehouseCode: s.warehouses.code,
        isActive: l.isActive,
        meta: l.meta,
        version: l.version,
      })
      .from(l)
      .leftJoin(s.warehouses, eq(s.warehouses.id, l.warehouseId))
      .where(eq(l.type, 'location_zone'))
      .orderBy(s.warehouses.code, l.name)
  )
    .filter((z) => !z.warehouseId || hasWarehouse(auth.scope, z.warehouseId))
    .map((z) => ({
      id: z.id,
      name: z.name,
      code: z.code,
      warehouseId: z.warehouseId,
      warehouseCode: z.warehouseCode ?? null,
      isActive: z.isActive,
      version: z.version,
      productGroupIds: zoneGroupIds(z.meta as Record<string, unknown> | null),
    }));
  const groups = (
    await db
      .select({
        id: l.id,
        name: l.name,
        clientId: l.clientId,
        clientName: s.clients.name,
        isActive: l.isActive,
      })
      .from(l)
      .leftJoin(s.clients, eq(s.clients.id, l.clientId))
      .where(eq(l.type, 'product_group'))
      .orderBy(l.name)
  )
    .filter((g) => !g.clientId || hasClient(auth.scope, g.clientId))
    .map((g) => ({ id: g.id, name: g.name, clientName: g.clientName ?? null, isActive: g.isActive }));
  return { zones, groups };
}

export async function setZoneProductGroups(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: ZoneGroupsSave,
): Promise<{ updated: number }> {
  const { zones, groups } = await zoneProductGroups(tx, auth);
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const ctx = domainCtxOf(actor, auth);
  let updated = 0;
  for (const a of input.assignments) {
    const zone = zoneById.get(a.zoneId);
    if (!zone) throw new AppError('NOT_FOUND', 'Location zone not found');
    const unknown = a.productGroupIds.find((id) => !groupName.has(id));
    if (unknown)
      throw new AppError('VALIDATION', 'A selected product group no longer exists', {
        fieldErrors: { [`zone.${a.zoneId}`]: ['Product group not found'] },
      });
    const next = [...new Set(a.productGroupIds)];
    if (sameIdSet(zone.productGroupIds, next)) continue;
    const row = (
      await tx
        .select({ meta: l.meta })
        .from(l)
        .where(and(eq(l.id, zone.id), eq(l.type, 'location_zone')))
        .limit(1)
    )[0];
    const meta = { ...((row?.meta as Record<string, unknown> | null) ?? {}), productGroupIds: next };
    await tx
      .update(l)
      .set({
        meta,
        updatedBy: actor.userId,
        updatedAt: new Date().toISOString(),
        version: sql`${l.version} + 1`,
      })
      .where(eq(l.id, zone.id));
    const names = (ids: readonly string[]) =>
      ids
        .map((id) => groupName.get(id) ?? id)
        .sort()
        .join(', ') || 'None';
    await logUpdate(
      tx,
      ctx,
      { entityType: LOOKUP_ENTITY, entityId: zone.id, entityCode: `Location Zone ${zone.name}` },
      { productGroups: names(zone.productGroupIds) },
      { productGroups: names(next) },
    );
    updated += 1;
  }
  return { updated };
}

/** Zone ids that store `productGroupId` (put-away / picking consumers). */
export async function zonesForProductGroup(db: AppDb, productGroupId: string): Promise<string[]> {
  return (
    await db
      .select({ id: l.id, meta: l.meta })
      .from(l)
      .where(and(eq(l.type, 'location_zone'), eq(l.isActive, true)))
  )
    .filter((z) => zoneGroupIds(z.meta as Record<string, unknown> | null).includes(productGroupId))
    .map((z) => z.id);
}
