/**
 * Labor classes and their dated rates (SPEC 4.3). The real cost of an hour is computed by
 * `loadedRate` in `@/lib/profit` and stored on the rate row; entries are restamped in the same
 * transaction. Wage, tax and benefit detail needs `wage:read`; the loaded rates need `money:read`.
 */
import 'server-only';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { laborClasses, laborRates } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import type { LaborClassKind, StreamSource } from '@/lib/constants';
import { loadedRate } from '@/lib/profit';
import type { LaborClassDTO, LaborRateDTO, RateChangePreviewDTO, RateForEntryDTO } from '@/lib/types';
import { assertVersion, centsOut, cleanText, defined, diff, hideUnless, inTx, iso, isUuid, moneyOut, rows, type DomainContext } from './_shared';
import { codeFromName, freeCode, softDeleteRow } from './_crud';
import { requireMoney, requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { assertOpen, finishWrite, newTouched, restampIndirect, restampProduction, restampVas, touchDay, touchJob } from './recalc';
import { loadSettings } from './settings';

type ClassRow = typeof laborClasses.$inferSelect;
type RateRow = typeof laborRates.$inferSelect;

export const listLaborClasses = scoped(async function listLaborClasses(ctx: DomainContext, options: { includeArchived?: boolean } = {}): Promise<LaborClassDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const found = await rows<ClassRow & { current: number | null; has_rate: boolean; is_default: boolean; archived_at: Date | null }>(
    db,
    sql`SELECT lc.id, lc.code, lc.name, lc.kind, lc.is_default, lc.color, lc.archived_at,
               (SELECT lr.loaded_rate_cents FROM pulse.labor_rates lr
                 WHERE lr.labor_class_id = lc.id AND lr.deleted_at IS NULL AND lr.effective_from <= CURRENT_DATE
                 ORDER BY (lr.site_id IS NULL) DESC, lr.effective_from DESC LIMIT 1) AS current,
               EXISTS (SELECT 1 FROM pulse.labor_rates lr WHERE lr.labor_class_id = lc.id AND lr.deleted_at IS NULL) AS has_rate
          FROM pulse.labor_classes lc
         WHERE lc.org_id = ${ctx.orgId} AND lc.deleted_at IS NULL ${options.includeArchived ? sql`` : sql`AND lc.archived_at IS NULL`}
         ORDER BY lc.is_default DESC, lower(lc.name)`,
  );
  return found.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind as LaborClassKind,
    isDefault: row.is_default,
    color: row.color,
    archivedAt: iso(row.archived_at),
    currentLoadedRateCents: moneyOut(access.seesMoney, row.current),
    hasRate: row.has_rate,
  }));
});

export const getLaborClassRow = scoped(async function getLaborClassRow(ctx: DomainContext, classId: string, executor: Executor = db): Promise<ClassRow> {
  const [row] = isUuid(classId) ? await executor.select().from(laborClasses).where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.id, classId), isNull(laborClasses.deletedAt))) : [];
  if (!row) throw notFound('That labor class');
  return row;
});

export interface LaborClassInput {
  code?: string | null;
  name: string;
  kind?: LaborClassKind;
  isDefault?: boolean;
  color?: string | null;
}

function classDTO(row: ClassRow): LaborClassDTO {
  return { id: row.id, code: row.code, name: row.name, kind: row.kind as LaborClassKind, isDefault: row.isDefault, color: row.color, archivedAt: iso(row.archivedAt), currentLoadedRateCents: null, hasRate: false };
}

/** Restamps every open entry that has no labor class of its own (they follow the org default class). */
async function restampDefaultless(tx: Executor, ctx: DomainContext): Promise<void> {
  const where = sql`src.labor_class_id IS NULL`;
  await restampProduction(tx, ctx.orgId, where);
  await restampIndirect(tx, ctx.orgId, where);
  await restampVas(tx, ctx.orgId, where);
  await finishTouched(tx, ctx, sql`labor_class_id IS NULL`);
}

