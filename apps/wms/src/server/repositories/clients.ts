/**
 * Clients repository (M11): grid, detail (KPIs, settings, addresses, users with access,
 * billing contracts), 4-step create, full edit, settings-only edit, bulk activate /
 * deactivate and guarded delete. Every write logs field-level change_log on "client".
 *
 * Shared core registry (BLUEPRINT.md §2.4, adapted): every write path here ALSO upserts
 * (or removes) the client's core.customers copy in the same transaction via
 * repositories/core-sync.ts. Read paths deliberately stay on wms.clients — the
 * blueprint's "replace wms.clients with a view over core.customers" idea was rejected as
 * higher risk (a view breaks drizzle table metadata and puts a shared table in the hot
 * path of every client query); write-through keeps wms.clients the operational source of
 * truth while core carries an always-current identity copy.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient, scopedWhere } from '@/server/auth/scope';
import * as s from '@/server/db/schema';
import { runBulk } from '@/server/domain/bulk';
import type { BulkResult } from '@/server/domain/types';
import { paginate } from '@/server/query/paginate';
import type { GridQuery } from '@/server/query/grid-query';
import {
  CLIENT_FIELDS,
  CLIENT_SEARCH_FIELDS,
  CLIENT_SORT_FIELDS,
  flattenSettings,
  fullSettings,
  readSscc,
  settingLabel,
  type ClientSave,
  type ClientSettingsForm,
  type ClientSscc,
} from '@/lib/grid-defs/organization/clients';
// Constant only. Importing it from the orders repository pulled that module graph into every
// clients request, so an orders 500 also took /api/clients and the client pickers down.
import { BACKLOG_VIEW_STATUSES as BACKLOG_STATUSES } from '@/lib/grid-defs/orders/shipment-orders';
import {
  assertVersion,
  compileGrid,
  domainCtxOf,
  listAddresses,
  logCreate,
  logDelete,
  logUpdate,
  saveAddresses,
  type Actor,
  type GridBinding,
  type OwnedAddress,
} from './clients-shared';
import { contractsForClient, logContractEvent, type ContractRow } from './billing';
import { removeClientFromCore, syncClientToCore } from './core-sync';
import { dbAll, dbGet, dbRun } from '@/server/db/sql';

const c = s.clients;
export const CLIENT_ENTITY = 'client';
export type ClientStatus = (typeof c.$inferSelect)['status'];

const backlog = sql.join(
  BACKLOG_STATUSES.map((v) => sql`${v}`),
  sql`, `,
);
const productCountSql = sql<number>`(SELECT COUNT(*) FROM products p WHERE p.client_id = clients.id)`;
const openOrdersSql = sql<number>`(SELECT COUNT(*) FROM shipment_orders so WHERE so.client_id = clients.id AND so.status IN (${backlog}))`;
const totalOrdersSql = sql<number>`(SELECT COUNT(*) FROM shipment_orders so WHERE so.client_id = clients.id)`;
const createdByNameSql = sql<string | null>`(SELECT u.name FROM users u WHERE u.id = clients.created_by)`;

const BINDING: GridBinding = {
  exprs: {
    code: sql`${c.code}`,
    name: sql`${c.name}`,
    officialName: sql`${c.officialName}`,
    taxId: sql`${c.taxId}`,
    status: sql`${c.status}`,
    currency: sql`${c.currency}`,
    productCount: productCountSql,
    openOrders: openOrdersSql,
    createdAt: sql`${c.createdAt}`,
  },
  fields: CLIENT_FIELDS,
  sortable: CLIENT_SORT_FIELDS,
  search: CLIENT_SEARCH_FIELDS,
  defaultSort: [{ field: 'name', dir: 'asc' }],
  tiebreaker: c.id,
};

export interface ClientListRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly officialName: string | null;
  readonly fullName: string;
  readonly taxId: string | null;
  readonly status: ClientStatus;
  readonly currency: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly phone: string;
  readonly billingPlan: string;
  readonly productCount: number;
  readonly openOrders: number;
  readonly totalOrders: number;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly version: number;
}

const ROW = {
  id: c.id,
  code: c.code,
  name: c.name,
  officialName: c.officialName,
  taxId: c.taxId,
  status: c.status,
  currency: c.currency,
  contactName: c.contactName,
  contactEmail: c.contactEmail,
  phone: c.phone,
  billingPlan: c.billingPlan,
  productCount: productCountSql,
  openOrders: openOrdersSql,
  totalOrders: totalOrdersSql,
  createdAt: c.createdAt,
  createdByName: createdByNameSql,
  version: c.version,
};

/** Clients are scoped by their own id. */
export const clientScope = (auth: AuthContext, view = true): SQL | undefined =>
  scopedWhere(c, view ? auth.viewScope : auth.scope, { clientId: c.id });

