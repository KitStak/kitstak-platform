/**
 * Read-only access to KitStak WMS records through the shared database: shipment orders, work
 * orders (kitting jobs), purchase orders (inbound receipts) and cycle counts. WMS is single-tenant
 * (see detect.ts), so every function returns nothing for other orgs.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { env } from '@/server/env';
import type { DomainContext } from '@/server/domain/_shared';
import { integrationAvailability, tableExists } from './detect';

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
    table: 'wms.shipment_orders',
    path: '/orders/',
    label: sql`coalesce(nullif(customer_name, ''), store_name, 'Order')`,
    search: (term) => sql`(code ilike ${term} or customer_name ilike ${term} or store_order_number ilike ${term})`,
  },
  wms_work_order: {
    table: 'wms.work_orders',
    path: '/work-orders/',
    label: sql`coalesce(nullif(type, ''), 'Work order')`,
    search: (term) => sql`(code ilike ${term})`,
  },
  wms_receipt: {
    table: 'wms.purchase_orders',
    path: '/receiving/',
    label: sql`'Purchase order'`,
    search: (term) => sql`(code ilike ${term})`,
  },
  wms_count: {
    table: 'wms.count_plans',
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

function query(type: WmsTargetType, where: SQL, limit: number): SQL {
  const source = SOURCES[type];
  return sql`select id, code, ${source.label} as label, status from ${sql.raw(source.table)} where ${where} order by code desc limit ${limit}`;
}

async function available(ctx: DomainContext, type: WmsTargetType): Promise<boolean> {
  return (await integrationAvailability(ctx)).wms && (await tableExists(SOURCES[type].table));
}

export async function searchWms(ctx: DomainContext, type: WmsTargetType, text = '', limit = 20): Promise<WmsRecordRef[]> {
  if (!(await available(ctx, type))) return [];
  const term = `%${text.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
  try {
    const result = await db.execute<Row>(query(type, SOURCES[type].search(term), Math.min(limit, 50)));
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
  if (ids.length === 0 || !(await available(ctx, type))) return new Map();
  try {
    const result = await db.execute<Row>(query(type, sql`id = any(${sql.param([...ids])}::text[])`, ids.length));
    return new Map(result.rows.map((row) => [row.id, toRef(type, row)]));
  } catch (error) {
    console.error('[projects] WMS lookup failed', error);
    return new Map();
  }
}
