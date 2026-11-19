/**
 * WMS reader: work orders with finished quantity and the cost of the parts they used, kits
 * built per day, billed revenue, extra service (VAS) records with their price, and the contract
 * rates that price a work order. For this organization's own
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
import { scoped } from '@/server/db/scope';
import { rows, type DomainContext } from '@/server/domain/_shared';
import { wmsSchemaFor, wmsTableExists, siblingDb } from './detect';
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

/** One warehouse extra service (VAS) record, with the price the warehouse has for it. */
export interface WmsVasRecord {
  readonly id: string;
  /** Equal to the shared `core.customers` id. */
  readonly clientId: string;
  readonly warehouseId: string | null;
  readonly vasTypeId: string;
  readonly vasType: string;
  /** The day the work was done, in the warehouse time zone. */
  readonly workDate: string;
  /**
   * Where the price comes from. `record`: the record carries its own total ("Total Price").
   * `contract`: quantity times the rate on the client's approved contract. `warehouse_bill`: the
   * contract fee changes with volume or applies to some products only (`billedBy` says which), so
   * only the warehouse bill can price it and Pulse leaves it with no price. Null: no price yet.
   */
  readonly priceFrom: 'record' | 'contract' | 'warehouse_bill' | null;
  /** Why the warehouse bill prices this record: `tiers` (volume tiers) or `conditions` (a fee for some products only). */
  readonly billedBy?: WmsBilledBy | null;
  /** How many, three places. A record with its own total counts as 1. */
  readonly quantity: string;
  /** Price of one, four places: the record's own total, or the contract rate. */
  readonly unitPrice: string | null;
  /** Whole cents for a record with its own total. A contract price is worked out in `src/lib/money.ts`. */
  readonly ownCents: number | null;
  readonly contractName: string | null;
  readonly workOrderId: string | null;
  readonly note: string | null;
  /** Path inside the WMS app. */
  readonly path: string;
}

/**
 * Why Pulse cannot price something from a warehouse contract fee: `tiers`, the rate depends on the
 * volume of a whole billing period (tiers with different rates, or units charged only above a
 * count); `conditions`, the fee is charged only for some products or orders ("Charge if").
 */
export type WmsBilledBy = 'tiers' | 'conditions';

