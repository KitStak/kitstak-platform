/**
 * Customer 360 for a project: the live CRM and WMS picture of the customer the project serves,
 * read straight from the shared database (no sync, no cache beyond the request). This is the
 * card at the top of the project Overview.
 *
 * Resolution order for the customer:
 *   project.crm_customer_id → project-level `core_customer` link → `crm.customer_links` for the
 *   linked CRM account. The account comes from a `crm_account` link or the linked deal's
 *   `account` relation. Deals: the project's own deal(s) plus other deals on that account.
 *
 * CRM part: headline deal (name, stage, value, close date, owner), its contacts, last touch.
 * WMS part: SKUs received, open orders, shipped in 7 days, the latest receipt, inventory
 * exceptions. Every number carries a deep link into the sibling app.
 * Risks: cross-app facts that put the project at risk (deal closes before the work is due,
 * late receipts, inventory exceptions, lost deal).
 *
 * Every part fails soft: a missing app, table or permission just leaves that part null.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { appUrls } from '@/server/env';
import { integrationLinks } from '@/server/db/schema';
import type { DomainContext } from '@/server/domain/_shared';
import { crmItemUrl } from './crm';
import { getCustomers } from './customers';
import { integrationAvailability, tableExists } from './detect';

export interface Customer360Person {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface Customer360Contact {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly email: string | null;
  readonly url: string;
}

export interface Customer360Deal {
  readonly id: string;
  readonly name: string;
  readonly stage: string | null;
  readonly stageColor: string | null;
  /** won | lost | open */
  readonly outcome: 'won' | 'lost' | 'open';
  readonly amount: number | null;
  readonly currency: string | null;
  /** ISO date (yyyy-mm-dd). */
  readonly closeDate: string | null;
  readonly probability: number | null;
  readonly nextStep: string | null;
  readonly owner: Customer360Person | null;
  readonly url: string;
  /** True for the deal(s) this project is linked to. */
  readonly linked: boolean;
}

export interface Customer360Risk {
  readonly id: string;
  readonly app: 'crm' | 'wms';
  readonly tone: 'danger' | 'warning';
  readonly text: string;
  readonly href: string | null;
}

export interface Customer360Receipt {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly expectedAt: string | null;
  readonly receivedAt: string | null;
  readonly late: boolean;
  readonly url: string;
}

export interface Customer360 {
  readonly available: { readonly crm: boolean; readonly wms: boolean };
  /** Sibling app origins, for empty-state actions. */
  readonly urls: { readonly crm: string; readonly wms: string };
  readonly customer: { readonly id: string; readonly code: string; readonly name: string } | null;
  readonly account: { readonly id: string; readonly name: string; readonly url: string } | null;
  readonly crm: {
    readonly headline: Customer360Deal | null;
    readonly deals: readonly Customer360Deal[];
    readonly contacts: readonly Customer360Contact[];
    readonly openPipeline: number;
    readonly wonValue: number;
    readonly currency: string;
    readonly lastTouch: { readonly at: string; readonly by: string | null; readonly text: string | null } | null;
  } | null;
  readonly wms: {
    readonly clientUrl: string;
    readonly ordersUrl: string;
    readonly shippedUrl: string;
    readonly receiptsUrl: string;
    readonly receivedUrl: string;
    readonly exceptionsUrl: string;
    readonly openOrders: number;
    readonly openReceipts: number;
    readonly lateReceipts: number;
    readonly skusReceived30: number;
    readonly shippedLast7: number;
    readonly shippedLast30: number;
    readonly lastShippedAt: string | null;
    /** Orders in an exception status + open line shortages + allocation exceptions (30 days). */
    readonly exceptions: number;
    readonly lastReceipt: Customer360Receipt | null;
  } | null;
  readonly risks: readonly Customer360Risk[];
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
  probability: string | null;
  next_step: string | null;
  owner_id: string | null;
  contact_ids: unknown;
};

const UUID = /^[0-9a-f-]{36}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const undashName = (name: string) => name.replace(/\s*[—–]\s*/g, ' · ');

function outcomeOf(stageId: string | null, stageName: string | null, isDone: boolean): Customer360Deal['outcome'] {
  const key = `${stageId ?? ''} ${stageName ?? ''}`.toLowerCase();
  if (isDone || /\bwon\b|closed won/.test(key)) return 'won';
  if (/\blost\b|closed lost/.test(key)) return 'lost';
  return 'open';
}

