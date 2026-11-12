/**
 * Data Setup lookups (M14): grid per lookup type with usage counts, create / edit with
 * type-specific `meta` (VAS calculation type, cart levels / columns / operation, merge-rule
 * criteria, damage flag), warehouse / client scoping, and an in-use guard on delete
 * (in-use values can be deactivated instead). Every write logs `change_log` ("lookup_value").
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient, hasWarehouse, type Scope } from '@/server/auth/scope';
import * as s from '@/server/db/schema';
import { runBulk } from '@/server/domain/bulk';
import type { BulkResult } from '@/server/domain/types';
import { paginate } from '@/server/query/paginate';
import type { GridQuery } from '@/server/query/grid-query';
import type { LookupType } from '@/lib/enums';
import {
  LOOKUP_FIELDS,
  LOOKUP_SEARCH_FIELDS,
  LOOKUP_SORT_FIELDS,
  lookupIssues,
  lookupMeta,
  lookupMetaDisplay,
  type LookupDef,
  type LookupSave,
} from '@/lib/grid-defs/admin/lookups';
import {
  assertVersion,
  compileGrid,
  domainCtxOf,
  duplicateError,
  logCreate,
  logDelete,
  logUpdate,
  qc,
  type Actor,
  type GridBinding,
} from './users-shared';

const l = s.lookupValues;
export const LOOKUP_ENTITY = 'lookup_value';

/** How many records point at a lookup value (by id or, for text columns, by name). */
function usageSql(type: LookupType): SQL {
  const id = qc(l.id);
  const name = qc(l.name);
  switch (type) {
    case 'product_type':
      return sql`(SELECT COUNT(*) FROM products x WHERE x.product_type_id = ${id})`;
    case 'product_group':
      return sql`(SELECT COUNT(*) FROM products x WHERE x.product_group_id = ${id})`;
    case 'location_group':
      return sql`(SELECT COUNT(*) FROM locations x WHERE x.location_group_id = ${id})`;
    case 'location_zone':
      return sql`(SELECT COUNT(*) FROM locations x WHERE x.location_zone_id = ${id})`;
    case 'vas_type':
      return sql`((SELECT COUNT(*) FROM vas_operations x WHERE x.vas_type_id = ${id}) + (SELECT COUNT(*) FROM billing_fees x WHERE x.vas_type_id = ${id}))`;
    case 'so_cancel_reason':
      return sql`(SELECT COUNT(*) FROM shipment_orders x WHERE x.cancel_reason_id = ${id})`;
    case 'so_type':
      return sql`(SELECT COUNT(*) FROM shipment_orders x WHERE x.order_type_id = ${id})`;
    case 'packing_warning_type':
      return sql`(SELECT COUNT(*) FROM shipment_orders x WHERE x.packing_warning_type_id = ${id})`;
    case 'adjustment_reason':
      return sql`(SELECT COUNT(*) FROM inventory_transactions x WHERE x.adjustment_reason_id = ${id})`;
    case 'return_reason':
      return sql`(SELECT COUNT(*) FROM return_order_lines x WHERE x.customer_return_reason_id = ${id} OR x.actual_return_reason_id = ${id})`;
    case 'mobile_cart_type':
      return sql`(SELECT COUNT(*) FROM mobile_carts x WHERE x.cart_type_id = ${id})`;
    case 'pack_type':
      return sql`(SELECT COUNT(*) FROM product_pack_types x WHERE x.pack_type = ${name})`;
    case 'po_type':
      return sql`(SELECT COUNT(*) FROM purchase_orders x WHERE x.po_type = ${name})`;
    case 'damage_reason':
      return sql`(SELECT COUNT(*) FROM inventory_transactions x WHERE x.to_damage_reason = ${name} OR x.from_damage_reason = ${name})`;
    case 'custom_carrier':
      return sql`(SELECT COUNT(*) FROM shipment_orders x WHERE x.carrier = ${name})`;
    default:
      return sql`0`;
  }
}

const statusSql = sql<string>`CASE WHEN ${qc(l.isActive)} = true THEN 'Active' ELSE 'Inactive' END`;
const warehouseCodeSql = sql<
  string | null
