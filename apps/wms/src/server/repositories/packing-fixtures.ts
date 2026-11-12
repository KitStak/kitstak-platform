/**
 * M04 station fixtures for the standard dataset (`npm run db:fixtures`, chained into `db:reset`),
 * idempotent and safe on a live dev database. In MLT1 it makes sure there is, ready to pack:
 *   - TOTE  : an order picked into a tote LP parked at PACK-01            → "Scan a Tote"
 *   - LOC   : an order picked into plain location stock at PACK-02         → "Scan a Location"
 *   - CART  : an order picked to PACK-03 and sat in a cell of cart MC-01   → "Scan a Putwall/Mobile Cart"
 *   - ORDER : an order picked to PACK-04                                   → List and Select / Scan an Order
 * and a hospital:
 *   - HOSP-01 in the "Hospital" location group (Storage, Shelves, Prevent Allocation)
 *   - SHORT : an order whose picked stock went to HOSP-01 through Report Issue (Pack Short: Open)
 *
 * Fixture orders carry store order # `KS-FIX-M04-<TAG>-<n>`. A tag is re-created only when no order
 * of that tag is still packable, so re-running tops the set up without duplicates. Every stock move
 * goes through the domain (allocation, task execute, ledger), so `npm run db:verify` stays green.
 * Each fixture runs in its own savepoint: one that cannot be staged (e.g. no free stock) is reported
 * and skipped instead of failing the whole fixture run.
 */
import { and, eq, inArray, isNull, ilike, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import * as schema from '@/server/db/schema';
import { licensePlates } from '@/server/domain';
import { allocateOrders } from '@/server/domain/allocation';
import { createJobsFromOrders } from '@/server/domain/jobs';
import { createOrder } from '@/server/domain/orders';
import { execute } from '@/server/domain/tasks';
import type { DomainCtx } from '@/server/domain/types';
import { HOSPITAL_GROUP_NAME } from './packing-hospitals';
import { reportIssue } from './packing';
import type { ScopedCtx } from './returns';
import { dbGet, mapSeq, withWriteTx } from '@/server/db/sql';

export const STATION_FIXTURE_WAREHOUSE = 'MLT1';
export const STATION_FIXTURE_PREFIX = 'KS-FIX-M04';
export const HOSPITAL_FIXTURE_CODE = 'HOSP-01';
const SKUS = ['APX-TEE-WHT-M', 'APX-TEE-NVY-M'] as const;
const PACKABLE = ['Ready to Pack', 'Packing Started'] as const;

export type StationFixtureTag = 'TOTE' | 'LOC' | 'CART' | 'ORDER' | 'SHORT';

export interface StationFixtureReport {
  readonly created: string[];
  readonly skipped: string[];
  /** Tag → "SO… in tote LP…" etc. */
  readonly fixtures: Partial<Record<StationFixtureTag, string>>;
}

/** The "Hospital" location group of the warehouse (lookup `location_group`), created when missing. */
export async function ensureHospitalGroup(
  tx: AppDb,
  warehouseId: string,
  created: string[],
): Promise<string> {
  const lv = schema.lookupValues;
  const found = (
    await tx
      .select({ id: lv.id })
      .from(lv)
      .where(
        and(
          eq(lv.type, 'location_group'),
          sql`lower(${lv.name}) = ${HOSPITAL_GROUP_NAME.toLowerCase()}`,
          eq(lv.warehouseId, warehouseId),
          isNull(lv.clientId),
        ),
      )
      .limit(1)
  )[0];
  if (found) return found.id;
  const row = (
    await tx
      .insert(lv)
      .values({
        type: 'location_group',
        name: HOSPITAL_GROUP_NAME,
        code: 'HOSPITAL',
        warehouseId,
        isActive: true,
        sortOrder: 90,
      })
      .returning({ id: lv.id })
  )[0];
  created.push(`location group ${HOSPITAL_GROUP_NAME}`);
  return row.id;
}

/** HOSP-01 in the Hospital group (allocation-locked Storage shelf). Existing rows are moved into the group. */
export async function ensureHospitalLocation(
  tx: AppDb,
  warehouseId: string,
  created: string[],
  skipped: string[],
): Promise<{ id: string; code: string }> {
  const groupId = await ensureHospitalGroup(tx, warehouseId, created);
  const existing = (
    await tx
      .select()
      .from(schema.locations)
      .where(
        and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.code, HOSPITAL_FIXTURE_CODE)),
      )
      .limit(1)
  )[0];
  if (existing) {
    if (existing.locationGroupId !== groupId || !existing.isActive) {
      await tx
        .update(schema.locations)
        .set({ locationGroupId: groupId, isActive: true })
        .where(eq(schema.locations.id, existing.id));
      created.push(`${HOSPITAL_FIXTURE_CODE} moved into the ${HOSPITAL_GROUP_NAME} group`);
    } else skipped.push(`location ${HOSPITAL_FIXTURE_CODE}`);
    return { id: existing.id, code: existing.code };
  }
  const row = (
    await tx
      .insert(schema.locations)
      .values({
        warehouseId,
        code: HOSPITAL_FIXTURE_CODE,
        zone: 'HOSP',
        aisle: '01',
        bay: '01',
        level: '01',
        type: 'Damaged',
        capacityUnits: 1000,
        areaType: 'Storage',
        locationType: 'Shelves',
        preventAllocation: true,
        barcode: HOSPITAL_FIXTURE_CODE,
        locationGroupId: groupId,
      })
      .returning()
  )[0];
  created.push(`location ${HOSPITAL_FIXTURE_CODE} (Hospital group)`);
  return { id: row.id, code: row.code };
}

