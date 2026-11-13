/**
 * Logs-group reports (spec 07): Change Log, Transaction History, Serial Number
 * Transaction History, Missing Log, Excel Export History.
 *
 * Beats Logiwa: the Change Log shows human labels (never `Logiwa.NameKey.*`), resolves
 * raw ids to codes/names, and deep-links every code to its record.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import { can } from '@/server/auth/permissions';
import type { GridQuery } from '@/server/query/grid-query';
import {
  CHANGE_LOG_DEF,
  CHANGE_LOG_MODULES,
  EXPORT_HISTORY_DEF,
  MISSING_LOG_DEF,
  SERIAL_TRANSACTIONS_DEF,
  TRANSACTION_HISTORY_DEF,
} from '@/lib/grid-defs/reports/logs';
import { GRID_EXPORTS } from '@/server/exports/grid-keys';
import { clientIn, inList, runReport, warehouseLabel, type ReportPage } from './reports-grid';
import { dbAll } from '@/server/db/sql';

type Row = Record<string, unknown>;

/* --------------------------------------------------------------- change log */

/** entity_type → [owning table holding warehouse_id, key column ("id" | "parent")]. */
const WAREHOUSE_OF: Readonly<Record<string, readonly [table: string, key: 'id' | 'parent']>> = {
  shipment_order: ['shipment_orders', 'id'],
  order_line: ['shipment_orders', 'parent'],
  job: ['jobs', 'id'],
  purchase_order: ['purchase_orders', 'id'],
  purchase_order_line: ['purchase_orders', 'parent'],
  work_order: ['work_orders', 'id'],
  work_order_component: ['work_orders', 'parent'],
  count_plan: ['count_plans', 'id'],
  count_line: ['count_plans', 'parent'],
  return_order: ['return_orders', 'id'],
  return_order_line: ['return_orders', 'parent'],
  end_of_day_manifest: ['end_of_day_manifests', 'id'],
  location: ['locations', 'id'],
  inventory: ['locations', 'parent'],
  shipment_plan: ['shipment_plans', 'id'],
  wave_rule: ['wave_rules', 'id'],
  license_plate: ['license_plates', 'id'],
  lp_type: ['lp_types', 'id'],
  job_type: ['job_types', 'id'],
};

/** entity_type → [route prefix, key column]. */
const HREF_OF: Readonly<Record<string, readonly [prefix: string, key: 'id' | 'parent']>> = {
  shipment_order: ['/orders/', 'id'],
  order_line: ['/orders/', 'parent'],
  job: ['/jobs/', 'id'],
  purchase_order: ['/receiving/', 'id'],
  purchase_order_line: ['/receiving/', 'parent'],
  product: ['/products/', 'id'],
  work_order: ['/work-orders/', 'id'],
  work_order_component: ['/work-orders/', 'parent'],
  count_plan: ['/counts/', 'id'],
  count_line: ['/counts/', 'parent'],
  return_order: ['/orders/returns/', 'id'],
  return_order_line: ['/orders/returns/', 'parent'],
  location: ['/locations/', 'id'],
  inventory: ['/locations/', 'parent'],
  shipment_plan: ['/shipment-plans/', 'id'],
  client: ['/clients/', 'id'],
  billing_contract: ['/billing/', 'id'],
  workflow: ['/automation/workflows/', 'id'],
};

const keyCol = (k: 'id' | 'parent'): string => (k === 'id' ? 'cl.entity_id' : 'cl.parent_entity_id');
const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

function warehouseExpr(): SQL {
  const whens = Object.entries(WAREHOUSE_OF)
    .map(
      ([type, [table, k]]) =>
        `WHEN ${quote(type)} THEN (SELECT x.warehouse_id FROM ${table} x WHERE x.id = ${keyCol(k)})`,
    )
    .join(' ');
  return sql.raw(`CASE cl.entity_type ${whens} END`);
}

/** entity_type → table holding client_id (client-restricted viewers only see these). */
const CLIENT_OF: Readonly<Record<string, readonly [table: string, key: 'id' | 'parent']>> = {
  shipment_order: ['shipment_orders', 'id'],
  order_line: ['shipment_orders', 'parent'],
  job: ['jobs', 'id'],
  purchase_order: ['purchase_orders', 'id'],
  purchase_order_line: ['purchase_orders', 'parent'],
  work_order: ['work_orders', 'id'],
  work_order_component: ['work_orders', 'parent'],
  return_order: ['return_orders', 'id'],
  return_order_line: ['return_orders', 'parent'],
  shipment_plan: ['shipment_plans', 'id'],
  product: ['products', 'id'],
  vendor: ['vendors', 'id'],
  listing: ['product_listings', 'id'],
  license_plate: ['license_plates', 'id'],
  client: ['clients', 'id'],
};

