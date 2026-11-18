/**
 * The MCP tools. Every one is a read: it lists or fetches Logiwa records through the read-only
 * client and returns them as JSON. None of them can create, change, ship, receive or cancel anything.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isRecord, LogiwaError, toRecord, type LogiwaClient } from './client.js';
import type { Config } from './config.js';
import { getPath, MAX_STATUS_PAGES, type EndpointName } from './endpoints.js';
import {
  CLIENT_ID_KEYS,
  CLIENT_NAME_KEYS,
  clientFilter,
  dateFilters,
  Lister,
  warehouseFilter,
  type Filter,
  type ListResult,
} from './query.js';
import {
  compact,
  dateArg,
  fail,
  firstField,
  fullArg,
  GUID,
  json,
  norm,
  pageArg,
  pageSizeArg,
  pick,
  READ_ONLY,
} from './util.js';

/** Shipment order statuses Logiwa counts as done; everything else is still open. */
export const CLOSED_ORDER_STATUSES = ['Shipped', 'Cancelled'] as const;

const ORDER_SUMMARY_KEYS = [
  'identifier',
  'code',
  'clientDisplayName',
  'clientIdentifier',
  'warehouseCode',
  'shipmentOrderStatusName',
  'shipmentOrderTypeName',
  'shipmentOrderDate',
  'expectedShipmentDate',
  'actualShipmentDate',
  'channelName',
  'channelOrderNumber',
  'po',
  'customerFullName',
  'companyName',
  'shipmentCity',
  'shipmentStateCode',
  'shipmentCountryCode',
  'carrierName',
  'shippingOptionName',
  'totalQuantity',
  'isBackOrder',
  'isPartial',
  'priority',
  'updatedDateTime',
] as const;

const PO_SUMMARY_KEYS = [
  'identifier',
  'code',
  'clientDisplayName',
  'clientIdentifier',
  'warehouseCode',
  'purchaseOrderStatusName',
  'statusName',
  'vendorName',
  'orderDate',
  'expectedArrivalDate',
  'createdDateTime',
  'updatedDateTime',
] as const;

const clientArg = z
  .string()
  .optional()
  .describe('Client: its Logiwa identifier (GUID) or part of its name, e.g. "Explore".');
const warehouseArg = z.string().optional().describe('Warehouse: its Logiwa identifier (GUID) or its code.');
const skuArg = z.string().optional().describe('Exact SKU.');

