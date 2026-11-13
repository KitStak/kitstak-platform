/**
 * Integration facade used by the links domain and API routes: resolve any link target to a
 * title/status/url, and search targets for pickers. Owned by the integrations team; extend here.
 */
import 'server-only';
import type { IntegrationTargetType } from '@/lib/constants';
import type { DomainContext } from '@/server/domain/_shared';
import { getCrmItems, searchCrmItems } from './crm';
import { getCustomers, searchCustomers } from './customers';
import { integrationAvailability } from './detect';
import { getWmsRecords, searchWms, type WmsTargetType } from './wms';

export { integrationAvailability } from './detect';

export interface ResolvedTarget {
  readonly type: IntegrationTargetType;
  readonly id: string;
  readonly title: string;
  readonly status: string | null;
  readonly url: string | null;
  readonly meta?: Record<string, unknown>;
}

const isWms = (type: IntegrationTargetType): type is WmsTargetType => type.startsWith('wms_');

/** Resolve many targets of one type. Unknown/foreign ids are omitted. */
export async function resolveTargets(
  ctx: DomainContext,
  type: IntegrationTargetType,
  ids: readonly string[],
): Promise<Map<string, ResolvedTarget>> {
  if (ids.length === 0) return new Map();
  if (type === 'crm_item' || type === 'crm_account') {
    const items = await getCrmItems(ctx, ids);
    return new Map(
      [...items.values()].map((item) => [
        item.id,
        { type, id: item.id, title: item.name, status: item.status, url: item.url, meta: { boardId: item.boardId, kind: item.kind, statusColor: item.statusColor } },
      ]),
    );
  }
  if (type === 'core_customer') {
    const found = await getCustomers(ctx, ids);
    return new Map(
      [...found.values()].map((customer) => [customer.id, { type, id: customer.id, title: customer.name, status: customer.status, url: null, meta: { code: customer.code } }]),
    );
  }
  if (isWms(type)) {
    const records = await getWmsRecords(ctx, type, ids);
    return new Map([...records.values()].map((record) => [record.id, { type, id: record.id, title: record.title, status: record.status, url: record.url, meta: { code: record.code } }]));
  }
  return new Map();
}

export async function resolveTarget(ctx: DomainContext, type: IntegrationTargetType, id: string): Promise<ResolvedTarget | null> {
  return (await resolveTargets(ctx, type, [id])).get(id) ?? null;
}

/** Picker search across one target type. */
export async function searchTargets(ctx: DomainContext, type: IntegrationTargetType, query: string, limit = 20): Promise<ResolvedTarget[]> {
  if (type === 'crm_item' || type === 'crm_account') {
    const items = await searchCrmItems(ctx, { kinds: [type === 'crm_item' ? 'deals' : 'accounts'], query, limit });
    return items.map((item) => ({ type, id: item.id, title: item.name, status: item.status, url: item.url, meta: { boardId: item.boardId, statusColor: item.statusColor } }));
  }
  if (type === 'core_customer') {
    const rows = await searchCustomers(ctx, query, limit);
    return rows.map((row) => ({ type, id: row.id, title: row.name, status: row.status, url: null, meta: { code: row.code } }));
  }
  if (isWms(type)) {
    const rows = await searchWms(ctx, type, query, limit);
    return rows.map((row) => ({ type, id: row.id, title: row.title, status: row.status, url: row.url, meta: { code: row.code } }));
  }
  return [];
}

/** Which target types the org can link right now (UI hides the rest). */
export async function availableTargetTypes(ctx: DomainContext): Promise<IntegrationTargetType[]> {
  const availability = await integrationAvailability(ctx);
  const types: IntegrationTargetType[] = ['core_customer'];
  if (availability.crm) types.push('crm_item', 'crm_account');
  if (availability.wms) types.push('wms_order', 'wms_work_order', 'wms_receipt', 'wms_count');
  return types;
}
