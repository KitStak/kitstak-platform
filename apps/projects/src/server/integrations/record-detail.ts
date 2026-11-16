/**
 * Live detail for one linked CRM / WMS record: the hover card behind every task chip. Reads the
 * sibling app's tables directly (no cache), so the card is always the current truth: deal value,
 * stage, owner and close date for CRM; status, dates and line items for WMS orders, receipts,
 * work orders and counts.
 *
 * Only records that are linked to work in this org are readable here (the chip is the entry
 * point), and every read fails soft: on any error the card just says it could not load.
 */
import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { wmsTable } from '@kitstak/db/wms-tenants';
import { db } from '@/server/db';
import { integrationLinks } from '@/server/db/schema';
import type { DomainContext } from '@/server/domain/_shared';
import type { IntegrationTargetType } from '@/lib/constants';
import type { RecordDetail, RecordDetailFact, RecordDetailLine } from '@/lib/types';
import { crmItemUrl } from './crm';
import { integrationAvailability, wmsSchemaFor, wmsTableExists } from './detect';
import { wmsUrl } from './wms';

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_LINES = 8;

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function money(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString('en-US')}`;
  }
}

function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fact(label: string, value: string | null | undefined, tone?: RecordDetailFact['tone']): RecordDetailFact | null {
  return value ? { label, value, ...(tone ? { tone } : {}) } : null;
}

const facts = (...entries: (RecordDetailFact | null)[]): RecordDetailFact[] => entries.filter((entry): entry is RecordDetailFact => entry !== null);

async function isLinked(ctx: DomainContext, type: IntegrationTargetType, id: string): Promise<boolean> {
  const rows = await db
    .select({ id: integrationLinks.id })
    .from(integrationLinks)
    .where(and(eq(integrationLinks.orgId, ctx.orgId), eq(integrationLinks.targetType, type), eq(integrationLinks.targetId, id)))
    .limit(1);
  return rows.length > 0;
}

async function crmDetail(ctx: DomainContext, type: IntegrationTargetType, id: string): Promise<RecordDetail | null> {
  if (!UUID.test(id)) return null;
  const result = await db.execute<{
    id: string;
    board_id: string;
    kind: string;
    name: string;
    stage_id: string | null;
    labels: unknown;
    amount: string | null;
    currency: string | null;
    close_date: string | null;
    probability: string | null;
    next_step: string | null;
    owner_id: string | null;
    owner_name: string | null;
    updated_at: string | null;
  }>(sql`
    select i.id, i.board_id, b.kind::text as kind, i.name,
           coalesce(i.values #>> '{stage,labelId}', i.values #>> '{status,labelId}', i.values #>> '{health,labelId}') as stage_id,
           (select c.settings -> 'labels' from crm.columns c
              where c.board_id = b.id and c.key in ('stage', 'status', 'health') and c.deleted_at is null
              order by case c.key when 'stage' then 0 when 'status' then 1 else 2 end limit 1) as labels,
           i.values #>> '{deal_value,amount}' as amount,
           i.values #>> '{deal_value,currency}' as currency,
           i.values #>> '{close_date,date}' as close_date,
           case when jsonb_typeof(i.values -> 'probability') = 'number' then i.values ->> 'probability'
                else i.values #>> '{probability,value}' end as probability,
           case when jsonb_typeof(i.values -> 'next_step') = 'string' then i.values ->> 'next_step'
                else i.values #>> '{next_step,text}' end as next_step,
           coalesce(i.values #>> '{owner,ids,0}', i.values #>> '{owner,userIds,0}') as owner_id,
           (select u.name from core."user" u
              where u.id::text = coalesce(i.values #>> '{owner,ids,0}', i.values #>> '{owner,userIds,0}') limit 1) as owner_name,
           i.updated_at::text as updated_at
    from crm.items i join crm.boards b on b.id = i.board_id
    where i.org_id = ${ctx.orgId} and i.id = ${id}::uuid and i.deleted_at is null
    limit 1`);
  const row = result.rows[0];
  if (!row) return null;
  const labels = Array.isArray(row.labels) ? (row.labels as { id: string; name: string }[]) : [];
  const stage = row.stage_id ? (labels.find((entry) => entry.id === row.stage_id)?.name ?? null) : null;
  const amount = row.amount !== null && row.amount !== '' ? num(row.amount) : null;
  const isDeal = row.kind === 'deals';
  return {
    type,
    id: row.id,
    app: 'crm',
    kindLabel: isDeal ? 'CRM deal' : 'CRM account',
    title: row.name,
    status: stage,
    url: crmItemUrl(ctx.orgSlug, row.board_id, row.id),
    facts: facts(
      isDeal && amount !== null ? fact('Deal value', money(amount, row.currency)) : null,
      fact(isDeal ? 'Stage' : 'Status', stage),
      isDeal && row.probability ? fact('Win chance', `${Math.round(num(row.probability))}%`) : null,
      isDeal ? fact('Close date', shortDate(row.close_date)) : null,
      fact('Owner', row.owner_name),
      fact('Next step', row.next_step),
    ),
    lines: [],
    linesLabel: null,
    moreLines: 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    checkedAt: new Date().toISOString(),
  };
}

type LineRow = { label: string; sku: string | null; a: number | string | null; b: number | string | null; c: number | string | null };

function lineOf(row: LineRow, parts: (row: LineRow) => { value: string; tone?: RecordDetailLine['tone'] }): RecordDetailLine {
  const { value, tone } = parts(row);
  return { label: row.label, sku: row.sku, value, ...(tone ? { tone } : {}) };
}

async function wmsDetail(schema: string, type: Exclude<IntegrationTargetType, 'crm_item' | 'crm_account' | 'core_customer'>, id: string): Promise<RecordDetail | null> {
  /** A table in the request org's own warehouse schema. */
  const t = (table: string) => wmsTable(schema, table);
  const base = { type, id, app: 'wms' as const, url: wmsUrl(type, id), checkedAt: new Date().toISOString() };
  if (type === 'wms_order') {
    const head = await db.execute<{ code: string; status: string; customer: string | null; carrier: string | null; tracking: string | null; expected: string | null; shipped: string | null; qty: number; updated_at: string | null }>(sql`
      select code, status, coalesce(nullif(customer_name, ''), nullif(company_name, ''), store_name) as customer, carrier,
             tracking_number as tracking, expected_ship_date as expected, shipped_at as shipped, total_quantity as qty, updated_at
      from ${t('shipment_orders')} where id = ${id} limit 1`);
    const row = head.rows[0];
    if (!row) return null;
    const lines = await db.execute<LineRow & { total: number }>(sql`
      select coalesce(p.name, 'Item') as label, p.sku, l.quantity as a, l.picked_quantity as b, l.shipped_quantity as c, count(*) over()::int as total
      from ${t('order_lines')} l left join ${t('products')} p on p.id = l.product_id
      where l.order_id = ${id} order by l.created_at limit ${MAX_LINES}`);
    const total = lines.rows[0]?.total ?? 0;
    return {
      ...base,
      kindLabel: 'WMS order',
      title: `${row.code}${row.customer ? ` · ${row.customer}` : ''}`,
      status: row.status,
      facts: facts(
        fact('Units', String(row.qty ?? 0)),
        fact('Ship by', shortDate(row.expected)),
        fact('Shipped', shortDate(row.shipped), 'success'),
        fact('Carrier', [row.carrier, row.tracking].filter(Boolean).join(' · ') || null),
      ),
      lines: lines.rows.map((line) =>
        lineOf(line, (l) => {
          const ordered = num(l.a);
          const shipped = num(l.c);
          const picked = num(l.b);
          if (shipped >= ordered && ordered > 0) return { value: `${shipped} of ${ordered} shipped`, tone: 'success' };
          return { value: `${picked} of ${ordered} picked` };
        }),
      ),
      linesLabel: 'Line items',
      moreLines: Math.max(0, total - lines.rows.length),
      updatedAt: row.updated_at,
    };
  }
  if (type === 'wms_receipt') {
    const head = await db.execute<{ code: string; status: string; vendor: string | null; expected: string | null; received_at: string | null; total: number; received: number; updated_at: string | null }>(sql`
      select code, status, vendor_name as vendor, coalesce(expected_date, planned_arrival_date) as expected, received_at,
             total_quantity as total, received_quantity as received, updated_at
      from ${t('purchase_orders')} where id = ${id} limit 1`);
    const row = head.rows[0];
    if (!row) return null;
    const lines = await db.execute<LineRow & { total: number; issues: number }>(sql`
      select coalesce(p.name, 'Item') as label, p.sku, l.ordered_quantity as a, l.received_quantity as b, l.damaged_quantity as c,
             count(*) over()::int as total,
             (count(*) filter (where l.damaged_quantity > 0 or (l.received_quantity > 0 and l.received_quantity <> l.ordered_quantity)) over())::int as issues
      from ${t('purchase_order_lines')} l left join ${t('products')} p on p.id = l.product_id
      where l.purchase_order_id = ${id}
      order by (l.damaged_quantity > 0 or (l.received_quantity > 0 and l.received_quantity <> l.ordered_quantity)) desc, l.created_at
      limit ${MAX_LINES}`);
    const total = lines.rows[0]?.total ?? 0;
    const issues = lines.rows[0]?.issues ?? 0;
    return {
      ...base,
      kindLabel: 'WMS receipt',
      title: `${row.code}${row.vendor ? ` · ${row.vendor}` : ''}`,
      status: row.status,
      facts: facts(
        fact('Received', `${num(row.received)} of ${num(row.total)} units`, num(row.received) >= num(row.total) && num(row.total) > 0 ? 'success' : undefined),
        issues > 0 ? fact('Discrepancies', `${issues} ${issues === 1 ? 'line' : 'lines'}`, 'danger') : null,
        fact('Expected', shortDate(row.expected)),
        fact('Received on', shortDate(row.received_at)),
      ),
      lines: lines.rows.map((line) =>
        lineOf(line, (l) => {
          const ordered = num(l.a);
          const received = num(l.b);
          const damaged = num(l.c);
          if (damaged > 0) return { value: `${received} of ${ordered}, ${damaged} damaged`, tone: 'danger' };
          if (received > 0 && received !== ordered) return { value: `${received} of ${ordered} received`, tone: 'warning' };
          if (received >= ordered && ordered > 0) return { value: `${received} of ${ordered} received`, tone: 'success' };
          return { value: `${received} of ${ordered} received` };
        }),
      ),
      linesLabel: 'Lines',
      moreLines: Math.max(0, total - lines.rows.length),
      updatedAt: row.updated_at,
    };
  }
  if (type === 'wms_work_order') {
    const head = await db.execute<{ code: string; status: string; kind: string | null; requested: number; processed: number; kit: string | null; start: string | null; finish: string | null; updated_at: string | null }>(sql`
      select w.code, w.status, w.type as kind, w.requested_qty as requested, w.processed_qty as processed, p.name as kit,
             w.planned_start_at as start, w.planned_finish_at as finish, w.updated_at
      from ${t('work_orders')} w left join ${t('products')} p on p.id = w.kit_product_id where w.id = ${id} limit 1`);
    const row = head.rows[0];
    if (!row) return null;
    const hasComponents = await wmsTableExists(schema, 'work_order_components');
    const lines = hasComponents
      ? await db.execute<LineRow & { total: number }>(sql`
          select coalesce(p.name, 'Component') as label, p.sku, c.total_qty as a, c.picked_qty as b, c.consumed_qty as c, count(*) over()::int as total
          from ${t('work_order_components')} c left join ${t('products')} p on p.id = c.component_product_id
          where c.work_order_id = ${id} order by c.id limit ${MAX_LINES}`)
      : { rows: [] as (LineRow & { total: number })[] };
    const total = lines.rows[0]?.total ?? 0;
    return {
      ...base,
      kindLabel: 'WMS work order',
      title: `${row.code}${row.kit ? ` · ${row.kit}` : row.kind ? ` · ${row.kind}` : ''}`,
      status: row.status,
      facts: facts(
        fact('Built', `${num(row.processed)} of ${num(row.requested)}`, num(row.processed) >= num(row.requested) && num(row.requested) > 0 ? 'success' : undefined),
        fact('Planned start', shortDate(row.start)),
        fact('Planned finish', shortDate(row.finish)),
      ),
      lines: lines.rows.map((line) => lineOf(line, (l) => ({ value: `${num(l.b)} of ${num(l.a)} picked` }))),
      linesLabel: 'Components',
      moreLines: Math.max(0, total - lines.rows.length),
      updatedAt: row.updated_at,
    };
  }
  // wms_count
  const head = await db.execute<{ code: string; status: string; description: string | null; scheduled: string | null; kind: string | null; updated_at: string | null }>(sql`
    select code, status, description, scheduled_at as scheduled, count_type as kind, updated_at from ${t('count_plans')} where id = ${id} limit 1`);
  const row = head.rows[0];
  if (!row) return null;
  const lines = await db.execute<LineRow & { total: number; counted: number; off: number; expected_sum: number; variance_sum: number }>(sql`
    select coalesce(p.name, loc.code, 'Line') as label, coalesce(p.sku, loc.code) as sku, l.initial_stock_qty as a, l.counted_qty as b, null::int as c,
           count(*) over()::int as total,
           (count(*) filter (where l.counted_qty is not null) over())::int as counted,
           (count(*) filter (where l.counted_qty is not null and l.counted_qty <> l.initial_stock_qty) over())::int as off,
           (sum(l.initial_stock_qty) filter (where l.counted_qty is not null) over())::int as expected_sum,
           (sum(abs(coalesce(l.counted_qty, l.initial_stock_qty) - l.initial_stock_qty)) over())::int as variance_sum
    from ${t('count_plan_lines')} l
      left join ${t('products')} p on p.id = l.product_id
      left join ${t('locations')} loc on loc.id = l.location_id
    where l.plan_id = ${id} and not l.is_recount_line
    order by (l.counted_qty is not null and l.counted_qty <> l.initial_stock_qty) desc, loc.code
    limit ${MAX_LINES}`);
  const first = lines.rows[0];
  const total = first?.total ?? 0;
  const variancePct = first && num(first.expected_sum) > 0 ? (num(first.variance_sum) / num(first.expected_sum)) * 100 : 0;
  return {
    ...base,
    kindLabel: 'WMS cycle count',
    title: `${row.code}${row.description ? ` · ${row.description}` : ''}`,
    status: row.status,
    facts: facts(
      fact('Counted', `${num(first?.counted)} of ${total} lines`),
      first && num(first.off) > 0 ? fact('Variance', `${variancePct.toFixed(variancePct < 1 ? 2 : 1)}% on ${num(first.off)} ${num(first.off) === 1 ? 'line' : 'lines'}`, variancePct >= 5 ? 'danger' : 'warning') : null,
      fact('Scheduled', shortDate(row.scheduled)),
    ),
    lines: lines.rows.map((line) =>
      lineOf(line, (l) => {
        const expected = num(l.a);
        if (l.b === null || l.b === undefined) return { value: `${expected} expected, not counted` };
        const counted = num(l.b);
        const diff = counted - expected;
        if (diff === 0) return { value: `${counted} counted, matches`, tone: 'success' };
        return { value: `${counted} counted, ${diff > 0 ? '+' : ''}${diff}`, tone: 'warning' };
      }),
    ),
    linesLabel: 'Lines',
    moreLines: Math.max(0, total - lines.rows.length),
    updatedAt: row.updated_at,
  };
}

/** Sibling-app names can carry long dashes ("Apex Tee \u2014 Navy"); KitStak copy uses a middle dot. */
const dash = (text: string): string => text.replace(/\s*[\u2014\u2013]\s*|\s+--\s+/g, ' · ');

function tidy(detail: RecordDetail | null): RecordDetail | null {
  if (!detail) return null;
  return {
    ...detail,
    title: dash(detail.title),
    status: detail.status ? dash(detail.status) : null,
    facts: detail.facts.map((entry) => ({ ...entry, value: dash(entry.value) })),
    lines: detail.lines.map((line) => ({ ...line, label: dash(line.label) })),
  };
}

export async function getRecordDetail(ctx: DomainContext, type: IntegrationTargetType, id: string): Promise<RecordDetail | null> {
  if (type === 'core_customer' || !id || id.length > 100) return null;
  try {
    if (!(await isLinked(ctx, type, id))) return null;
    const availability = await integrationAvailability(ctx);
    if (type === 'crm_item' || type === 'crm_account') return availability.crm ? tidy(await crmDetail(ctx, type, id)) : null;
    if (!availability.wms) return null;
    const schema = await wmsSchemaFor(ctx);
    return schema ? tidy(await wmsDetail(schema, type, id)) : null;
  } catch (error) {
    console.error('[projects] record detail read failed', error);
    return null;
  }
}
