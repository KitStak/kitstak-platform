/**
 * Algorithms repository (M12, spec 06 §2–§4): putaway/allocation lists, editor load/save with
 * the dynamic-replenishment exclusivity rules, guarded delete, Test Algorithm (putaway) and the
 * allocation Dry Run. Tests and dry runs execute the real foundation engines in a savepoint that
 * is always rolled back, so drafts can be tested before saving.
 */
import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient } from '@/server/auth/scope';
import * as s from '@/server/db/schema';
import { allocateOrders } from '@/server/domain/allocation';
import { runBulk } from '@/server/domain/bulk';
import { suggestLocations, type SuggestResult } from '@/server/domain/putaway';
import type { BulkResult } from '@/server/domain/types';
import { paginate } from '@/server/query/paginate';
import type { GridQuery } from '@/server/query/grid-query';
import {
  ALGORITHM_FIELDS,
  ALGORITHM_SEARCH_FIELDS,
  ALGORITHM_SORT_FIELDS,
  type AlgorithmRuleSave,
  type AlgorithmSave,
} from '@/lib/grid-defs/integrations/algorithms';
import {
  assertFound,
  assertVersion,
  assertWarehouseInScope,
  compileGrid,
  domainCtxOf,
  dryRun,
  duplicateError,
  fieldError,
  labelsOf,
  listScope,
  logCreate,
  logDelete,
  logUpdate,
  type Actor,
  type GridBinding,
} from './integration-logs-kit';
import { mapSeq } from '@/server/db/sql';

const t = s.algorithms;
const r = s.algorithmRules;
const ENTITY = 'algorithm';
type AlgoRow = typeof t.$inferSelect;
type Kind = AlgoRow['kind'];