/** `f.warehouseId=in:<id>` (shared ClientSelect) = clients usable in that warehouse: Active ones. */
function pickerFilter(query: GridQuery): { query: GridQuery; activeOnly: boolean } {
  const filters = query.filters.filter((f) => f.field !== 'warehouseId');
  return { query: { ...query, filters }, activeOnly: filters.length !== query.filters.length };
}

const fullName = (r: { officialName: string | null; name: string; code: string }): string =>
  `${r.officialName || r.name} (${r.code})`;

export async function listClients(
  db: AppDb,
  auth: AuthContext,
  rawQuery: GridQuery,
): Promise<{ rows: ClientListRow[]; total: number }> {
  const { query, activeOnly } = pickerFilter(rawQuery);
  const grid = compileGrid(BINDING, query, [
    clientScope(auth),
    activeOnly ? eq(c.status, 'Active') : undefined,
  ]);
  const result = await paginate(
    db
      .select(ROW)
      .from(c)
      .where(grid.where)
      .orderBy(...grid.orderBy)
      .$dynamic(),
    async () =>
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(c)
          .where(grid.where)
          .limit(1)
      )[0]?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return {
    rows: (result.rows as Omit<ClientListRow, 'fullName'>[]).map((r) => ({ ...r, fullName: fullName(r) })),
    total: result.total,
  };
}

export async function loadClient(db: AppDb, auth: AuthContext, id: string): Promise<typeof c.$inferSelect> {
  const row = (await db.select().from(c).where(eq(c.id, id)).limit(1))[0];
  if (!row || !hasClient(auth.scope, row.id)) throw notFoundError('Client');
  return row;
}

export interface ClientKpis {
  readonly orders30d: number;
  readonly unitsShipped30d: number;
  readonly inventoryUnits: number;
  readonly openPos: number;
  readonly openOrders: number;
  readonly products: number;
  readonly skusInStock: number;
}

export async function clientKpis(
  db: AppDb,
  auth: AuthContext,
  id: string,
  now = new Date(),
): Promise<ClientKpis> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const wh = auth.viewScope.warehouseIds.length
    ? sql.join(
        auth.viewScope.warehouseIds.map((w) => sql`${w}`),
        sql`, `,
      )
    : sql`''`;
  const one = async (q: SQL): Promise<number> => Number((await dbGet<{ n: number | null }>(db, q))?.n ?? 0);
  return {
    orders30d: await one(
      sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE client_id = ${id} AND warehouse_id IN (${wh}) AND created_at >= ${since}`,
    ),
    unitsShipped30d:
      await one(sql`SELECT COALESCE(SUM(ol.shipped_quantity), 0) AS n FROM order_lines ol JOIN shipment_orders so ON so.id = ol.order_id
      WHERE so.client_id = ${id} AND so.warehouse_id IN (${wh}) AND so.shipped_at >= ${since}`),
    inventoryUnits: await one(
      sql`SELECT COALESCE(SUM(on_hand), 0) AS n FROM inventory WHERE client_id = ${id} AND warehouse_id IN (${wh})`,
    ),
    skusInStock: await one(
      sql`SELECT COUNT(DISTINCT product_id) AS n FROM inventory WHERE client_id = ${id} AND warehouse_id IN (${wh}) AND on_hand > 0`,
    ),
    openPos: await one(
      sql`SELECT COUNT(*) AS n FROM purchase_orders WHERE client_id = ${id} AND warehouse_id IN (${wh}) AND status IN ('Pending', 'Started', 'Receiving')`,
    ),
    openOrders: await one(
      sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE client_id = ${id} AND warehouse_id IN (${wh}) AND status IN (${backlog})`,
    ),
    products: await one(sql`SELECT COUNT(*) AS n FROM products WHERE client_id = ${id}`),
  };
}

