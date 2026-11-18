/**
 * WMS reader: work orders with finished quantity and the cost of the parts they used, kits
 * built per day, billed revenue and extra service (VAS) revenue. For this organization's own
 * warehouse only.
 *
 * One separate warehouse per organization: the schema comes from `core.wms_tenants` through
 * `wmsSchemaFor` (which also checks the WMS entitlement) and every table name goes through
 * `wmsTable`, so a schema name is validated before it is ever used as an identifier. An org with
 * no warehouse reads as "not connected" and never falls back to another org's data.
 *
 * WMS ids are text, timestamps are ISO text in UTC and money is float dollars. Money is turned
 * into whole cents in SQL with `round(x::numeric * 100)`, never with JS floats. Read only, fail
 * soft: any error answers with an empty list. Pulse never writes into a warehouse schema.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { wmsTable } from '@kitstak/db/wms-tenants';
import { db } from '@/server/db';
import { rows, type DomainContext } from '@/server/domain/_shared';
import { wmsSchemaFor, wmsTableExists } from './detect';
import { logSoftFail } from './log';

export interface WmsWorkOrder {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly type: string | null;
  readonly note: string | null;
  /** Equal to the shared `core.customers` id. */
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly kitSku: string | null;
  readonly kitName: string | null;
  readonly requestedQty: number;
  /** Kits finished so far (`processed_qty`). */
  readonly finishedQty: number;
  readonly plannedFinish: string | null;
  readonly actualFinish: string | null;
  /** Planned parts at the warehouse's cost for one part, whole cents. */
  readonly materialPlannedCents: number;
  /** Parts really consumed at the warehouse's cost for one part, whole cents. */
  readonly materialConsumedCents: number;
  /** Path inside the WMS app. */
  readonly path: string;
}

export interface WmsBuildDay {
  readonly workOrderId: string;
  readonly workDate: string;
  /** Kits built that day (disassembly takes away). */
  readonly kits: number;
}

export interface WmsBilledLine {
  /** Stable per bill and kind of work: `wms:bill:<reportId>:<operation>`. */
  readonly ref: string;
  readonly reportId: string;
  readonly billNumber: string | null;
  readonly clientId: string;
  readonly periodEnd: string;
  readonly operation: string;
  readonly amountCents: number;
  readonly approved: boolean;
}

export interface WmsVasLine {
  readonly id: string;
  readonly clientId: string | null;
  readonly vasType: string;
  readonly workDate: string;
  readonly quantity: number | null;
  /** Null when the service is billed by quantity and the contract has no rate for it. */
  readonly revenueCents: number | null;
  readonly workOrderId: string | null;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const cents = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
};
const day = (value: string | null): string | null => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

/** The org's own warehouse schema when WMS is licensed and has work orders, else null. */
export async function wmsReady(ctx: DomainContext): Promise<string | null> {
  try {
    const schema = await wmsSchemaFor(ctx);
    if (!schema) return null;
    return (await wmsTableExists(schema, 'work_orders')) && (await wmsTableExists(schema, 'work_order_components')) ? schema : null;
  } catch (error) {
    logSoftFail(ctx.orgId, 'wms.wmsReady', error);
    return null;
  }
}

