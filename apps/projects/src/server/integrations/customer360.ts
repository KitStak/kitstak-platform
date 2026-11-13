/**
 * Customer 360 for a project: the live CRM and WMS picture of the customer the project serves,
 * read straight from the shared database (no sync, no cache beyond the request). This is the
 * strip at the top of the project Overview.
 *
 * Resolution order for the customer:
 *   project.crm_customer_id → project-level `core_customer` link → `crm.customer_links` for the
 *   linked CRM account. The account comes from a `crm_account` link or the linked deal's
 *   `account` relation. Deals: the project's own deal(s) plus other deals on that account.
 *
 * Every part fails soft: a missing app, table or permission just leaves that part null.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { integrationLinks } from '@/server/db/schema';
import type { DomainContext } from '@/server/domain/_shared';
import { crmItemUrl } from './crm';
import { getCustomers } from './customers';
import { integrationAvailability, tableExists } from './detect';

export interface Customer360Deal {
  readonly id: string;
  readonly name: string;
  readonly stage: string | null;
  readonly stageColor: string | null;
  /** won | lost | open */
  readonly outcome: 'won' | 'lost' | 'open';
  readonly amount: number | null;
  readonly currency: string | null;
  readonly closeDate: string | null;
  readonly url: string;
  /** True for the deal(s) this project is linked to. */
  readonly linked: boolean;
}

export interface Customer360 {
  readonly customer: { readonly id: string; readonly code: string; readonly name: string } | null;
  readonly account: { readonly id: string; readonly name: string; readonly url: string } | null;
  readonly crm: {
    readonly deals: readonly Customer360Deal[];
    readonly openPipeline: number;
    readonly wonValue: number;
    readonly currency: string;
  } | null;
  readonly wms: {
    readonly clientUrl: string;
    /** WMS grids filtered to this client. */
    readonly ordersUrl: string;
    readonly shippedUrl: string;
    readonly receiptsUrl: string;
    readonly openOrders: number;
    readonly exceptions: number;
    readonly openReceipts: number;
    readonly shippedLast30: number;
    readonly lastShippedAt: string | null;
  } | null;
  readonly checkedAt: string;
}

type DealRow = {
  id: string;
  board_id: string;
  name: string;
  stage_id: string | null;
  labels: unknown;
  amount: string | null;
  currency: string | null;
  close_date: string | null;
  account_id: string | null;
};

const UUID = /^[0-9a-f-]{36}$/i;

function outcomeOf(stageId: string | null, stageName: string | null, isDone: boolean): Customer360Deal['outcome'] {
  const key = `${stageId ?? ''} ${stageName ?? ''}`.toLowerCase();
  if (isDone || /\bwon\b|closed won/.test(key)) return 'won';
  if (/\blost\b|closed lost/.test(key)) return 'lost';
  return 'open';
}

const DEAL_SELECT = sql`
  select i.id, i.board_id, i.name,
         i.values #>> '{stage,labelId}' as stage_id,
         (select c.settings -> 'labels' from crm.columns c
            where c.board_id = i.board_id and c.key = 'stage' and c.deleted_at is null limit 1) as labels,
         i.values #>> '{deal_value,amount}' as amount,
         i.values #>> '{deal_value,currency}' as currency,
         i.values #>> '{close_date,date}' as close_date,
         i.values #>> '{account,itemIds,0}' as account_id
  from crm.items i join crm.boards b on b.id = i.board_id`;

function toDeal(ctx: DomainContext, row: DealRow, linkedIds: ReadonlySet<string>): Customer360Deal {
  const labels = Array.isArray(row.labels) ? (row.labels as { id: string; name: string; color?: string; isDone?: boolean }[]) : [];
  const label = row.stage_id ? labels.find((entry) => entry.id === row.stage_id) : undefined;
  const amount = row.amount !== null && row.amount !== '' ? Number(row.amount) : null;
  return {
    id: row.id,
    // CRM names can carry long dashes ("Acme \u2014 Plan"); KitStak copy uses a middle dot.
    name: row.name.replace(/\s*[\u2014\u2013]\s*/g, ' · '),
    stage: label?.name || null,
    stageColor: label?.color ?? null,
    outcome: outcomeOf(row.stage_id, label?.name ?? null, label?.isDone === true),
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    currency: row.currency,
    closeDate: row.close_date,
    url: crmItemUrl(ctx.orgSlug, row.board_id, row.id),
    linked: linkedIds.has(row.id),
  };
}

