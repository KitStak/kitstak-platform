/**
 * The replay "world": every reference built by the setup steps plus the event queue and
 * the small amount of simulation state the replay needs (orders created so far, counters).
 */
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import type { DomainCtx, Tx } from '@/server/domain/types';
import type { OrderPlan, WarehouseCode } from '../seed-orders';
import type { AccessRefs } from './access';
import type { CatalogRefs } from './catalog';
import type { ConfigRefs } from './config';
import type { FacilityRefs, WarehouseFacility } from './facility';
import type { CarrierRefs, ChannelRefs } from './integrations';
import type { LookupRefs } from './lookups';
import type { OrgRefs } from './org';
import type { EventQueue } from './queue';
import type { Id, SeedEnv, SeedUser } from './types';
import { actor } from './types';

export interface OrderRuntime {
  readonly plan: OrderPlan;
  readonly id: Id;
  readonly code: string;
}

export interface SeedCounters {
  events: number;
  failures: number;
  readonly failureSamples: string[];
}

export interface World {
  readonly env: SeedEnv;
  readonly queue: EventQueue;
  readonly endMs: number;
  readonly org: OrgRefs;
  readonly access: AccessRefs;
  readonly lookups: LookupRefs;
  readonly catalog: CatalogRefs;
  readonly facility: FacilityRefs;
  readonly carriers: CarrierRefs;
  readonly channels: ChannelRefs;
  readonly config: ConfigRefs;
  /** Orders created so far, by plan key. */
  readonly orders: Map<number, OrderRuntime>;
  readonly counters: SeedCounters;
}

export const facilityOf = (w: World, code: WarehouseCode): WarehouseFacility => w.facility[code];

export const warehouseCodeOf = (w: World, warehouseId: Id): WarehouseCode =>
  warehouseId === w.org.ks2 ? 'KS2' : 'MLT1';

/** Picks an operator for the warehouse deterministically from a number. */
export function operatorFor(w: World, code: WarehouseCode, n: number): SeedUser {
  const list = w.access.operators[code];
  return list.length > 0 ? list[Math.abs(n) % list.length] : w.access.manager;
}

export const managerCtx = (w: World): DomainCtx => actor(w.access.manager);
export const adminCtx = (w: World): DomainCtx => actor(w.access.admin);

export async function orderStatus(
  tx: Tx,
  orderId: Id,
): Promise<(typeof schema.shipmentOrders.$inferSelect)['status'] | null> {
  return (
    (
      await tx
        .select({ status: schema.shipmentOrders.status })
        .from(schema.shipmentOrders)
        .where(eq(schema.shipmentOrders.id, orderId))
        .limit(1)
    )[0]?.status ?? null
  );
}

/** Records a replay step that the domain rejected (kept for the seed report; the replay continues). */
export function noteFailure(w: World, label: string, error: unknown): void {
  w.counters.failures += 1;
  if (w.counters.failureSamples.length < 25) {
    const message = error instanceof Error ? error.message : String(error);
    w.counters.failureSamples.push(`${label}: ${message}`);
  }
}
