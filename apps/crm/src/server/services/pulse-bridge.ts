/**
 * KitStak Pulse inside the CRM (item panel "Profit" tab). On a deal: the Pulse jobs made from
 * it, with revenue, cost, profit and margin. On an account: the client's profit and open jobs.
 * Plus the deep links that create a Pulse job from the deal, prefilled.
 *
 * Everything is read through @kitstak/pulse-bridge over the CRM's own executor (one shared
 * Postgres, no browser call to Pulse). Degrades to `available: false` when the org is not
 * licensed for Pulse, the pulse schema is not installed, or this person has no Pulse role.
 * Money is hidden on the server for people who may not see it in Pulse.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import {
  emitBridgeEvent,
  getClientProfit,
  getJobsForRecord,
  lastDays,
  pulseAvailability,
  pulseUrls,
  rowsOf,
  type BridgeExecutor,
  type PulseJobSummary,
  type PulseJobTotals,
  type PulseMonthPoint,
  type PulsePeriodProfit,
} from '@kitstak/pulse-bridge';
import { dealFacts as sharedDealFacts, type Executor as DealFactsExecutor } from '@kitstak/db/crm-deal-facts';
import { fromScaled } from '@kitstak/programs-engine/money';
import { env } from '@/server/env';
import { orgModuleFlags } from '@/server/entitlements';
import { logger } from '@/server/logger';
import { requireItem } from './access';
import type { ServiceContext } from './context';

export type ItemPulseReason = 'not_licensed' | 'not_installed' | 'no_access' | 'not_applicable';

export interface ItemPulseJob extends PulseJobSummary {
  /** Absolute link to the job in Pulse. */
  readonly url: string;
  /** Absolute link to the daily log, on this job. */
  readonly logUrl: string;
}

export interface ItemPulseDeal {
  /** Deal value in whole cents, when the deal has one. */
  readonly valueCents: number | null;
  readonly currency: string;
  /** The deal's stage is marked done on its board (the CRM rule for won). */
  readonly won: boolean;
  readonly accountName: string | null;
}

export interface ItemPulseClient {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly targetMarginBp: number | null;
  /** The last 90 days. */
  readonly recent: PulsePeriodProfit;
  /** The last 12 months. */
  readonly year: PulsePeriodProfit | null;
  readonly trend: readonly PulseMonthPoint[];
  readonly openJobs: number;
  readonly atRisk: number;
  readonly losing: number;
}

export interface ItemPulseDto {
  readonly available: boolean;
  readonly reason: ItemPulseReason | null;
  readonly kind: 'deal' | 'account' | null;
  readonly pulseUrl: string;
  readonly moneyHidden: boolean;
  /** This person may create and change jobs in Pulse. */
  readonly canManageJobs: boolean;
  /** This person may type work into the Pulse daily log. */
  readonly canLog: boolean;
  readonly deal: ItemPulseDeal | null;
  /** `null` on an account that Pulse has no client for yet. */
  readonly client: ItemPulseClient | null;
  readonly jobs: readonly ItemPulseJob[];
  readonly totals: PulseJobTotals | null;
  /** "Create Pulse job" deep link, prefilled from this record. */
  readonly createJobUrl: string | null;
}

function pulseBase(): string {
  return env.NEXT_PUBLIC_PULSE_URL.replace(/\/+$/, '');
}

const bridgeDb = (ctx: ServiceContext) => ctx.db as unknown as BridgeExecutor;

function unavailable(reason: ItemPulseReason): ItemPulseDto {
  return {
    available: false,
    reason,
    kind: null,
    pulseUrl: pulseBase(),
    moneyHidden: true,
    canManageJobs: false,
    canLog: false,
    deal: null,
    client: null,
    jobs: [],
    totals: null,
    createJobUrl: null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DealFacts {
  readonly valueCents: number | null;
  /** Whole currency units as CRM stores them, for the prefill link. */
  readonly valueUnits: string | null;
  readonly currency: string;
  readonly won: boolean;
  readonly accountItemId: string | null;
  readonly accountName: string | null;
  readonly coreCustomerId: string | null;
}

/**
 * Value, stage and account of a deal through the shared deal facts reader
 * (`@kitstak/db/crm-deal-facts`, docs/programs/SPEC.md 6.2), the same read Projects uses to
 * prefill a program, with the shared won rule (A12).
 */
async function dealFacts(ctx: ServiceContext, itemId: string): Promise<DealFacts> {
  const facts = await sharedDealFacts(ctx.db as unknown as DealFactsExecutor, ctx.orgId, itemId).catch(() => null);
  const cents = facts?.valueCents ?? null;
  const asNumber = cents === null ? null : Number(cents);
  // Whole currency units as CRM stores them ("386400", "386400.5"), for the Pulse prefill link.
  const valueUnits = cents === null ? null : fromScaled(cents, 2).replace(/\.?0+$/, '');
  return {
    valueCents: asNumber !== null && Number.isSafeInteger(asNumber) ? asNumber : null,
    valueUnits,
    currency: facts?.currency || 'USD',
    won: facts?.won === true,
    accountItemId: facts?.accountItemId && UUID.test(facts.accountItemId) ? facts.accountItemId : null,
    accountName: facts?.accountName ?? null,
    coreCustomerId: facts?.coreCustomerId ?? null,
  };
}

async function accountCustomerId(ctx: ServiceContext, itemId: string): Promise<string | null> {
  const rows = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`select cl.core_customer_id::text as id from crm.customer_links cl where cl.item_id = ${itemId} and cl.org_id = ${ctx.orgId} limit 1`),
  );
  return rows[0]?.id ?? null;
}

