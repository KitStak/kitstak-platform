/**
 * Runs a list call with filters. Filters are sent to Logiwa as `Field.op=value` query parameters
 * (unless turned off) and are always applied again to the returned rows, so a filter Logiwa ignores
 * can never leak unrelated rows into an answer. Client narrowing (LOGIWA_MCP_CLIENTS) is enforced
 * on the rows the same way.
 */
import { LogiwaError, toPage, type LogiwaClient } from './client.js';
import type { Config } from './config.js';
import { ENDPOINTS, listPath, type EndpointName } from './endpoints.js';
import { field, firstField, GUID, norm } from './util.js';

export type Match = 'eq' | 'contains' | 'dateFrom' | 'dateTo' | 'notIn' | 'lineSku';

export interface Filter {
  /** Logiwa query parameter name, e.g. "ClientIdentifier"; omit to filter locally only. */
  readonly param?: string;
  readonly op?: 'eq' | 'gte' | 'lte';
  readonly value: string | readonly string[];
  /** Row fields to check locally (first present one wins). */
  readonly keys: readonly string[];
  readonly match: Match;
  readonly label: string;
}

export interface ListResult {
  page: number;
  pageSize: number;
  /** Total Logiwa reports for the server-side query, when it reports one. */
  totalInLogiwa: number | null;
  returned: number;
  rows: Record<string, unknown>[];
  notes?: string[];
}

export const CLIENT_ID_KEYS = ['clientIdentifier', 'ClientIdentifier', 'clientId'];
export const CLIENT_NAME_KEYS = ['clientDisplayName', 'clientName', 'clientCode', 'ClientName'];
export const WAREHOUSE_ID_KEYS = ['warehouseIdentifier', 'WarehouseIdentifier', 'warehouseId'];
export const WAREHOUSE_NAME_KEYS = [
  'warehouseCode',
  'warehouseName',
  'warehouseDescription',
  'WarehouseCode',
];

export function clientFilter(client: string | undefined): Filter[] {
  if (!client) return [];
  return GUID.test(client)
    ? [
        {
          param: 'ClientIdentifier',
          op: 'eq',
          value: client,
          keys: CLIENT_ID_KEYS,
          match: 'eq',
          label: 'client',
        },
      ]
    : [{ value: client, keys: CLIENT_NAME_KEYS, match: 'contains', label: 'client' }];
}

export function warehouseFilter(warehouse: string | undefined): Filter[] {
  if (!warehouse) return [];
  return GUID.test(warehouse)
    ? [
        {
          param: 'WarehouseIdentifier',
          op: 'eq',
          value: warehouse,
          keys: WAREHOUSE_ID_KEYS,
          match: 'eq',
          label: 'warehouse',
        },
      ]
    : [{ value: warehouse, keys: WAREHOUSE_NAME_KEYS, match: 'eq', label: 'warehouse' }];
}

export function dateFilters(param: string, keys: readonly string[], from?: string, to?: string): Filter[] {
  const out: Filter[] = [];
  if (from) out.push({ param, op: 'gte', value: from, keys, match: 'dateFrom', label: `${param} from` });
  if (to)
    out.push({ param, op: 'lte', value: `${to}T23:59:59`, keys, match: 'dateTo', label: `${param} to` });
  return out;
}

export class Lister {
  constructor(
    private readonly client: LogiwaClient,
    private readonly config: Config,
  ) {}

  /** Rejects a client outside LOGIWA_MCP_CLIENTS, and pins the one allowed client when there is only one. */
  scopeClient(client: string | undefined): string | undefined {
    const allowed = this.config.clients;
    if (allowed.length === 0) return client;
    if (client && GUID.test(client) && !allowed.includes(client.toLowerCase())) {
      throw new LogiwaError(
        'That client is outside the clients this server is set up for (LOGIWA_MCP_CLIENTS).',
      );
    }
    return client ?? (allowed.length === 1 ? allowed[0] : undefined);
  }

  /** True when a single record may be shown under client narrowing. */
  inScope(name: EndpointName, row: Record<string, unknown>): boolean {
    if (this.config.clients.length === 0 || !ENDPOINTS[name].clientScoped) return true;
    const id = firstField(row, CLIENT_ID_KEYS);
    return typeof id === 'string' && this.config.clients.includes(id.toLowerCase());
  }

  async list(
    name: EndpointName,
    opts: { page?: number; pageSize?: number; filters?: readonly Filter[] },
  ): Promise<ListResult> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? this.config.pageSize;
    const filters = opts.filters ?? [];
    const notes: string[] = [];
    const path = listPath(name, page - 1, pageSize);

    const query: Record<string, string> = {};
    if (this.config.serverFilters) {
      for (const f of filters) {
        if (f.param && typeof f.value === 'string') query[`${f.param}.${f.op ?? 'eq'}`] = f.value;
      }
    }

    let body: unknown;
    try {
      body = await this.client.get(path, query);
    } catch (error) {
      // Logiwa rejected the filter syntax: fetch the plain page and filter locally instead.
      if (error instanceof LogiwaError && error.status === 400 && Object.keys(query).length > 0) {
        body = await this.client.get(path);
        notes.push(
          'Logiwa did not accept the filters, so this page was filtered locally; other pages may hold more matches.',
        );
      } else {
        throw error;
      }
    }

    const { rows: raw, total } = toPage(body);
    let rows = raw;
    let unchecked = 0;
    for (const f of filters) {
      rows = rows.filter((row) => {
        const result = matches(row, f);
        if (result === null) unchecked++;
        return result !== false;
      });
    }
    if (unchecked > 0)
      notes.push(`Some rows had no field to check a filter against and were kept (${unchecked}).`);

    if (this.config.clients.length > 0 && ENDPOINTS[name].clientScoped) {
      const before = rows.length;
      rows = rows.filter((row) => this.inScope(name, row));
      if (rows.length < before) notes.push(`${before - rows.length} rows for other clients were left out.`);
    }
    if (raw.length > rows.length && total != null) {
      notes.push(`Logiwa returned ${raw.length} rows on this page; ${rows.length} matched every filter.`);
    }

    return {
      page,
      pageSize,
      totalInLogiwa: total,
      returned: rows.length,
      rows,
      ...(notes.length ? { notes } : {}),
    };
  }
}

/** true = matches, false = does not, null = the row has no field to check. */
function matches(row: Record<string, unknown>, f: Filter): boolean | null {
  const v = firstField(row, f.keys);
  if (f.match === 'lineSku') {
    if (!Array.isArray(v)) return null;
    return v.some(
      (line) =>
        typeof line === 'object' &&
        line !== null &&
        norm(firstField(line as Record<string, unknown>, ['productSKU', 'sku', 'productSku'])) ===
          norm(f.value),
    );
  }
  if (v === undefined || v === null || v === '') return f.match === 'notIn' ? true : null;
  const s = String(v);
  switch (f.match) {
    case 'eq':
      return [f.value].flat().some((x) => norm(x) === norm(s));
    case 'contains':
      return [f.value].flat().some((x) => norm(s).includes(norm(x)));
    case 'notIn':
      return ![f.value].flat().some((x) => norm(x) === norm(s));
    case 'dateFrom':
      return s.slice(0, 10) >= String(f.value).slice(0, 10);
    case 'dateTo':
      return s.slice(0, 10) <= String(f.value).slice(0, 10);
  }
}

export { field };
