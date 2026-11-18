/**
 * WMS tools (warehouse: customers, orders, inventory, kits). Each one runs fixed, parameterized SQL inside `readTenant`, so it
 * only ever sees the configured organization's warehouse (and clients, when narrowed).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_LIMIT } from './config.js';
import { clientScope, readTenant, type Sql, type Tenant, type Tx } from './db.js';
import { dateArg, fail, json, like, limitArg, READ_ONLY } from './util.js';

/** Order statuses the WMS counts as open (apps/wms/src/server/domain/atp.ts). */
export const OPEN_ORDER_STATUSES = [
  'Open',
  'Shortage',
  'On Hold',
  'Ready to Pick',
  'Picking Started',
  'Ready to Sort',
  'Sorting Started',
  'Ready to Pack',
  'Packing Started',
  'Ready to Load',
  'Loading Started',
  'Ready to Ship',
  'Partially Shipped',
] as const;

export interface WmsContext {
  readonly sql: Sql;
  readonly tenant: Tenant;
  readonly defaultLimit: number;
}

const clientArg = z.string().optional().describe('Client (3PL customer) code, e.g. "FRIDA".');
/** `AND c.code = $1` when a client code filter is given. */
function clientCodeFilter(tx: Tx, code: string | undefined, column = 'c.code') {
  return code ? tx`AND ${tx(column)} = ${code}` : tx``;
}

