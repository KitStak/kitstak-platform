/**
 * Read-only access to KitStak CRM records (crm.boards / crm.items / crm.columns) through the
 * shared database. Deals live on `kind='deals'` boards, accounts on `kind='accounts'` boards;
 * the deal stage label comes from the board's `stage` status column settings.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { env } from '@/server/env';
import type { DomainContext } from '@/server/domain/_shared';
import { integrationAvailability } from './detect';

export type CrmItemKind = 'deals' | 'accounts';

export interface CrmItemRef {
  readonly id: string;
  readonly boardId: string;
  readonly kind: string;
  readonly name: string;
  /** Human status/stage label ("Proposal"), or null. */
  readonly status: string | null;
  readonly statusColor: string | null;
  readonly url: string;
}

export function crmItemUrl(orgSlug: string, boardId: string, itemId: string): string {
  return `${env.NEXT_PUBLIC_CRM_URL.replace(/\/+$/, '')}/${orgSlug}/boards/${boardId}?item=${itemId}`;
}

type Row = {
  id: string;
  board_id: string;
  kind: string;
  name: string;
  status_id: string | null;
  labels: unknown;
};

function toRef(ctx: DomainContext, row: Row): CrmItemRef {
  const labels = Array.isArray(row.labels) ? (row.labels as { id: string; name: string; color?: string }[]) : [];
  const label = row.status_id ? labels.find((entry) => entry.id === row.status_id) : undefined;
  return {
    id: row.id,
    boardId: row.board_id,
    kind: row.kind,
    name: row.name,
    status: label?.name ?? null,
    statusColor: label?.color ?? null,
    url: crmItemUrl(ctx.orgSlug, row.board_id, row.id),
  };
}

const SELECT = sql`
  select i.id, i.board_id, b.kind, i.name,
         coalesce(i.values #>> '{stage,labelId}', i.values #>> '{status,labelId}', i.values #>> '{health,labelId}') as status_id,
         (select c.settings -> 'labels' from crm.columns c
            where c.board_id = b.id and c.key in ('stage', 'status', 'health') and c.deleted_at is null
            order by case c.key when 'stage' then 0 when 'status' then 1 else 2 end limit 1) as labels
  from crm.items i join crm.boards b on b.id = i.board_id`;

/** Search deals/accounts by name (link pickers). Returns [] when CRM is unavailable. */
export async function searchCrmItems(
  ctx: DomainContext,
  options: { readonly kinds?: readonly CrmItemKind[]; readonly query?: string; readonly limit?: number } = {},
): Promise<CrmItemRef[]> {
  if (!(await integrationAvailability(ctx)).crm) return [];
  const kinds = options.kinds?.length ? [...options.kinds] : ['deals', 'accounts'];
  const term = `%${(options.query ?? '').trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
  try {
    const result = await db.execute<Row>(sql`${SELECT}
      where i.org_id = ${ctx.orgId} and b.kind::text = any(${sql.param(kinds)}::text[]) and i.deleted_at is null and i.archived_at is null
        and b.deleted_at is null and i.parent_item_id is null and i.name ilike ${term}
      order by i.updated_at desc limit ${Math.min(options.limit ?? 20, 50)}`);
    return result.rows.map((row) => toRef(ctx, row));
  } catch (error) {
    console.error('[projects] CRM search failed', error);
    return [];
  }
}

/** Resolve CRM items by id (chips, link refresh). Missing/foreign ids are omitted. */
export async function getCrmItems(ctx: DomainContext, ids: readonly string[]): Promise<Map<string, CrmItemRef>> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0 || !(await integrationAvailability(ctx)).crm) return new Map();
  try {
    const result = await db.execute<Row>(sql`${SELECT}
      where i.org_id = ${ctx.orgId} and i.id = any(${sql.param(valid)}::uuid[]) and i.deleted_at is null`);
    return new Map(result.rows.map((row) => [row.id, toRef(ctx, row)]));
  } catch (error) {
    console.error('[projects] CRM lookup failed', error);
    return new Map();
  }
}

/**
 * Deal facts for the program wizard (docs/programs/SPEC.md 6.2): value, currency, won flag,
 * account and the rates read from the deal's columns, through the shared reader in
 * `@kitstak/db/crm-deal-facts`. Null when CRM is not installed or the deal is not in this org.
 */
export async function dealFactsFor(ctx: DomainContext, itemId: string): Promise<import('@kitstak/db/crm-deal-facts').CrmDealFacts | null> {
  const { dealFacts } = await import('@kitstak/db/crm-deal-facts');
  try {
    return await dealFacts(db as unknown as import('@kitstak/db/crm-deal-facts').Executor, ctx.orgId, itemId);
  } catch {
    return null;
  }
}