function clientExpr(): SQL {
  const whens = Object.entries(CLIENT_OF)
    .map(
      ([type, [table, k]]) =>
        `WHEN ${quote(type)} THEN (SELECT ${table === 'clients' ? 'x.id' : 'x.client_id'} FROM ${table} x WHERE x.id = ${keyCol(k)})`,
    )
    .join(' ');
  return sql.raw(`CASE cl.entity_type ${whens} END`);
}

/** Detail routes that need a lookup (algorithm kind, channel provider). */
const HREF_SQL: Readonly<Record<string, string>> = {
  algorithm:
    "(SELECT '/automation/algorithms/' || lower(x.kind) || '/' || x.id FROM algorithms x WHERE x.id = cl.entity_id)",
  channel_connection:
    "(SELECT '/integrations/channels/' || x.provider FROM channel_connections x WHERE x.id = cl.entity_id)",
  billing_report: "'/billing/reports/' || cl.entity_id",
};

/** Entities without a detail page: their list, quick-searched by the code (Equal). */
export const CHANGE_LOG_LIST_HREF: Readonly<Record<string, string>> = {
  retailer: '/organization/retailers',
  customer: '/organization/customers',
  vendor: '/organization/vendors',
  vas_operation: '/billing/vas',
  listing: '/products/listings',
  wave_rule: '/jobs/wave-rules',
  end_of_day_manifest: '/shipments/end-of-day',
  license_plate: '/settings/lp-numbers',
  lp_type: '/settings/lp-types',
  job_type: '/settings/job-types',
  user: '/settings/users',
  role: '/settings/roles',
  warehouse: '/settings/warehouses',
  lookup_value: '/settings/data-setup',
};

/** Deep link for one change-log row: detail route from SQL, else the searched list. */
export function changeLogHref(
  entityType: string,
  code: string | null,
  sqlHref: string | null,
): string | null {
  if (sqlHref) return sqlHref;
  const list = CHANGE_LOG_LIST_HREF[entityType];
  if (!list) return null;
  return code && code !== 'None' && code !== '\u2014' ? `${list}?q=${encodeURIComponent(code)}&qm=eq` : list;
}

function hrefExpr(): SQL {
  const detail = Object.entries(HREF_OF).map(
    ([type, [prefix, k]]) => `WHEN ${quote(type)} THEN ${quote(prefix)} || ${keyCol(k)}`,
  );
  const looked = Object.entries(HREF_SQL).map(([type, expr]) => `WHEN ${quote(type)} THEN ${expr}`);
  return sql.raw(`CASE cl.entity_type ${[...detail, ...looked].join(' ')} END`);
}

function moduleExpr(): SQL {
  const whens = Object.entries(CHANGE_LOG_MODULES)
    .map(([type, label]) => `WHEN ${quote(type)} THEN ${quote(label)}`)
    .join(' ');
  return sql.raw(`CASE cl.entity_type ${whens} ELSE replace(cl.entity_type, '_', ' ') END`);
}