>`(SELECT w.code FROM warehouses w WHERE w.id = ${qc(l.warehouseId)})`;
const clientNameSql = sql<string | null>`(SELECT c.name FROM clients c WHERE c.id = ${qc(l.clientId)})`;

function binding(type: LookupType): GridBinding {
  return {
    exprs: {
      name: sql`${qc(l.name)}`,
      status: statusSql,
      warehouseId: sql`${qc(l.warehouseId)}`,
      clientId: sql`${qc(l.clientId)}`,
      usageCount: usageSql(type),
      createdAt: sql`${qc(l.createdAt)}`,
      updatedAt: sql`${qc(l.updatedAt)}`,
      sortOrder: sql`${qc(l.sortOrder)}`,
      warehouseCode: warehouseCodeSql,
      clientName: clientNameSql,
    },
    fields: LOOKUP_FIELDS,
    sortable: LOOKUP_SORT_FIELDS,
    search: LOOKUP_SEARCH_FIELDS,
    defaultSort: [
      { field: 'sortOrder', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ],
    tiebreaker: l.id,
  };
}

/** Global values plus those inside the caller's warehouse / client scope. */
function visibleIn(scope: Scope): SQL | undefined {
  const wh = scope.warehouseIds.length
    ? or(isNull(l.warehouseId), inArray(l.warehouseId, [...scope.warehouseIds]))
    : isNull(l.warehouseId);
  if (scope.clientIds === 'all') return wh;
  const client = scope.clientIds.length
    ? or(isNull(l.clientId), inArray(l.clientId, [...scope.clientIds]))
    : isNull(l.clientId);
  return and(wh, client);
}

export interface LookupGridRow {
  readonly id: string;
  readonly type: LookupType;
  readonly name: string;
  readonly code: string | null;
  readonly status: 'Active' | 'Inactive';
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly warehouseId: string | null;
  readonly warehouseCode: string | null;
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly meta: Record<string, unknown> | null;
  readonly usageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

function columns(type: LookupType) {
  return {
    id: l.id,
    type: l.type,
    name: l.name,
    code: l.code,
    isActive: l.isActive,
    sortOrder: l.sortOrder,
    warehouseId: l.warehouseId,
    clientId: l.clientId,
    meta: l.meta,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    version: l.version,
    status: statusSql,
    warehouseCode: warehouseCodeSql,
    clientName: clientNameSql,
    usageCount: usageSql(type),
  };
}

const toRow = (r: Record<string, unknown>): LookupGridRow => ({
  ...(r as unknown as LookupGridRow),
  isActive: Boolean(r.isActive),
});

export async function listLookupGrid(
  db: AppDb,
  auth: AuthContext,
  type: LookupType,
  query: GridQuery,
): Promise<{ rows: LookupGridRow[]; total: number }> {
  const grid = compileGrid(binding(type), query, [eq(l.type, type), visibleIn(auth.scope)]);
  const result = await paginate(
    db
      .select(columns(type))
      .from(l)
      .where(grid.where)
      .orderBy(...grid.orderBy)
      .$dynamic(),
    async () =>
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(l)
          .where(grid.where)
          .limit(1)
      )[0]?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as Record<string, unknown>[]).map(toRow), total: result.total };
}

/** Counters for the Data Setup side nav. */
export async function lookupCounts(db: AppDb, auth: AuthContext): Promise<Record<string, number>> {
  const rows = await db
    .select({ type: l.type, n: sql<number>`count(*)` })
    .from(l)
    .where(visibleIn(auth.scope))
    .groupBy(l.type);
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
}

export async function getLookupRow(
  db: AppDb,
  auth: AuthContext,
  type: LookupType,
  id: string,
): Promise<LookupGridRow> {
  const row = (
    await db
      .select(columns(type))
      .from(l)
      .where(and(eq(l.id, id), eq(l.type, type)))
      .limit(1)
  )[0];
  if (!row) throw notFoundError('Value');
  const r = toRow(row as Record<string, unknown>);
  if (
    (r.warehouseId && !hasWarehouse(auth.scope, r.warehouseId)) ||
    (r.clientId && !hasClient(auth.scope, r.clientId))
  )
    throw notFoundError('Value');
  return r;
}