async function crmPart(
  ctx: DomainContext,
  dealIds: readonly string[],
  accountHint: string | null,
  customerId: string | null,
): Promise<{ crm: Customer360['crm']; account: Customer360['account']; customerFromAccount: string | null }> {
  try {
    const linked = new Set(dealIds);
    const own = dealIds.length
      ? (
          await db.execute<DealRow>(sql`${DEAL_SELECT}
            where i.org_id = ${ctx.orgId} and b.kind::text = 'deals' and i.deleted_at is null
              and i.id = any(${sql.param([...dealIds])}::uuid[])`)
        ).rows
      : [];
    let accountId = accountHint ?? own.find((row) => row.account_id)?.account_id ?? null;
    let customerFromAccount: string | null = null;
    const hasLinks = await tableExists('crm.customer_links');
    if (hasLinks && accountId) {
      const found = await db.execute<{ id: string }>(
        sql`select core_customer_id::text as id from crm.customer_links where org_id = ${ctx.orgId} and item_id = ${accountId}::uuid limit 1`,
      );
      customerFromAccount = found.rows[0]?.id ?? null;
    }
    if (!accountId && hasLinks && customerId) {
      const found = await db.execute<{ id: string }>(
        sql`select item_id::text as id from crm.customer_links where org_id = ${ctx.orgId} and core_customer_id = ${customerId}::uuid limit 1`,
      );
      accountId = found.rows[0]?.id ?? null;
    }
    let account: Customer360['account'] = null;
    let others: DealRow[] = [];
    if (accountId && UUID.test(accountId)) {
      const acc = await db.execute<{ id: string; board_id: string; name: string }>(
        sql`select id, board_id, name from crm.items where org_id = ${ctx.orgId} and id = ${accountId}::uuid and deleted_at is null`,
      );
      const row = acc.rows[0];
      if (row) account = { id: row.id, name: row.name.replace(/\s*[\u2014\u2013]\s*/g, ' · '), url: crmItemUrl(ctx.orgSlug, row.board_id, row.id) };
      others = (
        await db.execute<DealRow>(sql`${DEAL_SELECT}
          where i.org_id = ${ctx.orgId} and b.kind::text = 'deals' and i.deleted_at is null and i.archived_at is null
            and i.parent_item_id is null and (i.values -> 'account' -> 'itemIds') ? ${accountId}
          order by i.updated_at desc limit 12`)
      ).rows;
    }
    const byId = new Map<string, DealRow>();
    for (const row of [...own, ...others]) byId.set(row.id, row);
    const deals = [...byId.values()].map((row) => toDeal(ctx, row, linked));
    if (deals.length === 0 && !account) return { crm: null, account: null, customerFromAccount };
    // Linked deals first, then open deals, then the rest.
    deals.sort((a, b) => Number(b.linked) - Number(a.linked) || Number(b.outcome === 'open') - Number(a.outcome === 'open'));
    const currency = deals.find((deal) => deal.currency)?.currency ?? 'USD';
    const sum = (outcome: Customer360Deal['outcome']) =>
      deals.filter((deal) => deal.outcome === outcome).reduce((total, deal) => total + (deal.amount ?? 0), 0);
    return {
      crm: { deals: deals.slice(0, 5), openPipeline: sum('open'), wonValue: sum('won'), currency },
      account,
      customerFromAccount,
    };
  } catch (error) {
    console.error('[projects] customer 360 CRM read failed', error);
    return { crm: null, account: null, customerFromAccount: null };
  }
}