export interface ClientUserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly access: 'All clients' | 'Assigned';
}

/**
 * Accounts created by automated QA runs (critic / e2e suites: "KS-CRIT …", "KS-E2E …", "KS-TEST …",
 * `ks-crit-…@example.com`). They are hidden from the client's "Users with access" tab so demos
 * show only real people; Settings › Users still lists them for cleanup.
 */
const TEST_NAME = /^KS-(CRIT|E2E|TEST|QA)\b/i;
const TEST_EMAIL = /^ks-(crit|e2e|test|qa)[-.@]/i;
export function isTestIdentity(name: string, email: string): boolean {
  return TEST_NAME.test(name.trim()) || TEST_EMAIL.test(email.trim());
}

export async function usersWithAccess(db: AppDb, clientId: string): Promise<ClientUserRow[]> {
  const rows = await dbAll<{
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: number;
    allClients: number;
  }>(
    db,
    sql`
    SELECT u.id, u.name, u.email, u.role, u.is_active AS "isActive", u.all_clients AS "allClients" FROM users u
    WHERE u.all_clients = true OR EXISTS (SELECT 1 FROM user_clients uc WHERE uc.user_id = u.id AND uc.client_id = ${clientId})
    ORDER BY u.all_clients ASC, u.name ASC`,
  );
  return rows
    .filter((r) => !isTestIdentity(r.name, r.email))
    .map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      isActive: Boolean(r.isActive),
      access: r.allClients ? 'All clients' : 'Assigned',
    }));
}

export interface ClientDetail extends ClientListRow {
  readonly settings: ClientSettingsForm;
  readonly sscc: ClientSscc;
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly addresses: readonly OwnedAddress[];
  readonly kpis: ClientKpis;
  readonly contracts: readonly ContractRow[];
  readonly users: readonly ClientUserRow[];
  readonly updatedAt: string;
}

export async function getClient(db: AppDb, auth: AuthContext, id: string): Promise<ClientDetail> {
  const row = await loadClient(db, auth, id);
  const view = (await db.select(ROW).from(c).where(eq(c.id, id)).limit(1))[0] as Omit<
    ClientListRow,
    'fullName'
  >;
  return {
    ...view,
    fullName: fullName(view),
    settings: fullSettings(row.settings),
    sscc: readSscc(row.settings),
    customFields: row.customFields ?? {},
    addresses: await listAddresses(db, 'client', id),
    kpis: await clientKpis(db, auth, id),
    contracts: await contractsForClient(db, auth, id),
    users: await usersWithAccess(db, id),
    updatedAt: row.updatedAt,
  };
}

/* ---------------- writes ---------------- */

function snapshot(row: typeof c.$inferSelect): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: row.name,
    code: row.code,
    officialName: row.officialName ?? '',
    status: row.status,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    phone: row.phone,
    currency: row.currency,
    taxId: row.taxId ?? '',
    billingPlan: row.billingPlan,
  };
  for (const [k, v] of Object.entries(flattenSettings(fullSettings(row.settings))))
    out[settingLabel(k) ?? k] = v ? 'On' : 'Off';
  const sscc = readSscc(row.settings);
  out['SSCC-18 extension digit'] = sscc.extensionDigit;
  out['SSCC-18 GS1 company prefix'] = sscc.gs1CompanyPrefix;
  out['SSCC-18 serial number'] = sscc.serialNumber;
  for (const [k, v] of Object.entries(row.customFields ?? {})) out[`Custom field ${k}`] = v ?? '';
  return out;
}

const codeTaken = async (db: AppDb, code: string, exceptId?: string): Promise<boolean> => {
  const clash = (
    await db
      .select({ id: c.id })
      .from(c)
      .where(sql`upper(${c.code}) = upper(${code})`)
      .limit(1)
  )[0];
  return Boolean(clash && clash.id !== exceptId);
};

/**
 * Wizard step 1: is `code` free (case-insensitive, across every client, not only the caller's
 * scope, since codes are globally unique), and the nearest free variant (APX → APX2 … APX99).
 */