const textList = (values: readonly string[]): SQL => sql`(${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;
const cleanIds = (ids: readonly string[]): string[] => [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0 && id.length <= 64))];

/**
 * Work orders with finished quantity and component consumption cost. The cost of one part is
 * the unit cost of the newest received purchase order line for it, else the product's purchase
 * price (the warehouse has no cost at the time of use, so Pulse keeps its own copy on its rows).
 */
export async function listWorkOrders(ctx: DomainContext, options: { ids?: readonly string[]; query?: string; openOnly?: boolean; limit?: number } = {}): Promise<WmsWorkOrder[]> {
  const schema = await wmsReady(ctx);
  if (!schema) return [];
  if (options.ids && cleanIds(options.ids).length === 0) return [];
  try {
    const t = (name: string) => wmsTable(schema, name);
    const filters: SQL[] = [];
    if (options.ids) filters.push(sql`w.id in ${textList(cleanIds(options.ids))}`);
    if (options.openOnly) filters.push(sql`w.status in ('Open', 'In Process', 'Shortage')`);
    const text = options.query?.trim().slice(0, 80);
    if (text) filters.push(sql`(w.code ilike ${`%${text}%`} or c.name ilike ${`%${text}%`} or kp.sku ilike ${`%${text}%`} or kp.name ilike ${`%${text}%`})`);
    const where = filters.length > 0 ? sql.join(filters, sql` and `) : sql`true`;
    const found = await rows<{
      id: string;
      code: string;
      status: string;
      type: string | null;
      extra_note: string | null;
      client_id: string | null;
      client_name: string | null;
      sku: string | null;
      kit_name: string | null;
      requested_qty: number;
      processed_qty: number;
      planned_finish_at: string | null;
      actual_finish_at: string | null;
      planned_cents: string | null;
      consumed_cents: string | null;
    }>(
      db,
      sql`select w.id, w.code, w.status, w.type, w.extra_note, w.client_id, c.name as client_name, kp.sku, kp.name as kit_name,
                 w.requested_qty, w.processed_qty, w.planned_finish_at, w.actual_finish_at,
                 m.planned_cents::text as planned_cents, m.consumed_cents::text as consumed_cents
            from ${t('work_orders')} w
            left join ${t('clients')} c on c.id = w.client_id
            left join ${t('products')} kp on kp.id = w.kit_product_id
            left join lateral (
              select coalesce(sum(wc.total_qty * u.unit_cents), 0)::bigint as planned_cents,
                     coalesce(sum(wc.consumed_qty * u.unit_cents), 0)::bigint as consumed_cents
                from ${t('work_order_components')} wc
                join ${t('products')} cp on cp.id = wc.component_product_id
                left join lateral (
                  select coalesce(
                    (select round(pol.unit_cost::numeric * 100)::bigint from ${t('purchase_order_lines')} pol
                      where pol.product_id = cp.id and pol.unit_cost > 0 and pol.received_quantity > 0
                      order by pol.updated_at desc limit 1),
                    round(coalesce(cp.purchase_price, 0)::numeric * 100)::bigint) as unit_cents
                ) u on true
               where wc.work_order_id = w.id
            ) m on true
           where ${where}
           order by w.code desc
           limit ${Math.min(options.limit ?? 200, 500)}`,
    );
    return found.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      type: row.type,
      note: row.extra_note,
      clientId: row.client_id,
      clientName: row.client_name,
      kitSku: row.sku,
      kitName: row.kit_name,
      requestedQty: num(row.requested_qty),
      finishedQty: num(row.processed_qty),
      plannedFinish: day(row.planned_finish_at),
      actualFinish: day(row.actual_finish_at),
      materialPlannedCents: cents(row.planned_cents),
      materialConsumedCents: cents(row.consumed_cents),
      path: `/work-orders/${encodeURIComponent(row.id)}`,
    }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'wms.listWorkOrders', error);
    return [];
  }
}

/**
 * Kits built per work order per day, from the warehouse ledger. Exact rule: a Kitting row for
 * the work order's own kit product. A row that lands in a location adds, a row that leaves one
 * (disassembly) takes away. Component rows share the type and are left out by the product test.
 * The day is the ledger time in `timezone`.
 */
export async function workOrderBuildsByDay(ctx: DomainContext, workOrderIds: readonly string[], timezone: string): Promise<WmsBuildDay[]> {
  const ids = cleanIds(workOrderIds);
  const schema = ids.length > 0 ? await wmsReady(ctx) : null;
  if (!schema || !(await wmsTableExists(schema, 'inventory_transactions'))) return [];
  try {
    const t = (name: string) => wmsTable(schema, name);
    const found = await rows<{ work_order_id: string; work_date: string; kits: string }>(
      db,
      sql`select it.work_order_id, ((it.at::timestamptz at time zone ${timezone})::date)::text as work_date,
                 sum(case when it.to_location_id is not null then it.uom_qty else -it.uom_qty end)::text as kits
            from ${t('inventory_transactions')} it
            join ${t('work_orders')} w on w.id = it.work_order_id
           where it.type = 'Kitting' and it.work_order_id in ${textList(ids)} and it.product_id = w.kit_product_id
             and it.at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
           group by 1, 2
           order by 1, 2`,
    );
    return found.map((row) => ({ workOrderId: row.work_order_id, workDate: row.work_date, kits: num(row.kits) })).filter((row) => row.kits > 0);
  } catch (error) {
    logSoftFail(ctx.orgId, 'wms.workOrderBuildsByDay', error);
    return [];
  }
}

/**
 * Billed revenue per bill and kind of work. Uses summary lines only (`is_detail = false`):
 * every fee also writes detail lines, and adding both would count a bill twice. Canceled bills
 * are left out. Draft bills come back with `approved: false`.
 */
export async function listBilledRevenue(ctx: DomainContext, options: { from?: string; clientId?: string } = {}): Promise<WmsBilledLine[]> {
  const schema = await wmsReady(ctx);
  if (!schema || !(await wmsTableExists(schema, 'billing_reports')) || !(await wmsTableExists(schema, 'billing_report_lines'))) return [];
  try {
    const t = (name: string) => wmsTable(schema, name);
    const from = options.from ? sql`and r.period_end >= ${options.from}` : sql``;
    const client = options.clientId ? sql`and r.client_id = ${options.clientId}` : sql``;
    const found = await rows<{ report_id: string; bill_number: string | null; client_id: string; period_end: string; operation: string; amount_cents: string; approved: boolean }>(
      db,
      sql`select r.id as report_id, r.bill_number, r.client_id, left(r.period_end, 10) as period_end, l.operation_type as operation,
                 round(sum(l.adjusted_price)::numeric * 100)::bigint::text as amount_cents, (r.bill_status = 'Approved') as approved
            from ${t('billing_reports')} r
            join ${t('billing_report_lines')} l on l.report_id = r.id and l.is_detail = false
           where r.calc_status = 'Successful' and r.bill_status <> 'Canceled' and r.client_id is not null
             and r.period_end ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' ${from} ${client}
           group by r.id, r.bill_number, r.client_id, r.period_end, l.operation_type, r.bill_status
           order by r.period_end, r.id, l.operation_type`,
    );
    return found.map((row) => ({
      ref: `wms:bill:${row.report_id}:${row.operation.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      reportId: row.report_id,
      billNumber: row.bill_number,
      clientId: row.client_id,
      periodEnd: row.period_end,
      operation: row.operation,
      amountCents: cents(row.amount_cents),
      approved: row.approved === true,
    }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'wms.listBilledRevenue', error);
    return [];
  }
}