/** Seeds / tops up the M04 station fixtures. Run inside a transaction (each fixture gets a savepoint). */
export async function seedStationFixtures(tx: AppDb, base: DomainCtx): Promise<StationFixtureReport> {
  const created: string[] = [];
  const skipped: string[] = [];
  const fixtures: Partial<Record<StationFixtureTag, string>> = {};
  const wh = (
    await tx
      .select()
      .from(schema.warehouses)
      .where(eq(schema.warehouses.code, STATION_FIXTURE_WAREHOUSE))
      .limit(1)
  )[0];
  if (!wh) {
    skipped.push(`station fixtures: warehouse ${STATION_FIXTURE_WAREHOUSE} not found`);
    return { created, skipped, fixtures };
  }
  const ctx: ScopedCtx = { ...base, scope: { warehouseIds: [wh.id], clientIds: 'all' } } as ScopedCtx;
  const hosp = await ensureHospitalLocation(tx, wh.id, created, skipped);

  const loc = async (code: string) =>
    (
      await tx
        .select()
        .from(schema.locations)
        .where(and(eq(schema.locations.warehouseId, wh.id), eq(schema.locations.code, code)))
        .limit(1)
    )[0];
  const products = await mapSeq(
    SKUS,
    async (sku) => (await tx.select().from(schema.products).where(eq(schema.products.sku, sku)).limit(1))[0],
  );
  const [pa, pb] = products;
  const jobType =
    (
      await tx
        .select()
        .from(schema.jobTypes)
        .where(and(eq(schema.jobTypes.warehouseId, wh.id), eq(schema.jobTypes.code, 'Multi Item Orders')))
        .limit(1)
    )[0] ??
    (
      await tx
        .select()
        .from(schema.jobTypes)
        .where(and(eq(schema.jobTypes.warehouseId, wh.id), eq(schema.jobTypes.operationType, 'Picking')))
        .limit(1)
    )[0];
  if (!pa || !pb || !jobType) {
    skipped.push(
      `station orders: ${!pa || !pb ? `products ${SKUS.join(', ')}` : 'a picking job type'} missing in ${STATION_FIXTURE_WAREHOUSE}`,
    );
    return { created, skipped, fixtures };
  }

  const live = async (tag: StationFixtureTag) =>
    (
      await tx
        .select({
          id: schema.shipmentOrders.id,
          code: schema.shipmentOrders.code,
          ps: schema.shipmentOrders.packShortStatus,
        })
        .from(schema.shipmentOrders)
        .where(
          and(
            eq(schema.shipmentOrders.warehouseId, wh.id),
            ilike(schema.shipmentOrders.storeOrderNumber, `${STATION_FIXTURE_PREFIX}-${tag}-%`),
            inArray(schema.shipmentOrders.status, [...PACKABLE]),
          ),
        )
    ).filter((o) => (tag === 'SHORT' ? o.ps === 'Open' : o.ps !== 'Open'));

  /** Creates, allocates and picks a fixture order to a target (location, optionally into an LP). */
  const staged = async (
    t: AppDb,
    tag: StationFixtureTag,
    targetLocationId: string,
    targetLpId: string | null,
  ): Promise<{ id: string; code: string }> => {
    const n =
      (
        await t
          .select({ id: schema.shipmentOrders.id })
          .from(schema.shipmentOrders)
          .where(ilike(schema.shipmentOrders.storeOrderNumber, `${STATION_FIXTURE_PREFIX}-${tag}-%`))
      ).length + 1;
    const order = await createOrder(t, ctx, {
      warehouseId: wh.id,
      clientId: pa.clientId,
      customerName: 'Hannah Brooks',
      customerEmail: 'hannah.brooks@example.com',
      shipAddress: '418 Maple Ridge Rd',
      shipCity: 'Nashville',
      shipState: 'Tennessee',
      shipZip: '37209',
      shipCountry: 'USA',
      storeOrderNumber: `${STATION_FIXTURE_PREFIX}-${tag}-${n}`,
      lines: [
        { productId: pa.id, quantity: 2, unitPrice: 18 },
        { productId: pb.id, quantity: 1, unitPrice: 18 },
      ],
    } as never);
    await allocateOrders(t, ctx, { orderIds: [order.id], warehouseId: wh.id });
    const { jobIds } = await createJobsFromOrders(t, ctx, { orderIds: [order.id], jobTypeId: jobType.id });
    const picks = (
      await t
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            inArray(schema.tasks.jobId, jobIds),
            eq(schema.tasks.orderId, order.id),
            eq(schema.tasks.taskType, 'Picking'),
          ),
        )
    ).map((r) => r.id);
    if (picks.length === 0)
      throw new Error(
        `no picking tasks for the ${tag} order (not enough free stock of ${SKUS.join(' / ')}?)`,
      );
    await execute(t, ctx, { taskIds: picks, targetLocationId, ...(targetLpId ? { targetLpId } : {}) });
    const row = (
      await t
        .select({ code: schema.shipmentOrders.code })
        .from(schema.shipmentOrders)
        .where(eq(schema.shipmentOrders.id, order.id))
        .limit(1)
    )[0];
    return { id: order.id, code: row?.code ?? order.id };
  };

  /** One fixture in its own savepoint: a failure is reported, not fatal. */
  const attempt = async (tag: StationFixtureTag, fn: (t: AppDb) => Promise<string>) => {
    try {
      fixtures[tag] = await withWriteTx(tx, async (t) => await fn(t));
      created.push(`${tag.toLowerCase()} fixture ${fixtures[tag]}`);
    } catch (error) {
      skipped.push(
        `${tag.toLowerCase()} fixture not staged: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const station = async (code: string) => {
    const l = await loc(code);
    if (!l) throw new Error(`location ${code} not found in ${STATION_FIXTURE_WAREHOUSE}`);
    return l.id;
  };

  // TOTE: a fresh tote LP at PACK-01.
  const toteOrder = (await live('TOTE'))[0];
  if (toteOrder) {
    const lp = await dbGet<{ number: string }>(
      tx,
      sql`SELECT DISTINCT lp.number FROM inventory_allocations a JOIN inventory i ON i.id = a.inventory_id
      JOIN license_plates lp ON lp.id = i.lp_id WHERE a.order_id = ${toteOrder.id} LIMIT 1`,
    );
    fixtures.TOTE = `${toteOrder.code}${lp ? ` in tote ${lp.number}` : ''}`;
    skipped.push(`tote fixture ${fixtures.TOTE}`);
  } else
    await attempt('TOTE', async (t) => {
      const lpType =
        (
          await t
            .select()
            .from(schema.lpTypes)
            .where(and(eq(schema.lpTypes.warehouseId, wh.id), eq(schema.lpTypes.code, 'KS-CRIT-TOTE')))
            .limit(1)
        )[0] ??
        (await t.select().from(schema.lpTypes).where(eq(schema.lpTypes.warehouseId, wh.id)).limit(1))[0];
      if (!lpType) throw new Error(`no LP type in ${STATION_FIXTURE_WAREHOUSE}`);
      const lp = await licensePlates.create(t, ctx, {
        warehouseId: wh.id,
        lpTypeId: lpType.id,
        locationId: await station('PACK-01'),
      });
      return `${(await staged(t, 'TOTE', await station('PACK-01'), lp.id)).code} in tote ${lp.number}`;
    });

  for (const [tag, code] of [
    ['LOC', 'PACK-02'],
    ['ORDER', 'PACK-04'],
  ] as const) {
    const o = (await live(tag))[0];
    if (o) {
      fixtures[tag] = `${o.code} at ${code}`;
      skipped.push(`${tag.toLowerCase()} fixture ${fixtures[tag]}`);
    } else
      await attempt(tag, async (t) => `${(await staged(t, tag, await station(code), null)).code} at ${code}`);
  }
  // The location fixture carries a Packing Warning Type, so the warning dialog and its KPI are demonstrable.
  const warning = (
    await tx
      .select({ id: schema.lookupValues.id, name: schema.lookupValues.name })
      .from(schema.lookupValues)
      .where(
        and(eq(schema.lookupValues.type, 'packing_warning_type'), eq(schema.lookupValues.isActive, true)),
      )
      .orderBy(schema.lookupValues.sortOrder)
      .limit(1)
  )[0];
  const locOrder = (await live('LOC'))[0];
  if (warning && locOrder) {
    const row = (
      await tx
        .select({ w: schema.shipmentOrders.packingWarningTypeId })
        .from(schema.shipmentOrders)
        .where(eq(schema.shipmentOrders.id, locOrder.id))
        .limit(1)
    )[0];
    if (!row?.w) {
      await tx
        .update(schema.shipmentOrders)
        .set({ packingWarningTypeId: warning.id, version: sql`${schema.shipmentOrders.version} + 1` })
        .where(eq(schema.shipmentOrders.id, locOrder.id));
      created.push(`packing warning "${warning.name}" on ${locOrder.code}`);
    }
  }

  // CART: stage at PACK-03, then sit it in the first free cell of MC-01 (no API sorts into a putwall outside a job).
  const cart = (
    await tx
      .select()
      .from(schema.mobileCarts)
      .where(and(eq(schema.mobileCarts.warehouseId, wh.id), eq(schema.mobileCarts.code, 'MC-01')))
      .limit(1)
  )[0];
  if (!cart) skipped.push(`cart fixture: mobile cart MC-01 not found in ${STATION_FIXTURE_WAREHOUSE}`);
  else {
    const seat = async (t: AppDb, orderId: string): Promise<string> => {
      const cells = await t
        .select()
        .from(schema.mobileCartCells)
        .where(eq(schema.mobileCartCells.cartId, cart.id));
      const mine = cells.find((c) => c.orderId === orderId);
      if (mine) return mine.barcode;
      const free = cells
        .filter((c) => !c.orderId)
        .sort((a, b) => a.level - b.level || a.column - b.column)[0];
      if (!free) throw new Error(`cart ${cart.code} has no free cell`);
      await t.update(schema.mobileCartCells).set({ orderId }).where(eq(schema.mobileCartCells.id, free.id));
      return free.barcode;
    };
    const o = (await live('CART'))[0];
    if (o) {
      const cell = await withWriteTx(tx, async (t) => await seat(t, o.id));
      fixtures.CART = `${o.code} in ${cart.code} cell ${cell}`;
      skipped.push(`cart fixture ${fixtures.CART}`);
    } else
      await attempt('CART', async (t) => {
        const s = await staged(t, 'CART', await station('PACK-03'), null);
        return `${s.code} in ${cart.code} cell ${await seat(t, s.id)}`;
      });
  }

  // SHORT: a pack-short order held in HOSP-01 via Report Issue.
  const short = (await live('SHORT'))[0];
  if (short) {
    fixtures.SHORT = `${short.code} held in ${hosp.code}`;
    skipped.push(`short fixture ${fixtures.SHORT}`);
  } else
    await attempt('SHORT', async (t) => {
      const o = await staged(t, 'SHORT', await station('PACK-04'), null);
      await reportIssue(t, ctx, {
        orderId: o.id,
        hospitalLocationId: hosp.id,
        note: 'Fixture: outer carton crushed at pack-out',
      });
      return `${o.code} held in ${hosp.code}`;
    });
  return { created, skipped, fixtures };
}
