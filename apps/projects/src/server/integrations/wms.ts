/**
 * Read-only access to KitStak WMS records through the shared database: shipment orders, work
 * orders (kitting jobs), purchase orders (inbound receipts) and cycle counts. Each org has its own
 * warehouse schema (see detect.ts); every read targets the request org's schema, and an org with
 * no active warehouse gets nothing.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { env } from '@/server/env';
import type { DomainContext } from '@/server/domain/_shared';
import { wmsTable } from '@kitstak/db/wms-tenants';
import { wmsSchemaFor, wmsTableExists } from './detect';

export type WmsTargetType = 'wms_order' | 'wms_work_order' | 'wms_receipt' | 'wms_count';

export interface WmsRecordRef {
  readonly type: WmsTargetType;
  readonly id: string;
  /** Human code: SO010421, WO000088, PO002210, CNT000140. */
  readonly code: string;
  readonly title: string;
  readonly status: string | null;
  readonly url: string;
}

const SOURCES: Readonly<Record<WmsTargetType, { table: string; path: string; label: SQL; search: (term: string) => SQL }>> = {
  wms_order: {
    table: 'shipment_orders',
    path: '/orders/',
    label: sql`coalesce(nullif(customer_name, ''), store_name, 'Order')`,
    search: (term) => sql`(code ilike ${term} or customer_name ilike ${term} or store_order_number ilike ${term})`,
  },
  wms_work_order: {
    table: 'work_orders',
    path: '/work-orders/',
    label: sql`coalesce(nullif(type, ''), 'Work order')`,
    search: (term) => sql`(code ilike ${term})`,
  },
  wms_receipt: {
    table: 'purchase_orders',
    path: '/receiving/',
    label: sql`'Purchase order'`,
    search: (term) => sql`(code ilike ${term})`,
  },
  wms_count: {
    table: 'count_plans',
    path: '/counts/',
    label: sql`coalesce(nullif(description, ''), 'Cycle count')`,
    search: (term) => sql`(code ilike ${term} or description ilike ${term})`,
  },
};

export function wmsUrl(type: WmsTargetType, id: string): string {
  return `${env.NEXT_PUBLIC_WMS_URL.replace(/\/+$/, '')}${SOURCES[type].path}${encodeURIComponent(id)}`;
}

type Row = {
  id: string;
  code: string;
  label: string;
  status: string | null;
};

function query(schema: string, type: WmsTargetType, where: SQL, limit: number): SQL {
  const source = SOURCES[type];
  return sql`select id, code, ${source.label} as label, status from ${wmsTable(schema, source.table)} where ${where} order by code desc limit ${limit}`;
}

/** The org's WMS schema when it holds this record type's table, else null (WMS not installed). */
async function schemaFor(ctx: DomainContext, type: WmsTargetType): Promise<string | null> {
  const schema = await wmsSchemaFor(ctx);
  return schema && (await wmsTableExists(schema, SOURCES[type].table)) ? schema : null;
}

export async function searchWms(ctx: DomainContext, type: WmsTargetType, text = '', limit = 20): Promise<WmsRecordRef[]> {
  const schema = await schemaFor(ctx, type);
  if (!schema) return [];
  const term = `%${text.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
  try {
    const result = await db.execute<Row>(query(schema, type, SOURCES[type].search(term), Math.min(limit, 50)));
    return result.rows.map((row) => toRef(type, row));
  } catch (error) {
    console.error('[projects] WMS search failed', error);
    return [];
  }
}

function toRef(type: WmsTargetType, row: Row): WmsRecordRef {
  return { type, id: row.id, code: row.code, title: `${row.code} · ${row.label}`, status: row.status, url: wmsUrl(type, row.id) };
}

export async function getWmsRecords(ctx: DomainContext, type: WmsTargetType, ids: readonly string[]): Promise<Map<string, WmsRecordRef>> {
  if (ids.length === 0) return new Map();
  const schema = await schemaFor(ctx, type);
  if (!schema) return new Map();
  try {
    const result = await db.execute<Row>(query(schema, type, sql`id = any(${sql.param([...ids])}::text[])`, ids.length));
    return new Map(result.rows.map((row) => [row.id, toRef(type, row)]));
  } catch (error) {
    console.error('[projects] WMS lookup failed', error);
    return new Map();
  }
}