/** Collects the jobs and days of the stream rows that match `where` (no alias) and finishes the write. */
async function finishTouched(tx: Executor, ctx: DomainContext, where: SQL): Promise<void> {
  const touched = newTouched();
  const found = await rows<{ job_id: string | null; client_id: string | null; site_id: string; d: string }>(
    tx,
    sql`SELECT DISTINCT job_id, NULL::uuid AS client_id, site_id, to_char(work_date, 'YYYY-MM-DD') AS d FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND (${where})
        UNION SELECT DISTINCT job_id, client_id, site_id, to_char(work_date, 'YYYY-MM-DD') FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND (${where})
        UNION SELECT DISTINCT NULL::uuid, NULL::uuid, site_id, to_char(work_date, 'YYYY-MM-DD') FROM pulse.indirect_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND (${where})`,
  );
  for (const row of found) {
    touchJob(touched, row.job_id, row.client_id);
    touchDay(touched, row.site_id, row.d);
  }
  await finishWrite(tx, ctx, touched);
}

export const insertLaborClass = scoped(async function insertLaborClass(tx: Executor, ctx: DomainContext, input: LaborClassInput): Promise<ClassRow> {
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the labor class a name.', { name: 'Give the labor class a name.' });
  await loadSettings(ctx.orgId, tx);
  const code = cleanText(input.code) ?? (await freeCode(tx, ctx.orgId, 'labor_classes', codeFromName(name)));
  const [existing] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM pulse.labor_classes WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL`);
  // The first class of an org is its default, so entries with no class always have a rate to find.
  const makeDefault = Boolean(input.isDefault) || (existing?.n ?? 0) === 0;
  if (makeDefault) await tx.update(laborClasses).set({ isDefault: false }).where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.isDefault, true)));
  const [row] = await tx.insert(laborClasses).values({ orgId: ctx.orgId, code, name, kind: input.kind ?? 'employee', isDefault: makeDefault, color: input.color ?? null }).returning();
  await logActivity(tx, ctx, { verb: 'labor_class.created', entityType: 'labor_class', entityId: row!.id, after: { code, name, kind: row!.kind, isDefault: makeDefault } });
  return row!;
}, 1);

export const createLaborClass = scoped(async function createLaborClass(ctx: DomainContext, input: LaborClassInput): Promise<LaborClassDTO> {
  await requirePulse(ctx, 'rate:manage');
  return inTx(async (tx) => classDTO(await insertLaborClass(tx, ctx, input)));
});

export const updateLaborClass = scoped(async function updateLaborClass(ctx: DomainContext, classId: string, patch: Partial<LaborClassInput> & { archived?: boolean }): Promise<LaborClassDTO> {
  await requirePulse(ctx, 'rate:manage');
  return inTx(async (tx) => {
    const before = await getLaborClassRow(ctx, classId, tx);
    if (patch.isDefault === false && before.isDefault) throw conflict('Pick another labor class as the default instead.');
    if (patch.archived && before.isDefault) throw conflict('The default labor class cannot be archived. Make another class the default first.');
    if (patch.isDefault === true && !before.isDefault) await tx.update(laborClasses).set({ isDefault: false }).where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.isDefault, true)));
    const values = defined({
      code: patch.code === undefined ? undefined : (cleanText(patch.code) ?? before.code),
      name: patch.name === undefined ? undefined : (cleanText(patch.name) ?? before.name),
      kind: patch.kind,
      isDefault: patch.isDefault,
      color: patch.color,
      archivedAt: patch.archived === undefined ? undefined : patch.archived ? new Date() : null,
    });
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return classDTO(before);
    const [row] = await tx.update(laborClasses).set({ ...values, updatedAt: new Date() }).where(eq(laborClasses.id, before.id)).returning();
    await logActivity(tx, ctx, { verb: 'labor_class.updated', entityType: 'labor_class', entityId: before.id, ...change });
    if ('isDefault' in change.after) await restampDefaultless(tx, ctx);
    return classDTO(row!);
  });
});

export const deleteLaborClass = scoped(async function deleteLaborClass(ctx: DomainContext, classId: string): Promise<void> {
  await requirePulse(ctx, 'rate:manage');
  await inTx(async (tx) => {
    const before = await getLaborClassRow(ctx, classId, tx);
    if (before.isDefault) throw conflict('The default labor class cannot be deleted. Make another class the default first.');
    const [used] = await rows<{ n: number }>(
      tx,
      sql`SELECT (SELECT count(*) FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND labor_class_id = ${classId} AND deleted_at IS NULL)::int
               + (SELECT count(*) FROM pulse.indirect_entries WHERE org_id = ${ctx.orgId} AND labor_class_id = ${classId} AND deleted_at IS NULL)::int
               + (SELECT count(*) FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND labor_class_id = ${classId} AND deleted_at IS NULL)::int AS n`,
    );
    if ((used?.n ?? 0) > 0) throw conflict('Hours are logged under this labor class. Archive it instead, so its history stays.');
    await softDeleteRow(tx, ctx.orgId, 'labor_classes', classId, 'That labor class');
    await tx.update(laborRates).set({ deletedAt: new Date() }).where(and(eq(laborRates.orgId, ctx.orgId), eq(laborRates.laborClassId, classId), isNull(laborRates.deletedAt)));
    await logActivity(tx, ctx, { verb: 'labor_class.deleted', entityType: 'labor_class', entityId: classId, before: { code: before.code, name: before.name } });
  });
});

/* ---------------------------------------------------------------- rates */

export function toLaborRateDTO(row: RateRow, access: Pick<PulseAccess, 'seesMoney' | 'seesWages'>): LaborRateDTO {
  const wages = access.seesWages;
  const money = access.seesMoney;
  return {
    id: row.id,
    laborClassId: row.laborClassId,
    siteId: row.siteId,
    effectiveFrom: row.effectiveFrom,
    wageCents: moneyOut(wages, row.wageCents),
    payrollTaxBp: hideUnless(wages, row.payrollTaxBp),
    benefitsBp: hideUnless(wages, row.benefitsBp),
    otherBurdenBp: hideUnless(wages, row.otherBurdenBp),
    overheadPerHourCents: moneyOut(wages, row.overheadPerHourCents),
    overtimeMultiplier: row.overtimeMultiplier,
    loadedRateCents: moneyOut(money, row.loadedRateCents),
    overtimeRateCents: moneyOut(money, row.overtimeRateCents),
    billRateCents: moneyOut(money, row.billRateCents),
    note: row.note,
    version: row.version,
    wagesHidden: !wages,
    moneyHidden: !money,
  };
}

/** Rate rows, newest first. Refused with 403 for readers without `money:read` (SPEC section 3). */
export const listLaborRates = scoped(async function listLaborRates(ctx: DomainContext, options: { laborClassId?: string | null } = {}): Promise<LaborRateDTO[]> {
  const access = await requireMoney(ctx);
  const found = await db
    .select()
    .from(laborRates)
    .where(and(eq(laborRates.orgId, ctx.orgId), isNull(laborRates.deletedAt), options.laborClassId ? eq(laborRates.laborClassId, options.laborClassId) : undefined))
    .orderBy(asc(laborRates.laborClassId), desc(laborRates.effectiveFrom));
  return found.map((row) => toLaborRateDTO(row, access));
});

export interface LaborRateInput {
  laborClassId: string;
  siteId?: string | null;
  effectiveFrom: string;
  wageCents: number;
  payrollTaxBp?: number;
  benefitsBp?: number;
  otherBurdenBp?: number;
  overheadPerHourCents?: number;
  overtimeMultiplier?: string;
  billRateCents?: number | null;
  note?: string | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
}

interface RateFields {
  wageCents: number;
  payrollTaxBp: number;
  benefitsBp: number;
  otherBurdenBp: number;
  overheadPerHourCents: number;
  overtimeMultiplier: string;
}

function stampRate(fields: RateFields): { loadedRateCents: number; overtimeRateCents: number } {
  const rate = loadedRate(fields);
  return { loadedRateCents: centsOut(rate.loadedRateCents)!, overtimeRateCents: centsOut(rate.overtimeRateCents)! };
}

/** SQL (alias `src`): entries of this class (or with no class when it is the default) and site, dated from `from`. */
function classScope(row: { laborClassId: string; siteId: string | null }, isDefault: boolean, from: string, alias = 'src.'): SQL {
  const a = sql.raw(alias);
  const cls = isDefault ? sql`(${a}labor_class_id = ${row.laborClassId} OR ${a}labor_class_id IS NULL)` : sql`${a}labor_class_id = ${row.laborClassId}`;
  const site = row.siteId ? sql`AND ${a}site_id = ${row.siteId}` : sql``;
  return sql`${cls} ${site} AND ${a}work_date >= ${from}::date`;
}

async function restampForRate(tx: Executor, ctx: DomainContext, row: { laborClassId: string; siteId: string | null }, from: string): Promise<void> {
  const cls = await getLaborClassRow(ctx, row.laborClassId, tx);
  const where = classScope(row, cls.isDefault, from);
  await restampProduction(tx, ctx.orgId, where);
  await restampIndirect(tx, ctx.orgId, where);
  await restampVas(tx, ctx.orgId, where);
  await finishTouched(tx, ctx, classScope(row, cls.isDefault, from, ''));
}

export const insertLaborRate = scoped(async function insertLaborRate(tx: Executor, ctx: DomainContext, input: LaborRateInput, options: { restamp?: boolean } = {}): Promise<RateRow> {
  const settings = await loadSettings(ctx.orgId, tx);
  await getLaborClassRow(ctx, input.laborClassId, tx);
  await assertOpen(tx, ctx.orgId, [input.effectiveFrom]);
  const fields: RateFields = {
    wageCents: input.wageCents,
    payrollTaxBp: input.payrollTaxBp ?? settings.defaultPayrollTaxBp,
    benefitsBp: input.benefitsBp ?? settings.defaultBenefitsBp,
    otherBurdenBp: input.otherBurdenBp ?? settings.defaultOtherBurdenBp,
    overheadPerHourCents: input.overheadPerHourCents ?? settings.defaultOverheadPerHourCents,
    overtimeMultiplier: input.overtimeMultiplier ?? settings.defaultOvertimeMultiplier,
  };
  const [row] = await tx
    .insert(laborRates)
    .values({
      orgId: ctx.orgId,
      laborClassId: input.laborClassId,
      siteId: input.siteId ?? null,
      effectiveFrom: input.effectiveFrom,
      ...fields,
      ...stampRate(fields),
      billRateCents: input.billRateCents ?? null,
      note: cleanText(input.note),
      source: input.source ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      isSample: Boolean(input.isSample),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  await logActivity(tx, ctx, { verb: 'rate.changed', entityType: 'labor_rate', entityId: row!.id, after: { laborClassId: row!.laborClassId, siteId: row!.siteId, effectiveFrom: row!.effectiveFrom, loadedRateCents: row!.loadedRateCents }, meta: { change: 'added' } });
  if (options.restamp !== false) await restampForRate(tx, ctx, row!, row!.effectiveFrom);
  return row!;
}, 1);

export const createLaborRate = scoped(async function createLaborRate(ctx: DomainContext, input: LaborRateInput): Promise<LaborRateDTO> {
  const access = await requirePulse(ctx, 'rate:manage');
  return inTx(async (tx) => toLaborRateDTO(await insertLaborRate(tx, ctx, input), access));
});

async function getRateRow(ctx: DomainContext, rateId: string, executor: Executor): Promise<RateRow> {
  const [row] = isUuid(rateId) ? await executor.select().from(laborRates).where(and(eq(laborRates.orgId, ctx.orgId), eq(laborRates.id, rateId), isNull(laborRates.deletedAt))) : [];
  if (!row) throw notFound('That rate');
  return row;
}

export const updateLaborRate = scoped(async function updateLaborRate(ctx: DomainContext, rateId: string, patch: Partial<Omit<LaborRateInput, 'laborClassId'>>, version?: number | null): Promise<LaborRateDTO> {
  const access = await requirePulse(ctx, 'rate:manage');
  return inTx(async (tx) => {
    const before = await getRateRow(ctx, rateId, tx);
    assertVersion(before.version, version);
    await assertOpen(tx, ctx.orgId, [before.effectiveFrom, patch.effectiveFrom]);
    const fields: RateFields = {
      wageCents: patch.wageCents ?? before.wageCents,
      payrollTaxBp: patch.payrollTaxBp ?? before.payrollTaxBp,
      benefitsBp: patch.benefitsBp ?? before.benefitsBp,
      otherBurdenBp: patch.otherBurdenBp ?? before.otherBurdenBp,
      overheadPerHourCents: patch.overheadPerHourCents ?? before.overheadPerHourCents,
      overtimeMultiplier: patch.overtimeMultiplier ?? before.overtimeMultiplier,
    };
    const values = defined({
      ...fields,
      ...stampRate(fields),
      siteId: patch.siteId,
      effectiveFrom: patch.effectiveFrom,
      billRateCents: patch.billRateCents,
      note: patch.note === undefined ? undefined : cleanText(patch.note),
    });
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return toLaborRateDTO(before, access);
    const [row] = await tx.update(laborRates).set({ ...values, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(laborRates.id, before.id)).returning();
    await logActivity(tx, ctx, { verb: 'rate.changed', entityType: 'labor_rate', entityId: before.id, ...change, meta: { change: 'edited' } });
    const from = before.effectiveFrom < row!.effectiveFrom ? before.effectiveFrom : row!.effectiveFrom;
    await restampForRate(tx, ctx, { laborClassId: before.laborClassId, siteId: before.siteId === row!.siteId ? before.siteId : null }, from);
    return toLaborRateDTO(row!, access);
  });
});

export const deleteLaborRate = scoped(async function deleteLaborRate(ctx: DomainContext, rateId: string): Promise<void> {
  await requirePulse(ctx, 'rate:manage');
  await inTx(async (tx) => {
    const before = await getRateRow(ctx, rateId, tx);
    await assertOpen(tx, ctx.orgId, [before.effectiveFrom]);
    await softDeleteRow(tx, ctx.orgId, 'labor_rates', rateId, 'That rate');
    await logActivity(tx, ctx, { verb: 'rate.changed', entityType: 'labor_rate', entityId: rateId, before: { laborClassId: before.laborClassId, effectiveFrom: before.effectiveFrom, loadedRateCents: before.loadedRateCents }, meta: { change: 'deleted' } });
    await restampForRate(tx, ctx, before, before.effectiveFrom);
  });
});

/**
 * "This changes 212 entries and lowers profit by $1,430 across 9 jobs." Counts the open entries a
 * new or edited rate would restamp and the labor cost difference, without saving anything.
 */
export const previewLaborRate = scoped(async function previewLaborRate(ctx: DomainContext, input: LaborRateInput & { rateId?: string | null }): Promise<RateChangePreviewDTO> {
  const access = await requirePulse(ctx, 'rate:manage');
  const settings = await loadSettings(ctx.orgId);
  const cls = await getLaborClassRow(ctx, input.laborClassId);
  const fields: RateFields = {
    wageCents: input.wageCents,
    payrollTaxBp: input.payrollTaxBp ?? settings.defaultPayrollTaxBp,
    benefitsBp: input.benefitsBp ?? settings.defaultBenefitsBp,
    otherBurdenBp: input.otherBurdenBp ?? settings.defaultOtherBurdenBp,
    overheadPerHourCents: input.overheadPerHourCents ?? settings.defaultOverheadPerHourCents,
    overtimeMultiplier: input.overtimeMultiplier ?? settings.defaultOvertimeMultiplier,
  };
  const stamp = stampRate(fields);
  const scope = classScope({ laborClassId: input.laborClassId, siteId: input.siteId ?? null }, cls.isDefault, input.effectiveFrom, 'e.');
  // Only entries this row would be the pick for: no later live row of the class on or before the entry date.
  const later = sql`NOT EXISTS (SELECT 1 FROM pulse.labor_rates lr WHERE lr.org_id = ${ctx.orgId} AND lr.labor_class_id = ${input.laborClassId} AND lr.deleted_at IS NULL
                      AND lr.effective_from > ${input.effectiveFrom}::date AND lr.effective_from <= e.work_date ${input.rateId ? sql`AND lr.id <> ${input.rateId}` : sql``})`;
  const closed = sql`EXISTS (SELECT 1 FROM pulse.periods pp WHERE pp.org_id = e.org_id AND pp.status = 'closed' AND pp.period_month = date_trunc('month', e.work_date)::date)`;
  const [row] = await rows<{ entries: number; jobs: number; closed_entries: number; delta: string }>(
    db,
    sql`WITH e AS (
          SELECT org_id, job_id, work_date, site_id, labor_class_id, hours, overtime_hours, labor_cost_cents AS old FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL
          UNION ALL SELECT org_id, job_id, work_date, site_id, labor_class_id, hours, overtime_hours, labor_cost_cents FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL
          UNION ALL SELECT org_id, NULL::uuid, work_date, site_id, labor_class_id, hours, overtime_hours, cost_cents FROM pulse.indirect_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL
        ), hit AS (
          SELECT e.*, ${closed} AS is_closed FROM e WHERE ${scope} AND ${later}
        )
        SELECT count(*) FILTER (WHERE NOT is_closed)::int AS entries,
               count(DISTINCT job_id) FILTER (WHERE NOT is_closed)::int AS jobs,
               count(*) FILTER (WHERE is_closed)::int AS closed_entries,
               COALESCE(sum(round((hours - overtime_hours) * ${stamp.loadedRateCents}) + round(overtime_hours * ${stamp.overtimeRateCents}) - old) FILTER (WHERE NOT is_closed), 0)::text AS delta
          FROM hit`,
  );
  return { entries: row?.entries ?? 0, jobs: row?.jobs ?? 0, closedEntries: row?.closed_entries ?? 0, laborDeltaCents: moneyOut(access.seesMoney, row?.delta ?? '0') };
});

/**
 * The rate that applies to an entry today, in words the "How we got this" popover can use.
 * `source` is `class`, `default` or `none`.
 */
export const rateForEntry = scoped(async function rateForEntry(ctx: DomainContext, input: { laborClassId: string | null; siteId: string; workDate: string }): Promise<RateForEntryDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const [row] = await rows<{ found: boolean; source: string; rate_cents: number; overtime_rate_cents: number; labor_class_id: string | null; rate_id: string | null }>(
    db,
    sql`SELECT found, source, rate_cents, overtime_rate_cents, labor_class_id, rate_id FROM pulse.rate_for(${ctx.orgId}, ${input.laborClassId}::uuid, ${input.siteId}::uuid, ${input.workDate}::date)`,
  );
  return {
    found: Boolean(row?.found),
    source: row?.source ?? 'none',
    rateCents: moneyOut(access.seesMoney, row?.rate_cents),
    overtimeRateCents: moneyOut(access.seesMoney, row?.overtime_rate_cents),
    laborClassId: row?.labor_class_id ?? null,
    rateId: row?.rate_id ?? null,
  };
});