/** What the client's warehouse contract says a work order earns. */
export interface WmsContractPrice {
  readonly workOrderId: string;
  readonly contractName: string;
  /** "Per Kit" rate plus the "Per Component" rate times the parts in one kit, four places. Null when the contract has neither. */
  readonly unitPrice: string | null;
  /** The "Per WorkOrder" fee in whole cents. Null when the contract has none. */
  readonly perOrderCents: number | null;
  /** Changes when any rate behind the price changes. */
  readonly signature: string;
  /**
   * Set when only the warehouse bill can price this work order: a "Work Order" fee on the contract
   * has volume tiers or conditions. `unitPrice` and `perOrderCents` are then null.
   */
  readonly billedBy: WmsBilledBy | null;
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
export const wmsReady = scoped(async function wmsReady(ctx: DomainContext): Promise<string | null> {
  try {
    const schema = await wmsSchemaFor(ctx);
    if (!schema) return null;
    return (await wmsTableExists(schema, 'work_orders')) && (await wmsTableExists(schema, 'work_order_components')) ? schema : null;
  } catch (error) {
    logSoftFail(ctx.orgId, 'wms.wmsReady', error);
    return null;
  }
});

const textList = (values: readonly string[]): SQL => sql`(${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;

/**
 * The rate Pulse may use for one warehouse fee (alias `f`), read the way the warehouse bill prices
 * it (apps/wms `billing-engine.ts` priceFee and `priceQuantity`):
 *
 *  - A fee with "Charge if" conditions applies to some products or orders only. Pulse cannot tell
 *    whether this work order or record is one of them: blocked, `conditions`. (The pricing mode
 *    and "charge one time" marks the warehouse keeps in the same list start with `__` and are not
 *    conditions.)
 *  - No tiers: the standard rate, for every unit.
 *  - "For each unit" (`perUnit`): the first tier's rate, for every unit.
 *  - "From quantity": the first tier's rate when it charges from the first unit; a fee that skips
 *    the first units of each billing period is blocked, `tiers`.
 *  - One tier ("Graduated" or "Tier base"): its rate, for every unit.
 *  - Several tiers with the same rate: that rate, for "Tier base", and for "Graduated" when the
 *    tiers start at the first unit, leave no gap and have no end.
 *  - Several tiers with different rates: the rate depends on the total of a whole billing period
 *    across every work order, which one job or record cannot know: blocked, `tiers`.
 *
 * A minimum or maximum price on a fee is a top up or a cap of a whole billing period. It does not
 * change the rate of one unit, so it does not block the rate (it stays on the warehouse bill).
 */
function feeRateParts(t: (name: string) => SQL, hasTiers: boolean): { joins: SQL; rate: SQL; blocked: SQL } {
  const conds = sql`(case when jsonb_typeof(f.conditions::jsonb) = 'array' then f.conditions::jsonb else '[]'::jsonb end)`;
  const tierStats = hasTiers
    ? sql`select count(*)::int as n, min(ft.rate) as lo, max(ft.rate) as hi, coalesce(bool_or(ft.to_qty is null), false) as open_end,
                 (array_agg(ft.rate order by ft.from_qty nulls first, ft.id))[1] as first_rate,
                 (array_agg(ft.from_qty order by ft.from_qty nulls first, ft.id))[1] as first_from,
                 coalesce(bool_and(ft.to_qty is null or exists (
                   select 1 from ${t('billing_fee_tiers')} nt
                    where nt.fee_id = ft.fee_id and nt.id <> ft.id and nt.from_qty <= ft.to_qty + 1 and coalesce(nt.to_qty, 'infinity'::float8) > ft.to_qty)), true) as gapless
            from ${t('billing_fee_tiers')} ft where ft.fee_id = f.id`
    : sql`select 0 as n, null::float8 as lo, null::float8 as hi, false as open_end, null::float8 as first_rate, null::float8 as first_from, true as gapless`;
  const joins = sql`cross join lateral (
      select exists (select 1 from jsonb_array_elements(${conds}) e where left(coalesce(e->>'field', ''), 2) <> '__') as conditional,
             coalesce((select e->>'value' from jsonb_array_elements(${conds}) e where e->>'field' = '__pricingMode' limit 1), 'graduated') as mode
    ) fm
    cross join lateral (${tierStats}) fs`;
  const rate = sql`(case
      when fm.conditional then null
      when fs.n = 0 then f.standard_rate
      when fm.mode = 'perUnit' then fs.first_rate
      when fm.mode = 'fromQuantity' then case when coalesce(fs.first_from, 1) <= 1 then fs.first_rate end
      when fs.n = 1 then fs.first_rate
      when fs.lo = fs.hi and (fm.mode = 'tierBase' or (coalesce(fs.first_from, 1) <= 1 and fs.open_end and fs.gapless)) then fs.lo
    end)`;
  const blocked = sql`(case when fm.conditional then 'conditions' when fs.n > 0 and ${rate} is null then 'tiers' end)`;
  return { joins, rate, blocked };
}
const cleanIds = (ids: readonly string[]): string[] => [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0 && id.length <= 64))];

/**
 * Work orders with finished quantity and component consumption cost. The cost of one part is
 * the unit cost of the newest received purchase order line for it, else the product's purchase
 * price (the warehouse has no cost at the time of use, so Pulse keeps its own copy on its rows).
 */
export const listWorkOrders = scoped(async function listWorkOrders(ctx: DomainContext, options: { ids?: readonly string[]; query?: string; openOnly?: boolean; limit?: number } = {}): Promise<WmsWorkOrder[]> {
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
      siblingDb,
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
});

/**
 * Kits built per work order per day, from the warehouse ledger. Exact rule: a Kitting row for
 * the work order's own kit product. A row that lands in a location adds, a row that leaves one
 * (disassembly) takes away. Component rows share the type and are left out by the product test.
 * The day is the ledger time in `timezone`.
 */
export const workOrderBuildsByDay = scoped(async function workOrderBuildsByDay(ctx: DomainContext, workOrderIds: readonly string[], timezone: string): Promise<WmsBuildDay[]> {
  const ids = cleanIds(workOrderIds);
  const schema = ids.length > 0 ? await wmsReady(ctx) : null;
  if (!schema || !(await wmsTableExists(schema, 'inventory_transactions'))) return [];
  try {
    const t = (name: string) => wmsTable(schema, name);
    const found = await rows<{ work_order_id: string; work_date: string; kits: string }>(
      siblingDb,
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
});

/**
 * Billed revenue per bill and kind of work. Uses summary lines only (`is_detail = false`):
 * every fee also writes detail lines, and adding both would count a bill twice. Canceled bills
 * are left out. Draft bills come back with `approved: false`.
 */
export const listBilledRevenue = scoped(async function listBilledRevenue(ctx: DomainContext, options: { from?: string; clientId?: string } = {}): Promise<WmsBilledLine[]> {
  const schema = await wmsReady(ctx);
  if (!schema || !(await wmsTableExists(schema, 'billing_reports')) || !(await wmsTableExists(schema, 'billing_report_lines'))) return [];
  try {
    const t = (name: string) => wmsTable(schema, name);
    const from = options.from ? sql`and r.period_end >= ${options.from}` : sql``;
    const client = options.clientId ? sql`and r.client_id = ${options.clientId}` : sql``;
    const found = await rows<{ report_id: string; bill_number: string | null; client_id: string; period_end: string; operation: string; amount_cents: string; approved: boolean }>(
      siblingDb,
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
});

/** The WMS screen that lists extra service records. */
export const WMS_VAS_PATH = '/billing/vas';

/**
 * Extra service (VAS) records with the price the warehouse has for each one.
 *
 *  - A "Total Price" record carries its own price: that total is used as it is.
 *  - A "Vas Quantity" record is priced by the client's contract: the VAS fee for that service on
 *    the newest approved contract of the same client and warehouse that had started by the day
 *    of the work, at the rate the warehouse bill charges for one unit (`feeRateParts`).
 *  - A fee whose rate depends on the volume of a billing period, or that applies to some records
 *    only, cannot price one record: `priceFrom` is `warehouse_bill` and there is no price.
 *  - No such fee means no price yet.
 *
 * Tied to a work order when the record names one. The day is the record's time in the warehouse
 * time zone. Answers null when this workspace has no warehouse to read (so a caller never
 * mistakes "cannot read" for "no records"), and throws only when `throwOnError` is set.
 */
export const listVasRecords = scoped(async function listVasRecords(ctx: DomainContext, options: { throwOnError?: boolean } = {}): Promise<WmsVasRecord[] | null> {
  try {
    const schema = await wmsReady(ctx);
    if (!schema || !(await wmsTableExists(schema, 'vas_operations')) || !(await wmsTableExists(schema, 'lookup_values'))) return null;
    const t = (name: string) => wmsTable(schema, name);
    const hasFees = (await wmsTableExists(schema, 'billing_fees')) && (await wmsTableExists(schema, 'billing_contracts'));
    const hasTiers = hasFees && (await wmsTableExists(schema, 'billing_fee_tiers'));
    const hasWarehouses = await wmsTableExists(schema, 'warehouses');
    const fee = feeRateParts(t, hasTiers);
    const rate = hasFees
      ? sql`left join lateral (
              select case when ${fee.blocked} is null and ${fee.rate} >= 0 and ${fee.rate} < 1000000 then round(${fee.rate}::numeric, 4) end as rate,
                     ${fee.blocked} as blocked, bc.name as contract_name
                from ${t('billing_fees')} f
                join ${t('billing_contracts')} bc on bc.id = f.contract_id
                ${fee.joins}
               where bc.client_id = v.client_id and bc.warehouse_id = v.warehouse_id and bc.approval_status = 'Approved'
                 and f.operation_type = 'VAS' and f.vas_type_id = v.vas_type_id
                 and (${fee.blocked} is not null or (${fee.rate} >= 0 and ${fee.rate} < 1000000))
                 and left(bc.calc_start_date, 10) <= left(v.operation_at, 10)
               order by bc.calc_start_date desc, f.updated_at desc, f.id
               limit 1
            ) r on true`
      : sql`left join lateral (select null::numeric as rate, null::text as blocked, null::text as contract_name) r on true`;
    const zone = hasWarehouses ? sql`coalesce((select nullif(wh.timezone, '') from ${t('warehouses')} wh where wh.id = v.warehouse_id), 'UTC')` : sql`'UTC'`;
    const found = await rows<{
      id: string;
      client_id: string;
      warehouse_id: string | null;
      vas_type_id: string;
      vas_type: string;
      work_date: string;
      calculation_type: string;
      quantity: string;
      own_price: string;
      own_cents: string;
      rate: string | null;
      blocked: WmsBilledBy | null;
      contract_name: string | null;
      work_order_id: string | null;
      note: string | null;
    }>(
      siblingDb,
      sql`select v.id, v.client_id, v.warehouse_id, v.vas_type_id, lv.name as vas_type, v.calculation_type, v.note,
                 case when v.operation_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then ((v.operation_at::timestamptz at time zone ${zone})::date)::text else left(v.operation_at, 10) end as work_date,
                 round(v.value::numeric, 3)::text as quantity,
                 round(v.value::numeric, 4)::text as own_price,
                 round(v.value::numeric * 100)::bigint::text as own_cents,
                 r.rate::text as rate, r.blocked, r.contract_name,
                 (select wo.id from ${t('work_orders')} wo where v.reference_order_type = 'Work Order' and wo.code = v.reference_number limit 1) as work_order_id
            from ${t('vas_operations')} v
            join ${t('lookup_values')} lv on lv.id = v.vas_type_id
            ${rate}
           where v.operation_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' and v.client_id is not null and v.value >= 0 and v.value < 100000000
           order by v.operation_at, v.id
           limit 20000`,
    );
    return found.map((row): WmsVasRecord => {
      const own = row.calculation_type === 'Total Price';
      const priceFrom = own ? 'record' : row.blocked !== null ? 'warehouse_bill' : row.rate !== null ? 'contract' : null;
      return {
        id: row.id,
        clientId: row.client_id,
        warehouseId: row.warehouse_id,
        vasTypeId: row.vas_type_id,
        vasType: row.vas_type,
        workDate: row.work_date,
        priceFrom,
        quantity: own ? '1.000' : row.quantity,
        // A price of one has to fit the column: a very large own total keeps its cents and shows no price of one.
        unitPrice: own ? (Number(row.own_price) < 1_000_000 ? row.own_price : null) : row.rate,
        ownCents: own ? cents(row.own_cents) : null,
        contractName: priceFrom === 'contract' || priceFrom === 'warehouse_bill' ? row.contract_name : null,
        billedBy: priceFrom === 'warehouse_bill' ? row.blocked : null,
        workOrderId: row.work_order_id,
        note: row.note,
        path: WMS_VAS_PATH,
      };
    });
  } catch (error) {
    logSoftFail(ctx.orgId, 'wms.listVasRecords', error);
    if (options.throwOnError) throw error;
    return null;
  }
});

/**
 * What the warehouse contract says each of these work orders earns: the "Work Order" fees on the
 * newest approved contract of the work order's client and warehouse that has started (a contract
 * with a start day in the future is not read yet).
 *
 * Each fee is read at the rate the warehouse bill would charge for one unit (`feeRateParts`): its
 * standard rate, or its tier rate when the tiers give every unit the same rate. When a fee's rate
 * depends on the volume of a whole billing period (tiers with different rates, or units charged
 * only above a count), or the fee applies to some products only ("Charge if"), one job cannot know
 * its price: the work order comes back with no price and `billedBy` set, and the warehouse bill
 * prices it. A work order whose client has no such fee is left out. Fail soft: an empty list.
 */
export const listContractPrices = scoped(async function listContractPrices(ctx: DomainContext, workOrderIds: readonly string[]): Promise<WmsContractPrice[]> {
  const ids = cleanIds(workOrderIds);
  if (ids.length === 0) return [];
  try {
    const schema = await wmsReady(ctx);
    if (!schema || !(await wmsTableExists(schema, 'billing_fees')) || !(await wmsTableExists(schema, 'billing_contracts'))) return [];
    const t = (name: string) => wmsTable(schema, name);
    const fee = feeRateParts(t, await wmsTableExists(schema, 'billing_fee_tiers'));
    const kinds = sql`('Per Kit', 'Per Component', 'Per WorkOrder')`;
    const found = await rows<{ work_order_id: string; contract_id: string; contract_name: string; unit_price: string | null; per_order_cents: string | null; signature: string; blocked: WmsBilledBy | null; priced: boolean }>(
      siblingDb,
      sql`select w.id as work_order_id, c.contract_id, c.contract_name, a.blocked,
                 (a.per_kit is not null or a.per_component is not null or a.per_order is not null) as priced,
                 case when a.per_kit is null and a.per_component is null then null
                      else round(coalesce(a.per_kit, 0) + coalesce(a.per_component, 0) * p.parts, 4)::text end as unit_price,
                 round(a.per_order * 100)::bigint::text as per_order_cents,
                 concat_ws('|', c.contract_id, coalesce(a.per_kit::text, ''), coalesce(a.per_component::text, ''), coalesce(a.per_order::text, ''), p.parts::text) as signature
            from ${t('work_orders')} w
            cross join lateral (
              select coalesce(sum(wc.component_qty), 0)::numeric as parts from ${t('work_order_components')} wc where wc.work_order_id = w.id
            ) p
            join lateral (
              select bc.id as contract_id, bc.name as contract_name
                from ${t('billing_contracts')} bc
               where bc.client_id = w.client_id and bc.warehouse_id = w.warehouse_id and bc.approval_status = 'Approved'
                 -- A contract that has not started yet sets no price: its rates count from its start day.
                 and left(bc.calc_start_date, 10) <= to_char(now(), 'YYYY-MM-DD')
                 and exists (select 1 from ${t('billing_fees')} f where f.contract_id = bc.id and f.operation_type = 'Work Order' and f.fee_by in ${kinds})
               order by bc.calc_start_date desc, bc.id
               limit 1
            ) c on true
            cross join lateral (
              select sum(r.rate::numeric) filter (where r.fee_by = 'Per Kit' and r.usable) as per_kit,
                     sum(r.rate::numeric) filter (where r.fee_by = 'Per Component' and r.usable) as per_component,
                     sum(r.rate::numeric) filter (where r.fee_by = 'Per WorkOrder' and r.usable) as per_order,
                     -- "conditions" sorts before "tiers": a fee for some products only is named first.
                     min(r.blocked) as blocked
                from (
                  select f.fee_by, ${fee.rate} as rate, ${fee.blocked} as blocked,
                         (${fee.blocked} is null and ${fee.rate} >= 0 and ${fee.rate} < 1000000) as usable
                    from ${t('billing_fees')} f
                    ${fee.joins}
                   where f.contract_id = c.contract_id and f.operation_type = 'Work Order' and f.fee_by in ${kinds}
                ) r
            ) a
           where w.id in ${textList(ids)}`,
    );
    return found
      .filter((row) => row.blocked !== null || row.priced)
      .filter((row) => row.unit_price === null || Number(row.unit_price) < 1_000_000)
      .map((row) =>
        row.blocked !== null
          ? { workOrderId: row.work_order_id, contractName: row.contract_name, unitPrice: null, perOrderCents: null, signature: `${row.contract_id}|warehouse bill|${row.blocked}`, billedBy: row.blocked }
          : {
              workOrderId: row.work_order_id,
              contractName: row.contract_name,
              unitPrice: row.unit_price,
              perOrderCents: row.per_order_cents === null ? null : cents(row.per_order_cents),
              signature: row.signature,
              billedBy: null,
            },
      );
  } catch (error) {
    logSoftFail(ctx.orgId, 'wms.listContractPrices', error);
    return [];
  }
});
