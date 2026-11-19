/**
 * Records a new job can start from: CRM deals that were won and warehouse work orders that are
 * open, both without a Pulse job yet. Read only and fail soft: when the sibling app is missing,
 * not licensed, or anything goes wrong, the list is empty and the wizard just hides the choice.
 *
 * This is the jobs team's small reader behind the new job wizard. When the integrations team
 * ships its CRM and WMS readers in `src/server/integrations`, swap the two queries for them.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { wmsTable } from '@kitstak/db/wms-tenants';
import { scoped } from '@/server/db/scope';
import { findJobsByLink, type DomainContext } from '@/server/domain';
import { integrationAvailability, siblingDb, tableExists, wmsSchemaFor } from '@/server/integrations';

export interface WonDealSource {
  readonly id: string;
  readonly name: string;
  /** Deal value in whole cents, or null when the deal has no value. */
  readonly valueCents: number | null;
  readonly closeDate: string | null;
  readonly accountItemId: string | null;
  readonly accountName: string | null;
  readonly coreCustomerId: string | null;
}

export interface WorkOrderSource {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly requestedQty: number;
  readonly coreCustomerId: string | null;
  readonly clientName: string | null;
  readonly kitSku: string | null;
  readonly kitName: string | null;
  readonly warehouseId: string | null;
  readonly plannedFinish: string | null;
}

export interface JobSources {
  readonly deals: readonly WonDealSource[];
  readonly workOrders: readonly WorkOrderSource[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Keeps the records that no live Pulse job is linked to yet. */
async function withoutJob<T extends { id: string }>(
  ctx: DomainContext,
  type: 'crm_deal' | 'wms_work_order',
  records: readonly T[],
): Promise<T[]> {
  const linked = await Promise.all(
    records.map((record) =>
      findJobsByLink(ctx, type, record.id).then(
        (jobs) => jobs.length > 0,
        () => false,
      ),
    ),
  );
  return records.filter((_, index) => !linked[index]);
}

async function wonDeals(ctx: DomainContext): Promise<WonDealSource[]> {
  if (
    !(await tableExists('crm.items')) ||
    !(await tableExists('crm.boards')) ||
    !(await tableExists('crm.columns'))
  )
    return [];
  const hasCustomerLinks = await tableExists('crm.customer_links');
  const customer = hasCustomerLinks
    ? sql`(select cl.core_customer_id::text from crm.customer_links cl where cl.item_id = a.id limit 1)`
    : sql`null::text`;
  // Won means the deal's stage label is marked done on its own board: the rule CRM itself uses.
  const result = await siblingDb.execute<{
    id: string;
    name: string;
    value_cents: string | null;
    close_date: string | null;
    account_item_id: string | null;
    account_name: string | null;
    core_customer_id: string | null;
  }>(sql`
    select i.id::text as id, i.name,
           case when (i.values #>> '{deal_value,amount}') ~ '^-?[0-9]+(\\.[0-9]+)?$' then round((i.values #>> '{deal_value,amount}')::numeric * 100)::bigint::text end as value_cents,
           left(i.values #>> '{close_date,date}', 10) as close_date,
           i.values #>> '{account,itemIds,0}' as account_item_id,
           a.name as account_name,
           ${customer} as core_customer_id
      from crm.items i
      join crm.boards b on b.id = i.board_id
      left join crm.items a on a.id::text = i.values #>> '{account,itemIds,0}' and a.deleted_at is null
     where i.org_id = ${ctx.orgId} and b.kind::text = 'deals'
       and b.deleted_at is null and b.archived_at is null
       and i.deleted_at is null and i.archived_at is null and i.parent_item_id is null
       and exists (
         select 1 from crm.columns c, jsonb_array_elements(case when jsonb_typeof(c.settings -> 'labels') = 'array' then c.settings -> 'labels' else '[]'::jsonb end) l
          where c.board_id = b.id and c.key = 'stage' and c.deleted_at is null
            and coalesce(l ->> 'isDone', 'false') = 'true' and l ->> 'id' = i.values #>> '{stage,labelId}')
     order by left(i.values #>> '{close_date,date}', 10) desc nulls last, i.updated_at desc
     limit 40`);
  const deals = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    valueCents: row.value_cents === null ? null : Number(row.value_cents),
    closeDate: row.close_date && /^\d{4}-\d{2}-\d{2}$/.test(row.close_date) ? row.close_date : null,
    accountItemId: row.account_item_id && UUID.test(row.account_item_id) ? row.account_item_id : null,
    accountName: row.account_name,
    coreCustomerId: row.core_customer_id,
  }));
  return (await withoutJob(ctx, 'crm_deal', deals)).slice(0, 12);
}

async function openWorkOrders(ctx: DomainContext): Promise<WorkOrderSource[]> {
  const schema = await wmsSchemaFor(ctx);
  if (!schema) return [];
  const result = await siblingDb.execute<{
    id: string;
    code: string;
    status: string;
    requested_qty: number;
    client_id: string | null;
    client_name: string | null;
    sku: string | null;
    kit_name: string | null;
    warehouse_id: string | null;
    planned_finish_at: string | null;
  }>(sql`
    select w.id, w.code, w.status, w.requested_qty, w.client_id, c.name as client_name, p.sku, p.name as kit_name, w.warehouse_id, w.planned_finish_at
      from ${wmsTable(schema, 'work_orders')} w
      left join ${wmsTable(schema, 'clients')} c on c.id = w.client_id
      left join ${wmsTable(schema, 'products')} p on p.id = w.kit_product_id
     where w.status in ('Open', 'In Process', 'Shortage')
     order by w.created_at desc
     limit 40`);
  const orders = result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    status: row.status,
    requestedQty: Number(row.requested_qty) || 0,
    coreCustomerId: row.client_id && UUID.test(row.client_id) ? row.client_id : null,
    clientName: row.client_name,
    kitSku: row.sku,
    kitName: row.kit_name,
    warehouseId: row.warehouse_id,
    plannedFinish:
      row.planned_finish_at && /^\d{4}-\d{2}-\d{2}/.test(row.planned_finish_at)
        ? row.planned_finish_at.slice(0, 10)
        : null,
  }));
  return (await withoutJob(ctx, 'wms_work_order', orders)).slice(0, 12);
}

/** Won deals and open work orders with no Pulse job yet. Never throws. */
export const listJobSources = scoped(async function listJobSources(ctx: DomainContext): Promise<JobSources> {
  let available = { crm: false, wms: false, projects: false };
  try {
    available = await integrationAvailability(ctx);
  } catch {
    return { deals: [], workOrders: [] };
  }
  const [deals, workOrders] = await Promise.all([
    available.crm ? wonDeals(ctx).catch(() => []) : Promise.resolve([]),
    available.wms ? openWorkOrders(ctx).catch(() => []) : Promise.resolve([]),
  ]);
  return { deals, workOrders };
});