/** Humanizes a camelCase / snake / i18n key ("Logiwa.NameKey.RemainingVolume" → "Remaining Volume"). */
export function humanizeProperty(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tail = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw;
  const spaced = tail
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Line-level change rows → the SKU of the changed line (order / PO / return / count lines). */
export const LINE_TABLES: Readonly<Record<string, string>> = {
  order_line: 'order_lines',
  purchase_order_line: 'purchase_order_lines',
  return_order_line: 'return_order_lines',
  count_line: 'count_plan_lines',
};
function lineSkuExpr(): SQL {
  const whens = Object.entries(LINE_TABLES)
    .map(
      ([type, table]) =>
        `WHEN ${quote(type)} THEN (SELECT p.sku FROM ${table} x JOIN products p ON p.id = x.product_id WHERE x.id = cl.entity_id)`,
    )
    .join(' ');
  return sql.raw(`CASE cl.entity_type ${whens} END`);
}

/**
 * Change Log audience (RA-R4): the full audit trail (every user's edits) is for roles that
 * manage users (admin / supervisor). Everyone else sees only the changes they made.
 */
export const CHANGE_LOG_ALL_USERS_PERMISSION = 'settings.users.view';
export function seesAllChangeLog(auth: AuthContext): boolean {
  return can(auth, CHANGE_LOG_ALL_USERS_PERMISSION);
}

export function changeLogSql(auth: AuthContext): SQL {
  const wh = warehouseExpr();
  const ownOnly = seesAllChangeLog(auth) ? sql`1 = 1` : sql`cl.user_id = ${auth.user.id}`;
  const allClients = auth.viewScope.clientIds === 'all';
  return sql`
    SELECT cl.id AS "id", cl.type AS "type", ${moduleExpr()} AS "module", cl.entity_type AS "entityType",
           COALESCE(cl.entity_code, 'None') || COALESCE(' / ' || ${lineSkuExpr()}, '') AS "code", ${lineSkuExpr()} AS "lineSku", ${hrefExpr()} AS "href",
           (EXISTS (SELECT 1 FROM change_log d WHERE d.entity_type = cl.entity_type AND d.entity_id = cl.entity_id AND d.type = 'Delete'))::int AS "recordDeleted",
           COALESCE(cl.field_label, cl.field) AS "property", cl.field AS "field",
           cl.from_value AS "fromValue", cl.to_value AS "toValue", cl.message AS "message",
           cl.at AS "at", COALESCE(NULLIF(u.name, ''), cl.source, u.email) AS "source", COALESCE(u.email, cl.source) AS "sourceDetail", u.name AS "userName"
    FROM change_log cl
    LEFT JOIN users u ON u.id = cl.user_id
    WHERE ((${wh} IS NULL AND ${allClients ? sql`1 = 1` : sql`0 = 1`}) OR ${inList(wh, auth.viewScope.warehouseIds)})
      AND ${allClients ? sql`1 = 1` : inList(clientExpr(), auth.viewScope.clientIds as readonly string[])}
      AND ${ownOnly}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id-like value → readable code/name (so the grid never shows a raw UUID). */
export async function resolveIds(db: AppDb, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const list = sql.join(
    unique.map((v) => sql`${v}`),
    sql`, `,
  );
  const rows = await dbAll<{ id: string; label: string }>(
    db,
    sql`
    SELECT id, code AS label FROM shipment_packages WHERE id IN (${list})
    UNION ALL SELECT id, code FROM locations WHERE id IN (${list})
    UNION ALL SELECT id, name FROM users WHERE id IN (${list})
    UNION ALL SELECT id, name FROM lookup_values WHERE id IN (${list})
    UNION ALL SELECT id, name FROM clients WHERE id IN (${list})
    UNION ALL SELECT id, code FROM warehouses WHERE id IN (${list})
    UNION ALL SELECT id, sku FROM products WHERE id IN (${list})
    UNION ALL SELECT id, number FROM license_plates WHERE id IN (${list})
    UNION ALL SELECT id, code FROM lp_types WHERE id IN (${list})
    UNION ALL SELECT id, display_name FROM vendors WHERE id IN (${list})
    UNION ALL SELECT id, name FROM carrier_services WHERE id IN (${list})
    UNION ALL SELECT id, setup_name FROM carrier_connections WHERE id IN (${list})
    UNION ALL SELECT id, name FROM retailers WHERE id IN (${list})
    UNION ALL SELECT id, code FROM jobs WHERE id IN (${list})
    UNION ALL SELECT id, code FROM shipment_orders WHERE id IN (${list})`,
  );
  return new Map(rows.map((r) => [r.id, r.label]));
}

export async function presentChangeLogRows(db: AppDb, rows: readonly Row[]): Promise<Row[]> {
  const inMessages = rows.flatMap((r) =>
    typeof r.message === 'string'
      ? (r.message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [])
      : [],
  );
  const ids = [
    ...rows
      .flatMap((r) => [r.fromValue, r.toValue])
      .filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)),
    ...inMessages,
  ];
  const names = await resolveIds(db, ids);
  const show = (v: unknown): string | null => {
    if (typeof v !== 'string' || v === '' || /^[—–]$/.test(v.trim())) return null;
    return UUID_RE.test(v) ? (names.get(v) ?? 'Removed item') : v;
  };
  return rows.map((r) => {
    const field = typeof r.field === 'string' ? r.field : '';
    const label = humanizeProperty(typeof r.property === 'string' ? r.property : field);
    const isIdField = /Id$/.test(field) && field.length > 2;
    const base = isIdField && label ? label.replace(/\s+Id$/i, '') : label;
    const sku = typeof r.lineSku === 'string' ? r.lineSku : null;
    const raw = lineSubject(r.message);
    // The SKU is already in Code ("SO010847 / APX-TEE-BLK-L"); keep other subjects (e.g. a count location).
    const subject = raw && raw !== sku ? raw : null;
    return {
      ...r,
      // A deleted record has no page to open: its rows render as plain text (every Delete row, and
      // the earlier history of that record), never a link to a missing record.
      href: Number(r.recordDeleted)
        ? null
        : changeLogHref(
            String(r.entityType ?? ''),
            typeof r.code === 'string' ? (r.code.split(' / ')[0] ?? r.code) : null,
            typeof r.href === 'string' ? r.href : null,
          ),
      // Line-level rows (order / PO / return lines, inventory buckets) name the SKU they changed,
      // so four "Quantity" rows on one order are told apart without opening the message.
      property: base && subject ? `${base} · ${subject}` : base,
      fromValue: show(r.fromValue),
      toValue: show(r.toValue),
      message: presentMessage(r.message, names),
    };
  });
}

/** "APX-TEE-NVY-M -> Quantity is modified. 0 --> 1" → "APX-TEE-NVY-M". */
export function lineSubject(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const m = /^(.{1,80}?) -> /.exec(message);
  return m?.[1]?.trim() || null;
}

/** Readable message: raw ids replaced by codes / names, i18n keys humanized, `-->` as an arrow. */
export function presentMessage(message: unknown, names: ReadonlyMap<string, string>): string | null {
  if (typeof message !== 'string' || message.trim() === '') return null;
  return message
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      (id) => names.get(id) ?? 'removed item',
    )
    .replace(/\b[A-Za-z]+\.NameKey\.([A-Za-z0-9_]+)/g, (_, k: string) => humanizeProperty(k) ?? k)
    .replace(/\s+-->\s+/g, ' → ')
    // Stored rows write an em dash for an empty side; the screen never shows one.
    .replace(/(^|\s)[—–](?=\s+→)/g, '$1(empty)')
    .replace(/(→\s+)[—–](?=\s|$)/g, '$1(empty)')
    .replace(/\s+[—–]\s+/g, ' · ')
    .replace(/\.\s+→/g, '. (empty) →')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function listChangeLog(
  db: AppDb,
  auth: AuthContext,
  query: GridQuery,
): Promise<ReportPage<Row>> {
  const page = await runReport<Row>(db, changeLogSql(auth), CHANGE_LOG_DEF, query);
  return { rows: await presentChangeLogRows(db, page.rows), total: page.total };
}

/* ------------------------------------------------------ transaction history */

/**
 * Signed quantity of a ledger row (RA-R2-3). The ledger stores moves unsigned with
 * from/to; a row with only a source location is a decrement (shipment, kitting out,
 * cancel receiving), a row with only a target keeps its stored sign (receipts, and the
 * already-signed adjust/count deltas), and a move keeps its quantity.
 */
export function signedLedgerQty(uomQty: number, hasFrom: boolean, hasTo: boolean): number {
  if (hasFrom && !hasTo) return -Math.abs(uomQty);
  return uomQty;
}

/** Warehouse on-hand change of a ledger row: moves inside the warehouse net to zero. */
export function onHandDelta(uomQty: number, hasFrom: boolean, hasTo: boolean): number {
  if (hasFrom && hasTo) return 0;
  return signedLedgerQty(uomQty, hasFrom, hasTo);
}

/** Running on-hand (client + warehouse + product) after each row; before = after - delta. */
export function runningBalances(
  rows: readonly { readonly delta: number }[],
): { before: number; after: number }[] {
  let bal = 0;
  return rows.map((r) => {
    const before = bal;
    bal += r.delta;
    return { before, after: bal };
  });
}

const SIGNED_QTY = sql.raw(
  `CASE WHEN t.from_location_id IS NOT NULL AND t.to_location_id IS NULL THEN -ABS(t.uom_qty) ELSE t.uom_qty END`,
);
const SIGNED_PACK_QTY = sql.raw(
  `CASE WHEN t.from_location_id IS NOT NULL AND t.to_location_id IS NULL THEN -ABS(t.pack_qty) ELSE t.pack_qty END`,
);
const ON_HAND_DELTA = sql.raw(
  `CASE WHEN t.from_location_id IS NOT NULL AND t.to_location_id IS NOT NULL THEN 0 WHEN t.from_location_id IS NOT NULL THEN -ABS(t.uom_qty) ELSE t.uom_qty END`,
);
const ON_HAND_AFTER = sql.raw(
  `SUM(CASE WHEN t.from_location_id IS NOT NULL AND t.to_location_id IS NOT NULL THEN 0 WHEN t.from_location_id IS NOT NULL THEN -ABS(t.uom_qty) ELSE t.uom_qty END) OVER (PARTITION BY t.warehouse_id, t.client_id, t.product_id ORDER BY t.seq ROWS UNBOUNDED PRECEDING)`,
);

export function transactionsSql(auth: AuthContext): SQL {
  return sql`
    SELECT t.id AS "id", t.seq AS "seq", t.type AS "type",
           t.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse", t.client_id AS "clientId", c.name AS "client",
           o.code AS "orderCode", CASE WHEN o.id IS NOT NULL THEN '/orders/' || o.id END AS "orderHref",
           ol.original_order_code AS "originalOrderCode", COALESCE(ot.name, o.order_type) AS "orderType",
           po.code AS "poCode", CASE WHEN po.id IS NOT NULL THEN '/receiving/' || po.id END AS "poHref", po.reference_number AS "poNumber",
           ro.rma_code AS "rmaNumber", CASE WHEN ro.id IS NOT NULL THEN '/orders/returns/' || ro.id END AS "returnHref",
           r.received_at AS "receivedAt",
           wo.code AS "workOrderCode", CASE WHEN wo.id IS NOT NULL THEN '/work-orders/' || wo.id END AS "workOrderHref",
           t.algorithm_name AS "algorithmName", t.algorithm_rule_name AS "algorithmRuleName",
           p.sku AS "sku", p.name AS "productName", p.barcode AS "barcode", '/products/' || p.id AS "productHref",
           t.from_pack_type AS "fromPackType", t.to_pack_type AS "toPackType", p.uom AS "uomPackType",
           ar.name AS "adjustmentReason",
           fl.code AS "sourceLocation", flg.name AS "fromLocationGroup", fl.area_type AS "fromAreaType",
           tl.code AS "targetLocation", tlg.name AS "toLocationGroup", tl.area_type AS "toAreaType",
           flp.number AS "sourceLp", flp.original_number AS "fromOriginalLp", tlp.number AS "targetLp", tlp.original_number AS "toOriginalLp",
           fplp.number AS "sourceParentLp", fplp.original_number AS "fromOriginalParentLp", fplt.code AS "sourceParentLpType",
           tplp.number AS "targetParentLp", tplp.original_number AS "toOriginalParentLp", tplt.code AS "targetParentLpType",
           cp.code AS "countPlanCode", CASE WHEN cp.id IS NOT NULL THEN '/counts/' || cp.id END AS "countHref",
           ${SIGNED_QTY} AS "uomQty", ${SIGNED_PACK_QTY} AS "packQty", ${ON_HAND_DELTA} AS "netChange",
           (${ON_HAND_AFTER}) - (${ON_HAND_DELTA}) AS "qtyBefore", ${ON_HAND_AFTER} AS "qtyAfter",
           t.from_damage_reason AS "fromDamageReason", t.to_damage_reason AS "toDamageReason",
           t.from_expiry AS "fromExpiry", t.to_expiry AS "toExpiry", t.from_lot AS "fromLot", t.to_lot AS "toLot",
           t.at AS "at", COALESCE(u.name, t.source) AS "user",
           t.from_production_date AS "fromProductionDate", t.to_production_date AS "toProductionDate", t.note AS "note"
    FROM inventory_transactions t
    JOIN products p ON p.id = t.product_id
    JOIN clients c ON c.id = t.client_id
    JOIN warehouses w ON w.id = t.warehouse_id
    LEFT JOIN shipment_orders o ON o.id = t.order_id
    LEFT JOIN order_lines ol ON ol.id = t.order_line_id
    LEFT JOIN lookup_values ot ON ot.id = o.order_type_id
    LEFT JOIN purchase_orders po ON po.id = t.purchase_order_id
    LEFT JOIN receipts r ON r.id = t.receipt_id
    LEFT JOIN return_orders ro ON ro.id = t.return_order_id
    LEFT JOIN work_orders wo ON wo.id = t.work_order_id
    LEFT JOIN count_plans cp ON cp.id = t.count_plan_id
    LEFT JOIN lookup_values ar ON ar.id = t.adjustment_reason_id
    LEFT JOIN locations fl ON fl.id = t.from_location_id
    LEFT JOIN lookup_values flg ON flg.id = fl.location_group_id
    LEFT JOIN locations tl ON tl.id = t.to_location_id
    LEFT JOIN lookup_values tlg ON tlg.id = tl.location_group_id
    LEFT JOIN license_plates flp ON flp.id = t.from_lp_id
    LEFT JOIN license_plates tlp ON tlp.id = t.to_lp_id
    LEFT JOIN license_plates fplp ON fplp.id = t.from_parent_lp_id
    LEFT JOIN lp_types fplt ON fplt.id = fplp.lp_type_id
    LEFT JOIN license_plates tplp ON tplp.id = t.to_parent_lp_id
    LEFT JOIN lp_types tplt ON tplt.id = tplp.lp_type_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE ${inList(sql`t.warehouse_id`, auth.viewScope.warehouseIds)} AND ${clientIn(sql`t.client_id`, auth.viewScope.clientIds)}`;
}

export const listTransactions = async (
  db: AppDb,
  auth: AuthContext,
  q: GridQuery,
): Promise<ReportPage<Row>> => await runReport<Row>(db, transactionsSql(auth), TRANSACTION_HISTORY_DEF, q);

export function serialTransactionsSql(auth: AuthContext): SQL {
  return sql`
    SELECT st.id AS "id", t.type AS "type", p.sku AS "sku", p.name AS "productName", '/products/' || p.id AS "productHref",
           s.primary_serial AS "primarySerial", s.secondary_serial AS "secondarySerial", st.status AS "serialStatus",
           t.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse", t.client_id AS "clientId", c.name AS "client",
           o.code AS "orderCode", CASE WHEN o.id IS NOT NULL THEN '/orders/' || o.id END AS "orderHref",
           ol.original_order_code AS "originalOrderCode",
           po.code AS "poCode", CASE WHEN po.id IS NOT NULL THEN '/receiving/' || po.id END AS "poHref",
           fl.code AS "fromLocation", tl.code AS "toLocation", flp.number AS "fromLp", tlp.number AS "toLp",
           fplp.number AS "sourceParentLp", fplt.code AS "sourceParentLpType", tplp.number AS "targetParentLp", tplt.code AS "targetParentLpType",
           COALESCE(t.to_damage_reason, t.from_damage_reason) AS "damageReason", COALESCE(t.to_expiry, t.from_expiry) AS "expiryDate",
           COALESCE(t.to_lot, t.from_lot) AS "lotNumber", o.store_order_number AS "storeOrderNumber",
           st.at AS "at", COALESCE(u.name, t.source) AS "user"
    FROM serial_transactions st
    JOIN inventory_transactions t ON t.id = st.inventory_transaction_id
    JOIN serial_numbers s ON s.id = st.serial_id
    JOIN products p ON p.id = s.product_id
    JOIN clients c ON c.id = t.client_id
    JOIN warehouses w ON w.id = t.warehouse_id
    LEFT JOIN shipment_orders o ON o.id = t.order_id
    LEFT JOIN order_lines ol ON ol.id = t.order_line_id
    LEFT JOIN purchase_orders po ON po.id = t.purchase_order_id
    LEFT JOIN locations fl ON fl.id = t.from_location_id
    LEFT JOIN locations tl ON tl.id = t.to_location_id
    LEFT JOIN license_plates flp ON flp.id = t.from_lp_id
    LEFT JOIN license_plates tlp ON tlp.id = t.to_lp_id
    LEFT JOIN license_plates fplp ON fplp.id = t.from_parent_lp_id
    LEFT JOIN lp_types fplt ON fplt.id = fplp.lp_type_id
    LEFT JOIN license_plates tplp ON tplp.id = t.to_parent_lp_id
    LEFT JOIN lp_types tplt ON tplt.id = tplp.lp_type_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE ${inList(sql`t.warehouse_id`, auth.viewScope.warehouseIds)} AND ${clientIn(sql`t.client_id`, auth.viewScope.clientIds)}`;
}

export const listSerialTransactions = async (
  db: AppDb,
  auth: AuthContext,
  q: GridQuery,
): Promise<ReportPage<Row>> =>
  await runReport<Row>(db, serialTransactionsSql(auth), SERIAL_TRANSACTIONS_DEF, q);

/* -------------------------------------------------------------- missing log */

export function missingLogSql(auth: AuthContext): SQL {
  return sql`
    SELECT m.id AS "id", m.wave_no AS "waveNo", CASE WHEN m.wave_no IS NOT NULL THEN '/jobs/wave-log?f.waveNo=eq:' || m.wave_no END AS "waveHref", j.code AS "jobCode", CASE WHEN j.id IS NOT NULL THEN '/jobs/' || j.id END AS "jobHref",
           o.code AS "orderCode", CASE WHEN o.id IS NOT NULL THEN '/orders/' || o.id END AS "orderHref",
           p.sku AS "sku", p.name AS "productName", p.barcode AS "barcode", '/products/' || p.id AS "productHref",
           m.pack_type AS "packType", lp.number AS "lpNumber", plp.number AS "parentLp", plt.code AS "parentLpType",
           m.missing_qty AS "missingQty", loc.code AS "location", '/locations/' || loc.id AS "locationHref",
           m.inventory_qty AS "inventoryQty", m.is_retain AS "isRetain", m.entered_at AS "enteredAt",
           COALESCE(u.name, m.entered_by) AS "enteredBy", m.notes AS "notes",
           m.warehouse_id AS "warehouseId", ${warehouseLabel('w')} AS "warehouse", m.client_id AS "clientId", c.name AS "client"
    FROM missing_log m
    JOIN products p ON p.id = m.product_id
    JOIN clients c ON c.id = m.client_id
    JOIN warehouses w ON w.id = m.warehouse_id
    JOIN locations loc ON loc.id = m.location_id
    LEFT JOIN jobs j ON j.id = m.job_id
    LEFT JOIN shipment_orders o ON o.id = m.order_id
    LEFT JOIN license_plates lp ON lp.id = m.lp_id
    LEFT JOIN license_plates plp ON plp.id = lp.parent_lp_id
    LEFT JOIN lp_types plt ON plt.id = plp.lp_type_id
    LEFT JOIN users u ON u.email = m.entered_by OR u.id = m.entered_by
    WHERE ${inList(sql`m.warehouse_id`, auth.viewScope.warehouseIds)} AND ${clientIn(sql`m.client_id`, auth.viewScope.clientIds)}`;
}

export async function listMissingLog(
  db: AppDb,
  auth: AuthContext,
  query: GridQuery,
): Promise<ReportPage<Row>> {
  const page = await runReport<Row>(db, missingLogSql(auth), MISSING_LOG_DEF, query);
  return { rows: page.rows.map((r) => ({ ...r, isRetain: Boolean(r.isRetain) })), total: page.total };
}

/* ----------------------------------------------------------- export history */

/** Grids that exist only for developer tooling; their exports never show in the history. */
export const DEV_GRID_KEY_PREFIX = 'dev-';

/** gridKey → human Export Type ("Shipped & Canceled Orders export"); unknown keys keep their stored title. */
export function exportTypeExpr(): SQL {
  const whens = GRID_EXPORTS.filter((d) => !d.gridKey.startsWith(DEV_GRID_KEY_PREFIX))
    .map((d) => `WHEN ${quote(d.gridKey)} THEN ${quote(`${d.title} export`)}`)
    .join(' ');
  return sql.raw(`CASE b.grid_key ${whens} ELSE b.title END`);
}

/** gridKey → the page the export was started from (checked against src/app routes). */
export const EXPORT_SOURCE_PAGES: Readonly<Record<string, string>> = {
  'orders-backlog': '/orders',
  'orders-shipped': '/orders',
  shipments: '/shipments',
  'shipment-history': '/shipments/history',
  'shipment-plans': '/shipment-plans',
  'shipment-plan-orders': '/shipment-plans/orders',
  'shipment-plan-lps': '/shipment-plans/lps',
  jobs: '/jobs',
  'wave-rules': '/jobs/wave-rules',
  'allocation-exceptions': '/jobs/allocation-exceptions',
  'tasks-order-operations': '/tasks/order-operations',
  'tasks-count': '/tasks/count',
  'tasks-replenishment': '/tasks/replenishment',
  'job-types': '/settings/job-types',
  'return-orders': '/orders/returns',
  vendors: '/organization/vendors',
  'inventory-total': '/inventory',
  'inventory-by-location': '/inventory/by-location',
  'inventory-atp': '/inventory/atp',
  'count-plans': '/counts',
  'count-locations': '/counts/locations',
  'count-skus': '/counts/skus',
  'work-orders': '/work-orders',
  'kit-inventory': '/inventory/kits',
  products: '/products',
  locations: '/locations',
  warehouses: '/settings/warehouses',
  'mobile-carts': '/settings/mobile-carts',
  'lp-types': '/settings/lp-types',
  'lp-numbers': '/settings/lp-numbers',
  'shipment-packages': '/settings/shipment-packages',
  clients: '/clients',
  'billing-contracts': '/billing',
  'integration-monitoring': '/integrations/monitoring/missing-orders',
  'algorithms-putaway': '/automation/algorithms',
  'algorithms-allocation': '/automation/algorithms',
  workflows: '/automation/workflows',
  'monitoring-recent-errors': '/integrations/monitoring/recent-errors',
  'monitoring-workflow-blocked': '/integrations/monitoring/workflow-blocked',
  'monitoring-listing-exceptions': '/integrations/monitoring/listing-exceptions',
  'end-of-day': '/shipments/end-of-day',
  'wave-log': '/jobs/wave-log',
  shortages: '/jobs/shortage',
  'purchase-orders': '/receiving',
  'receiving-history': '/receiving/history',
  'kit-components': '/inventory/kit-components',
  'product-listings': '/products/listings',
  customers: '/organization/customers',
  retailers: '/organization/retailers',
  'billing-reports': '/billing/reports',
  'vas-operations': '/billing/vas',
  'integration-logs': '/integrations/logs/history',
  'integration-orders': '/integrations/logs/orders',
  'integration-products': '/integrations/logs/products',
  'channel-methods': '/integrations/logs/methods',
  'monitoring-health': '/integrations/monitoring',
  'carrier-errors': '/integrations/carrier-errors/label-generation',
  'carrier-errors-rate-call': '/integrations/carrier-errors/rate-call',
  'carrier-errors-void-label': '/integrations/carrier-errors/void-label',
  'rate-shopping-presets': '/automation/rate-shopping',
  'screen-configs': '/settings/screen-configuration',
  'report-inventory-aging': '/reports/inventory-aging',
  'report-location-utilization': '/reports/location-utilization',
  'report-order-lines': '/reports/order-lines',
  'report-export-history': '/reports/export-history',
  'report-channel-sales': '/reports/channel-sales',
  'report-serial-numbers': '/reports/serial-numbers',
  'report-serial-shipments': '/reports/serial-numbers/shipment-history',
  'report-serial-receipts': '/reports/serial-numbers/receiving-history',
  'report-order-inventory': '/reports/order-inventory',
  'report-replenishment': '/reports/replenishment',
  'report-inventory-snapshot': '/reports/inventory-snapshot',
  'report-change-log': '/reports/change-log',
  'report-transaction-history': '/reports/transaction-history',
  'report-serial-transactions': '/reports/transaction-history/serial',
  'report-missing-log': '/reports/missing-log',
  'report-po-receiving': '/reports/po-receiving',
  'report-user-performance': '/reports/user-performance',
  users: '/settings/users',
  roles: '/settings/roles',
  'audit-log': '/settings/audit',
  printouts: '/settings/printouts',
};

/** Link back to the originating grid with the exact filter set that was exported. */
export function exportSourceHref(gridKey: unknown, query: unknown): string | null {
  if (typeof gridKey !== 'string') return null;
  const page = EXPORT_SOURCE_PAGES[gridKey];
  if (!page) return null;
  const params = new URLSearchParams(typeof query === 'string' ? query : '');
  params.delete('page');
  const qs = params.toString();
  return qs ? `${page}?${qs}` : page;
}

/** Plain-language summary of the exported filter set ("2 filters · search \"ABC\""). */
export function exportFilterSummary(query: unknown): string | null {
  if (typeof query !== 'string' || query.trim() === '') return null;
  const params = new URLSearchParams(query);
  const filters = [...params.keys()].filter((k) => k.startsWith('f.')).length;
  const parts: string[] = [];
  if (filters) parts.push(`${filters} filter${filters === 1 ? '' : 's'}`);
  const q = params.get('q');
  if (q) parts.push(`search "${q}"`);
  return parts.length ? parts.join(' · ') : null;
}

/** The viewer's own exports (the tray and this page show the same rows). */
export function exportHistorySql(auth: AuthContext): SQL {
  return sql`
    SELECT b.id AS "id", ${exportTypeExpr()} AS "title", b.grid_key AS "gridKey", b.created_at AS "createdAt", b.finished_at AS "finishedAt",
           b.row_count AS "rowCount", b.error_message AS "errorMessage", b.status AS "status", b.progress AS "progress",
           b.file_id AS "fileId", f.name AS "fileName", b.query AS "query", COALESCE(u.name, u.email) AS "exportedBy",
           CASE WHEN ('&' || COALESCE(b.query, '')) ILIKE '%&f.%' OR ('&' || COALESCE(b.query, '')) ILIKE '%&q=_%' THEN 1 ELSE 0 END AS "hasFilters",
           CASE WHEN b.file_id IS NOT NULL AND b.status = 'completed' THEN '/api/files/' || b.file_id END AS "downloadHref",
           CASE WHEN b.file_id IS NOT NULL AND b.status = 'completed' THEN 'Download' WHEN b.status = 'error' THEN 'No file' ELSE 'Preparing' END AS "action"
    FROM background_tasks b
    LEFT JOIN files f ON f.id = b.file_id
    LEFT JOIN users u ON u.id = b.user_id
    WHERE b.kind = 'export' AND b.user_id = ${auth.user.id} AND (b.grid_key IS NULL OR b.grid_key NOT ILIKE ${`${DEV_GRID_KEY_PREFIX}%`})`;
}

export async function listExportHistory(
  db: AppDb,
  auth: AuthContext,
  q: GridQuery,
): Promise<ReportPage<Row>> {
  const page = await runReport<Row>(db, exportHistorySql(auth), EXPORT_HISTORY_DEF, q);
  return {
    rows: page.rows.map((r) => {
      const { query, ...rest } = r as Row & { query?: unknown };
      return {
        ...rest,
        sourceHref: exportSourceHref(r.gridKey, query),
        filterSummary: exportFilterSummary(query) ?? 'No filters',
      };
    }),
    total: page.total,
  };
}
