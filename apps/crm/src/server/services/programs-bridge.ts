/**
 * KitStak Programs inside the CRM (item panel "Programs" tab and the health line under a deal
 * or account name, docs/programs/SPEC.md 6.2): which programs serve this deal or account, with
 * this month's units, revenue and forecast, and a deep link that starts a program from the deal.
 *
 * Reads go through `@kitstak/pm-bridge` over the CRM's own executor; money comes from the shared
 * program money reader, so the numbers equal Projects and Pulse to the cent. Money is hidden by
 * the Projects rule (an explicit program role, A10). Degrades to `available: false` when the org
 * is not licensed for Projects or the program tables are not installed.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  isBridgeError,
  listLinkedPrograms,
  newProgramUrl,
  type BridgeExecutor,
  type BridgeProgram,
  type BridgeTarget,
} from '@kitstak/pm-bridge';
import { dealFacts, type Executor as DealFactsExecutor } from '@kitstak/db/crm-deal-facts';
import { refreshLinkCache, type Executor as LinksExecutor } from '@kitstak/db/record-links';
import { rowsOf } from '@kitstak/pm-bridge';
import { customerLinks, customers as coreCustomers } from '@kitstak/db/schema';
import { env } from '@/server/env';
import { orgModuleFlags } from '@/server/entitlements';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import { logger } from '@/server/logger';
import { requireItem } from './access';
import { isOrgAdmin, type ServiceContext } from './context';

export type ItemProgramsReason = 'not_licensed' | 'not_installed' | 'not_applicable' | 'no_access';

export interface ItemProgramsDeal {
  readonly valueCents: string | null;
  readonly currency: string | null;
  readonly won: boolean;
  readonly accountName: string | null;
  readonly termMonths: number | null;
}

export interface ItemProgramsDto {
  /** Projects is licensed, installed and has programs, and this record can have programs. */
  readonly available: boolean;
  readonly reason: ItemProgramsReason | null;
  readonly kind: 'deal' | 'account' | null;
  readonly programs: readonly BridgeProgram[];
  /** Opens the new program wizard filled in from this record (null when it cannot start one). */
  readonly createProgramUrl: string | null;
  /** Deal facts on a deal (value and the won stage), null on an account. */
  readonly deal: ItemProgramsDeal | null;
  /** Money is hidden on every program listed (units only). */
  readonly moneyHidden: boolean;
  readonly projectsUrl: string;
  /** Where an admin adds Projects to the plan (shown only with `not_licensed`, to owners and admins). */
  readonly addProjectsUrl: string | null;
}

export function projectsUrl(): string {
  return env.NEXT_PUBLIC_PROJECTS_URL.replace(/\/+$/, '');
}

function portalBillingUrl(): string {
  return `${(process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300').replace(/\/+$/, '')}/billing`;
}

const bridgeDb = (ctx: ServiceContext) => ctx.db as unknown as BridgeExecutor;

/** Maps bridge errors onto the CRM error envelope (plain language messages pass through). */
export function rethrow(error: unknown): never {
  if (isBridgeError(error)) {
    if (error.code === 'NOT_FOUND') throw new NotFoundError('Program', error.message);
    if (error.code === 'FORBIDDEN') throw new ForbiddenError(error.message);
    if (error.code === 'UNAVAILABLE') throw new ConflictError(error.message);
    throw new ValidationError(
      Object.entries(error.fields ?? {}).map(([path, message]) => ({ path, message })),
      error.message,
    );
  }
  throw error;
}

/** Why Programs cannot be used from the CRM for this org right now (null = it can). */
export async function availability(ctx: ServiceContext): Promise<'not_licensed' | null> {
  const flags = await orgModuleFlags(ctx.orgId);
  return flags.projects ? null : 'not_licensed';
}

/**
 * The bridge targets of a record: a deal is `crm_item`; an account is `crm_account` plus the
 * shared customer it is linked to. Both CRM ids are read, since older links used either type.
 */
export async function targetsFor(ctx: ServiceContext, itemId: string) {
  const { item, board } = await requireItem(ctx, itemId, 'read');
  const kind: 'deal' | 'account' | null = board.kind === 'deals' ? 'deal' : board.kind === 'accounts' ? 'account' : null;
  const type: BridgeTarget['type'] = kind === 'account' ? 'crm_account' : 'crm_item';
  const targets: BridgeTarget[] = [
    { type, id: item.id },
    { type: type === 'crm_item' ? 'crm_account' : 'crm_item', id: item.id },
  ];
  let customerId: string | null = null;
  if (kind === 'account') {
    const [link] = await ctx.db
      .select({ id: customerLinks.coreCustomerId })
      .from(customerLinks)
      .innerJoin(coreCustomers, eq(coreCustomers.id, customerLinks.coreCustomerId))
      .where(and(eq(customerLinks.itemId, item.id), isNull(coreCustomers.deletedAt)))
      .limit(1);
    customerId = link?.id ?? null;
    if (customerId) targets.push({ type: 'core_customer', id: customerId });
  }
  return { item, board, kind, targets, customerId };
}

