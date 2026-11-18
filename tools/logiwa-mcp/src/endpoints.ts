/**
 * The only Logiwa iO API paths this server may call. Everything is a GET except the login, and the
 * HTTP client refuses any path that is not built from this table. Nothing here creates, changes,
 * ships, receives, adjusts or cancels anything.
 *
 * Sources (see README "API notes"): Logiwa's help center confirms the shipment order paths and the
 * `/i/{index}/s/{size}` paging; the other list paths follow the same pattern and are used by other
 * public integrations, but should be checked against https://mydeveloper.logiwa.com once a key exists.
 */

export const TOKEN_PATH = '/v3.1/Authorize/token';

export interface ListEndpoint {
  /** Path before the `/i/{index}/s/{size}` paging suffix. */
  readonly list: string;
  /** Path for one record, with `{id}` replaced by the identifier, when Logiwa has one. */
  readonly get?: string;
  /** Whether rows belong to one client (so LOGIWA_MCP_CLIENTS narrowing applies). */
  readonly clientScoped: boolean;
}

export const ENDPOINTS = {
  shipmentOrders: { list: '/v3.1/ShipmentOrder/list', get: '/v3.1/ShipmentOrder/{id}', clientScoped: true },
  inventory: { list: '/v3.1/Inventory/list', clientScoped: true },
  products: { list: '/v3.1/Product/list', get: '/v3.1/Product/{id}', clientScoped: true },
  purchaseOrders: { list: '/v3.1/PurchaseOrder/list', get: '/v3.1/PurchaseOrder/{id}', clientScoped: true },
  clients: { list: '/v3.1/Client/list', clientScoped: false },
  warehouses: { list: '/v3.1/Warehouse/list', clientScoped: false },
  totalInventory: { list: '/v3.1/Report/TotalInventory', clientScoped: true },
  availableToPromise: { list: '/v3.1/Report/AvailableToPromise', clientScoped: true },
  shipmentHistory: { list: '/v3.1/Report/ShipmentHistory', clientScoped: true },
  receivingHistory: { list: '/v3.1/Report/ReceivingHistory', clientScoped: true },
} as const satisfies Record<string, ListEndpoint>;

export type EndpointName = keyof typeof ENDPOINTS;

const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
/** Words that name a write action; never accepted as a record identifier. */
const ACTION_WORDS =
  /^(list|create|bulk|update|patch|upsert|delete|remove|cancel|ship|receive|adjust|transfer|add|merge|split|allocate|pick|pack|load|approve|post|send|print|void|close|complete|subscribe)$/i;

function isIdentifier(id: string): boolean {
  return SEGMENT.test(id) && !ACTION_WORDS.test(id) && id !== '.' && id !== '..';
}

export function listPath(name: EndpointName, index: number, size: number): string {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(size) || size < 1) {
    throw new Error('Bad page index or size.');
  }
  return `${ENDPOINTS[name].list}/i/${index}/s/${size}`;
}

export function getPath(name: EndpointName, id: string): string {
  const ep: ListEndpoint = ENDPOINTS[name];
  if (!ep.get) throw new Error(`${name} has no single-record endpoint.`);
  if (!isIdentifier(id)) throw new Error('Identifier may only contain letters, digits, ".", "_" and "-".');
  return ep.get.replace('{id}', encodeURIComponent(id));
}

/** True when `path` (no query string) is one this server is allowed to GET. */
export function isAllowedGet(path: string): boolean {
  for (const ep of Object.values(ENDPOINTS) as ListEndpoint[]) {
    if (path.startsWith(`${ep.list}/i/`)) {
      if (/^\/i\/\d+\/s\/\d+$/.test(path.slice(ep.list.length))) return true;
    }
    if (ep.get) {
      const [head, tail] = ep.get.split('{id}') as [string, string];
      if (path.startsWith(head) && path.endsWith(tail)) {
        const id = path.slice(head.length, path.length - tail.length);
        if (isIdentifier(id)) return true;
      }
    }
  }
  return false;
}
export const MAX_STATUS_PAGES = 25;