export async function clientCodeCheck(
  db: AppDb,
  raw: string,
  exceptId?: string,
): Promise<{ code: string; available: boolean; suggestion: string | null }> {
  const code = raw.trim().toUpperCase();
  if (!code) return { code, available: false, suggestion: null };
  const available = !(await codeTaken(db, code, exceptId));
  if (available) return { code, available, suggestion: code };
  for (let n = 2; n < 1000; n += 1) {
    const tail = String(n);
    const candidate = `${code.slice(0, Math.max(2, 20 - tail.length))}${tail}`;
    if (!(await codeTaken(db, candidate, exceptId))) return { code, available, suggestion: candidate };
  }
  return { code, available, suggestion: null };
}

async function assertCodeFree(db: AppDb, code: string, exceptId?: string): Promise<void> {
  const clash = (
    await db
      .select({ id: c.id })
      .from(c)
      .where(sql`upper(${c.code}) = upper(${code})`)
      .limit(1)
  )[0];
  if (clash && clash.id !== exceptId)
    throw new AppError('DUPLICATE', `Client code ${code} is already used`, {
      fieldErrors: { code: ['This client code is already used'] },
    });
}

async function assertNameFree(db: AppDb, name: string, exceptId?: string): Promise<void> {
  const clash = (
    await db
      .select({ id: c.id })
      .from(c)
      .where(sql`lower(${c.name}) = lower(${name})`)
      .limit(1)
  )[0];
  if (clash && clash.id !== exceptId)
    throw new AppError('DUPLICATE', `A client named ${name} already exists`, {
      fieldErrors: { name: ['A client with this display name already exists'] },
    });
}

type StoredSettings = (typeof c.$inferInsert)['settings'];

/** Switch groups plus `sscc` in one settings JSON (blank SSCC is dropped). */
function withSscc(settings: ClientSettingsForm, sscc: ClientSscc | undefined): StoredSettings {
  const any = sscc && (sscc.extensionDigit || sscc.gs1CompanyPrefix || sscc.serialNumber);
  return (any ? { ...settings, sscc } : { ...settings }) as StoredSettings;
}

function columns(input: ClientSave) {
  return {
    name: input.name.trim(),
    code: input.code,
    officialName: input.officialName.trim(),
    status: input.status,
    contactName: input.contactName ?? '',
    contactEmail: input.contactEmail ?? '',
    phone: input.phone ?? '',
    currency: input.currency,
    taxId: input.taxId,
    billingPlan: input.billingPlan,
    settings: withSscc(input.settings, input.sscc),
    customFields: input.customFields,
  };
}

async function addNote(tx: AppDb, actor: Actor, clientId: string, body: string | null): Promise<void> {
  if (!body) return;
  await tx
    .insert(s.entityNotes)
    .values({ entityType: CLIENT_ENTITY, entityId: clientId, body, userId: actor.userId });
}

export async function createClient(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: ClientSave,
): Promise<{ id: string; code: string; name: string }> {
  if (auth.scope.clientIds !== 'all')
    throw new AppError('FORBIDDEN', 'Only users with access to all clients can create clients');
  await assertCodeFree(tx, input.code);
  await assertNameFree(tx, input.name.trim());
  const row = (
    await tx
      .insert(c)
      .values({ ...columns(input), createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: c.id, code: c.code, name: c.name })
  )[0];
  await syncClientToCore(tx, row.id);
  const ctx = domainCtxOf(actor, auth);
  await logCreate(tx, ctx, CLIENT_ENTITY, row.id, row.code);
  if (input.addresses.length)
    await saveAddresses(
      tx,
      ctx,
      { type: 'client', id: row.id, code: row.code, userId: actor.userId },
      input.addresses,
    );
  await addNote(tx, actor, row.id, input.note);
  return row;
}

