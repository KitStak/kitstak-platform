/**
 * Pipeline cockpit: funnel, weighted forecast, quota attainment, at-risk deals and stage
 * velocity for one deals board, aggregated on the server (pure math in `crm-model.ts`).
 */
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { activityLog, itemLinks, items, updates } from '@/server/db/schema';
import { BadRequestError, NotFoundError } from '@/server/http/errors';
import { requireBoard } from './access';
import type { ServiceContext } from './context';
import {
  connectColumnTo,
  crmSettings,
  currencyOf,
  findColumn,
  labelDto,
  labelsOf,
  loadBoardRows,
  loadCrmBoard,
  orgUsers,
  readAmount,
  readConnect,
  readDate,
  readLabelId,
  readNumber,
  readPeople,
  resolveCrmBoards,
  saveCrmSettings,
  statusColumnFor,
  canUseCrmCache,
  type CrmBoard,
} from './crm-boards';
import { boardsVersion, cachedCrm, invalidateCrmCache } from './crm-cache';
import type { CrmUserDto, PipelineDto, PipelineQuery, PipelineSettingsInput } from './crm-contracts';
import {
  buildStages,
  computePipeline,
  observedProbabilities,
  periodQuarters,
  periodRange,
  type DealFacts,
  type StageChange,
  type StageInfo,
} from './crm-model';
import type { ColumnRow } from './item-reads';

export const DEFAULT_STALE_DAYS = 14;

export interface DealColumns {
  readonly stage: ColumnRow | undefined;
  readonly value: ColumnRow | undefined;
  readonly probability: ColumnRow | undefined;
  readonly closeDate: ColumnRow | undefined;
  readonly owner: ColumnRow | undefined;
  readonly account: ColumnRow | undefined;
  readonly contacts: ColumnRow | undefined;
  readonly nextStep: ColumnRow | undefined;
  readonly source: ColumnRow | undefined;
}

export function dealColumns(
  deals: CrmBoard,
  related: { accountsBoardId?: string; contactsBoardId?: string } = {},
): DealColumns {
  const { columns } = deals;
  return {
    stage: statusColumnFor(deals.row, columns, ['stage', 'status', 'deal_stage']),
    value: findColumn(columns, ['deal_value', 'value', 'amount'], ['currency', 'number']),
    probability: findColumn(columns, ['probability', 'close_probability'], 'number'),
    closeDate: findColumn(columns, ['close_date', 'expected_close', 'close'], 'date'),
    owner: findColumn(columns, ['owner', 'deal_owner'], 'people'),
    account:
      connectColumnTo(columns, related.accountsBoardId, ['account']) ??
      findColumn(columns, ['account'], 'connect_boards'),
    contacts:
      connectColumnTo(columns, related.contactsBoardId, ['contacts']) ??
      findColumn(columns, ['contacts'], 'connect_boards'),
    nextStep: findColumn(columns, ['next_step', 'next_steps'], ['text', 'long_text']),
    source: findColumn(columns, ['source'], 'status'),
  };
}

/** Stage definitions for a deals board (settings overrides → observed → linear defaults). */
export function dealStages(deals: CrmBoard, cols: DealColumns, rows: readonly { values: Record<string, unknown> }[]): {
  stages: StageInfo[];
  customized: boolean;
} {
  const settings = crmSettings(deals.row);
  const observed = observedProbabilities(
    rows.map((row) => ({ stageId: readLabelId(row.values, cols.stage), probability: readNumber(row.values, cols.probability) })),
  );
  const overrides = settings.stageProbabilities ?? {};
  return {
    stages: buildStages(labelsOf(cols.stage), overrides, observed),
    customized: Object.keys(overrides).length > 0,
  };
}

async function stageHistory(ctx: ServiceContext, boardId: string, columnKey: string): Promise<Map<string, StageChange[]>> {
  const rows = await ctx.db
    .select({ itemId: activityLog.itemId, after: activityLog.after, at: activityLog.createdAt })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.orgId, ctx.orgId),
        eq(activityLog.boardId, boardId),
        eq(activityLog.action, 'item.value_changed'),
        eq(activityLog.columnKey, columnKey),
      ),
    )
    .orderBy(asc(activityLog.createdAt));
  const history = new Map<string, StageChange[]>();
  for (const row of rows) {
    const labelId = (row.after as { labelId?: unknown } | null)?.labelId;
    if (!row.itemId || typeof labelId !== 'string') continue;
    history.set(row.itemId, [...(history.get(row.itemId) ?? []), { labelId, at: row.at.toISOString() }]);
  }
  return history;
}