/** "Nov 30" (adds the year when it is not this year). Date-only values are read as UTC days. */
export function shortDay(iso: string, now = new Date()): string {
  const date = new Date(ISO_DAY.test(iso) ? `${iso}T00:00:00Z` : iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: 'numeric' } : {}),
  });
}

const DEAL_SELECT = sql`
  select i.id, i.board_id, i.name,
         i.values #>> '{stage,labelId}' as stage_id,
         (select c.settings -> 'labels' from crm.columns c
            where c.board_id = i.board_id and c.key = 'stage' and c.deleted_at is null limit 1) as labels,
         i.values #>> '{deal_value,amount}' as amount,
         i.values #>> '{deal_value,currency}' as currency,
         i.values #>> '{close_date,date}' as close_date,
         i.values #>> '{account,itemIds,0}' as account_id,
         case when jsonb_typeof(i.values -> 'probability') = 'number' then i.values ->> 'probability'
              else i.values #>> '{probability,value}' end as probability,
         case when jsonb_typeof(i.values -> 'next_step') = 'string' then i.values ->> 'next_step'
              else i.values #>> '{next_step,text}' end as next_step,
         i.values #>> '{owner,ids,0}' as owner_id,
         i.values #> '{contacts,itemIds}' as contact_ids
  from crm.items i join crm.boards b on b.id = i.board_id`;

function toDeal(ctx: DomainContext, row: DealRow, linkedIds: ReadonlySet<string>, people: ReadonlyMap<string, Customer360Person>): Customer360Deal {
  const labels = Array.isArray(row.labels) ? (row.labels as { id: string; name: string; color?: string; isDone?: boolean }[]) : [];
  const label = row.stage_id ? labels.find((entry) => entry.id === row.stage_id) : undefined;
  const amount = row.amount !== null && row.amount !== '' ? Number(row.amount) : null;
  const probability = row.probability !== null && row.probability !== '' ? Number(row.probability) : null;
  return {
    id: row.id,
    // CRM names can carry long dashes ("Acme — Plan"); KitStak copy uses a middle dot.
    name: undashName(row.name),
    stage: label?.name || null,
    stageColor: label?.color ?? null,
    outcome: outcomeOf(row.stage_id, label?.name ?? null, label?.isDone === true),
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    currency: row.currency,
    closeDate: row.close_date && ISO_DAY.test(row.close_date) ? row.close_date : null,
    probability: probability !== null && Number.isFinite(probability) ? probability : null,
    nextStep: row.next_step?.trim() ? undashName(row.next_step.trim()) : null,
    owner: row.owner_id ? (people.get(row.owner_id) ?? null) : null,
    url: crmItemUrl(ctx.orgSlug, row.board_id, row.id),
    linked: linkedIds.has(row.id),
  };
}

async function peopleById(ids: readonly string[]): Promise<Map<string, Customer360Person>> {
  const valid = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (valid.length === 0) return new Map();
  const rows = await db.execute<{ id: string; name: string | null; email: string; image: string | null }>(
    sql`select id::text as id, name, email, image from core."user" where id = any(${sql.param(valid)}::uuid[])`,
  );
  return new Map(rows.rows.map((row) => [row.id, { id: row.id, name: row.name || row.email, image: row.image }]));
}