const ruleCountSql = sql<number>`(SELECT COUNT(*) FROM algorithm_rules ar WHERE ar.algorithm_id = "algorithms"."id")`;
const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = "algorithms"."warehouse_id")`;

const BINDING: GridBinding = {
  exprs: {
    name: sql`${t.name}`,
    warehouseId: sql`${t.warehouseId}`,
    warehouseCode: warehouseCodeSql,
    status: sql`${t.status}`,
    isDynamicReplenishment: sql`${t.isDynamicReplenishment}`,
    ruleCount: ruleCountSql,
    updatedAt: sql`${t.updatedAt}`,
  },
  fields: ALGORITHM_FIELDS,
  sortable: ALGORITHM_SORT_FIELDS,
  search: ALGORITHM_SEARCH_FIELDS,
  defaultSort: [{ field: 'name', dir: 'asc' }],
  tiebreaker: t.id,
};

export interface AlgorithmRow {
  readonly id: string;
  readonly name: string;
  readonly kind: Kind;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly status: 'Active' | 'Passive';
  readonly isDynamicReplenishment: boolean;
  readonly enforceSuggestedLocations: boolean;
  readonly isSystem: boolean;
  readonly ruleCount: number;
  readonly inUse: string | null;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AlgorithmDetail extends AlgorithmRow {
  readonly rules: readonly (AlgorithmRuleSave & { readonly id: string; readonly sequence: number })[];
  /** Another active replenishment algorithm exists in the warehouse (drives the info box). */
  readonly otherReplenishment: { readonly id: string; readonly name: string } | null;
}

/** Why an algorithm can't be deleted (null = deletable). */
async function inUseReason(
  db: AppDb,
  a: Pick<AlgoRow, 'id' | 'kind' | 'isSystem' | 'isDynamicReplenishment' | 'status' | 'warehouseId'>,
): Promise<string | null> {
  if (a.isSystem) return "System algorithms can't be deleted; set them passive instead";
  if (a.kind === 'Allocation') {
    const jt = (
      await db
        .select({ code: s.jobTypes.code })
        .from(s.jobTypes)
        .where(eq(s.jobTypes.allocationAlgorithmId, a.id))
        .limit(1)
    )[0];
    if (jt) return `Used by job type ${jt.code}`;
  }
  if (a.kind === 'Putaway' && a.isDynamicReplenishment && a.status === 'Active') {
    const others = await db
      .select({ id: t.id })
      .from(t)
      .where(
        and(
          eq(t.warehouseId, a.warehouseId),
          eq(t.kind, 'Putaway'),
          eq(t.isDynamicReplenishment, true),
          eq(t.status, 'Active'),
          ne(t.id, a.id),
        ),
      );
    if (others.length === 0) return 'At least one replenishment algorithm must stay active';
  }
  return null;
}

async function toRow(db: AppDb, a: AlgoRow, ruleCount: number, warehouseCode: string): Promise<AlgorithmRow> {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    warehouseId: a.warehouseId,
    warehouseCode,
    status: a.status,
    isDynamicReplenishment: a.isDynamicReplenishment,
    enforceSuggestedLocations: a.enforceSuggestedLocations,
    isSystem: a.isSystem,
    ruleCount,
    inUse: await inUseReason(db, a),
    updatedAt: a.updatedAt,
    version: a.version,
  };
}

export async function listAlgorithms(
  db: AppDb,
  auth: AuthContext,
  kind: Kind,
  query: GridQuery,
): Promise<{ rows: AlgorithmRow[]; total: number }> {
  const grid = compileGrid(BINDING, query, [
    listScope(t, auth, { warehouseId: t.warehouseId }),
    eq(t.kind, kind),
  ]);
  const result = await paginate(
    db
      .select({ a: t, ruleCount: ruleCountSql, warehouseCode: warehouseCodeSql })
      .from(t)
      .where(grid.where)
      .orderBy(...grid.orderBy)
      .$dynamic(),
    async () =>
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(t)
          .where(grid.where)
          .limit(1)
      )[0]?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return {
    rows: await mapSeq(result.rows, async (x) => await toRow(db, x.a, Number(x.ruleCount), x.warehouseCode)),
    total: result.total,
  };
}

export async function loadAlgorithm(db: AppDb, auth: AuthContext, id: string): Promise<AlgoRow> {
  const row = assertFound((await db.select().from(t).where(eq(t.id, id)).limit(1))[0], 'Algorithm');
  assertWarehouseInScope(auth, row.warehouseId, 'Algorithm');
  return row;
}

async function loadRules(db: AppDb, id: string): Promise<AlgorithmDetail['rules']> {
  return (await db.select().from(r).where(eq(r.algorithmId, id)).orderBy(asc(r.sequence))).map((x) => ({
    id: x.id,
    sequence: x.sequence,
    name: x.name,
    isActive: x.isActive,
    conditions: x.conditions,
    inventoryConditions: x.inventoryConditions ?? [],
    actions: (x.actions ?? []).map((a) => ({ action: a.action, value: a.value })),
    orderBy: x.orderBy,
  }));
}

export async function getAlgorithm(db: AppDb, auth: AuthContext, id: string): Promise<AlgorithmDetail> {
  const a = await loadAlgorithm(db, auth, id);
  const rules = await loadRules(db, id);
  const wh = (await labelsOf(db, 'warehouses', [a.warehouseId])).get(a.warehouseId) ?? '';
  const other =
    a.kind === 'Putaway'
      ? ((
          await db
            .select({ id: t.id, name: t.name })
            .from(t)
            .where(
              and(
                eq(t.warehouseId, a.warehouseId),
                eq(t.kind, 'Putaway'),
                eq(t.isDynamicReplenishment, true),
                eq(t.status, 'Active'),
                ne(t.id, a.id),
              ),
            )
            .limit(1)
        )[0] ?? null)
      : null;
  return { ...(await toRow(db, a, rules.length, wh)), rules, otherReplenishment: other };
}

/* ---------------- save ---------------- */

async function snapshot(
  db: AppDb,
  a: Pick<
    AlgoRow,
    'name' | 'warehouseId' | 'status' | 'isDynamicReplenishment' | 'enforceSuggestedLocations'
  >,
  rules: readonly AlgorithmRuleSave[],
) {
  return {
    name: a.name,
    warehouse: (await labelsOf(db, 'warehouses', [a.warehouseId])).get(a.warehouseId) ?? a.warehouseId,
    status: a.status,
    dynamicReplenishment: a.isDynamicReplenishment,
    enforceSuggestedLocations: a.enforceSuggestedLocations,
    rules:
      rules
        .map((x, i) => `${i === 0 ? 'If' : `${i}. If else`} ${x.name}${x.isActive ? '' : ' (off)'}`)
        .join(' · ') || 'None',
  };
}

async function writeRules(
  tx: AppDb,
  algorithmId: string,
  rules: readonly AlgorithmRuleSave[],
  kind: Kind,
): Promise<void> {
  await tx.delete(r).where(eq(r.algorithmId, algorithmId));
  if (rules.length === 0) return;
  await tx.insert(r).values(
    rules.map((x, i) => ({
      algorithmId,
      sequence: i + 1,
      name: x.name,
      isActive: x.isActive,
      conditions: x.conditions,
      inventoryConditions: kind === 'Allocation' ? x.inventoryConditions : null,
      actions:
        kind === 'Putaway'
          ? x.actions.map((a) =>
              a.value === undefined || a.value === null || a.value === ''
                ? { action: a.action }
                : { action: a.action, value: a.value },
            )
          : null,
      orderBy: x.orderBy,
    })),
  );
}

/**
 * Dynamic replenishment exclusivity (spec 06 §3): enabling it on one algorithm makes the other
 * active replenishment algorithms of the warehouse passive; the last active one can't be switched off.
 */
async function applyReplenishmentRules(
  tx: AppDb,
  actor: Actor,
  auth: AuthContext,
  id: string | null,
  body: AlgorithmSave,
  before: AlgoRow | null,
): Promise<string[]> {
  const notes: string[] = [];
  if (body.kind !== 'Putaway') return notes;
  const others = await tx
    .select()
    .from(t)
    .where(
      and(
        eq(t.warehouseId, body.warehouseId),
        eq(t.kind, 'Putaway'),
        eq(t.isDynamicReplenishment, true),
        eq(t.status, 'Active'),
        id ? ne(t.id, id) : sql`1 = 1`,
      ),
    );
  const wasActiveRepl = before?.isDynamicReplenishment && before.status === 'Active';
  const isActiveRepl = body.isDynamicReplenishment && body.status === 'Active';
  if (wasActiveRepl && !isActiveRepl && others.length === 0) {
    throw fieldError(
      body.isDynamicReplenishment ? 'status' : 'isDynamicReplenishment',
      'At least one replenishment algorithm must be active. Choose another algorithm for dynamic replenishment first.',
      'INVALID_STATE',
    );
  }
  if (isActiveRepl && !wasActiveRepl) {
    const ctx = domainCtxOf(actor, auth);
    for (const o of others) {
      await tx
        .update(t)
        .set({ status: 'Passive', version: sql`${t.version} + 1` })
        .where(eq(t.id, o.id));
      await logUpdate(
        tx,
        ctx,
        { entityType: ENTITY, entityId: o.id, entityCode: o.name },
        { status: 'Active' },
        { status: 'Passive' },
      );
      notes.push(`${o.name} is now passive because ${body.name} handles dynamic replenishment.`);
    }
  }
  return notes;
}

async function assertUniqueName(tx: AppDb, body: AlgorithmSave, id: string | null): Promise<void> {
  const dup = (
    await tx
      .select({ id: t.id })
      .from(t)
      .where(
        and(
          eq(t.warehouseId, body.warehouseId),
          eq(t.kind, body.kind),
          sql`lower(${t.name}) = lower(${body.name})`,
          id ? ne(t.id, id) : sql`1 = 1`,
        ),
      )
      .limit(1)
  )[0];
  if (dup)
    throw duplicateError(
      'name',
      `An ${body.kind.toLowerCase()} algorithm named "${body.name}" already exists in this warehouse`,
    );
}

export interface SaveResult {
  readonly algorithm: AlgorithmDetail;
  readonly notes: readonly string[];
}

export async function createAlgorithm(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  body: AlgorithmSave,
): Promise<SaveResult> {
  assertWarehouseInScope(auth, body.warehouseId);
  await assertUniqueName(tx, body, null);
  const notes = await applyReplenishmentRules(tx, actor, auth, null, body, null);
  const row = (
    await tx
      .insert(t)
      .values({
        name: body.name,
        warehouseId: body.warehouseId,
        kind: body.kind,
        status: body.status,
        isDynamicReplenishment: body.kind === 'Putaway' && body.isDynamicReplenishment,
        enforceSuggestedLocations: body.kind === 'Putaway' && body.enforceSuggestedLocations,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning()
  )[0];
  await writeRules(tx, row.id, body.rules, body.kind);
  await logCreate(tx, domainCtxOf(actor, auth), {
    entityType: ENTITY,
    entityId: row.id,
    entityCode: row.name,
  });
  return { algorithm: await getAlgorithm(tx, auth, row.id), notes };
}

export async function updateAlgorithm(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  id: string,
  body: AlgorithmSave,
): Promise<SaveResult> {
  const before = await loadAlgorithm(tx, auth, id);
  assertVersion(before.version, body.version);
  if (before.kind !== body.kind) throw fieldError('kind', "An algorithm's type can't change");
  if (before.warehouseId !== body.warehouseId)
    throw fieldError('warehouseId', "An algorithm can't move to another warehouse");
  if (before.isSystem && body.name !== before.name)
    throw fieldError('name', 'System algorithms keep their name');
  await assertUniqueName(tx, body, id);
  const oldRules = await loadRules(tx, id);
  const notes = await applyReplenishmentRules(tx, actor, auth, id, body, before);
  await tx
    .update(t)
    .set({
      name: body.name,
      status: body.status,
      isDynamicReplenishment: body.kind === 'Putaway' && body.isDynamicReplenishment,
      enforceSuggestedLocations: body.kind === 'Putaway' && body.enforceSuggestedLocations,
      updatedBy: actor.userId,
      version: sql`${t.version} + 1`,
    })
    .where(eq(t.id, id));
  await writeRules(tx, id, body.rules, body.kind);
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    { entityType: ENTITY, entityId: id, entityCode: body.name },
    await snapshot(tx, before, oldRules),
    await snapshot(tx, { ...body }, body.rules),
  );
  return { algorithm: await getAlgorithm(tx, auth, id), notes };
}

export async function deleteAlgorithms(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ids: readonly string[],
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const a = await loadAlgorithm(inner, auth, id);
    const reason = await inUseReason(inner, a);
    if (reason) throw new AppError('INVALID_STATE', `${a.name}: ${reason}`);
    await inner.delete(t).where(eq(t.id, id));
    await logDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: a.name });
  });
}

/* ---------------- test / dry run ---------------- */

async function withDraft<T>(
  db: AppDb,
  kind: Kind,
  draft: { warehouseId: string; rules: readonly AlgorithmRuleSave[] } | undefined,
  algorithmId: string | null,
  fn: (tx: AppDb, algorithmId: string | null) => T,
): Promise<T> {
  if (!draft) return await dryRun(db, async (tx) => await fn(tx, algorithmId));
  return await dryRun(db, async (tx) => {
    const tmp = (
      await tx
        .insert(t)
        .values({
          name: `__draft_${crypto.randomUUID()}`,
          warehouseId: draft.warehouseId,
          kind,
          status: 'Active',
        })
        .returning()
    )[0];
    await writeRules(tx, tmp.id, draft.rules, kind);
    return await fn(tx, tmp.id);
  });
}

export interface PutawayTestResult extends SuggestResult {
  readonly product: { readonly sku: string; readonly name: string };
  readonly suggestions: readonly (SuggestResult['suggestions'][number] & {
    readonly areaType: string | null;
    readonly zone: string | null;
    readonly onHand: number;
  })[];
}

export interface PutawayInventoryRow {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly status: string;
  readonly packType: string;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly receivedAt: string;
  readonly poNumber: string | null;
  readonly damageReason: string | null;
  readonly onHand: number;
  readonly allocated: number;
}

/** Test Algorithm › Product Putaway: the product's inventory rows in the warehouse to test from (Logiwa parity). */
export async function putawayTestInventory(
  db: AppDb,
  auth: AuthContext,
  warehouseId: string,
  productId: string,
): Promise<PutawayInventoryRow[]> {
  assertWarehouseInScope(auth, warehouseId);
  const product = assertFound(
    (
      await db
        .select({ clientId: s.products.clientId })
        .from(s.products)
        .where(eq(s.products.id, productId))
        .limit(1)
    )[0],
    'Product',
  );
  if (!hasClient(auth.scope, product.clientId)) throw new AppError('NOT_FOUND', 'Product not found');
  const i = s.inventory;
  return (
    await db
      .select({ i, code: s.locations.code, lp: s.licensePlates.number })
      .from(i)
      .innerJoin(s.locations, eq(s.locations.id, i.locationId))
      .leftJoin(s.licensePlates, eq(s.licensePlates.id, i.lpId))
      .where(and(eq(i.warehouseId, warehouseId), eq(i.productId, productId), sql`${i.onHand} > 0`))
      .orderBy(asc(s.locations.code))
      .limit(200)
  ).map(({ i: r, code, lp }) => ({
    id: r.id,
    locationId: r.locationId,
    locationCode: code,
    status: r.status,
    packType: r.packType,
    lpId: r.lpId,
    lpNumber: lp ?? null,
    lotNumber: r.lotNumber,
    expiryDate: r.expiryDate,
    productionDate: r.productionDate,
    receivedAt: r.receivedAt,
    poNumber: r.poNumber,
    damageReason: r.damageReason,
    onHand: r.onHand,
    allocated: r.allocated,
  }));
}

export async function testPutaway(
  db: AppDb,
  auth: AuthContext,
  algorithmId: string | null,
  input: {
    warehouseId: string;
    productId: string;
    qty: number;
    fromLocationId?: string | null;
    lpId?: string | null;
    isReceiving: boolean;
    lot?: string | null;
    expiry?: string | null;
    damageReason?: string | null;
    packType?: string | null;
    productionDate?: string | null;
    receivedAt?: string | null;
    allocatedQty?: number | null;
    draft?: { warehouseId: string; rules: readonly AlgorithmRuleSave[] };
  },
): Promise<PutawayTestResult> {
  assertWarehouseInScope(auth, input.warehouseId);
  const product = assertFound(
    (await db.select().from(s.products).where(eq(s.products.id, input.productId)).limit(1))[0],
    'Product',
  );
  if (!hasClient(auth.scope, product.clientId)) throw new AppError('NOT_FOUND', 'Product not found');
  const result = await withDraft(
    db,
    'Putaway',
    input.draft,
    algorithmId,
    async (tx, id) =>
      await suggestLocations(tx, {
        warehouseId: input.warehouseId,
        productId: input.productId,
        qty: input.qty,
        fromLocationId: input.fromLocationId ?? null,
        lpId: input.lpId ?? null,
        isReceiving: input.isReceiving,
        lot: input.lot ?? null,
        expiry: input.expiry ?? null,
        damageReason: input.damageReason ?? null,
        algorithmId: id,
        limit: 10,
        ...(input.packType ? { packType: input.packType } : {}),
        productionDate: input.productionDate ?? null,
        ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
        allocatedQty: input.allocatedQty ?? 0,
      }),
  );
  const ids = result.suggestions.map((x) => x.locationId);
  const locs =
    ids.length === 0
      ? []
      : await db
          .select({ id: s.locations.id, areaType: s.locations.areaType, zone: s.locations.zone })
          .from(s.locations)
          .where(inArray(s.locations.id, ids));
  const qty =
    ids.length === 0
      ? []
      : await db
          .select({ id: s.inventory.locationId, n: sql<number>`SUM(${s.inventory.onHand})` })
          .from(s.inventory)
          .where(inArray(s.inventory.locationId, ids))
          .groupBy(s.inventory.locationId);
  const byId = new Map(locs.map((l) => [l.id, l]));
  const qtyBy = new Map(qty.map((q) => [q.id, Number(q.n)]));
  return {
    ...result,
    product: { sku: product.sku, name: product.name },
    algorithm: input.draft ? 'Unsaved draft' : result.algorithm,
    suggestions: result.suggestions.map((x) => ({
      ...x,
      areaType: byId.get(x.locationId)?.areaType ?? null,
      zone: byId.get(x.locationId)?.zone ?? null,
      onHand: qtyBy.get(x.locationId) ?? 0,
    })),
  };
}

export interface DryRunLine {
  readonly sku: string;
  readonly quantity: number;
  readonly allocated: number;
  readonly buckets: readonly {
    readonly location: string;
    readonly areaType: string | null;
    readonly lp: string | null;
    readonly lot: string | null;
    readonly expiry: string | null;
    readonly qty: number;
    readonly rule: string | null;
  }[];
}

export interface DryRunResult {
  readonly orderCode: string;
  readonly algorithm: string;
  readonly outcome: 'Allocated' | 'Shortage' | 'Failed';
  readonly message: string | null;
  readonly rule: string | null;
  readonly lines: readonly DryRunLine[];
  readonly exceptions: readonly string[];
}

export async function allocationDryRun(
  db: AppDb,
  auth: AuthContext,
  algorithmId: string | null,
  input: { orderId: string; draft?: { warehouseId: string; rules: readonly AlgorithmRuleSave[] } },
  actor: Actor,
): Promise<DryRunResult> {
  const order = assertFound(
    (await db.select().from(s.shipmentOrders).where(eq(s.shipmentOrders.id, input.orderId)).limit(1))[0],
    'Shipment order',
  );
  assertWarehouseInScope(auth, order.warehouseId, 'Shipment order');
  return await withDraft(db, 'Allocation', input.draft, algorithmId, async (tx, id) => {
    const algoName = id
      ? ((await tx.select({ n: t.name }).from(t).where(eq(t.id, id)).limit(1))[0]?.n ?? 'Default')
      : 'Default';
    const res = await allocateOrders(
      tx,
      { ...domainCtxOf(actor, auth), source: 'Dry run' },
      { orderIds: [order.id], warehouseId: order.warehouseId, algorithmId: id, runBy: 'Dry run' },
    );
    const lines = await tx
      .select({ l: s.orderLines, sku: s.products.sku })
      .from(s.orderLines)
      .innerJoin(s.products, eq(s.products.id, s.orderLines.productId))
      .where(eq(s.orderLines.orderId, order.id));
    const ia = s.inventoryAllocations;
    const allocs = await tx
      .select({
        a: ia,
        loc: s.locations.code,
        areaType: s.locations.areaType,
        lot: s.inventory.lotNumber,
        expiry: s.inventory.expiryDate,
        lp: s.licensePlates.number,
      })
      .from(ia)
      .innerJoin(s.inventory, eq(s.inventory.id, ia.inventoryId))
      .innerJoin(s.locations, eq(s.locations.id, s.inventory.locationId))
      .leftJoin(s.licensePlates, eq(s.licensePlates.id, s.inventory.lpId))
      .where(and(eq(ia.orderId, order.id), eq(ia.status, 'Allocated')));
    const ex = await tx
      .select({ e: s.allocationExceptions.explanation, rule: s.allocationExceptions.algorithmRuleName })
      .from(s.allocationExceptions)
      .where(eq(s.allocationExceptions.orderId, order.id));
    const failure = res.failed[0];
    const rule = allocs.find((x) => x.a.ruleName)?.a.ruleName ?? ex.find((x) => x.rule)?.rule ?? null;
    return {
      orderCode: order.code,
      algorithm: input.draft ? 'Unsaved draft' : algoName,
      outcome: failure ? 'Failed' : res.shortage.includes(order.id) ? 'Shortage' : 'Allocated',
      message: failure?.message ?? null,
      rule,
      lines: lines.map((x) => ({
        sku: x.sku,
        quantity: x.l.quantity - x.l.cancelledQuantity,
        allocated: x.l.allocatedQuantity,
        buckets: allocs
          .filter((b) => b.a.orderLineId === x.l.id)
          .map((b) => ({
            location: b.loc,
            areaType: b.areaType,
            lp: b.lp,
            lot: b.lot,
            expiry: b.expiry,
            qty: b.a.qty,
            rule: b.a.ruleName,
          })),
      })),
      exceptions: ex.map((x) => x.e),
    };
  });
}

/** Orders a dry run can target: open orders in the algorithm's warehouse. */
export async function dryRunOrderOptions(
  db: AppDb,
  auth: AuthContext,
  warehouseId: string,
  q: string | null,
): Promise<{ id: string; code: string; label: string }[]> {
  assertWarehouseInScope(auth, warehouseId);
  const o = s.shipmentOrders;
  const conds: (SQL | undefined)[] = [
    eq(o.warehouseId, warehouseId),
    inArray(o.status, ['Open', 'Shortage']),
    sql`${o.deletedAt} IS NULL`,
  ];
  if (auth.scope.clientIds !== 'all')
    conds.push(inArray(o.clientId, auth.scope.clientIds.length > 0 ? [...auth.scope.clientIds] : ['-']));
  if (q)
    conds.push(sql`(${o.code} ILIKE ${`%${q}%`} ESCAPE '' OR ${o.customerName} ILIKE ${`%${q}%`} ESCAPE '')`);
  return (
    await db
      .select({ id: o.id, code: o.code, customer: o.customerName, units: o.totalQuantity })
      .from(o)
      .where(and(...conds))
      .orderBy(sql`${o.orderDate} DESC`)
      .limit(30)
  ).map((x) => ({ id: x.id, code: x.code, label: `${x.code} · ${x.customer}` }));
}