function empty(reason: ItemProgramsReason, kind: ItemProgramsDto['kind'], extra: Partial<ItemProgramsDto> = {}): ItemProgramsDto {
  return {
    available: false,
    reason,
    kind,
    programs: [],
    createProgramUrl: null,
    deal: null,
    moneyHidden: true,
    projectsUrl: projectsUrl(),
    addProjectsUrl: null,
    ...extra,
  };
}

/** Programs for one deal or account (other boards and subitems have none). */
export async function getItemPrograms(ctx: ServiceContext, itemId: string): Promise<ItemProgramsDto> {
  const { item, kind, targets, customerId } = await targetsFor(ctx, itemId);
  if (!kind || item.parentItemId !== null) return empty('not_applicable', kind);
  if ((await availability(ctx)) === 'not_licensed') {
    return empty('not_licensed', kind, { addProjectsUrl: isOrgAdmin(ctx) ? portalBillingUrl() : null });
  }
  if (!ctx.userId) return empty('no_access', kind);
  const urls = { projectsUrl: projectsUrl() };
  const [result, facts] = await Promise.all([
    listLinkedPrograms(bridgeDb(ctx), { orgId: ctx.orgId, userId: ctx.userId }, targets, urls),
    kind === 'deal' ? dealFacts(ctx.db as unknown as DealFactsExecutor, ctx.orgId, item.id).catch(() => null) : Promise.resolve(null),
  ]);
  if (!result.available) return empty(result.reason === 'no_access' ? 'no_access' : 'not_installed', kind);
  const deal: ItemProgramsDeal | null =
    kind === 'deal'
      ? {
          valueCents: result.moneyHidden || facts?.valueCents == null ? null : facts.valueCents.toString(),
          currency: facts?.currency ?? null,
          won: facts?.won === true,
          accountName: facts?.accountName ?? null,
          termMonths: facts?.rates.termMonths ?? null,
        }
      : null;
  const archived = item.deletedAt !== null || item.archivedAt !== null;
  return {
    available: true,
    reason: null,
    kind,
    programs: result.programs,
    createProgramUrl: archived
      ? null
      : newProgramUrl(urls, kind === 'deal' ? { crmItem: item.id, name: item.name } : { name: item.name, customer: customerId }),
    deal,
    moneyHidden: result.moneyHidden,
    projectsUrl: urls.projectsUrl,
    addProjectsUrl: null,
  };
}

/**
 * A deal or account changed stage: refresh the cached title and stage on its `core.record_links`
 * edges (program chips in Projects read them). Runs inside the CRM write's transaction in a
 * savepoint and never throws, so a CRM write never fails because of Programs.
 */
export async function refreshProgramLinks(ctx: ServiceContext, change: { readonly itemId: string }): Promise<void> {
  try {
    const [row] = rowsOf<{ name: string; kind: string; board_id: string; slug: string; status: string | null }>(
      await ctx.db.execute(sql`
        select i.name, b.kind::text as kind, i.board_id::text as board_id, o.slug,
               (select l ->> 'name' from crm.columns c,
                       jsonb_array_elements(case when jsonb_typeof(c.settings -> 'labels') = 'array' then c.settings -> 'labels' else '[]'::jsonb end) l
                 where c.board_id = i.board_id and c.key in ('stage', 'status') and c.deleted_at is null
                   and l ->> 'id' = coalesce(i.values #>> '{stage,labelId}', i.values #>> '{status,labelId}')
                 limit 1) as status
          from crm.items i join crm.boards b on b.id = i.board_id join core.organization o on o.id = i.org_id
         where i.id = ${change.itemId} and i.org_id = ${ctx.orgId}`),
    );
    if (!row || (row.kind !== 'deals' && row.kind !== 'accounts')) return;
    const ref = { type: row.kind === 'deals' ? ('crm_deal' as const) : ('crm_account' as const), id: change.itemId };
    await ctx.db.transaction(async (tx) => {
      await refreshLinkCache(tx as unknown as LinksExecutor, ctx.orgId, ref, {
        title: row.name,
        status: row.status ?? undefined,
        url: `/${row.slug}/boards/${row.board_id}?item=${change.itemId}`,
      });
    });
  } catch (error) {
    logger.warn('programs.link_cache_failed', {
      orgId: ctx.orgId,
      itemId: change.itemId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
