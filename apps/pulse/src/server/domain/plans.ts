/**
 * Quotes and budgets (SPEC 4.10). A job holds up to two plans: the quote (what was sold) and the
 * budget (your own cost plan, made by "Make my own budget"). A plan is totals, or lines whose sum
 * is the totals. Every change writes old and new totals to the activity log (`plan.revised`),
 * which is the revision history.
 */
import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { jobPlanLines, jobPlans } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import type { PlanKind, PlanLineCategory, PlanLineUnit, PlanOrigin } from '@/lib/constants';
import { planSharedAuto, planTotalsFromLines } from '@/lib/profit';
import type { JobPlanDTO, JobPlanLineDTO, JobPlansDTO } from '@/lib/types';
import { assertVersion, cleanText, hideUnless, inTx, isoRequired, moneyOut, rows, type DomainContext } from './_shared';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { recomputeJobs } from './job-stats';
import { loadSettings } from './settings';

type PlanRow = typeof jobPlans.$inferSelect;
type LineRow = typeof jobPlanLines.$inferSelect;
type Money = Pick<PulseAccess, 'seesMoney'>;

export function toPlanDTO(row: PlanRow, lines: readonly LineRow[], access: Money): JobPlanDTO {
  const money = access.seesMoney;
  return {
    id: row.id,
    jobId: row.jobId,
    plan: row.plan as PlanKind,
    units: row.units,
    revenueCents: moneyOut(money, row.revenueCents),
    laborHours: row.laborHours,
    laborCents: moneyOut(money, row.laborCents),
    setupHours: row.setupHours,
    setupCents: moneyOut(money, row.setupCents),
    materialCents: moneyOut(money, row.materialCents),
    otherCents: moneyOut(money, row.otherCents),
    sharedCents: moneyOut(money, row.sharedCents),
    sharedAuto: row.sharedAuto,
    version: row.version,
    origin: row.origin as PlanOrigin,
    originRef: row.originRef,
    note: row.note,
    lines: lines
      .filter((line) => line.planId === row.id)
      .sort((a, b) => a.position - b.position)
      .map(
        (line): JobPlanLineDTO => ({
          id: line.id,
          position: line.position,
          category: line.category as PlanLineCategory,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit as PlanLineUnit | null,
          unitAmount: hideUnless(money, line.unitAmount),
          amountCents: moneyOut(money, line.amountCents),
          flex: line.flex,
          laborClassId: line.laborClassId,
          vasServiceId: line.vasServiceId,
          itemId: line.itemId,
        }),
      ),
    updatedAt: isoRequired(row.updatedAt),
    moneyHidden: !money,
  };
}

/** Both plans of a job (either may be null). */
export async function loadPlans(ctx: DomainContext, jobId: string, access: Money, executor: Executor = db): Promise<JobPlansDTO> {
  const plans = await executor.select().from(jobPlans).where(and(eq(jobPlans.orgId, ctx.orgId), eq(jobPlans.jobId, jobId)));
  const lines = plans.length > 0 ? await executor.select().from(jobPlanLines).where(and(eq(jobPlanLines.orgId, ctx.orgId), eq(jobPlanLines.jobId, jobId))).orderBy(asc(jobPlanLines.position)) : [];
  const pick = (kind: PlanKind) => {
    const row = plans.find((plan) => plan.plan === kind);
    return row ? toPlanDTO(row, lines, access) : null;
  };
  return { quote: pick('quote'), budget: pick('budget') };
}

export async function getJobPlans(ctx: DomainContext, jobId: string): Promise<JobPlansDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  return loadPlans(ctx, jobId, access);
}

export interface PlanLineInput {
  category: PlanLineCategory;
  description?: string | null;
  quantity?: string | null;
  unit?: PlanLineUnit | null;
  unitAmount?: string | null;
  amountCents: number;
  flex?: boolean | null;
  laborClassId?: string | null;
  vasServiceId?: string | null;
  itemId?: string | null;
}

export interface PlanInput {
  units?: string;
  revenueCents?: number;
  laborHours?: string;
  laborCents?: number;
  setupHours?: string;
  setupCents?: number;
  materialCents?: number;
  otherCents?: number;
  /** Typed shared cost. Leave out (or pass null) to let Pulse fill it (`shared_auto`). */
  sharedCents?: number | null;
  /** When given, the totals are the sum of the lines and the typed totals are ignored. */
  lines?: PlanLineInput[];
  origin?: PlanOrigin;
  originRef?: string | null;
  note?: string | null;
  version?: number | null;
}

const totalsOf = (row: PlanRow) => ({
  units: row.units,
  revenueCents: row.revenueCents,
  laborHours: row.laborHours,
  laborCents: row.laborCents,
  setupHours: row.setupHours,
  setupCents: row.setupCents,
  materialCents: row.materialCents,
  otherCents: row.otherCents,
  sharedCents: row.sharedCents,
});