const idList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && UUID.test(id)) : []);

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
    if (hasLinks && accountId && UUID.test(accountId)) {
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
    let accountContactIds: string[] = [];
    let others: DealRow[] = [];
    if (accountId && UUID.test(accountId)) {
      const acc = await db.execute<{ id: string; board_id: string; name: string; contact_ids: unknown }>(
        sql`select id, board_id, name, values #> '{contacts,itemIds}' as contact_ids
              from crm.items where org_id = ${ctx.orgId} and id = ${accountId}::uuid and deleted_at is null`,
      );
      const row = acc.rows[0];
      if (row) {
        account = { id: row.id, name: undashName(row.name), url: crmItemUrl(ctx.orgSlug, row.board_id, row.id) };
        accountContactIds = idList(row.contact_ids);
      }
      others = (
        await db.execute<DealRow>(sql`${DEAL_SELECT}
          where i.org_id = ${ctx.orgId} and b.kind::text = 'deals' and i.deleted_at is null and i.archived_at is null
            and i.parent_item_id is null and (i.values -> 'account' -> 'itemIds') ? ${accountId}
          order by i.updated_at desc limit 12`)
      ).rows;
    }
    const byId = new Map<string, DealRow>();
    for (const row of [...own, ...others]) byId.set(row.id, row);
    if (byId.size === 0 && !account) return { crm: null, account: null, customerFromAccount };

    const people = await peopleById([...byId.values()].map((row) => row.owner_id ?? '').filter(Boolean));
    const deals = [...byId.values()].map((row) => toDeal(ctx, row, linked, people));
    // Linked deals first, then open deals, then the rest.
    deals.sort((a, b) => Number(b.linked) - Number(a.linked) || Number(b.outcome === 'open') - Number(a.outcome === 'open'));
    const headline = deals[0] ?? null;
    const currency = deals.find((deal) => deal.currency)?.currency ?? 'USD';
    const sum = (outcome: Customer360Deal['outcome']) =>
      deals.filter((deal) => deal.outcome === outcome).reduce((total, deal) => total + (deal.amount ?? 0), 0);

    // Contacts: the headline deal's, else the account's.
    const headlineRow = headline ? byId.get(headline.id) : undefined;
    const contactIds = [...new Set([...idList(headlineRow?.contact_ids), ...accountContactIds])].slice(0, 8);
    const contacts: Customer360Contact[] = contactIds.length
      ? (
          await db.execute<{ id: string; board_id: string; name: string; title: string | null; email: string | null }>(sql`
            select id, board_id, name,
                   case when jsonb_typeof(values -> 'job_title') = 'string' then values ->> 'job_title'
                        else values #>> '{job_title,text}' end as title,
                   coalesce(values #>> '{email,email}', values #>> '{email,value}') as email
              from crm.items where org_id = ${ctx.orgId} and deleted_at is null and id = any(${sql.param(contactIds)}::uuid[])`)
        ).rows
          .sort((a, b) => contactIds.indexOf(a.id) - contactIds.indexOf(b.id))
          .map((row) => ({
            id: row.id,
            name: undashName(row.name),
            title: row.title?.trim() || null,
            email: row.email?.trim() || null,
            url: crmItemUrl(ctx.orgSlug, row.board_id, row.id),
          }))
      : [];

    // Last touch: the newest update on the deals, the account or its contacts.
    const touchIds = [...byId.keys(), ...(account ? [account.id] : []), ...contacts.map((contact) => contact.id)];
    const touch = (
      await db.execute<{ at: string; by: string | null; text: string | null }>(sql`
        select u.created_at::text as at, coalesce(nullif(p.name, ''), p.email) as by, left(u.body_text, 160) as text
          from crm.updates u left join core."user" p on p.id = u.author_id
         where u.org_id = ${ctx.orgId} and u.deleted_at is null and u.item_id = any(${sql.param(touchIds)}::uuid[])
         order by u.created_at desc limit 1`)
    ).rows[0];

    return {
      crm: {
        headline,
        deals: deals.slice(0, 5),
        contacts,
        openPipeline: sum('open'),
        wonValue: sum('won'),
        currency,
        lastTouch: touch ? { at: new Date(touch.at).toISOString(), by: touch.by, text: touch.text ? undashName(touch.text) : null } : null,
      },
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

/** WMS stores timestamps as ISO text; empty strings read as null. */
const ts = (column: string) => sql.raw(`nullif(${column}, '')::timestamptz`);

async function wmsPart(customer: { id: string; code: string }): Promise<Customer360['wms']> {
  try {
    const client = await db.execute<{ id: string }>(
      sql`select id::text as id from wms.clients where id::text = ${customer.id} or code = ${customer.code} order by (id::text = ${customer.id}) desc limit 1`,
    );
    const clientId = client.rows[0]?.id;
    if (!clientId) return null;
    const [hasShortages, hasAllocExceptions, hasReceipts] = await Promise.all([
      tableExists('wms.order_line_shortages'),
      tableExists('wms.allocation_exceptions'),
      tableExists('wms.receipts'),
    ]);
    const result = await db.execute<{
      open_orders: number;
      exception_orders: number;
      shortages: number;
      alloc_exceptions: number;
      shipped_7: number;
      shipped_30: number;
      last_shipped: string | null;
      open_receipts: number;
      late_receipts: number;
      skus_30: number;
    }>(sql`
      select
        (select count(*)::int from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null
           and status <> all(${sql.param(CLOSED_ORDER)}::text[])) as open_orders,
        (select count(*)::int from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null
           and status = any(${sql.param(EXCEPTION_ORDER)}::text[])) as exception_orders,
        ${
          hasShortages
            ? sql`(select count(*)::int from wms.order_line_shortages s join wms.shipment_orders o on o.id = s.order_id
                    where o.client_id::text = ${clientId} and o.deleted_at is null and s.resolved_at is null
                      and o.status <> all(${sql.param(CLOSED_ORDER)}::text[]))`
            : sql`0`
        } as shortages,
        ${
          hasAllocExceptions
            ? sql`(select count(distinct order_id)::int from wms.allocation_exceptions
                    where client_id::text = ${clientId} and is_rolled_back is not true and ${ts('run_at')} >= now() - interval '30 days')`
            : sql`0`
        } as alloc_exceptions,
        (select count(*)::int from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null
           and status = any(${sql.param(SHIPPED)}::text[]) and ${ts('shipped_at')} >= now() - interval '7 days') as shipped_7,
        (select count(*)::int from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null
           and status = any(${sql.param(SHIPPED)}::text[]) and ${ts('shipped_at')} >= now() - interval '30 days') as shipped_30,
        (select max(${ts('shipped_at')})::text from wms.shipment_orders where client_id::text = ${clientId} and deleted_at is null) as last_shipped,
        (select count(*)::int from wms.purchase_orders where client_id::text = ${clientId}
           and status = any(${sql.param(OPEN_RECEIPT)}::text[])) as open_receipts,
        (select count(*)::int from wms.purchase_orders where client_id::text = ${clientId}
           and status = any(${sql.param(OPEN_RECEIPT)}::text[]) and received_quantity < total_quantity
           and ${ts('expected_date')} < now()) as late_receipts,
        ${
          hasReceipts
            ? sql`(select count(distinct product_id)::int from wms.receipts
                    where client_id::text = ${clientId} and cancelled_at is null and ${ts('received_at')} >= now() - interval '30 days')`
            : sql`0`
        } as skus_30`);
    const row = result.rows[0];
    if (!row) return null;
    // The receipt to watch: the oldest late one, else the newest.
    const receipt = (
      await db.execute<{ id: string; code: string; status: string; expected: string | null; received: string | null; late: boolean }>(sql`
        select id, code, status, ${ts('expected_date')}::text as expected,
               coalesce(${ts('completed_at')}, ${ts('received_at')})::text as received,
               (status = any(${sql.param(OPEN_RECEIPT)}::text[]) and received_quantity < total_quantity and ${ts('expected_date')} < now()) as late
          from wms.purchase_orders
         where client_id::text = ${clientId} and status <> 'Cancelled'
         order by (status = any(${sql.param(OPEN_RECEIPT)}::text[]) and received_quantity < total_quantity and ${ts('expected_date')} < now()) desc,
                  case when status = any(${sql.param(OPEN_RECEIPT)}::text[]) and ${ts('expected_date')} < now() then ${ts('expected_date')} end asc nulls last,
                  coalesce(${ts('expected_date')}, ${ts('created_at')}) desc nulls last
         limit 1`)
    ).rows[0];
    const origin = appUrls().wms;
    const filter = `f.clientId=in:${encodeURIComponent(clientId)}`;
    return {
      clientUrl: `${origin}/clients/${encodeURIComponent(clientId)}`,
      ordersUrl: `${origin}/orders?${filter}`,
      shippedUrl: `${origin}/orders/shipped?${filter}`,
      receiptsUrl: `${origin}/receiving?${filter}`,
      receivedUrl: `${origin}/receiving/history?${filter}`,
      exceptionsUrl: `${origin}/jobs/shortage?${filter}`,
      openOrders: Number(row.open_orders) || 0,
      openReceipts: Number(row.open_receipts) || 0,
      lateReceipts: Number(row.late_receipts) || 0,
      skusReceived30: Number(row.skus_30) || 0,
      shippedLast7: Number(row.shipped_7) || 0,
      shippedLast30: Number(row.shipped_30) || 0,
      lastShippedAt: row.last_shipped ? new Date(row.last_shipped).toISOString() : null,
      exceptions: (Number(row.exception_orders) || 0) + (Number(row.shortages) || 0) + (Number(row.alloc_exceptions) || 0),
      lastReceipt: receipt
        ? {
            id: receipt.id,
            code: receipt.code,
            status: receipt.status,
            expectedAt: receipt.expected ? new Date(receipt.expected).toISOString() : null,
            receivedAt: receipt.received ? new Date(receipt.received).toISOString() : null,
            late: receipt.late === true,
            url: `${origin}/receiving/${encodeURIComponent(receipt.id)}`,
          }
        : null,
    };
  } catch (error) {
    console.error('[projects] customer 360 WMS read failed', error);
    return null;
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

async function risksFor(projectId: string, crm: Customer360['crm'], wms: Customer360['wms'], today: string): Promise<Customer360Risk[]> {
  const risks: Customer360Risk[] = [];
  const deal = crm?.headline;
  if (deal?.outcome === 'lost') {
    risks.push({ id: 'deal-lost', app: 'crm', tone: 'danger', text: `The CRM deal ${deal.name} is marked ${deal.stage ?? 'lost'}`, href: deal.url });
  } else if (deal?.outcome === 'open' && deal.closeDate) {
    try {
      const after = await db.execute<{ count: number; latest: string | null }>(sql`
        select count(*)::int as count, max(t.due_date)::text as latest
          from pm.tasks t join pm.statuses s on s.id = t.status_id
         where t.project_id = ${projectId}::uuid and t.deleted_at is null and t.completed_at is null
           and s.category not in ('done', 'cancelled') and t.due_date > ${deal.closeDate}::date`);
      const count = Number(after.rows[0]?.count) || 0;
      if (count > 0) {
        risks.push({
          id: 'deal-close',
          app: 'crm',
          tone: 'warning',
          text: `Deal close date is ${shortDay(deal.closeDate)} but ${plural(count, 'open task is', 'open tasks are')} due after it`,
          href: deal.url,
        });
      }
    } catch (error) {
      console.error('[projects] customer 360 risk read failed', error);
    }
    if (deal.closeDate < today) {
      risks.push({
        id: 'deal-overdue',
        app: 'crm',
        tone: 'warning',
        text: `Deal close date ${shortDay(deal.closeDate)} has passed and the deal is still ${deal.stage ? `in ${deal.stage}` : 'open'}`,
        href: deal.url,
      });
    }
  }
  if (wms) {
    if (wms.lateReceipts > 0 && wms.lastReceipt?.late) {
      const receipt = wms.lastReceipt;
      risks.push({
        id: 'receipt-late',
        app: 'wms',
        tone: 'warning',
        text:
          wms.lateReceipts === 1
            ? `${receipt.code} was due ${receipt.expectedAt ? shortDay(receipt.expectedAt) : 'already'} and is still ${receipt.status}`
            : `${wms.lateReceipts} receipts are late, oldest ${receipt.code} was due ${receipt.expectedAt ? shortDay(receipt.expectedAt) : 'already'}`,
        href: wms.lateReceipts === 1 ? receipt.url : wms.receiptsUrl,
      });
    }
    if (wms.exceptions > 0) {
      risks.push({
        id: 'exceptions',
        app: 'wms',
        tone: 'danger',
        text: `${plural(wms.exceptions, 'inventory exception needs', 'inventory exceptions need')} attention in the warehouse`,
        href: wms.exceptionsUrl,
      });
    }
  }
  return risks;
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
  const risks = await risksFor(project.id, crm.crm, wms, checkedAt.slice(0, 10));
  return {
    available: { crm: availability.crm, wms: availability.wms },
    urls: { crm: `${appUrls().crm}/${ctx.orgSlug}`, wms: appUrls().wms },
    customer: customer ? { id: customer.id, code: customer.code, name: customer.name } : null,
    account: crm.account,
    crm: crm.crm,
    wms,
    risks,
    checkedAt,
  };
}
