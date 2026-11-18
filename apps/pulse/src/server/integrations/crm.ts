/**
 * CRM reader: deals (with the board's own "won" rule) and accounts, for this organization only.
 * Read only, fail soft: when CRM is not licensed, not installed, or anything goes wrong, every
 * function answers with an empty list. Pulse never writes into `crm.*`.
 *
 * Won means the deal's stage label is marked done on its own board (`isDone`), the same rule
 * CRM's dashboards use. Deal value is stored in whole currency units, so cents = amount x 100.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { rows, type DomainContext } from '@/server/domain/_shared';
import { integrationAvailability, tableExists } from './detect';
import { logSoftFail } from './log';

export interface CrmDeal {
  readonly id: string;
  readonly name: string;
  readonly boardId: string;
  readonly stage: string | null;
  readonly won: boolean;
  /** Stage is a closed, not won stage (lost, dead, disqualified). */
  readonly lost: boolean;
  readonly valueCents: number | null;
  readonly currency: string;
  readonly closeDate: string | null;
  readonly accountItemId: string | null;
  readonly accountName: string | null;
  readonly coreCustomerId: string | null;
  /** Path inside the CRM app. */
  readonly path: string;
}

export interface CrmAccount {
  readonly id: string;
  readonly name: string;
  readonly boardId: string;
  readonly health: string | null;
  readonly coreCustomerId: string | null;
  readonly path: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOST = /\blost\b|closed[\s_-]?lost|\bdead\b|\bdisqualified\b/i;

/** CRM is licensed and its tables are here. */
export async function crmReady(ctx: DomainContext): Promise<boolean> {
  try {
    if (!(await integrationAvailability(ctx)).crm) return false;
    return (await tableExists('crm.items')) && (await tableExists('crm.boards')) && (await tableExists('crm.columns'));
  } catch (error) {
    logSoftFail(ctx.orgId, 'crm.crmReady', error);
    return false;
  }
}

interface DealRow {
  id: string;
  name: string;
  board_id: string;
  stage_id: string | null;
  stage_name: string | null;
  won: boolean | null;
  value_cents: string | null;
  currency: string | null;
  close_date: string | null;
  account_item_id: string | null;
  account_name: string | null;
  core_customer_id: string | null;
}

/** The stage label object of deal `i` on its own board. */
const STAGE_LABEL = sql`(select l from crm.columns c,
    jsonb_array_elements(case when jsonb_typeof(c.settings -> 'labels') = 'array' then c.settings -> 'labels' else '[]'::jsonb end) l
   where c.board_id = i.board_id and c.key = 'stage' and c.deleted_at is null and l ->> 'id' = i.values #>> '{stage,labelId}' limit 1)`;

async function dealRows(ctx: DomainContext, where: SQL, order: SQL, limit: number): Promise<CrmDeal[]> {
  const customer = (await tableExists('crm.customer_links')) ? sql`(select cl.core_customer_id::text from crm.customer_links cl where cl.item_id = a.id limit 1)` : sql`null::text`;
  const found = await rows<DealRow>(
    db,
    sql`select d.*, d.label ->> 'name' as stage_name, coalesce(d.label ->> 'isDone', 'false') = 'true' as won
          from (
            select i.id::text as id, i.name, i.board_id::text as board_id, i.values #>> '{stage,labelId}' as stage_id, ${STAGE_LABEL} as label,
                   case when (i.values #>> '{deal_value,amount}') ~ '^-?[0-9]+(\\.[0-9]+)?$' then round((i.values #>> '{deal_value,amount}')::numeric * 100)::bigint::text end as value_cents,
                   i.values #>> '{deal_value,currency}' as currency,
                   left(i.values #>> '{close_date,date}', 10) as close_date,
                   i.values #>> '{account,itemIds,0}' as account_item_id,
                   a.name as account_name,
                   ${customer} as core_customer_id,
                   i.updated_at
              from crm.items i
              join crm.boards b on b.id = i.board_id
              left join crm.items a on a.id::text = i.values #>> '{account,itemIds,0}' and a.org_id = i.org_id and a.deleted_at is null
             where i.org_id = ${ctx.orgId} and b.kind::text = 'deals'
               and b.deleted_at is null and b.archived_at is null
               and i.deleted_at is null and i.archived_at is null and i.parent_item_id is null
               and ${where}
          ) d
         order by ${order}
         limit ${limit}`,
  );
  return found.map((row) => {
    const cents = row.value_cents === null ? null : Number(row.value_cents);
    const won = row.won === true;
    return {
      id: row.id,
      name: row.name,
      boardId: row.board_id,
      stage: row.stage_name ?? row.stage_id,
      won,
      lost: !won && LOST.test(`${row.stage_id ?? ''} ${row.stage_name ?? ''}`),
      valueCents: cents !== null && Number.isSafeInteger(cents) ? cents : null,
      currency: row.currency || 'USD',
      closeDate: row.close_date && /^\d{4}-\d{2}-\d{2}$/.test(row.close_date) ? row.close_date : null,
      accountItemId: row.account_item_id && UUID.test(row.account_item_id) ? row.account_item_id : null,
      accountName: row.account_name,
      coreCustomerId: row.core_customer_id,
      path: `/${ctx.orgSlug}/boards/${row.board_id}?item=${row.id}`,
    };
  });
}

/**
 * Won deals first, then newest close date. `won` is worked out in the outer select, so the order
 * repeats the rule on the inner row (`d.label`): an outer alias cannot be used inside an expression.
 */
export const SEARCH_ORDER = sql`(coalesce(d.label ->> 'isDone', 'false') = 'true') desc, d.close_date desc nulls last, d.updated_at desc`;

const idList = (ids: readonly string[]): SQL => sql`(${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;

/** Deals by id. Ids that are not uuids are ignored, so one odd id cannot break a read. */
export async function getDeals(ctx: DomainContext, ids: readonly string[]): Promise<CrmDeal[]> {
  const clean = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (clean.length === 0 || !(await crmReady(ctx))) return [];
  try {
    return await dealRows(ctx, sql`i.id in ${idList(clean)}`, sql`d.name`, clean.length);
  } catch (error) {
    logSoftFail(ctx.orgId, 'crm.getDeals', error);
    return [];
  }
}

/** Won deals, newest close date first. */
export async function listWonDeals(ctx: DomainContext, options: { limit?: number; sinceDays?: number } = {}): Promise<CrmDeal[]> {
  if (!(await crmReady(ctx))) return [];
  try {
    const since = options.sinceDays
      ? sql`and (left(i.values #>> '{close_date,date}', 10) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(i.values #>> '{close_date,date}', 10)::date >= current_date - ${options.sinceDays}::int)`
      : sql``;
    return await dealRows(ctx, sql`coalesce(${STAGE_LABEL} ->> 'isDone', 'false') = 'true' ${since}`, sql`d.close_date desc nulls last, d.updated_at desc`, Math.min(options.limit ?? 50, 500));
  } catch (error) {
    logSoftFail(ctx.orgId, 'crm.listWonDeals', error);
    return [];
  }
}

/** Deals whose name or account matches the text, won deals first. */
export async function searchDeals(ctx: DomainContext, query: string, limit = 12): Promise<CrmDeal[]> {
  if (!(await crmReady(ctx))) return [];
  try {
    const text = query.trim().slice(0, 80);
    const match = text ? sql`(i.name ilike ${`%${text}%`} or a.name ilike ${`%${text}%`})` : sql`true`;
    return await dealRows(ctx, match, SEARCH_ORDER, Math.min(limit, 50));
  } catch (error) {
    logSoftFail(ctx.orgId, 'crm.searchDeals', error);
    return [];
  }
}

/** Accounts by id, with the health label and the shared customer id when the account has one. */
export async function getAccounts(ctx: DomainContext, ids: readonly string[]): Promise<CrmAccount[]> {
  const clean = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (clean.length === 0 || !(await crmReady(ctx))) return [];
  try {
    const customer = (await tableExists('crm.customer_links')) ? sql`(select cl.core_customer_id::text from crm.customer_links cl where cl.item_id = i.id limit 1)` : sql`null::text`;
    const found = await rows<{ id: string; name: string; board_id: string; health: string | null; core_customer_id: string | null }>(
      db,
      sql`select i.id::text as id, i.name, i.board_id::text as board_id, ${customer} as core_customer_id,
                 (select l ->> 'name' from crm.columns c,
                    jsonb_array_elements(case when jsonb_typeof(c.settings -> 'labels') = 'array' then c.settings -> 'labels' else '[]'::jsonb end) l
                   where c.board_id = i.board_id and c.key = 'health' and c.deleted_at is null and l ->> 'id' = i.values #>> '{health,labelId}' limit 1) as health
            from crm.items i
           where i.org_id = ${ctx.orgId} and i.deleted_at is null and i.id in ${idList(clean)}`,
    );
    return found.map((row) => ({ id: row.id, name: row.name, boardId: row.board_id, health: row.health, coreCustomerId: row.core_customer_id, path: `/${ctx.orgSlug}/boards/${row.board_id}?item=${row.id}` }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'crm.getAccounts', error);
    return [];
  }
}