/** Latest touch per deal: completed activities linked to it, and updates posted on it. */
export async function lastActivityByDeal(
  ctx: ServiceContext,
  dealIds: readonly string[],
  activitiesBoard: CrmBoard | null,
  todayIso: string,
): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  const bump = (id: string, at: string | null | undefined) => {
    if (!at) return;
    const current = latest.get(id);
    if (!current || at > current) latest.set(id, at);
  };
  if (dealIds.length === 0) return latest;
  const ids = [...dealIds];
  const updateRows = await ctx.db
    .select({ itemId: updates.itemId, at: max(updates.createdAt) })
    .from(updates)
    .where(and(eq(updates.orgId, ctx.orgId), inArray(updates.itemId, ids)))
    .groupBy(updates.itemId);
  for (const row of updateRows) bump(row.itemId, row.at ? new Date(row.at).toISOString() : null);
  if (activitiesBoard) {
    const dateColumn = findColumn(activitiesBoard.columns, ['date', 'due_date'], 'date');
    const links = await ctx.db
      .select({ dealId: itemLinks.toItemId, values: items.values })
      .from(itemLinks)
      .innerJoin(items, eq(items.id, itemLinks.fromItemId))
      .where(
        and(
          eq(itemLinks.orgId, ctx.orgId),
          inArray(itemLinks.toItemId, ids),
          eq(items.boardId, activitiesBoard.row.id),
        ),
      );
    for (const link of links) {
      const date = readDate(link.values, dateColumn);
      if (date && date <= todayIso) bump(link.dealId, `${date}T12:00:00.000Z`);
    }
  }
  return latest;
}

const FACTS_TTL_MS = 30_000;

interface PipelineFacts {
  readonly facts: DealFacts[];
  /** Minimal rows for observed stage probabilities. */
  readonly observedRows: { values: Record<string, unknown> }[];
}

async function pipelineFacts(
  ctx: ServiceContext,
  deals: CrmBoard,
  cols: DealColumns,
  activities: CrmBoard | null,
  todayIso: string,
): Promise<PipelineFacts> {
  const rows = await loadBoardRows(ctx, deals.row.id);
  const [history, touches] = await Promise.all([
    cols.stage ? stageHistory(ctx, deals.row.id, cols.stage.key) : Promise.resolve(new Map<string, StageChange[]>()),
    lastActivityByDeal(
      ctx,
      rows.map((row) => row.id),
      activities,
      todayIso,
    ),
  ]);
  const pick = [cols.stage?.key, cols.probability?.key].filter((key): key is string => Boolean(key));
  return {
    facts: rows.map((row) => ({
      id: row.id,
      name: row.name,
      stageId: readLabelId(row.values, cols.stage),
      value: readAmount(row.values, cols.value),
      closeDate: readDate(row.values, cols.closeDate),
      ownerIds: readPeople(row.values, cols.owner),
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: touches.get(row.id) ?? null,
      history: history.get(row.id) ?? [],
    })),
    observedRows: rows.map((row) => ({ values: Object.fromEntries(pick.map((key) => [key, row.values[key]])) })),
  };
}

function userOf(users: ReadonlyMap<string, CrmUserDto>, id: string | undefined): CrmUserDto | null {
  return id ? (users.get(id) ?? null) : null;
}