async function validate(
  db: AppDb,
  auth: AuthContext,
  def: LookupDef,
  input: LookupSave,
  exceptId?: string,
): Promise<{ warehouseId: string | null; clientId: string | null }> {
  const issues = lookupIssues(def, input);
  if (issues.length)
    throw new AppError('VALIDATION', issues[0]!.message, {
      fieldErrors: Object.fromEntries(issues.map((i) => [i.path, [i.message]])),
    });
  const warehouseId = def.scope === 'warehouse' ? input.warehouseId : null;
  const clientId = def.scope === 'client' ? input.clientId : null;
  if (warehouseId && !hasWarehouse(auth.scope, warehouseId))
    throw new AppError('VALIDATION', 'Warehouse not found', {
      fieldErrors: { warehouseId: ['Warehouse not found'] },
    });
  if (clientId && !hasClient(auth.scope, clientId))
    throw new AppError('VALIDATION', 'Client not found', { fieldErrors: { clientId: ['Client not found'] } });
  const clash = (
    await db
      .select({ id: l.id })
      .from(l)
      .where(
        and(
          eq(l.type, def.type),
          sql`lower(${l.name}) = ${input.name.trim().toLowerCase()}`,
          warehouseId ? eq(l.warehouseId, warehouseId) : isNull(l.warehouseId),
          clientId ? eq(l.clientId, clientId) : isNull(l.clientId),
        ),
      )
      .limit(1)
  )[0];
  if (clash && clash.id !== exceptId) throw duplicateError('name', `"${input.name.trim()}" already exists`);
  if (def.hasCode && input.code) {
    const codeClash = (
      await db
        .select({ id: l.id })
        .from(l)
        .where(
          and(
            eq(l.type, def.type),
            sql`lower(${l.code}) = ${input.code.trim().toLowerCase()}`,
            warehouseId ? eq(l.warehouseId, warehouseId) : isNull(l.warehouseId),
          ),
        )
        .limit(1)
    )[0];
    if (codeClash && codeClash.id !== exceptId)
      throw duplicateError('code', `Code ${input.code.trim()} already exists`);
  }
  if (def.type === 'return_reason' && input.linkDamageReason && input.linkedDamageReasonId) {
    const dr = (
      await db
        .select({ id: l.id })
        .from(l)
        .where(and(eq(l.id, input.linkedDamageReasonId), eq(l.type, 'damage_reason')))
        .limit(1)
    )[0];
    if (!dr)
      throw new AppError('VALIDATION', 'Damage reason not found', {
        fieldErrors: { linkedDamageReasonId: ['Damage reason not found'] },
      });
  }
  return { warehouseId, clientId };
}

/** Change-log snapshot: names instead of ids, meta flattened to readable fields. */
async function display(
  db: AppDb,
  def: LookupDef,
  r: {
    name: string;
    code: string | null;
    isActive: boolean;
    sortOrder: number;
    warehouseId: string | null;
    clientId: string | null;
    meta: Record<string, unknown> | null;
  },
): Promise<Record<string, unknown>> {
  const wh = r.warehouseId
    ? (
        await db
          .select({ code: s.warehouses.code })
          .from(s.warehouses)
          .where(eq(s.warehouses.id, r.warehouseId))
          .limit(1)
      )[0]?.code
    : null;
  const cl = r.clientId
    ? (
        await db.select({ name: s.clients.name }).from(s.clients).where(eq(s.clients.id, r.clientId)).limit(1)
      )[0]?.name
    : null;
  const m = r.meta ?? {};
  const linked =
    typeof m.linkedDamageReasonId === 'string'
      ? ((await db.select({ name: l.name }).from(l).where(eq(l.id, m.linkedDamageReasonId)).limit(1))[0]
          ?.name ?? null)
      : null;
  return {
    name: r.name,
    code: r.code,
    status: r.isActive ? 'Active' : 'Inactive',
    sortOrder: r.sortOrder,
    ...(def.scope === 'warehouse' ? { warehouse: wh ?? (def.scopeRequired ? '' : 'All warehouses') } : {}),
    ...(def.scope === 'client' ? { client: cl ?? 'All clients' } : {}),
    ...lookupMetaDisplay(def, r.meta, { damageReason: linked }),
  };
}