export function registerTools(server: McpServer, client: LogiwaClient, config: Config): void {
  const lister = new Lister(client, config);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      return json(await fn());
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  const shape = (result: ListResult, full: boolean | undefined, keys?: readonly string[]) => ({
    ...result,
    rows: result.rows.map((row) => (full ? row : keys ? summarize(row, keys) : compact(row))),
  });

  const one = async (name: EndpointName, id: string, full?: boolean, keys?: readonly string[]) => {
    const row = toRecord(await client.get(getPath(name, id)));
    if (!row || !lister.inScope(name, row)) throw new LogiwaError('No record found with that identifier.');
    return full || !keys ? compact(row) : { ...summarize(row, keys), lines: lines(row) };
  };

  server.registerTool(
    'logiwa_whoami',
    {
      title: 'Logiwa connection',
      description:
        'Which Logiwa iO host this server reads, how it signs in, and any client narrowing. No secrets.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(async () => ({
        host: new URL(config.baseUrl).host,
        auth: config.auth.kind === 'password' ? 'API user (email and password)' : 'pre-issued token',
        clients: config.clients.length ? config.clients : 'all clients the API user can see',
        defaultPageSize: config.pageSize,
        readOnly: true,
      })),
  );

  server.registerTool(
    'logiwa_list_clients',
    {
      title: 'List clients',
      description:
        'The 3PL clients (customers) set up in Logiwa, with their identifiers. Use an identifier to filter other tools.',
      inputSchema: {
        query: z.string().optional().describe('Part of the client name.'),
        page: pageArg,
        page_size: pageSizeArg,
      },
      annotations: READ_ONLY,
    },
    async ({ query, page, page_size }) =>
      run(async () => {
        const filters: Filter[] = query
          ? [
              {
                value: query,
                keys: ['name', 'displayName', 'clientName', 'code', 'description'],
                match: 'contains',
                label: 'name',
              },
            ]
          : [];
        const result = await lister.list('clients', { page, pageSize: page_size, filters });
        if (config.clients.length) {
          result.rows = result.rows.filter((r) => {
            const id = firstField(r, ['identifier', ...CLIENT_ID_KEYS]);
            return typeof id === 'string' && config.clients.includes(id.toLowerCase());
          });
          result.returned = result.rows.length;
        }
        return shape(result, false);
      }),
  );

  server.registerTool(
    'logiwa_list_warehouses',
    {
      title: 'List warehouses',
      description: 'Warehouses set up in Logiwa, with their identifiers and codes.',
      inputSchema: { page: pageArg, page_size: pageSizeArg },
      annotations: READ_ONLY,
    },
    async ({ page, page_size }) =>
      run(async () => shape(await lister.list('warehouses', { page, pageSize: page_size }), false)),
  );

  const orderFilters = (a: {
    client?: string;
    warehouse?: string;
    status?: string;
    code?: string;
    sku?: string;
    from?: string;
    to?: string;
  }): Filter[] => {
    const f: Filter[] = [...clientFilter(lister.scopeClient(a.client)), ...warehouseFilter(a.warehouse)];
    if (a.status && norm(a.status) === 'open') {
      f.push({
        value: [...CLOSED_ORDER_STATUSES],
        keys: ['shipmentOrderStatusName'],
        match: 'notIn',
        label: 'status',
      });
    } else if (a.status) {
      f.push({
        param: 'Status',
        op: 'eq',
        value: a.status,
        keys: ['shipmentOrderStatusName'],
        match: 'eq',
        label: 'status',
      });
    }
    if (a.code) {
      f.push({
        param: 'Code',
        op: 'eq',
        value: a.code,
        keys: ['code', 'channelOrderNumber'],
        match: 'eq',
        label: 'code',
      });
    }
    if (a.sku)
      f.push({ param: 'Sku', op: 'eq', value: a.sku, keys: ['products'], match: 'lineSku', label: 'sku' });
    f.push(...dateFilters('ShipmentOrderDate', ['shipmentOrderDate'], a.from, a.to));
    return f;
  };

  server.registerTool(
    'logiwa_search_orders',
    {
      title: 'Search shipment orders',
      description:
        'Outbound shipment orders, newest data from Logiwa. Filter by client, warehouse, status ("open" means not Shipped or Cancelled; ' +
        'others: Open, Shortage, OnHold, ReadyToPick, PickingStarted, ReadyToPack, PackingStarted, ReadyToShip, Shipped, Cancelled), ' +
        'order code, SKU and order date range. Paged: check totalInLogiwa and ask for the next page when needed.',
      inputSchema: {
        client: clientArg,
        warehouse: warehouseArg,
        status: z.string().optional().describe('A status name, or "open".'),
        code: z.string().optional().describe('Logiwa order code or the store (channel) order number.'),
        sku: skuArg,
        from: dateArg.describe('Order date from (YYYY-MM-DD).'),
        to: dateArg.describe('Order date to (YYYY-MM-DD).'),
        page: pageArg,
        page_size: pageSizeArg,
        full: fullArg,
      },
      annotations: READ_ONLY,
    },
    async ({ page, page_size, full, ...a }) =>
      run(async () => {
        const result = await lister.list('shipmentOrders', {
          page,
          pageSize: page_size,
          filters: orderFilters(a),
        });
        return shape(result, full, ORDER_SUMMARY_KEYS);
      }),
  );

  server.registerTool(
    'logiwa_get_order',
    {
      title: 'Get a shipment order',
      description:
        'One shipment order with its lines (SKU, ordered, picked, packed, shipped quantities). Give its identifier (GUID) or its code.',
      inputSchema: {
        id: z
          .string()
          .min(1)
          .max(100)
          .describe('Order identifier (GUID), Logiwa order code, or store order number.'),
        full: fullArg,
      },
      annotations: READ_ONLY,
    },
    async ({ id, full }) =>
      run(async () => {
        if (GUID.test(id)) return one('shipmentOrders', id, full, ORDER_SUMMARY_KEYS);
        const found = await lister.list('shipmentOrders', {
          page: 1,
          pageSize: 50,
          filters: orderFilters({ code: id }),
        });
        const row = found.rows[0];
        if (!row)
          throw new LogiwaError(
            `No order found with code ${id} on the first page Logiwa returned. Try its identifier.`,
          );
        const identifier = firstField(row, ['identifier']);
        return typeof identifier === 'string' && GUID.test(identifier)
          ? one('shipmentOrders', identifier, full, ORDER_SUMMARY_KEYS)
          : full
            ? compact(row)
            : { ...summarize(row, ORDER_SUMMARY_KEYS), lines: lines(row) };
      }),
  );

  server.registerTool(
    'logiwa_order_status_summary',
    {
      title: 'Order counts by status',
      description:
        `Counts shipment orders by status (and by client), for a client, warehouse and order date range. Reads up to ${MAX_STATUS_PAGES} pages ` +
        'of 200 orders; says when it stopped early. Narrow the date range for big clients.',
      inputSchema: {
        client: clientArg,
        warehouse: warehouseArg,
        from: dateArg.describe('Order date from (YYYY-MM-DD).'),
        to: dateArg.describe('Order date to (YYYY-MM-DD).'),
        max_pages: z
          .number()
          .int()
          .min(1)
          .max(MAX_STATUS_PAGES)
          .optional()
          .describe(`Pages of 200 to read (default 5, max ${MAX_STATUS_PAGES}).`),
      },
      annotations: READ_ONLY,
    },
    async ({ client, warehouse, from, to, max_pages }) =>
      run(async () => {
        const filters = orderFilters({ client, warehouse, from, to });
        const byStatus: Record<string, { orders: number; units: number }> = {};
        const byClient: Record<string, Record<string, number>> = {};
        let scanned = 0;
        let total: number | null = null;
        let complete = false;
        const notes = new Set<string>();
        for (let page = 1; page <= (max_pages ?? 5); page++) {
          const res = await lister.list('shipmentOrders', { page, pageSize: 200, filters });
          total = res.totalInLogiwa ?? total;
          res.notes?.forEach((n) => notes.add(n));
          for (const row of res.rows) {
            const status = String(firstField(row, ['shipmentOrderStatusName']) ?? 'Unknown');
            const who = String(
              firstField(row, CLIENT_NAME_KEYS) ?? firstField(row, CLIENT_ID_KEYS) ?? 'Unknown',
            );
            const units = Number(firstField(row, ['totalQuantity']) ?? 0);
            byStatus[status] ??= { orders: 0, units: 0 };
            byStatus[status].orders++;
            byStatus[status].units += Number.isFinite(units) ? units : 0;
            byClient[who] ??= {};
            byClient[who][status] = (byClient[who][status] ?? 0) + 1;
          }
          scanned += res.rows.length;
          const pageCount = res.rows.length;
          if (pageCount === 0 || (total != null && page * 200 >= total)) {
            complete = true;
            break;
          }
        }
        const open = Object.entries(byStatus)
          .filter(([s]) => !CLOSED_ORDER_STATUSES.some((c) => norm(c) === norm(s)))
          .reduce((n, [, v]) => n + v.orders, 0);
        return {
          ordersCounted: scanned,
          totalInLogiwa: total,
          complete,
          openOrders: open,
          byStatus,
          byClient,
          ...(complete
            ? {}
            : {
                note: 'Stopped before the last page; counts are partial. Narrow the dates or raise max_pages.',
              }),
          ...(notes.size ? { notes: [...notes] } : {}),
        };
      }),
  );

  const stockInput = {
    client: clientArg,
    warehouse: warehouseArg,
    sku: skuArg,
    page: pageArg,
    page_size: pageSizeArg,
  };
  const stockFilters = (a: { client?: string; warehouse?: string; sku?: string }): Filter[] => [
    ...clientFilter(lister.scopeClient(a.client)),
    ...warehouseFilter(a.warehouse),
    ...(a.sku
      ? [
          {
            param: 'Sku',
            op: 'eq',
            value: a.sku,
            keys: ['productSKU', 'sku', 'productSku', 'Sku'],
            match: 'eq',
            label: 'sku',
          } as const,
        ]
      : []),
  ];

  server.registerTool(
    'logiwa_list_inventory',
    {
      title: 'Inventory by location',
      description:
        'On-hand inventory rows from Logiwa (SKU, location, lot, quantities) for a client, warehouse or SKU.',
      inputSchema: {
        ...stockInput,
        location: z.string().optional().describe('Location code, e.g. "A-01-02".'),
      },
      annotations: READ_ONLY,
    },
    async ({ page, page_size, location, ...a }) =>
      run(async () => {
        const filters = stockFilters(a);
        if (location) {
          filters.push({
            value: location,
            keys: ['locationCode', 'locationName', 'location'],
            match: 'eq',
            label: 'location',
          });
        }
        return shape(await lister.list('inventory', { page, pageSize: page_size, filters }), false);
      }),
  );

  server.registerTool(
    'logiwa_inventory_totals',
    {
      title: 'Inventory totals per SKU',
      description:
        "Logiwa's Total Inventory report: on hand, allocated and available per SKU, for a client, warehouse or SKU.",
      inputSchema: stockInput,
      annotations: READ_ONLY,
    },
    async ({ page, page_size, ...a }) =>
      run(async () =>
        shape(
          await lister.list('totalInventory', { page, pageSize: page_size, filters: stockFilters(a) }),
          false,
        ),
      ),
  );

  server.registerTool(
    'logiwa_available_to_promise',
    {
      title: 'Available to promise',
      description: "Logiwa's Available to Promise report: what can still be sold or shipped per SKU.",
      inputSchema: stockInput,
      annotations: READ_ONLY,
    },
    async ({ page, page_size, ...a }) =>
      run(async () =>
        shape(
          await lister.list('availableToPromise', { page, pageSize: page_size, filters: stockFilters(a) }),
          false,
        ),
      ),
  );

  server.registerTool(
    'logiwa_list_products',
    {
      title: 'List products',
      description:
        'Products (SKUs) in Logiwa for a client, or one SKU. Use logiwa_get_product for full detail.',
      inputSchema: {
        client: clientArg,
        sku: skuArg,
        query: z.string().optional().describe('Part of the product name or SKU.'),
        page: pageArg,
        page_size: pageSizeArg,
      },
      annotations: READ_ONLY,
    },
    async ({ client, sku, query, page, page_size }) =>
      run(async () => {
        const filters = stockFilters({ client, sku });
        if (query)
          filters.push({
            value: query,
            keys: ['name', 'productName', 'sku', 'productSKU', 'description'],
            match: 'contains',
            label: 'query',
          });
        return shape(await lister.list('products', { page, pageSize: page_size, filters }), false);
      }),
  );

  server.registerTool(
    'logiwa_get_product',
    {
      title: 'Get a product',
      description:
        'One product by its Logiwa identifier (GUID): pack types, barcodes, dimensions and settings.',
      inputSchema: { id: z.string().regex(GUID, 'Use the product identifier (GUID)') },
      annotations: READ_ONLY,
    },
    async ({ id }) => run(async () => one('products', id, true)),
  );

  server.registerTool(
    'logiwa_list_purchase_orders',
    {
      title: 'List purchase orders',
      description:
        'Inbound purchase orders (what is expected to arrive) for a client or warehouse, by code, status or date.',
      inputSchema: {
        client: clientArg,
        warehouse: warehouseArg,
        status: z.string().optional().describe('Status name, e.g. "Open" or "Completed".'),
        code: z.string().optional().describe('Purchase order code.'),
        from: dateArg.describe('Created from (YYYY-MM-DD).'),
        to: dateArg.describe('Created to (YYYY-MM-DD).'),
        page: pageArg,
        page_size: pageSizeArg,
        full: fullArg,
      },
      annotations: READ_ONLY,
    },
    async ({ client, warehouse, status, code, from, to, page, page_size, full }) =>
      run(async () => {
        const filters: Filter[] = [
          ...clientFilter(lister.scopeClient(client)),
          ...warehouseFilter(warehouse),
        ];
        if (status) {
          filters.push({
            param: 'Status',
            op: 'eq',
            value: status,
            keys: ['purchaseOrderStatusName', 'statusName'],
            match: 'eq',
            label: 'status',
          });
        }
        if (code)
          filters.push({ param: 'Code', op: 'eq', value: code, keys: ['code'], match: 'eq', label: 'code' });
        filters.push(...dateFilters('CreatedDateTime', ['createdDateTime', 'orderDate'], from, to));
        return shape(
          await lister.list('purchaseOrders', { page, pageSize: page_size, filters }),
          full,
          PO_SUMMARY_KEYS,
        );
      }),
  );

  server.registerTool(
    'logiwa_get_purchase_order',
    {
      title: 'Get a purchase order',
      description:
        'One purchase order with its lines (SKU, expected and received quantities), by identifier (GUID).',
      inputSchema: { id: z.string().regex(GUID, 'Use the purchase order identifier (GUID)'), full: fullArg },
      annotations: READ_ONLY,
    },
    async ({ id, full }) => run(async () => one('purchaseOrders', id, full, PO_SUMMARY_KEYS)),
  );

  const historyInput = {
    client: clientArg,
    warehouse: warehouseArg,
    sku: skuArg,
    from: dateArg.describe('From (YYYY-MM-DD).'),
    to: dateArg.describe('To (YYYY-MM-DD).'),
    page: pageArg,
    page_size: pageSizeArg,
  };

  server.registerTool(
    'logiwa_shipment_history',
    {
      title: 'Shipment history',
      description:
        "Logiwa's Shipment History report: what shipped, when, with which carrier and tracking number.",
      inputSchema: historyInput,
      annotations: READ_ONLY,
    },
    async ({ from, to, page, page_size, ...a }) =>
      run(async () => {
        const filters = [
          ...stockFilters(a),
          ...dateFilters(
            'ShipmentDate',
            ['shipmentDate', 'shipmentDateTime', 'actualShipmentDate'],
            from,
            to,
          ),
        ];
        return shape(await lister.list('shipmentHistory', { page, pageSize: page_size, filters }), false);
      }),
  );

  server.registerTool(
    'logiwa_receiving_history',
    {
      title: 'Receiving history',
      description:
        "Logiwa's Receiving History report: what was received, when, against which purchase order.",
      inputSchema: historyInput,
      annotations: READ_ONLY,
    },
    async ({ from, to, page, page_size, ...a }) =>
      run(async () => {
        const filters = [
          ...stockFilters(a),
          ...dateFilters(
            'ReceivingDate',
            ['receivingDate', 'receivedDate', 'receiptDate', 'createdDateTime'],
            from,
            to,
          ),
        ];
        return shape(await lister.list('receivingHistory', { page, pageSize: page_size, filters }), false);
      }),
  );
}

function summarize(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out = pick(row, keys);
  const products = firstField(row, ['products', 'lines', 'details']);
  if (Array.isArray(products)) out.lineCount = products.length;
  return Object.keys(out).length > 1 ? out : compact(row);
}

function lines(row: Record<string, unknown>): Record<string, unknown>[] | undefined {
  const products = firstField(row, ['products', 'lines', 'details']);
  if (!Array.isArray(products)) return undefined;
  return products
    .filter(isRecord)
    .map((line) =>
      pick(line, [
        'productSKU',
        'sku',
        'productName',
        'quantity',
        'expectedQuantity',
        'receivedQuantity',
        'uomQuantity',
        'packType',
        'allocatedUOMQuantity',
        'pickedUOMQuantity',
        'packedUOMQuantity',
        'shippedUOMQuantity',
        'cancelledUOMQuantity',
        'lotBatchNumber',
        'expiryDate',
      ]),
    );
}