export async function updateClient(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  id: string,
  input: ClientSave,
): Promise<{ id: string; code: string; name: string; version: number }> {
  const before = await loadClient(tx, auth, id);
  assertVersion(before.version, input.version);
  if (input.code !== before.code)
    throw new AppError('VALIDATION', "Client code can't change", {
      fieldErrors: { code: ["Client code can't change after creation"] },
    });
  await assertNameFree(tx, input.name.trim(), id);
  const after = (
    await tx
      .update(c)
      .set({ ...columns(input), updatedBy: actor.userId, version: sql`${c.version} + 1` })
      .where(eq(c.id, id))
      .returning()
  )[0];
  await syncClientToCore(tx, id);
  const ctx = domainCtxOf(actor, auth);
  await logUpdate(tx, ctx, CLIENT_ENTITY, id, after.code, snapshot(before), snapshot(after));
  await saveAddresses(
    tx,
    ctx,
    { type: 'client', id, code: after.code, userId: actor.userId },
    input.addresses,
  );
  await addNote(tx, actor, id, input.note);
  return { id, code: after.code, name: after.name, version: after.version };
}

export async function updateClientSettings(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  id: string,
  input: { currency: ClientSave['currency']; settings: ClientSettingsForm; version?: number },
): Promise<{ id: string; version: number }> {
  const before = await loadClient(tx, auth, id);
  assertVersion(before.version, input.version);
  const after = (
    await tx
      .update(c)
      .set({
        currency: input.currency,
        settings: withSscc(input.settings, readSscc(before.settings)),
        updatedBy: actor.userId,
        version: sql`${c.version} + 1`,
      })
      .where(eq(c.id, id))
      .returning()
  )[0];
  await syncClientToCore(tx, id);
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    CLIENT_ENTITY,
    id,
    after.code,
    snapshot(before),
    snapshot(after),
  );
  return { id, version: after.version };
}