export async function createLookupValue(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  def: LookupDef,
  input: LookupSave,
): Promise<LookupGridRow> {
  const scope = await validate(tx, auth, def, input);
  const row = (
    await tx
      .insert(l)
      .values({
        type: def.type,
        name: input.name.trim(),
        code: def.hasCode ? input.code : null,
        ...scope,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
        meta: lookupMeta(def, input),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: l.id, name: l.name })
  )[0];
  await logCreate(tx, domainCtxOf(actor, auth), {
    entityType: LOOKUP_ENTITY,
    entityId: row.id,
    entityCode: `${def.noun} ${row.name}`,
  });
  return await getLookupRow(tx, auth, def.type, row.id);
}

export async function updateLookupValue(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  def: LookupDef,
  id: string,
  input: LookupSave,
): Promise<LookupGridRow> {
  const before = await getLookupRow(tx, auth, def.type, id);
  assertVersion(before.version, input.version);
  const scope = await validate(tx, auth, def, input, id);
  if (
    before.usageCount > 0 &&
    before.name !== input.name.trim() &&
    ['pack_type', 'po_type', 'damage_reason', 'custom_carrier'].includes(def.type)
  ) {
    throw new AppError(
      'VALIDATION',
      `${before.usageCount} records use "${before.name}" by name; it can't be renamed`,
      { fieldErrors: { name: ['In use by name; deactivate it and create a new value instead'] } },
    );
  }
  // Keys maintained elsewhere (Location Zone › Match With Product Groups) survive a drawer edit.
  const kept =
    def.type === 'location_zone' && Array.isArray(before.meta?.productGroupIds)
      ? { productGroupIds: before.meta.productGroupIds }
      : {};
  const meta = 'productGroupIds' in kept ? { ...lookupMeta(def, input), ...kept } : lookupMeta(def, input);
  await tx
    .update(l)
    .set({
      name: input.name.trim(),
      code: def.hasCode ? input.code : null,
      ...scope,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      meta,
      updatedBy: actor.userId,
      updatedAt: new Date().toISOString(),
      version: sql`${l.version} + 1`,
    })
    .where(eq(l.id, id));
  const after = await getLookupRow(tx, auth, def.type, id);
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    { entityType: LOOKUP_ENTITY, entityId: id, entityCode: `${def.noun} ${after.name}` },
    await display(tx, def, before),
    await display(tx, def, after),
  );
  return after;
}

export async function setLookupsActive(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  def: LookupDef,
  ids: readonly string[],
  isActive: boolean,
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await getLookupRow(inner, auth, def.type, id);
    if (row.isActive === isActive)
      throw new AppError('INVALID_STATE', `${row.name} is already ${isActive ? 'active' : 'inactive'}`);
    await inner
      .update(l)
      .set({
        isActive,
        updatedBy: actor.userId,
        updatedAt: new Date().toISOString(),
        version: sql`${l.version} + 1`,
      })
      .where(eq(l.id, id));
    await logUpdate(
      inner,
      ctx,
      { entityType: LOOKUP_ENTITY, entityId: id, entityCode: `${def.noun} ${row.name}` },
      { status: row.status },
      { status: isActive ? 'Active' : 'Inactive' },
    );
  });
}

export async function deleteLookupValues(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  def: LookupDef,
  ids: readonly string[],
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await getLookupRow(inner, auth, def.type, id);
    if (row.usageCount > 0)
      throw new AppError(
        'INVALID_STATE',
        `${row.name} is used by ${row.usageCount} ${row.usageCount === 1 ? 'item' : 'items'}. Deactivate it instead.`,
      );
    await inner.delete(l).where(eq(l.id, id));
    await logDelete(inner, ctx, {
      entityType: LOOKUP_ENTITY,
      entityId: id,
      entityCode: `${def.noun} ${row.name}`,
    });
  });
}