export function registerWmsTools(server: McpServer, ctx: WmsContext): void {
  const { sql, tenant } = ctx;
  const lim = (n: number | undefined) => Math.min(n ?? ctx.defaultLimit, MAX_LIMIT);
  const run = <T>(fn: Parameters<typeof readTenant<T>>[2]) => readTenant<T>(sql, tenant, fn);

  server.registerTool(
    'wms_list_customers',
    {
      title: 'List customers',
      description:
        'List the 3PL customers (WMS "clients") whose goods the warehouse holds: code, name, contacts, billing plan, status.',
      inputSchema: {
        query: z.string().optional().describe('Matches code, name or official name.'),
        status: z.string().optional().describe('e.g. "Active" or "Inactive".'),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async ({ query, status, limit }) =>
      json(
        await run(
          (tx, s) => tx`
            SELECT c.code, c.name, c.official_name, c.contact_name, c.contact_email, c.phone,
              c.billing_plan, c.status, c.currency, c.created_at
            FROM ${s}.clients c
            WHERE true ${clientScope(tx, tenant, 'c.id')}
              ${query ? tx`AND (c.code ILIKE ${like(query)} OR c.name ILIKE ${like(query)} OR c.official_name ILIKE ${like(query)})` : tx``}
              ${status ? tx`AND c.status = ${status}` : tx``}
            ORDER BY c.name
            LIMIT ${lim(limit)}`,
        ),
      ),
  );

  server.registerTool(
    'wms_list_warehouses',
    {
      title: 'List warehouses',
      description: 'List warehouse buildings: code, name, city, state, time zone, active and default flags.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      json(
        await run(
          (tx, s) => tx`
            SELECT w.code, w.name, w.city, w.state, w.timezone, w.type, w.is_active, w.is_default
            FROM ${s}.warehouses w ORDER BY w.is_default DESC, w.code`,
        ),
      ),
  );

  server.registerTool(
    'wms_search_orders',
    {
      title: 'Search orders',
      description:
        'Search outbound shipment orders. Filter by status, client, warehouse, dates, or text (order code, store order number, customer name, tracking number). Returns one row per order plus total_matching.',
      inputSchema: {
        query: z.string().optional().describe('Order code, store order #, customer name, PO or tracking #.'),
        status: z
          .union([z.string(), z.literal('open')])
          .optional()
          .describe(
            'A WMS status like "Ready to Ship" or "Shipped", or "open" for every not-yet-shipped status.',
          ),
        client_code: clientArg,
        warehouse_code: z.string().optional(),
        order_type: z.string().optional().describe('e.g. "D2C" or "B2B".'),
        order_date_from: dateArg.describe('YYYY-MM-DD, inclusive.'),
        order_date_to: dateArg.describe('YYYY-MM-DD, inclusive.'),
        late_only: z
          .boolean()
          .optional()
          .describe('Only open orders whose expected ship date is before today.'),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      json(
        await run(
          (tx, s) => tx`
            SELECT o.code, o.status, c.code AS client, w.code AS warehouse, o.order_type, o.channel,
              o.store_name, o.store_order_number, o.retailer_po, o.customer_name, o.company_name,
              o.ship_city, o.ship_state, o.ship_country, o.total_quantity, o.priority,
              o.order_date, o.expected_ship_date, o.shipped_at, o.carrier, o.shipping_service,
              o.tracking_number, count(*) OVER () AS total_matching
            FROM ${s}.shipment_orders o
            JOIN ${s}.clients c ON c.id = o.client_id
            JOIN ${s}.warehouses w ON w.id = o.warehouse_id
            WHERE o.deleted_at IS NULL ${clientScope(tx, tenant, 'o.client_id')}
              ${clientCodeFilter(tx, a.client_code)}
              ${a.warehouse_code ? tx`AND w.code = ${a.warehouse_code}` : tx``}
              ${
                a.status === 'open' || a.late_only
                  ? tx`AND o.status IN ${tx([...OPEN_ORDER_STATUSES])}`
                  : a.status
                    ? tx`AND o.status = ${a.status}`
                    : tx``
              }
              ${a.late_only ? tx`AND o.expected_ship_date IS NOT NULL AND o.expected_ship_date < to_char(current_date, 'YYYY-MM-DD')` : tx``}
              ${a.order_type ? tx`AND o.order_type = ${a.order_type}` : tx``}
              ${a.order_date_from ? tx`AND o.order_date >= ${a.order_date_from}` : tx``}
              ${a.order_date_to ? tx`AND substr(o.order_date, 1, 10) <= ${a.order_date_to}` : tx``}
              ${
                a.query
                  ? tx`AND (o.code ILIKE ${like(a.query)} OR o.store_order_number ILIKE ${like(a.query)}
                      OR o.customer_name ILIKE ${like(a.query)} OR o.retailer_po ILIKE ${like(a.query)}
                      OR o.tracking_number ILIKE ${like(a.query)} OR o.client_reference_code ILIKE ${like(a.query)})`
                  : tx``
              }
            ORDER BY o.order_date DESC, o.code DESC
            LIMIT ${lim(a.limit)}`,
        ),
      ),
  );

  server.registerTool(
    'wms_get_order',
    {
      title: 'Get order',
      description:
        'One shipment order with its ship-to, shipping details and lines (SKU, ordered, allocated, picked, packed, shipped, cancelled).',
      inputSchema: {
        code: z.string().describe('The WMS order code, or the store order number.'),
      },
      annotations: READ_ONLY,
    },
    async ({ code }) => {
      const result = await run(async (tx, s) => {
        const orders = await tx`
          SELECT o.id, o.code, o.status, c.code AS client, c.name AS client_name, w.code AS warehouse,
            o.order_type, o.channel, o.store_name, o.store_order_number, o.retailer_po, o.client_reference_code,
            o.customer_name, o.company_name, o.customer_email, o.customer_phone,
            o.ship_address, o.ship_city, o.ship_state, o.ship_zip, o.ship_country,
            o.priority, o.order_date, o.expected_ship_date, o.shipped_at, o.delivered_at, o.cancelled_at,
            o.carrier, o.shipping_service, o.tracking_number, o.tracking_numbers,
            o.total_quantity, o.total_weight_oz, o.total_shipping_cost, o.is_back_order,
            o.pick_short_status, o.pack_short_status, o.note, o.packing_instructions, o.is_gift
          FROM ${s}.shipment_orders o
          JOIN ${s}.clients c ON c.id = o.client_id
          JOIN ${s}.warehouses w ON w.id = o.warehouse_id
          WHERE o.deleted_at IS NULL ${clientScope(tx, tenant, 'o.client_id')}
            AND (o.code = ${code} OR o.store_order_number = ${code})
          ORDER BY (o.code = ${code}) DESC, o.order_date DESC
          LIMIT 5`;
        if (orders.length === 0) return null;
        const [order, ...others] = orders;
        const lines = await tx`
          SELECT p.sku, p.name AS product, l.quantity, l.allocated_quantity, l.picked_quantity,
            l.packed_quantity, l.shipped_quantity, l.cancelled_quantity, l.pack_type, l.lot_number,
            l.unit_price, kp.sku AS kit_sku
          FROM ${s}.order_lines l
          JOIN ${s}.products p ON p.id = l.product_id
          LEFT JOIN ${s}.products kp ON kp.id = l.kit_product_id
          WHERE l.order_id = ${order!.id}
          ORDER BY p.sku`;
        const { id: _id, ...header } = order!;
        return {
          ...header,
          lines,
          ...(others.length > 0 ? { other_matches: others.map((o) => o.code) } : {}),
        };
      });
      return result ? json(result) : fail(`No order found with code or store order number "${code}".`);
    },
  );

  server.registerTool(
    'wms_order_status_summary',
    {
      title: 'Order status summary',
      description:
        'Counts of orders and units by status (optionally per client), plus how many open orders are past their expected ship date.',
      inputSchema: {
        client_code: clientArg,
        by_client: z.boolean().optional().describe('Break the counts down per client.'),
        open_only: z.boolean().optional().describe('Only not-yet-shipped statuses (default true).'),
      },
      annotations: READ_ONLY,
    },
    async ({ client_code, by_client, open_only }) =>
      json(
        await run(
          (tx, s) => tx`
            SELECT ${by_client ? tx`c.code AS client,` : tx``} o.status,
              count(*) AS orders, COALESCE(sum(o.total_quantity), 0) AS units,
              count(*) FILTER (WHERE o.expected_ship_date < to_char(current_date, 'YYYY-MM-DD')
                AND o.status IN ${tx([...OPEN_ORDER_STATUSES])}) AS past_expected_ship_date
            FROM ${s}.shipment_orders o
            JOIN ${s}.clients c ON c.id = o.client_id
            WHERE o.deleted_at IS NULL ${clientScope(tx, tenant, 'o.client_id')}
              ${clientCodeFilter(tx, client_code)}
              ${open_only === false ? tx`` : tx`AND o.status IN ${tx([...OPEN_ORDER_STATUSES])}`}
            GROUP BY ${by_client ? tx`c.code,` : tx``} o.status
            ORDER BY ${by_client ? tx`c.code,` : tx``} orders DESC`,
        ),
      ),
  );

  server.registerTool(
    'wms_search_products',
    {
      title: 'Search products',
      description: 'Search SKUs by SKU, name or barcode. Shows client, kit flag, status and reorder point.',
      inputSchema: {
        query: z.string().optional().describe('SKU, product name or barcode.'),
        client_code: clientArg,
        kits_only: z.boolean().optional(),
        status: z.string().optional().describe('e.g. "Active".'),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      json(
        await run(
          (tx, s) => tx`
            SELECT p.sku, p.name, c.code AS client, p.barcode, p.category, p.uom, p.is_kit, p.kit_type,
              p.status, p.reorder_point, p.min_safety_stock, count(*) OVER () AS total_matching
            FROM ${s}.products p
            JOIN ${s}.clients c ON c.id = p.client_id
            WHERE true ${clientScope(tx, tenant, 'p.client_id')}
              ${clientCodeFilter(tx, a.client_code)}
              ${a.kits_only ? tx`AND p.is_kit` : tx``}
              ${a.status ? tx`AND p.status = ${a.status}` : tx``}
              ${a.query ? tx`AND (p.sku ILIKE ${like(a.query)} OR p.name ILIKE ${like(a.query)} OR p.barcode = ${a.query})` : tx``}
            ORDER BY p.sku
            LIMIT ${lim(a.limit)}`,
        ),
      ),
  );

  server.registerTool(
    'wms_get_inventory',
    {
      title: 'Get inventory',
      description:
        'Stock for one or more SKUs: on hand, allocated, available (on hand minus allocated), damaged, and units on open orders. Group by warehouse (default) or by location.',
      inputSchema: {
        sku: z.string().optional().describe('Exact SKU. Leave empty and use query to match several.'),
        query: z.string().optional().describe('Partial SKU or product name.'),
        client_code: clientArg,
        warehouse_code: z.string().optional(),
        by_location: z
          .boolean()
          .optional()
          .describe('One row per location and lot instead of per warehouse.'),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async (a) => {
      if (!a.sku && !a.query) return fail('Give a sku or a query.');
      const rows = await run((tx, s) => {
        const productFilter = tx`
          ${clientScope(tx, tenant, 'p.client_id')}
          ${clientCodeFilter(tx, a.client_code)}
          ${a.sku ? tx`AND p.sku = ${a.sku}` : tx`AND (p.sku ILIKE ${like(a.query!)} OR p.name ILIKE ${like(a.query!)})`}
          ${a.warehouse_code ? tx`AND w.code = ${a.warehouse_code}` : tx``}`;
        if (a.by_location) {
          return tx`
            SELECT p.sku, p.name AS product, c.code AS client, w.code AS warehouse, loc.code AS location,
              i.lot_number, i.expiry_date, i.status, i.on_hand, i.allocated, (i.on_hand - i.allocated) AS available,
              i.damaged
            FROM ${s}.inventory i
            JOIN ${s}.products p ON p.id = i.product_id
            JOIN ${s}.clients c ON c.id = p.client_id
            JOIN ${s}.warehouses w ON w.id = i.warehouse_id
            JOIN ${s}.locations loc ON loc.id = i.location_id
            WHERE i.on_hand <> 0 ${productFilter}
            ORDER BY p.sku, w.code, loc.code
            LIMIT ${lim(a.limit)}`;
        }
        return tx`
          WITH so AS (
            SELECT l.product_id, o.warehouse_id,
              sum(GREATEST(l.quantity - l.cancelled_quantity - l.shipped_quantity, 0)) AS open_order_qty
            FROM ${s}.order_lines l JOIN ${s}.shipment_orders o ON o.id = l.order_id
            WHERE o.deleted_at IS NULL AND o.status IN ${tx([...OPEN_ORDER_STATUSES])}
            GROUP BY l.product_id, o.warehouse_id
          )
          SELECT p.sku, p.name AS product, c.code AS client, w.code AS warehouse,
            sum(i.on_hand) AS on_hand, sum(i.allocated) AS allocated,
            sum(i.on_hand - i.allocated) AS available, sum(i.damaged) AS damaged,
            COALESCE(max(so.open_order_qty), 0) AS open_order_qty,
            count(DISTINCT i.location_id) AS locations, p.reorder_point
          FROM ${s}.inventory i
          JOIN ${s}.products p ON p.id = i.product_id
          JOIN ${s}.clients c ON c.id = p.client_id
          JOIN ${s}.warehouses w ON w.id = i.warehouse_id
          LEFT JOIN so ON so.product_id = i.product_id AND so.warehouse_id = i.warehouse_id
          WHERE true ${productFilter}
          GROUP BY p.id, p.sku, p.name, c.code, w.code, p.reorder_point
          ORDER BY p.sku, w.code
          LIMIT ${lim(a.limit)}`;
      });
      return rows.length > 0 ? json(rows) : fail('No inventory found for that SKU or search.');
    },
  );

  server.registerTool(
    'wms_low_stock',
    {
      title: 'Low stock',
      description:
        'Active SKUs whose available quantity (on hand minus allocated, all warehouses) is at or below their reorder point.',
      inputSchema: { client_code: clientArg, limit: limitArg },
      annotations: READ_ONLY,
    },
    async ({ client_code, limit }) =>
      json(
        await run(
          (tx, s) => tx`
            SELECT p.sku, p.name, c.code AS client, p.reorder_point,
              COALESCE(sum(i.on_hand - i.allocated), 0) AS available
            FROM ${s}.products p
            JOIN ${s}.clients c ON c.id = p.client_id
            LEFT JOIN ${s}.inventory i ON i.product_id = p.id
            WHERE p.status = 'Active' AND p.reorder_point > 0 ${clientScope(tx, tenant, 'p.client_id')}
              ${clientCodeFilter(tx, client_code)}
            GROUP BY p.id, p.sku, p.name, c.code, p.reorder_point
            HAVING COALESCE(sum(i.on_hand - i.allocated), 0) <= p.reorder_point
            ORDER BY (COALESCE(sum(i.on_hand - i.allocated), 0) - p.reorder_point), p.sku
            LIMIT ${lim(limit)}`,
        ),
      ),
  );

  server.registerTool(
    'wms_get_kit',
    {
      title: 'Get kit',
      description:
        'A kit SKU with its bill of materials: each component, quantity per kit, component stock available, and how many kits the available components could build.',
      inputSchema: {
        sku: z.string().describe('Kit SKU.'),
        client_code: clientArg,
        warehouse_code: z.string().optional().describe('Limit component stock to one warehouse.'),
      },
      annotations: READ_ONLY,
    },
    async (a) => {
      const result = await run(async (tx, s) => {
        const [kit] = await tx`
          SELECT p.id, p.sku, p.name, c.code AS client, p.kit_type, p.status, p.is_kit
          FROM ${s}.products p JOIN ${s}.clients c ON c.id = p.client_id
          WHERE p.sku = ${a.sku} ${clientScope(tx, tenant, 'p.client_id')} ${clientCodeFilter(tx, a.client_code)}
          ORDER BY c.code LIMIT 1`;
        if (!kit) return null;
        const components = await tx`
          SELECT cp.sku, cp.name, k.quantity AS qty_per_kit, k.pack_type,
            COALESCE(sum(i.on_hand - i.allocated), 0) AS available
          FROM ${s}.kit_components k
          JOIN ${s}.products cp ON cp.id = k.component_product_id
          LEFT JOIN ${s}.inventory i ON i.product_id = cp.id
            ${a.warehouse_code ? tx`AND i.warehouse_id IN (SELECT id FROM ${s}.warehouses WHERE code = ${a.warehouse_code})` : tx``}
          WHERE k.kit_product_id = ${kit.id}
          GROUP BY cp.sku, cp.name, k.quantity, k.pack_type
          ORDER BY cp.sku`;
        const buildable =
          components.length === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  ...components.map((c) =>
                    Number(c.qty_per_kit) > 0
                      ? Math.floor(Number(c.available) / Number(c.qty_per_kit))
                      : Infinity,
                  ),
                ),
              );
        const { id: _id, ...header } = kit;
        return {
          ...header,
          components,
          buildable_from_available_components: Number.isFinite(buildable) ? buildable : 0,
        };
      });
      return result ? json(result) : fail(`No product found with SKU "${a.sku}".`);
    },
  );

  server.registerTool(
    'wms_list_work_orders',
    {
      title: 'List kitting work orders',
      description:
        'Kitting work orders: code, status, kit SKU, requested and processed quantities, planned and actual dates.',
      inputSchema: {
        status: z
          .string()
          .optional()
          .describe('"Open", "In Process", "Completed", "Shortage" or "Cancelled".'),
        client_code: clientArg,
        kit_sku: z.string().optional(),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      json(
        await run(
          (tx, s) => tx`
            SELECT wo.code, wo.status, c.code AS client, w.code AS warehouse, kp.sku AS kit_sku,
              kp.name AS kit_name, wo.requested_qty, wo.processed_qty, wo.build_for,
              wo.planned_start_at, wo.planned_finish_at, wo.actual_start_at, wo.actual_finish_at,
              wo.created_at
            FROM ${s}.work_orders wo
            JOIN ${s}.clients c ON c.id = wo.client_id
            JOIN ${s}.warehouses w ON w.id = wo.warehouse_id
            LEFT JOIN ${s}.products kp ON kp.id = wo.kit_product_id
            WHERE true ${clientScope(tx, tenant, 'wo.client_id')}
              ${clientCodeFilter(tx, a.client_code)}
              ${a.status ? tx`AND wo.status = ${a.status}` : tx``}
              ${a.kit_sku ? tx`AND kp.sku = ${a.kit_sku}` : tx``}
            ORDER BY wo.created_at DESC
            LIMIT ${lim(a.limit)}`,
        ),
      ),
  );
}