export async function getPipeline(ctx: ServiceContext, query: PipelineQuery, now = new Date()): Promise<PipelineDto> {
  const resolved = await resolveCrmBoards(ctx, query.boardId);
  const ref = query.boardId ? resolved.dealBoards.find((board) => board.id === query.boardId) : resolved.primary.deals;
  if (!ref) throw new NotFoundError('Deals board');
  const deals = await loadCrmBoard(ctx, ref);
  if (!deals) throw new NotFoundError('Deals board');
  const writable = await requireBoard(ctx, deals.row.id, 'write').then(
    () => true,
    () => false,
  );
  const activities = await loadCrmBoard(ctx, resolved.primary.activities);
  const cols = dealColumns(deals, {
    accountsBoardId: resolved.primary.accounts?.id,
    contactsBoardId: resolved.primary.contacts?.id,
  });
  const todayIso = now.toISOString().slice(0, 10);
  // Period / owner only change the aggregation, so the expensive deal facts (rows, stage
  // history, last touches) are cached per board and reused across filter switches.
  const loadFacts = () => pipelineFacts(ctx, deals, cols, activities, todayIso);
  const [{ facts, observedRows }, users] = await Promise.all([
    canUseCrmCache(ctx)
      ? boardsVersion(ctx, [deals.row.id, activities?.row.id]).then((version) =>
          cachedCrm(ctx.orgId, `pipeline-facts:${deals.row.id}:${cols.stage?.key ?? ''}:${todayIso}`, version, FACTS_TTL_MS, loadFacts),
        )
      : loadFacts(),
    orgUsers(ctx),
  ]);
  const { stages, customized } = dealStages(deals, cols, observedRows);
  const settings = crmSettings(deals.row);
  const staleDays = settings.staleDays ?? DEFAULT_STALE_DAYS;
  const quotas = settings.quotas ?? {};
  const range = periodRange(query.period, now);
  const owner = query.owner ?? null;
  const computed = computePipeline({
    deals: facts,
    stages,
    today: now,
    range,
    owner,
    staleDays,
    quotas,
    quarters: periodQuarters(query.period),
  });
  const ownerIds = [...new Set(facts.flatMap((deal) => deal.ownerIds))];
  const stageById = new Map(stages.map((stage) => [stage.label.id, stage]));
  return {
    board: deals.ref,
    dealBoards: resolved.dealBoards,
    currency: currencyOf(cols.value),
    period: query.period,
    periodRange: range,
    owner,
    owners: ownerIds.map((id) => users.get(id)).filter((entry): entry is CrmUserDto => Boolean(entry)),
    settings: {
      stageProbabilities: Object.fromEntries(stages.map((stage) => [stage.label.id, stage.probability])),
      quotas,
      staleDays,
      customized,
    },
    canEdit: writable,
    summary: computed.summary,
    funnel: computed.funnel,
    forecast: computed.forecast,
    reps: computed.reps.flatMap((rep) => {
      const person = users.get(rep.userId);
      if (!person) return [];
      return [
        {
          user: person,
          openCount: rep.openCount,
          openValue: rep.openValue,
          weighted: rep.weighted,
          won: rep.won,
          quota: rep.quota,
          attainment: rep.attainment,
        },
      ];
    }),
    atRisk: computed.atRisk.slice(0, 25).map((risk) => ({
      id: risk.deal.id,
      name: risk.deal.name,
      stage: risk.deal.stageId ? (stageById.get(risk.deal.stageId)?.label ?? labelDto(cols.stage, risk.deal.stageId)) : null,
      value: risk.deal.value,
      closeDate: risk.deal.closeDate,
      owner: userOf(users, risk.deal.ownerIds[0]),
      lastActivityAt: risk.deal.lastActivityAt,
      daysSinceActivity: risk.daysSinceActivity,
      reasons: risk.reasons,
    })),
    velocity: computed.velocity,
    generatedAt: now.toISOString(),
  };
}

export async function savePipelineSettings(ctx: ServiceContext, input: PipelineSettingsInput) {
  const board = await requireBoard(ctx, input.boardId, 'write');
  if (board.kind !== 'deals') throw new BadRequestError('Pipeline settings can only be saved on a deals board');
  invalidateCrmCache(ctx.orgId);
  const patch = {
    ...(input.stageProbabilities && { stageProbabilities: input.stageProbabilities }),
    ...(input.quotas && { quotas: input.quotas }),
    ...(input.staleDays !== undefined && { staleDays: input.staleDays }),
  };
  return saveCrmSettings(ctx, input.boardId, patch);
}

/** Exposed for 360 views: account/contact connect ids of a deal. */
export function dealLinks(values: Record<string, unknown>, cols: DealColumns) {
  return { accountIds: readConnect(values, cols.account), contactIds: readConnect(values, cols.contacts) };
}