/** The org's shared and labor cents of the last 90 days, for the plan's automatic shared cost. */
async function last90(executor: Executor, orgId: string): Promise<{ shared: bigint; labor: bigint }> {
  const [row] = await rows<{ shared: string; labor: string }>(
    executor,
    sql`SELECT COALESCE(sum(amount_cents) FILTER (WHERE kind = 'shared'), 0)::text AS shared, COALESCE(sum(amount_cents) FILTER (WHERE kind = 'labor'), 0)::text AS labor
          FROM pulse.fact_days WHERE org_id = ${orgId} AND work_date > CURRENT_DATE - 90`,
  );
  return { shared: BigInt(row?.shared ?? 0), labor: BigInt(row?.labor ?? 0) };
}

/**
 * Creates or replaces one plan of a job inside `tx`. Does not recompute the job: callers do.
 * Returns the saved row.
 */
export async function upsertPlan(tx: Executor, ctx: DomainContext, jobId: string, kind: PlanKind, input: PlanInput): Promise<PlanRow> {
  const [existing] = await tx.select().from(jobPlans).where(and(eq(jobPlans.orgId, ctx.orgId), eq(jobPlans.jobId, jobId), eq(jobPlans.plan, kind)));
  if (existing) assertVersion(existing.version, input.version);
  const settings = await loadSettings(ctx.orgId, tx);
  const lines = input.lines;
  let totals: { units: string; revenueCents: bigint; laborHours: string; laborCents: bigint; setupHours: string; setupCents: bigint; materialCents: bigint; otherCents: bigint };
  if (lines) {
    const sum = planTotalsFromLines(lines.map((line) => ({ category: line.category, quantity: line.quantity ?? null, unit: line.unit ?? null, amountCents: line.amountCents })));
    totals = {
      units: String(sum.units ?? 0),
      revenueCents: sum.revenueCents ?? BigInt(0),
      laborHours: String(sum.laborHours ?? 0),
      laborCents: sum.laborCents ?? BigInt(0),
      setupHours: String(sum.setupHours ?? 0),
      setupCents: sum.setupCents ?? BigInt(0),
      materialCents: sum.materialCents ?? BigInt(0),
      otherCents: sum.otherCents ?? BigInt(0),
    };
  } else {
    totals = {
      units: input.units ?? existing?.units ?? '0',
      revenueCents: input.revenueCents === undefined ? (existing?.revenueCents ?? BigInt(0)) : BigInt(input.revenueCents),
      laborHours: input.laborHours ?? existing?.laborHours ?? '0',
      laborCents: input.laborCents === undefined ? (existing?.laborCents ?? BigInt(0)) : BigInt(input.laborCents),
      setupHours: input.setupHours ?? existing?.setupHours ?? '0',
      setupCents: input.setupCents === undefined ? (existing?.setupCents ?? BigInt(0)) : BigInt(input.setupCents),
      materialCents: input.materialCents === undefined ? (existing?.materialCents ?? BigInt(0)) : BigInt(input.materialCents),
      otherCents: input.otherCents === undefined ? (existing?.otherCents ?? BigInt(0)) : BigInt(input.otherCents),
    };
  }
  if (Number(totals.setupHours) > Number(totals.laborHours)) throw invalid('Setup hours are part of labor hours, so they cannot be more than the labor hours.', { setupHours: 'Too many setup hours.' });
  if (totals.setupCents > totals.laborCents) throw invalid('Setup cost is part of labor cost, so it cannot be more than the labor cost.', { setupCents: 'Too much setup cost.' });
  const typedShared = input.sharedCents !== undefined && input.sharedCents !== null;
  const sharedAuto = typedShared ? false : input.sharedCents === null ? true : (existing?.sharedAuto ?? true);
  let sharedCents: bigint;
  if (typedShared) sharedCents = BigInt(input.sharedCents as number);
  else if (sharedAuto) {
    const recent = await last90(tx, ctx.orgId);
    sharedCents = planSharedAuto({ rule: settings.sharedCostRule as 'none' | 'by_labor_hours' | 'full' | 'percent_of_labor', laborCents: totals.laborCents, sharedPctBp: settings.sharedPctBp, shared90Cents: recent.shared, labor90Cents: recent.labor });
  } else sharedCents = existing?.sharedCents ?? BigInt(0);
  const values = {
    ...totals,
    sharedCents,
    sharedAuto,
    origin: input.origin ?? existing?.origin ?? 'typed',
    originRef: input.originRef === undefined ? (existing?.originRef ?? null) : input.originRef,
    note: input.note === undefined ? (existing?.note ?? null) : cleanText(input.note),
    updatedBy: ctx.userId,
  };
  let row: PlanRow;
  if (existing) {
    [row] = (await tx.update(jobPlans).set({ ...values, version: sql`version + 1`, updatedAt: new Date() }).where(eq(jobPlans.id, existing.id)).returning()) as [PlanRow];
  } else {
    [row] = (await tx.insert(jobPlans).values({ orgId: ctx.orgId, jobId, plan: kind, ...values }).returning()) as [PlanRow];
  }
  if (lines) {
    await tx.delete(jobPlanLines).where(and(eq(jobPlanLines.orgId, ctx.orgId), eq(jobPlanLines.planId, row.id)));
    if (lines.length > 0) {
      await tx.insert(jobPlanLines).values(
        lines.map((line, index) => ({
          orgId: ctx.orgId,
          planId: row.id,
          jobId,
          position: index,
          category: line.category,
          description: cleanText(line.description),
          quantity: line.quantity ?? null,
          unit: line.unit ?? null,
          unitAmount: line.unitAmount ?? null,
          amountCents: BigInt(line.amountCents),
          flex: line.flex ?? null,
          laborClassId: line.laborClassId ?? null,
          vasServiceId: line.vasServiceId ?? null,
          itemId: line.itemId ?? null,
        })),
      );
    }
  }
  await logActivity(tx, ctx, {
    verb: 'plan.revised',
    entityType: 'plan',
    entityId: row.id,
    jobId,
    field: kind,
    before: existing ? totalsOf(existing) : null,
    after: totalsOf(row),
    meta: { plan: kind, origin: row.origin, lines: lines ? lines.length : undefined, created: !existing },
  });
  return row;
}