export async function setClientStatus(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ids: readonly string[],
  status: ClientStatus,
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await loadClient(inner, auth, id);
    if (row.status === status)
      throw new AppError('INVALID_STATE', `${row.name} is already ${status.toLowerCase()}`);
    if (status === 'Inactive') {
      const open = Number(
        (
          await dbGet<{ n: number }>(
            inner,
            sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE client_id = ${id} AND status IN (${backlog})`,
          )
        )?.n ?? 0,
      );
      if (open > 0)
        throw new AppError(
          'INVALID_STATE',
          `${row.name} has ${open} open ${open === 1 ? 'order' : 'orders'}`,
        );
    }
    await inner
      .update(c)
      .set({ status, updatedBy: actor.userId, version: sql`${c.version} + 1` })
      .where(eq(c.id, id));
    await syncClientToCore(inner, id);
    await logUpdate(inner, ctx, CLIENT_ENTITY, id, row.code, { status: row.status }, { status });
    // The billing-periods scheduler skips contracts of Inactive clients: say so on each Approved contract's change log.
    const approved = await inner
      .select({ id: s.billingContracts.id, name: s.billingContracts.name })
      .from(s.billingContracts)
      .where(and(eq(s.billingContracts.clientId, id), eq(s.billingContracts.approvalStatus, 'Approved')));
    for (const k of approved) {
      await logContractEvent(inner, ctx, k.id, k.name, {
        type: 'Update',
        field: 'autoCalculation',
        label: 'Automatic calculation',
        from: status === 'Inactive' ? 'Running' : 'Paused',
        to: status === 'Inactive' ? 'Paused' : 'Running',
        message:
          status === 'Inactive'
            ? `Client ${row.name} was deactivated; automatic billing is paused. Calculate a final bill manually if needed.`
            : `Client ${row.name} was activated; automatic billing resumes.`,
      });
    }
  });
}

/** Why a client can't be deleted (null = deletable). */
export async function clientDeleteBlocker(db: AppDb, id: string): Promise<string | null> {
  const counts = await dbGet<{
    products: number;
    orders: number;
    pos: number;
    inv: number;
    contracts: number;
  }>(
    db,
    sql`SELECT
    (SELECT COUNT(*) FROM products WHERE client_id = ${id}) AS products,
    (SELECT COUNT(*) FROM shipment_orders WHERE client_id = ${id}) AS orders,
    (SELECT COUNT(*) FROM purchase_orders WHERE client_id = ${id}) AS pos,
    (SELECT COUNT(*) FROM inventory WHERE client_id = ${id} AND on_hand > 0) AS inv,
    (SELECT COUNT(*) FROM billing_contracts WHERE client_id = ${id}) AS contracts`,
  );
  if (!counts) return null;
  const parts = [
    counts.products ? `${counts.products} products` : '',
    counts.orders ? `${counts.orders} orders` : '',
    counts.pos ? `${counts.pos} POs` : '',
    counts.inv ? 'stock on hand' : '',
    counts.contracts ? `${counts.contracts} billing forms` : '',
  ].filter(Boolean);
  return parts.length ? `has ${parts.join(', ')}; deactivate it instead` : null;
}

export async function deleteClients(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ids: readonly string[],
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await loadClient(inner, auth, id);
    const reason = await clientDeleteBlocker(inner, id);
    if (reason) throw new AppError('INVALID_STATE', `${row.name} ${reason}`);
    for (const table of [
      'customers',
      'vendors',
      'user_clients',
      'lookup_values',
      'vas_operations',
      'shipment_package_clients',
      'printout_template_clients',
      'carrier_connection_clients',
    ]) {
      await dbRun(inner, sql`DELETE FROM ${sql.raw(table)} WHERE client_id = ${id}`);
    }
    await inner
      .delete(s.addresses)
      .where(and(eq(s.addresses.ownerType, 'client'), eq(s.addresses.ownerId, id)));
    await inner.delete(c).where(eq(c.id, id));
    await removeClientFromCore(inner, id);
    await logDelete(inner, ctx, CLIENT_ENTITY, id, row.code);
  });
}

/**
 * GET /api/clients for any caller: holders of settings.clients.view get the full grid row, everyone
 * else (operators / viewers using client pickers) only the picker-safe fields.
 */
export async function listClientsForCaller(
  db: AppDb,
  auth: AuthContext,
  query: GridQuery,
): Promise<{ rows: (ClientListRow | ReturnType<typeof slimClientRow>)[]; total: number }> {
  if (auth.permissions.has('settings.clients.view')) return await listClients(db, auth, query);
  // Never select PII for these callers: the SQL itself only reads the picker-safe columns.
  const { query: q, activeOnly } = pickerFilter(query);
  const grid = compileGrid(BINDING, q, [clientScope(auth), activeOnly ? eq(c.status, 'Active') : undefined]);
  const result = await paginate(
    db
      .select(SLIM_ROW)
      .from(c)
      .where(grid.where)
      .orderBy(...grid.orderBy)
      .$dynamic(),
    async () =>
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(c)
          .where(grid.where)
          .limit(1)
      )[0]?.n ?? 0,
    { page: q.page, pageSize: q.pageSize },
  );
  const rows = (result.rows as Omit<SlimClientRow, 'fullName'>[]).map((r) =>
    slimClientRow({ ...r, fullName: fullName(r) }),
  );
  return { rows, total: result.total };
}

const SLIM_ROW = {
  id: c.id,
  code: c.code,
  name: c.name,
  officialName: c.officialName,
  status: c.status,
  currency: c.currency,
};
export const SLIM_CLIENT_KEYS = [
  'id',
  'code',
  'name',
  'officialName',
  'fullName',
  'status',
  'currency',
] as const;
export type SlimClientRow = Pick<ClientListRow, (typeof SLIM_CLIENT_KEYS)[number]>;

/** The picker-safe subset of a client row (no tax ID or contact data) for roles without Clients view. */
export function slimClientRow(r: SlimClientRow): SlimClientRow {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    officialName: r.officialName,
    fullName: r.fullName,
    status: r.status,
    currency: r.currency,
  };
}

/** Lightweight id → label options for pickers (Active only by default); one indexed query, no KPIs. */
export async function clientOptions(
  db: AppDb,
  auth: AuthContext,
  includeInactive = false,
): Promise<{ id: string; code: string; name: string; status: ClientStatus; currency: string }[]> {
  return await db
    .select({ id: c.id, code: c.code, name: c.name, status: c.status, currency: c.currency })
    .from(c)
    .where(and(clientScope(auth, false), includeInactive ? undefined : eq(c.status, 'Active')))
    .orderBy(asc(c.name));
}

export async function clientsByIds(
  db: AppDb,
  ids: readonly string[],
): Promise<Map<string, typeof c.$inferSelect>> {
  if (ids.length === 0) return new Map();
  return new Map(
    (
      await db
        .select()
        .from(c)
        .where(inArray(c.id, [...ids]))
    ).map((r) => [r.id, r]),
  );
}