/** Pulse profit for one CRM record. Deals and accounts only; other boards have no Profit tab. */
export async function getItemPulse(ctx: ServiceContext, itemId: string): Promise<ItemPulseDto> {
  const { item, board } = await requireItem(ctx, itemId, 'read');
  if (board.kind !== 'deals' && board.kind !== 'accounts') return unavailable('not_applicable');
  if (item.parentItemId !== null) return unavailable('not_applicable');
  const flags = await orgModuleFlags(ctx.orgId);
  if (!flags.pulse) return unavailable('not_licensed');
  if (!ctx.userId) return unavailable('no_access');
  if (!(await pulseAvailability(bridgeDb(ctx))).installed) return unavailable('not_installed');
  const who = { orgId: ctx.orgId, userId: ctx.userId };
  const urls = pulseUrls(pulseBase());
  const withUrls = (job: PulseJobSummary): ItemPulseJob => ({ ...job, url: urls.path(job.path), logUrl: urls.log(job.number) });

  if (board.kind === 'deals') {
    const [result, facts] = await Promise.all([
      getJobsForRecord(bridgeDb(ctx), who, { type: 'crm_deal', id: item.id }),
      dealFacts(ctx, item.id),
    ]);
    if (!result.available) return unavailable(result.reason);
    return {
      available: true,
      reason: null,
      kind: 'deal',
      pulseUrl: pulseBase(),
      moneyHidden: result.moneyHidden,
      canManageJobs: result.access.canManageJobs,
      canLog: result.access.canLog,
      deal: { valueCents: facts.valueCents, currency: facts.currency, won: facts.won, accountName: facts.accountName },
      client: null,
      jobs: result.jobs.map(withUrls),
      totals: result.totals,
      createJobUrl: result.access.canManageJobs
        ? urls.newJobFromDeal({
            dealId: item.id,
            name: item.name,
            value: facts.valueUnits,
            accountItemId: facts.accountItemId,
            coreCustomerId: facts.coreCustomerId,
          })
        : null,
    };
  }

  const coreCustomerId = await accountCustomerId(ctx, item.id);
  const recent = lastDays(90);
  const result = await getClientProfit(
    bridgeDb(ctx),
    who,
    { crmAccountItemId: item.id, coreCustomerId },
    { from: recent.from, to: recent.to, longDays: 365, trendMonths: 12, jobLimit: 8 },
  );
  if (!result.available) return unavailable(result.reason);
  return {
    available: true,
    reason: null,
    kind: 'account',
    pulseUrl: pulseBase(),
    moneyHidden: result.moneyHidden,
    canManageJobs: result.access.canManageJobs,
    canLog: result.access.canLog,
    deal: null,
    client: result.client
      ? {
          id: result.client.id,
          name: result.client.name,
          url: urls.path(result.client.path),
          targetMarginBp: result.client.targetMarginBp,
          recent: result.period,
          year: result.longPeriod,
          trend: result.trend,
          openJobs: result.openJobs,
          atRisk: result.atRisk,
          losing: result.losing,
        }
      : null,
    jobs: result.jobs.map(withUrls),
    totals: null,
    createJobUrl: result.access.canManageJobs
      ? `${pulseBase()}/jobs/new?${new URLSearchParams({ crmAccountItemId: item.id, ...(coreCustomerId ? { coreCustomerId } : {}) }).toString()}`
      : null,
  };
}

/**
 * Tells Pulse a deal's stage changed, so "won deals with no job yet" and linked jobs refresh on
 * its next page load. Fire and forget: never throws, and does nothing when Pulse is absent.
 */
export async function notifyPulseOfStageChange(ctx: ServiceContext, itemId: string, stageLabelId: string | null): Promise<void> {
  try {
    await emitBridgeEvent(bridgeDb(ctx), { orgId: ctx.orgId }, { kind: 'crm_deal_stage_changed', targetId: itemId, payload: { stage: stageLabelId } });
  } catch (error: unknown) {
    logger.warn('pulse.stage_event_failed', { itemId, error: error instanceof Error ? error.message : String(error) });
  }
}