async function assertJob(tx: Executor, ctx: DomainContext, jobId: string): Promise<void> {
  const found = await rows(tx, sql`SELECT 1 FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND id = ${jobId} AND deleted_at IS NULL`);
  if (found.length === 0) throw notFound('That job');
}

/** Saves the quote or the budget of a job (totals or lines) and rebuilds the job's numbers. */
export async function savePlan(ctx: DomainContext, jobId: string, kind: PlanKind, input: PlanInput): Promise<JobPlanDTO> {
  const access = await requirePulse(ctx, 'plan:manage');
  return inTx(async (tx) => {
    await assertJob(tx, ctx, jobId);
    const row = await upsertPlan(tx, ctx, jobId, kind, input);
    await recomputeJobs(tx, ctx, [jobId]);
    const lines = await tx.select().from(jobPlanLines).where(eq(jobPlanLines.planId, row.id));
    return toPlanDTO(row, lines, access);
  });
}

/** "Make my own budget": copies the quote (totals and lines) into a budget. */
export async function makeBudgetFromQuote(ctx: DomainContext, jobId: string): Promise<JobPlanDTO> {
  const access = await requirePulse(ctx, 'plan:manage');
  return inTx(async (tx) => {
    await assertJob(tx, ctx, jobId);
    const plans = await tx.select().from(jobPlans).where(and(eq(jobPlans.orgId, ctx.orgId), eq(jobPlans.jobId, jobId)));
    const quote = plans.find((plan) => plan.plan === 'quote');
    if (!quote) throw conflict('This job has no quote to copy yet. Add a quote first.');
    if (plans.some((plan) => plan.plan === 'budget')) throw conflict('This job already has a budget.');
    const quoteLines = await tx.select().from(jobPlanLines).where(eq(jobPlanLines.planId, quote.id)).orderBy(asc(jobPlanLines.position));
    const row = await upsertPlan(tx, ctx, jobId, 'budget', {
      units: quote.units,
      revenueCents: Number(quote.revenueCents),
      laborHours: quote.laborHours,
      laborCents: Number(quote.laborCents),
      setupHours: quote.setupHours,
      setupCents: Number(quote.setupCents),
      materialCents: Number(quote.materialCents),
      otherCents: Number(quote.otherCents),
      sharedCents: quote.sharedAuto ? null : Number(quote.sharedCents),
      lines:
        quoteLines.length > 0
          ? quoteLines.map((line) => ({
              category: line.category as PlanLineCategory,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit as PlanLineUnit | null,
              unitAmount: line.unitAmount,
              amountCents: Number(line.amountCents),
              flex: line.flex,
              laborClassId: line.laborClassId,
              vasServiceId: line.vasServiceId,
              itemId: line.itemId,
            }))
          : undefined,
      origin: 'copied_from_quote',
      originRef: quote.id,
    });
    await recomputeJobs(tx, ctx, [jobId]);
    const lines = await tx.select().from(jobPlanLines).where(eq(jobPlanLines.planId, row.id));
    return toPlanDTO(row, lines, access);
  });
}

/** Removes the budget, so every "budget" reads the quote again. The quote itself cannot be deleted while a budget exists. */
export async function deletePlan(ctx: DomainContext, jobId: string, kind: PlanKind): Promise<void> {
  await requirePulse(ctx, 'plan:manage');
  await inTx(async (tx) => {
    const plans = await tx.select().from(jobPlans).where(and(eq(jobPlans.orgId, ctx.orgId), eq(jobPlans.jobId, jobId)));
    const row = plans.find((plan) => plan.plan === kind);
    if (!row) throw notFound(kind === 'quote' ? 'That quote' : 'That budget');
    if (kind === 'quote' && plans.some((plan) => plan.plan === 'budget')) throw conflict('Delete the budget first. A budget always sits on top of a quote.');
    await tx.delete(jobPlans).where(eq(jobPlans.id, row.id));
    await logActivity(tx, ctx, { verb: 'plan.revised', entityType: 'plan', entityId: row.id, jobId, field: kind, before: totalsOf(row), after: null, meta: { plan: kind, deleted: true } });
    await recomputeJobs(tx, ctx, [jobId]);
  });
}
