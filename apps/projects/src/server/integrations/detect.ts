/**
 * Feature detection for sibling apps. Integration UI is shown only when (1) the org is entitled
 * to the module and (2) the sibling's tables exist in this database. WMS is single-tenant: its
 * tables are not org-scoped, so WMS data is only offered to the org named by WMS_PLATFORM_ORG_SLUG.
 * Every read here fails soft: on any error the integration reports "unavailable", never throws.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { orgModuleFlags } from '@/server/entitlements';
import type { DomainContext } from '@/server/domain/_shared';

const TABLE_TTL_MS = 5 * 60_000;
const tableCache = new Map<string, { exists: boolean; at: number }>();

export async function tableExists(qualified: string): Promise<boolean> {
  const cached = tableCache.get(qualified);
  if (cached && Date.now() - cached.at < TABLE_TTL_MS) return cached.exists;
  try {
    const result = await db.execute<{ exists: boolean }>(sql`select to_regclass(${qualified}) is not null as exists`);
    const exists = Boolean(result.rows[0]?.exists);
    tableCache.set(qualified, { exists, at: Date.now() });
    return exists;
  } catch {
    return false;
  }
}

export interface IntegrationAvailability {
  readonly crm: boolean;
  readonly wms: boolean;
}

export async function integrationAvailability(ctx: DomainContext): Promise<IntegrationAvailability> {
  try {
    const flags = await orgModuleFlags(ctx.orgId);
    const [crmTables, wmsTables] = await Promise.all([
      flags.crm ? tableExists('crm.items') : Promise.resolve(false),
      flags.wms && ctx.orgSlug === env.WMS_PLATFORM_ORG_SLUG ? tableExists('wms.shipment_orders') : Promise.resolve(false),
    ]);
    return { crm: crmTables, wms: wmsTables };
  } catch {
    return { crm: false, wms: false };
  }
}