const SHIPPED = ['Shipped', 'Delivered'];
const CLOSED_ORDER = ['Shipped', 'Delivered', 'Cancelled'];
const EXCEPTION_ORDER = ['Shortage', 'On Hold', 'Exception', 'Backordered'];
const OPEN_RECEIPT = ['Pending', 'Started', 'Open', 'In Progress', 'Receiving'];

async function wmsPart(customer: { id: string; code: string }): Promise<Customer360['wms']> {
  try {
    const client = await db.execute<{ id: string }>(
      sql`select id::text as id from wms.clients where id::text = ${customer.id} or code = ${customer.code} order by (id::text = ${customer.id}) desc limit 1`,
    );
    const clientId = client.rows[0]?.id;
    if (!clientId) return null;
    const result = await db.execute<{ open_orders: number; exceptions: number; shipped_30: number; last_shipped: string | null; open_receipts: number }>(sql`
      select
        (select count(*)::int from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null
           and status <> all(${sql.param(CLOSED_ORDER)}::text[])) as open_orders,
        (select count(*)::int from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null
           and status = any(${sql.param(EXCEPTION_ORDER)}::text[])) as exceptions,
        (select count(*)::int from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null
           and status = any(${sql.param(SHIPPED)}::text[]) and shipped_at >= now() - interval '30 days') as shipped_30,
        (select max(shipped_at)::text from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null) as last_shipped,
        (select count(*)::int from wms.purchase_orders where client_id::text = ${clientId}
           and status = any(${sql.param(OPEN_RECEIPT)}::text[])) as open_receipts`);
    const row = result.rows[0];
    if (!row) return null;
    const origin = env.NEXT_PUBLIC_WMS_URL.replace(/\/+$/, '');
    const filter = `f.clientId=in:${encodeURIComponent(clientId)}`;
    return {
      clientUrl: `${origin}/clients/${encodeURIComponent(clientId)}`,
      ordersUrl: `${origin}/orders?${filter}`,
      shippedUrl: `${origin}/orders/shipped?${filter}`,
      receiptsUrl: `${origin}/receiving?${filter}`,
      openOrders: Number(row.open_orders) || 0,
      exceptions: Number(row.exceptions) || 0,
      openReceipts: Number(row.open_receipts) || 0,
      shippedLast30: Number(row.shipped_30) || 0,
      lastShippedAt: row.last_shipped ? new Date(row.last_shipped).toISOString() : null,
    };
  } catch (error) {
    console.error('[projects] customer 360 WMS read failed', error);
    return null;
  }
}

export async function customer360(
  ctx: DomainContext,
  project: { readonly id: string; readonly crmCustomerId: string | null; readonly crmItemId: string | null },
): Promise<Customer360> {
  const checkedAt = new Date().toISOString();
  const availability = await integrationAvailability(ctx);
  const links = await db
    .select({ type: integrationLinks.targetType, id: integrationLinks.targetId })
    .from(integrationLinks)
    .where(and(eq(integrationLinks.orgId, ctx.orgId), eq(integrationLinks.projectId, project.id), isNull(integrationLinks.taskId)));
  const dealIds = [
    ...new Set([project.crmItemId, ...links.filter((link) => link.type === 'crm_item').map((link) => link.id)].filter((id): id is string => Boolean(id && UUID.test(id)))),
  ];
  const accountHint = links.find((link) => link.type === 'crm_account' && UUID.test(link.id))?.id ?? null;
  let customerId = project.crmCustomerId ?? links.find((link) => link.type === 'core_customer')?.id ?? null;

  const crm = availability.crm ? await crmPart(ctx, dealIds, accountHint, customerId) : { crm: null, account: null, customerFromAccount: null };
  customerId = customerId ?? crm.customerFromAccount;
  const customer = customerId ? ((await getCustomers(ctx, [customerId])).get(customerId) ?? null) : null;
  const wms = customer && availability.wms ? await wmsPart(customer) : null;
  return {
    customer: customer ? { id: customer.id, code: customer.code, name: customer.name } : null,
    account: crm.account,
    crm: crm.crm,
    wms,
    checkedAt,
  };
}