/**
 * Extra service (VAS) records with their revenue: the typed total for "Total Price" services,
 * quantity times the approved contract's rate for quantity services, and null when the contract
 * has no rate. Tied to a work order when the record names one.
 */
export async function listVasRevenue(ctx: DomainContext, options: { from?: string } = {}): Promise<WmsVasLine[]> {
  const schema = await wmsReady(ctx);
  if (!schema || !(await wmsTableExists(schema, 'vas_operations')) || !(await wmsTableExists(schema, 'lookup_values'))) return [];
  try {
    const t = (name: string) => wmsTable(schema, name);
    const hasFees = (await wmsTableExists(schema, 'billing_fees')) && (await wmsTableExists(schema, 'billing_contracts'));
    const rate = hasFees
      ? sql`(select f.standard_rate from ${t('billing_fees')} f join ${t('billing_contracts')} bc on bc.id = f.contract_id
              where bc.client_id = v.client_id and bc.approval_status = 'Approved' and f.operation_type = 'VAS' and f.vas_type_id = v.vas_type_id
              order by bc.calc_start_date desc nulls last limit 1)`
      : sql`null::double precision`;
    const from = options.from ? sql`and v.operation_at >= ${options.from}` : sql``;
    const found = await rows<{ id: string; client_id: string | null; vas_type: string; work_date: string; calculation_type: string; value: number | null; revenue_cents: string | null; work_order_id: string | null }>(
      db,
      sql`select x.id, x.client_id, x.vas_type, x.work_date, x.calculation_type, x.value, x.work_order_id,
                 case when x.calculation_type = 'Total Price' then round(x.value::numeric * 100)::bigint::text
                      when x.rate is not null then round(x.value::numeric * x.rate::numeric * 100)::bigint::text end as revenue_cents
            from (
              select v.id, v.client_id, lv.name as vas_type, left(v.operation_at, 10) as work_date, v.calculation_type, v.value, ${rate} as rate,
                     (select wo.id from ${t('work_orders')} wo where v.reference_order_type = 'Work Order' and wo.code = v.reference_number limit 1) as work_order_id
                from ${t('vas_operations')} v
                join ${t('lookup_values')} lv on lv.id = v.vas_type_id
               where v.operation_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' ${from}
            ) x
           order by x.work_date`,
    );
    return found.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      vasType: row.vas_type,
      workDate: row.work_date,
      quantity: row.calculation_type === 'Total Price' ? null : num(row.value),
      revenueCents: row.revenue_cents === null ? null : cents(row.revenue_cents),
      workOrderId: row.work_order_id,
    }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'wms.listVasRevenue', error);
    return [];
  }
}
