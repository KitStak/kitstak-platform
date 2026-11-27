/**
 * Price cards (docs/programs/SPEC.md D5, D6, A3, 4.4). A card has dated versions: Draft,
 * Scheduled (published, starts later), In force and Ended. Only drafts change. Publishing
 * reprices every open output row from its start date in the same transaction and refreshes the
 * ledger; locked rows keep their old price.
 */
import 'server-only';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { loadProgramMonthInputs } from '@kitstak/db/programs';
import { firstDayOfMonth, lastDayOfMonth, monthOf, shiftMonth, workDaysInMonth } from '@kitstak/programs-engine/calendar';
import { cardSummary, compileRateRules, describeRateRule, rateConflictMessage, resolveUnitPrice, versionFor } from '@kitstak/programs-engine/price';
import { changeBp, fromScaled, mulQuantityPrice, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { monthCharges, type MonthResult } from '@kitstak/programs-engine/month';
import type { CardLine, CardVersion, OutputRow, RateRule } from '@kitstak/programs-engine/types';
import { db, type Executor } from '@/server/db';
import { priceCardLines, priceCardRules, priceCardVersions, programAttributes, programVariants, projectMembers, type PriceCardVersion } from '@/server/db/schema';
import { conflict, invalid, locked, notFound } from '@/server/errors';
import type { CardImpactDTO, CardLineInput, CardVersionDTO, IsoDate, RateRuleInput } from '@/lib/program-types';
import type { VersionSource, VersionState } from '@/lib/constants';
import { routes } from '@/lib/routes';
import type { DomainContext } from '../_shared';
import { logActivity } from '../activity';
import { notify } from '../notifications';
import { calendarFor, dayText, lockSettings, shared, todayInZone, versionConflict } from './_program';
import { requireProgram, type ProgramAccess } from './access';
import { emitProgramChanged } from './events';
import { monthsFrom, refreshLedgerFor } from './ledger';
import { isLocked, lastLockedDay, programLocks } from './locks';
import { programJobId } from './postings';
import { restampOutput, versionsFor } from './pricing';

// --- DTOs ----------------------------------------------------------------------------------------

function stateOf(row: PriceCardVersion, published: readonly CardVersion[], today: IsoDate): VersionState {
  if (row.status === 'draft') return 'draft';
  if (row.effectiveFrom > today) return 'scheduled';
  return versionFor(published, today)?.id === row.id ? 'in_force' : 'ended';
}

async function versionRows(executor: Executor, versionIds: readonly string[]) {
  if (versionIds.length === 0) return { lines: [], rules: [] };
  const list = sql.join(versionIds.map((id) => sql`${id}::uuid`), sql`, `);
  const [lines, rules] = await Promise.all([
    executor.select().from(priceCardLines).where(sql`${priceCardLines.versionId} in (${list})`).orderBy(asc(priceCardLines.position), asc(priceCardLines.kind)),
    executor.select().from(priceCardRules).where(sql`${priceCardRules.versionId} in (${list})`).orderBy(asc(priceCardRules.position)),
  ]);
  return { lines, rules };
}

export async function toVersionDTOs(executor: Executor, ctx: DomainContext, access: Pick<ProgramAccess, 'program' | 'settings' | 'caps'>, rows: readonly PriceCardVersion[]): Promise<CardVersionDTO[]> {
  const hidden = !access.caps.seesMoney;
  const today = todayInZone(access.settings.timezone);
  const published = await versionsFor(executor, ctx, access.program.id);
  const { lines, rules } = await versionRows(executor, rows.map((row) => row.id));
  const attributes = await executor.select().from(programAttributes).where(eq(programAttributes.programId, access.program.id));
  return rows.map((row) => {
    const myLines = lines.filter((line) => line.versionId === row.id);
    const myRules = rules.filter((rule) => rule.versionId === row.id);
    const asCard: CardVersion = {
      id: row.id,
      number: row.number,
      effectiveFrom: row.effectiveFrom,
      lines: myLines.map(toCardLine),
      rules: myRules.map((rule) => ({ id: rule.id, attributeId: rule.attributeId, valueId: rule.valueId, op: rule.op, amount: rule.amount })),
    };
    return {
      id: row.id,
      programId: row.programId,
      number: row.number,
      status: row.status,
      state: stateOf(row, published, today),
      effectiveFrom: row.effectiveFrom,
      label: row.label,
      note: row.note,
      source: row.source,
      reviewStatus: row.reviewStatus,
      reviewNote: row.reviewNote,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      publishedBy: row.publishedBy,
      lines: hidden
        ? []
        : myLines.map((line) => ({
            id: line.id,
            kind: line.kind,
            variantId: line.variantId,
            ruleId: line.ruleId,
            unitPrice: line.unitPrice,
            rateCents: line.rateCents,
            amountCents: line.amountCents === null ? null : line.amountCents.toString(),
            prorate: line.prorate,
            chargeWhilePaused: line.chargeWhilePaused,
            label: line.label,
            position: line.position,
          })),
      rules: hidden
        ? []
        : myRules.map((rule) => {
            const attribute = attributes.find((a) => a.id === rule.attributeId);
            const value = attribute?.values.find((v) => v.id === rule.valueId);
            return { id: rule.id, attributeId: rule.attributeId, valueId: rule.valueId, op: rule.op, amount: rule.amount, position: rule.position, text: describeRateRule(rule, attribute?.name ?? 'Attribute', value?.label ?? 'value') };
          }),
      summary: hidden ? null : cardSummary(asCard, access.settings.unitSingular),
      version: row.version,
      moneyHidden: hidden,
    };
  });
}

function toCardLine(line: typeof priceCardLines.$inferSelect): CardLine {
  return {
    id: line.id,
    kind: line.kind,
    variantId: line.variantId,
    ruleId: line.ruleId,
    unitPrice: line.unitPrice,
    rateCents: line.rateCents,
    amountCents: line.amountCents === null ? null : line.amountCents.toString(),
    prorate: line.prorate,
    chargeWhilePaused: line.chargeWhilePaused,
    label: line.label,
  };
}

export async function listCardVersions(ctx: DomainContext, key: string): Promise<CardVersionDTO[]> {
  const access = await requireProgram(ctx, key);
  const rows = await db.select().from(priceCardVersions).where(and(eq(priceCardVersions.programId, access.program.id), isNull(priceCardVersions.deletedAt))).orderBy(desc(priceCardVersions.effectiveFrom), desc(priceCardVersions.createdAt));
  return toVersionDTOs(db, ctx, access, rows);
}

async function loadVersion(ctx: DomainContext, versionId: string, action: 'project:read' | 'pricing:propose' | 'pricing:manage') {
  const [row] = await db.select().from(priceCardVersions).where(and(eq(priceCardVersions.id, versionId), eq(priceCardVersions.orgId, ctx.orgId), isNull(priceCardVersions.deletedAt)));
  if (!row) throw notFound('That price card version');
  const access = await requireProgram(ctx, { id: row.programId }, action);
  return { row, access };
}

export async function getCardVersion(ctx: DomainContext, versionId: string): Promise<CardVersionDTO> {
  const { row, access } = await loadVersion(ctx, versionId, 'project:read');
  const [dto] = await toVersionDTOs(db, ctx, access, [row]);
  return dto!;
}

// --- Writing version content ------------------------------------------------------------------------

export interface ResolvedLine extends Omit<CardLineInput, 'variantKey'> {
  readonly variantId?: string | null;
}

/** Replaces a draft's lines and rules, then compiles the rules into variant lines (A3). */
export async function writeVersionContent(tx: Executor, ctx: DomainContext, versionId: string, programId: string, content: { readonly lines: readonly ResolvedLine[]; readonly rules: readonly RateRuleInput[] }): Promise<{ conflicts: { variantId: string; text: string }[] }> {
  await tx.delete(priceCardLines).where(eq(priceCardLines.versionId, versionId));
  await tx.delete(priceCardRules).where(eq(priceCardRules.versionId, versionId));
  const [attributes, variants] = await Promise.all([
    tx.select().from(programAttributes).where(and(eq(programAttributes.programId, programId), isNull(programAttributes.deletedAt))),
    tx.select().from(programVariants).where(and(eq(programVariants.programId, programId), isNull(programVariants.deletedAt))),
  ]);
  const seen = new Set<string>();
  for (const line of content.lines) {
    const slot = `${line.kind}:${line.variantId ?? 'card'}`;
    if (seen.has(slot)) throw invalid(line.variantId ? 'A variant has two rates of the same kind. Keep one.' : 'The card has two lines of the same kind. Keep one.');
    seen.add(slot);
    if (line.variantId && !variants.some((v) => v.id === line.variantId)) throw invalid('A rate points at a variant that is not in this program.');
    if (line.variantId && line.kind !== 'per_unit' && line.kind !== 'per_order') throw invalid('Only per unit and per batch lines can be set per variant.');
  }
  const ruleRows = content.rules.map((rule, index) => {
    const attribute = attributes.find((a) => a.id === rule.attributeId);
    if (!attribute) throw invalid('A rule points at an attribute that is not in this program.');
    if (!attribute.values.some((v) => v.id === rule.valueId)) throw invalid(`A rule points at a ${attribute.name} value that does not exist.`);
    return { orgId: ctx.orgId, versionId, attributeId: rule.attributeId, valueId: rule.valueId, op: rule.op, amount: rule.amount, position: index };
  });
  const insertedRules = ruleRows.length ? await tx.insert(priceCardRules).values(ruleRows).returning() : [];
  const handLines = content.lines.map((line, index) => ({
    orgId: ctx.orgId,
    versionId,
    kind: line.kind,
    variantId: line.variantId ?? null,
    ruleId: null,
    unitPrice: line.kind === 'per_unit' ? (line.unitPrice ?? null) : null,
    rateCents: line.kind === 'per_hour' ? (line.rateCents ?? null) : null,
    amountCents: line.kind === 'per_order' || line.kind === 'flat_monthly' || line.kind === 'monthly_minimum' ? (line.amountCents ? BigInt(line.amountCents) : null) : null,
    prorate: line.prorate ?? true,
    chargeWhilePaused: line.chargeWhilePaused ?? true,
    label: line.label?.trim() || null,
    position: index,
  }));
  if (handLines.length) await tx.insert(priceCardLines).values(handLines);
  const cardDefault = content.lines.find((line) => line.kind === 'per_unit' && !line.variantId)?.unitPrice ?? null;
  const compiled = compileRateRules({
    defaultUnitPrice: cardDefault,
    rules: insertedRules.map((rule): RateRule => ({ id: rule.id, attributeId: rule.attributeId, valueId: rule.valueId, op: rule.op, amount: rule.amount })),
    variants: variants.map((variant) => ({ id: variant.id, attributes: variant.attributes })),
    handLines: content.lines.filter((line) => line.kind === 'per_unit' && line.variantId && line.unitPrice).map((line) => ({ variantId: line.variantId as string, unitPrice: line.unitPrice as string })),
  });
  if (compiled.lines.length) {
    await tx.insert(priceCardLines).values(
      compiled.lines.map((line, index) => ({ orgId: ctx.orgId, versionId, kind: 'per_unit' as const, variantId: line.variantId, ruleId: line.ruleId, unitPrice: line.unitPrice, prorate: true, chargeWhilePaused: true, position: 1000 + index })),
    );
  }
  return {
    conflicts: compiled.conflicts.map((item) => ({
      variantId: item.variantId,
      text: rateConflictMessage(item.reason, variants.find((v) => v.id === item.variantId)?.name ?? 'this variant', { amount: item.amount, problem: item.problem }),
    })),
  };
}

/** Inserts a version (wizard, copy, templates). Published versions get the next number. */
export async function insertVersion(
  tx: Executor,
  ctx: DomainContext,
  programId: string,
  input: { readonly effectiveFrom: IsoDate; readonly status: 'draft' | 'published'; readonly source: VersionSource; readonly sourceRef?: string | null; readonly label?: string | null; readonly lines: readonly ResolvedLine[]; readonly rules: readonly RateRuleInput[] },
): Promise<{ id: string; number: number | null; conflicts: { variantId: string; text: string }[] }> {
  const [row] = await tx
    .insert(priceCardVersions)
    .values({ orgId: ctx.orgId, programId, status: 'draft', effectiveFrom: input.effectiveFrom, source: input.source, sourceRef: input.sourceRef ?? null, label: input.label ?? null, createdBy: ctx.actorKind === 'user' ? ctx.userId : null })
    .returning();
  const { conflicts } = await writeVersionContent(tx, ctx, row!.id, programId, input);
  let number: number | null = null;
  if (input.status === 'published') {
    if (conflicts.length > 0) throw invalid(conflicts[0]!.text);
    number = await nextNumber(tx, programId);
    await tx.update(priceCardVersions).set({ status: 'published', number, publishedAt: new Date(), publishedBy: ctx.actorKind === 'user' ? ctx.userId : null }).where(eq(priceCardVersions.id, row!.id));
  }
  return { id: row!.id, number, conflicts };
}

async function nextNumber(tx: Executor, programId: string): Promise<number> {
  const result = await tx.execute(sql`select coalesce(max(number), 0) + 1 as next from pm.price_card_versions where program_id = ${programId}::uuid`);
  return Number((result as unknown as { rows: { next: number }[] }).rows[0]?.next ?? 1);
}

async function contentOf(executor: Executor, versionId: string): Promise<{ lines: ResolvedLine[]; rules: RateRuleInput[] }> {
  const { lines, rules } = await versionRows(executor, [versionId]);
  return {
    lines: lines
      .filter((line) => !line.ruleId)
      .map((line) => ({
        kind: line.kind,
        variantId: line.variantId,
        unitPrice: line.unitPrice,
        rateCents: line.rateCents,
        amountCents: line.amountCents === null ? null : line.amountCents.toString(),
        prorate: line.prorate,
        chargeWhilePaused: line.chargeWhilePaused,
        label: line.label,
      })),
    rules: rules.map((rule) => ({ attributeId: rule.attributeId, valueId: rule.valueId, op: rule.op, amount: rule.amount })),
  };
}

// --- Drafts --------------------------------------------------------------------------------------

export async function createDraftVersion(ctx: DomainContext, key: string, input: { readonly from: string | 'current' | 'empty'; readonly effectiveFrom: IsoDate }): Promise<CardVersionDTO> {
  const access = await requireProgram(ctx, key, 'pricing:propose');
  const today = todayInZone(access.settings.timezone);
  const id = await db.transaction(async (tx) => {
    let content: { lines: ResolvedLine[]; rules: RateRuleInput[] } = { lines: [], rules: [] };
    if (input.from === 'current') {
      const current = versionFor(await versionsFor(tx, ctx, access.program.id), input.effectiveFrom > today ? input.effectiveFrom : today);
      if (current) content = await contentOf(tx, current.id);
    } else if (input.from !== 'empty') {
      const [source] = await tx.select().from(priceCardVersions).where(and(eq(priceCardVersions.id, input.from), eq(priceCardVersions.programId, access.program.id)));
      if (!source) throw notFound('That price card version');
      content = await contentOf(tx, source.id);
    }
    const created = await insertVersion(tx, ctx, access.program.id, { effectiveFrom: input.effectiveFrom, status: 'draft', source: 'manual', ...content });
    await logActivity(tx, ctx, { verb: 'price_card.draft_created', entityType: 'price_card_version', entityId: created.id, projectId: access.program.id, after: { effectiveFrom: input.effectiveFrom } });
    return created.id;
  });
  return getCardVersion(ctx, id);
}

function assertDraft(row: PriceCardVersion): void {
  if (row.status !== 'draft') throw invalid('Only drafts can change. Move a Scheduled version back to a draft first.');
}

export async function updateDraftVersion(
  ctx: DomainContext,
  versionId: string,
  patch: { readonly effectiveFrom?: IsoDate; readonly label?: string | null; readonly note?: string | null; readonly lines?: readonly ResolvedLine[]; readonly rules?: readonly RateRuleInput[] },
  expectedVersion: number,
): Promise<CardVersionDTO> {
  const { row, access } = await loadVersion(ctx, versionId, 'pricing:propose');
  assertDraft(row);
  if (row.version !== expectedVersion) throw versionConflict();
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(priceCardVersions)
      .set({
        effectiveFrom: patch.effectiveFrom ?? row.effectiveFrom,
        label: patch.label !== undefined ? patch.label : row.label,
        note: patch.note !== undefined ? patch.note : row.note,
        reviewStatus: row.reviewStatus === 'sent_back' ? 'none' : row.reviewStatus,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(priceCardVersions.id, versionId), eq(priceCardVersions.version, expectedVersion)))
      .returning();
    if (updated.length === 0) throw versionConflict();
    if (patch.lines || patch.rules) {
      const current = await contentOf(tx, versionId);
      await writeVersionContent(tx, ctx, versionId, access.program.id, { lines: patch.lines ?? current.lines, rules: patch.rules ?? current.rules });
    }
  });
  return getCardVersion(ctx, versionId);
}

// --- Impact preview (4.4.5) ---------------------------------------------------------------------

function repriceRows(output: readonly OutputRow[], versions: readonly CardVersion[], from: IsoDate, isOpen: (date: IsoDate) => boolean, overrides: ReadonlyMap<string, string | null>): OutputRow[] {
  return output.map((row) => {
    if (row.workDate < from || !isOpen(row.workDate) || row.priceSource === 'build' || row.priceSource === 'job') return row;
    const price = resolveUnitPrice({ workDate: row.workDate, variantId: row.variantId, buildOverride: overrides.get(row.buildId) ?? null, versions });
    return { ...row, unitPrice: price.unitPrice, priceSource: price.source, versionId: price.versionId, revenueCents: mulQuantityPrice(row.qty, price.unitPrice).toString() };
  });
}

function delta(before: bigint, after: bigint) {
  return { beforeCents: before.toString(), afterCents: after.toString(), deltaCents: (after - before).toString(), deltaBp: changeBp(after, before) };
}

/** What publishing a draft would change (this month, next month at recent volume, per variant, the minimum). */
export async function previewVersion(ctx: DomainContext, versionId: string, draft?: { readonly effectiveFrom?: IsoDate; readonly lines?: readonly ResolvedLine[]; readonly rules?: readonly RateRuleInput[] }): Promise<CardImpactDTO> {
  const { row, access } = await loadVersion(ctx, versionId, 'pricing:propose');
  const program = access.program;
  const today = todayInZone(access.settings.timezone);
  // Compile the draft inside a transaction that is always rolled back.
  let draftVersion: CardVersion | null = null;
  let conflicts: { variantId: string; text: string }[] = [];
  const effectiveFrom = draft?.effectiveFrom ?? row.effectiveFrom;
  try {
    await db.transaction(async (tx) => {
      if (draft?.lines || draft?.rules) {
        const current = await contentOf(tx, versionId);
        conflicts = (await writeVersionContent(tx, ctx, versionId, program.id, { lines: draft.lines ?? current.lines, rules: draft.rules ?? current.rules })).conflicts;
      } else {
        conflicts = (await writeVersionContent(tx, ctx, versionId, program.id, await contentOf(tx, versionId))).conflicts;
      }
      const { lines, rules } = await versionRows(tx, [versionId]);
      draftVersion = { id: versionId, number: row.number, effectiveFrom, lines: lines.map(toCardLine), rules: rules.map((r) => ({ id: r.id, attributeId: r.attributeId, valueId: r.valueId, op: r.op, amount: r.amount })) };
      throw new RollbackPreview();
    });
  } catch (error) {
    if (!(error instanceof RollbackPreview)) throw error;
  }
  const before = await versionsFor(db, ctx, program.id);
  const after = [...before.filter((v) => v.id !== versionId && v.effectiveFrom !== effectiveFrom), draftVersion!].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  const locks = await programLocks(ctx, program);
  const goesToJob = Boolean(await programJobId(db, ctx, program.id));
  const isOpen = (date: IsoDate) => !isLocked(locks, date, { goesToJob });
  const month = monthOf(today);
  const inputs = await loadProgramMonthInputs(shared(db), ctx.orgId, program.id, month);
  const overrides = new Map<string, string | null>();
  const overrideRows = await db.execute(sql`select task_id::text as id, rate_override::text as rate from pm.builds where program_id = ${program.id}::uuid and rate_override is not null`);
  for (const r of (overrideRows as unknown as { rows: { id: string; rate: string }[] }).rows) overrides.set(r.id, r.rate);
  const thisBefore = monthCharges({ ...inputs, asOf: today });
  const thisAfter = monthCharges({ ...inputs, versions: after, output: repriceRows(inputs.output, after, effectiveFrom, isOpen, overrides), asOf: today });
  // Next month at recent volume: trailing 20 work days per variant times next month's work days.
  const calendar = await calendarFor(db, ctx, program, access.settings);
  const nextMonth = shiftMonth(month, 1);
  const nextDays = workDaysInMonth(calendar, nextMonth);
  const trailing = await db.execute(
    sql`select variant_id::text as variant_id, coalesce(sum(qty), 0)::text as units, count(distinct work_date)::int as days
          from pm.build_output where program_id = ${program.id}::uuid and deleted_at is null and work_date > (${today}::date - 28) and work_date <= ${today}::date group by 1`,
  );
  const recent = (trailing as unknown as { rows: { variant_id: string | null; units: string; days: number }[] }).rows;
  const synth = (versions: readonly CardVersion[]): MonthResult => {
    const day = nextDays[0] ?? firstDayOfMonth(nextMonth);
    const output: OutputRow[] = recent.map((r, index) => {
      const perDay = quantityToScaled(r.units) / BigInt(Math.max(20, r.days));
      const qty = fromScaled(perDay * BigInt(nextDays.length), 3);
      const price = resolveUnitPrice({ workDate: day, variantId: r.variant_id, buildOverride: null, versions });
      return { buildId: `preview-${index}`, variantId: r.variant_id, workDate: day, qty, scrapQty: '0', unitPrice: price.unitPrice, priceSource: price.source, versionId: price.versionId, revenueCents: mulQuantityPrice(qty, price.unitPrice).toString(), posting: 'program', pulseJobId: null };
    });
    return monthCharges({ programId: program.id, month: nextMonth, asOf: lastDayOfMonth(nextMonth), calendar, versions, output, finished: [], time: [], oneTime: [] });
  };
  const nextBefore = synth(before);
  const nextAfter = synth(after);
  const variants = await db.select().from(programVariants).where(and(eq(programVariants.programId, program.id), isNull(programVariants.deletedAt))).orderBy(sql`${programVariants.position} COLLATE "C"`);
  const attributes = await db.select().from(programAttributes).where(eq(programAttributes.programId, program.id));
  const day = effectiveFrom > today ? effectiveFrom : today;
  const byVariant = variants.map((variant) => {
    const b = resolveUnitPrice({ workDate: day, variantId: variant.id, buildOverride: null, versions: before });
    const a = resolveUnitPrice({ workDate: day, variantId: variant.id, buildOverride: null, versions: after });
    const units = thisAfter.byVariant.find((r) => r.variantId === variant.id)?.units ?? '0.000';
    const beforeCents = thisBefore.byVariant.find((r) => r.variantId === variant.id)?.perUnitCents ?? ZERO;
    const afterCents = thisAfter.byVariant.find((r) => r.variantId === variant.id)?.perUnitCents ?? ZERO;
    return { variantId: variant.id, name: variant.name, beforePrice: b.source === 'none' ? null : b.unitPrice, afterPrice: a.source === 'none' ? null : a.unitPrice, units, deltaCents: (afterCents - beforeCents).toString() };
  });
  const openRows = inputs.output.filter((r) => r.workDate >= effectiveFrom && isOpen(r.workDate));
  const openDates = [...new Set(openRows.map((r) => r.workDate))].sort();
  const lockedDay = lastLockedDay(locks, { goesToJob });
  const warnings: CardImpactDTO['warnings'][number][] = [];
  const version = draftVersion as CardVersion | null;
  if (!version?.lines.some((line) => line.kind === 'per_unit')) warnings.push('no_per_unit_line');
  if (thisAfter.totalCents < thisBefore.totalCents) warnings.push('lower_than_current');
  if (effectiveFrom < today) warnings.push('starts_in_past');
  if (lockedDay && effectiveFrom <= lockedDay.through) warnings.push('locked_days_keep_old_price');
  if (byVariant.some((v) => v.afterPrice === null)) warnings.push('unpriced_variants');
  const rules = (version?.rules ?? []).map((rule) => {
    const attribute = attributes.find((a) => a.id === rule.attributeId);
    const value = attribute?.values.find((v) => v.id === rule.valueId);
    const count = variants.filter((v) => v.attributes[rule.attributeId] === rule.valueId).length;
    return { ruleId: rule.id, text: `${describeRateRule(rule, attribute?.name ?? 'Attribute', value?.label ?? 'value')} · ${count} ${count === 1 ? 'variant' : 'variants'}`, variants: count };
  });
  return {
    effectiveFrom,
    openDays: openDates.length ? { from: openDates[0]!, to: openDates.at(-1)!, count: openDates.length } : null,
    lockedDays: lockedDay,
    thisMonth: delta(thisBefore.totalCents, thisAfter.totalCents),
    nextMonth: delta(nextBefore.totalCents, nextAfter.totalCents),
    byVariant,
    minimum: {
      before: thisBefore.minimum.minimumCents.toString(),
      after: thisAfter.minimum.minimumCents.toString(),
      gapBefore: thisBefore.minimum.gapSoFarCents.toString(),
      gapAfter: thisAfter.minimum.gapSoFarCents.toString(),
    },
    rules,
    conflicts,
    warnings,
  };
}

class RollbackPreview extends Error {}

// --- Publish (4.4.2) -------------------------------------------------------------------------------

export async function publishVersion(ctx: DomainContext, versionId: string, expectedVersion: number): Promise<{ repricedRows: number; number: number }> {
  const { row, access } = await loadVersion(ctx, versionId, 'pricing:manage');
  assertDraft(row);
  if (row.version !== expectedVersion) throw versionConflict();
  const program = access.program;
  const result = await db.transaction(async (tx) => {
    await lockSettings(tx, [program.id], 'update');
    const locks = await programLocks(ctx, program, tx);
    const goesToJob = Boolean(await programJobId(tx, ctx, program.id));
    const lockedDay = lastLockedDay(locks, { goesToJob });
    if (lockedDay && row.effectiveFrom <= lockedDay.through) {
      throw locked(`Pick a start date after ${dayText(lockedDay.through)}. Days through then are closed.`);
    }
    if (isLocked(locks, row.effectiveFrom, { goesToJob })) throw locked('That start date is in a closed month. Pick a later date.');
    const { conflicts } = await writeVersionContent(tx, ctx, versionId, program.id, await contentOf(tx, versionId));
    if (conflicts.length > 0) throw invalid(conflicts[0]!.text);
    // Same day fold.
    const [same] = await tx
      .select()
      .from(priceCardVersions)
      .where(and(eq(priceCardVersions.programId, program.id), eq(priceCardVersions.status, 'published'), eq(priceCardVersions.effectiveFrom, row.effectiveFrom), isNull(priceCardVersions.deletedAt)));
    if (same) {
      const used = await tx.execute(
        sql`select (exists (select 1 from pm.build_output where card_version_id = ${same.id}::uuid and deleted_at is null)
                    or exists (select 1 from pm.program_ledger where version_id = ${same.id}::uuid and deleted_at is null)) as used`,
      );
      if ((used as unknown as { rows: { used: boolean }[] }).rows[0]?.used) throw conflict(`A published version already starts on ${dayText(row.effectiveFrom)}.`);
      await tx.update(priceCardVersions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(priceCardVersions.id, same.id));
      await logActivity(tx, ctx, { verb: 'price_card.version_replaced', entityType: 'price_card_version', entityId: same.id, projectId: program.id, before: { number: same.number, effectiveFrom: same.effectiveFrom } });
    }
    const number = row.number ?? (await nextNumber(tx, program.id));
    const updated = await tx
      .update(priceCardVersions)
      .set({ status: 'published', number, publishedAt: new Date(), publishedBy: ctx.actorKind === 'user' ? ctx.userId : null, reviewStatus: 'none', reviewNote: null, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(priceCardVersions.id, versionId), eq(priceCardVersions.version, expectedVersion)))
      .returning();
    if (updated.length === 0) throw versionConflict();
    const repricedRows = await restampOutput(tx, ctx, { containerId: program.id, programId: program.id, locks, from: row.effectiveFrom });
    const today = todayInZone(access.settings.timezone);
    await refreshLedgerFor(tx, ctx, { programIds: [program.id], months: monthsFrom(row.effectiveFrom, today) });
    const version: CardVersion = { id: versionId, number, effectiveFrom: row.effectiveFrom, lines: (await versionRows(tx, [versionId])).lines.map(toCardLine), rules: [] };
    await logActivity(tx, ctx, {
      verb: 'price_card.version_published',
      entityType: 'price_card_version',
      entityId: versionId,
      projectId: program.id,
      after: { number, effectiveFrom: row.effectiveFrom, repriced: repricedRows, money: { summary: cardSummary(version, access.settings.unitSingular) } },
    });
    if (row.effectiveFrom > today) {
      const owners = await tx.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, program.id));
      await notify(tx, ctx, {
        recipients: owners.map((o) => o.userId),
        kind: 'project',
        title: `Price card v${number} for ${program.key} starts ${dayText(row.effectiveFrom)}`,
        url: routes.programTab(program.key, 'price-card'),
        projectId: program.id,
      });
    }
    await emitProgramChanged(tx, ctx, program.id);
    return { repricedRows, number };
  });
  return result;
}

/** A Scheduled version back to a draft ("Edit"). */
export async function unpublishVersion(ctx: DomainContext, versionId: string): Promise<void> {
  const { row, access } = await loadVersion(ctx, versionId, 'pricing:manage');
  const today = todayInZone(access.settings.timezone);
  if (row.status !== 'published' || row.effectiveFrom <= today) throw invalid('Only a version that starts later can go back to a draft.');
  await db.transaction(async (tx) => {
    await lockSettings(tx, [access.program.id], 'update');
    await tx.update(priceCardVersions).set({ status: 'draft', version: row.version + 1, updatedAt: new Date() }).where(eq(priceCardVersions.id, versionId));
    await refreshLedgerFor(tx, ctx, { programIds: [access.program.id], months: [monthOf(row.effectiveFrom)] });
    await logActivity(tx, ctx, { verb: 'price_card.unpublished', entityType: 'price_card_version', entityId: versionId, projectId: access.program.id, after: { number: row.number, effectiveFrom: row.effectiveFrom } });
    await emitProgramChanged(tx, ctx, access.program.id);
  });
}

/** Drafts any time; published versions only while Scheduled. */
export async function deleteVersion(ctx: DomainContext, versionId: string): Promise<void> {
  const { row, access } = await loadVersion(ctx, versionId, 'pricing:propose');
  const today = todayInZone(access.settings.timezone);
  if (row.status === 'published') {
    if (!access.caps.canPrice) throw invalid('Only program owners can remove a published version.');
    if (row.effectiveFrom <= today) throw invalid('This version is already in force. Publish a new version instead.');
  }
  await db.transaction(async (tx) => {
    await tx.update(priceCardVersions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(priceCardVersions.id, versionId));
    if (row.status === 'published') await refreshLedgerFor(tx, ctx, { programIds: [access.program.id], months: [monthOf(row.effectiveFrom)] });
    await logActivity(tx, ctx, { verb: 'price_card.version_deleted', entityType: 'price_card_version', entityId: versionId, projectId: access.program.id, before: { number: row.number, effectiveFrom: row.effectiveFrom, status: row.status } });
  });
}

// --- Pending rate changes (4.4.3) -------------------------------------------------------------------

/** Finds or makes the pending draft for a start date and sets or clears hand lines in it. */
export async function setVariantRatesIn(tx: Executor, ctx: DomainContext, access: Pick<ProgramAccess, 'program' | 'settings'>, rates: readonly { readonly variantId: string; readonly unitPrice: string | null }[], startsOn: IsoDate): Promise<{ versionId: string; pendingCount: number }> {
  await lockSettings(tx, [access.program.id], 'update');
  let [draft] = await tx
    .select()
    .from(priceCardVersions)
    .where(and(eq(priceCardVersions.programId, access.program.id), eq(priceCardVersions.status, 'draft'), eq(priceCardVersions.source, 'variant_tab'), eq(priceCardVersions.effectiveFrom, startsOn), isNull(priceCardVersions.deletedAt)));
  if (!draft) {
    const current = versionFor(await versionsFor(tx, ctx, access.program.id), startsOn);
    const content = current ? await contentOf(tx, current.id) : { lines: [], rules: [] };
    const created = await insertVersion(tx, ctx, access.program.id, { effectiveFrom: startsOn, status: 'draft', source: 'variant_tab', label: 'Rate changes', ...content });
    [draft] = await tx.select().from(priceCardVersions).where(eq(priceCardVersions.id, created.id));
  }
  const content = await contentOf(tx, draft!.id);
  let lines = [...content.lines];
  for (const rate of rates) {
    lines = lines.filter((line) => !(line.kind === 'per_unit' && line.variantId === rate.variantId));
    if (rate.unitPrice) lines.push({ kind: 'per_unit', variantId: rate.variantId, unitPrice: rate.unitPrice, prorate: true, chargeWhilePaused: true });
  }
  await writeVersionContent(tx, ctx, draft!.id, access.program.id, { lines, rules: content.rules });
  await tx.update(priceCardVersions).set({ version: draft!.version + 1, updatedAt: new Date() }).where(eq(priceCardVersions.id, draft!.id));
  // Pending count: variant hand lines that differ from the version in force.
  const current = versionFor(await versionsFor(tx, ctx, access.program.id), startsOn);
  const pendingCount = lines.filter((line) => {
    if (line.kind !== 'per_unit' || !line.variantId) return false;
    const was = current?.lines.find((l) => l.kind === 'per_unit' && l.variantId === line.variantId && !l.ruleId);
    return !was || was.unitPrice !== line.unitPrice;
  }).length + (current?.lines.filter((l) => l.kind === 'per_unit' && l.variantId && !l.ruleId && !lines.some((n) => n.variantId === l.variantId && n.kind === 'per_unit')).length ?? 0);
  await logActivity(tx, ctx, { verb: 'price_card.variant_rate_changed', entityType: 'price_card_version', entityId: draft!.id, projectId: access.program.id, after: { startsOn, variants: rates.length, money: { rates } } });
  return { versionId: draft!.id, pendingCount };
}

export async function setVariantRate(ctx: DomainContext, variantId: string, input: { readonly unitPrice: string | null; readonly startsOn?: IsoDate | null }): Promise<{ versionId: string; pendingCount: number; startsOn: IsoDate }> {
  const [variant] = await db.select().from(programVariants).where(and(eq(programVariants.id, variantId), eq(programVariants.orgId, ctx.orgId), isNull(programVariants.deletedAt)));
  if (!variant) throw notFound('That variant');
  const access = await requireProgram(ctx, { id: variant.programId }, 'pricing:propose');
  const startsOn = input.startsOn ?? todayInZone(access.settings.timezone);
  const locks = await programLocks(ctx, access.program);
  if (isLocked(locks, startsOn, { goesToJob: false })) throw locked('That start date is in a closed month. Pick a later date.');
  const result = await db.transaction((tx) => setVariantRatesIn(tx, ctx, access, [{ variantId, unitPrice: input.unitPrice }], startsOn));
  return { ...result, startsOn };
}

/** The pending draft made from the Variants tab, if any (for the sticky bar). */
export async function pendingRateChanges(executor: Executor, ctx: DomainContext, access: Pick<ProgramAccess, 'program'>): Promise<{ versionId: string; startsOn: IsoDate; count: number } | null> {
  const [draft] = await executor
    .select()
    .from(priceCardVersions)
    .where(and(eq(priceCardVersions.programId, access.program.id), eq(priceCardVersions.status, 'draft'), eq(priceCardVersions.source, 'variant_tab'), isNull(priceCardVersions.deletedAt)))
    .orderBy(asc(priceCardVersions.effectiveFrom))
    .limit(1);
  if (!draft) return null;
  const current = versionFor(await versionsFor(executor, ctx, access.program.id), draft.effectiveFrom);
  const lines = (await versionRows(executor, [draft.id])).lines.filter((line) => line.kind === 'per_unit' && line.variantId && !line.ruleId);
  const count = lines.filter((line) => current?.lines.find((l) => l.kind === 'per_unit' && l.variantId === line.variantId && !l.ruleId)?.unitPrice !== line.unitPrice).length;
  return { versionId: draft.id, startsOn: draft.effectiveFrom, count: Math.max(count, 1) };
}

// --- Review (4.4.4) ---------------------------------------------------------------------------------

export async function requestReview(ctx: DomainContext, versionId: string): Promise<void> {
  const { row, access } = await loadVersion(ctx, versionId, 'pricing:propose');
  assertDraft(row);
  await db.transaction(async (tx) => {
    await tx.update(priceCardVersions).set({ reviewStatus: 'waiting', reviewNote: null, reviewRequestedBy: ctx.userId, reviewRequestedAt: new Date(), version: row.version + 1, updatedAt: new Date() }).where(eq(priceCardVersions.id, versionId));
    const owners = await tx.select({ userId: projectMembers.userId }).from(projectMembers).where(and(eq(projectMembers.projectId, access.program.id), eq(projectMembers.role, 'owner')));
    await notify(tx, ctx, {
      recipients: owners.map((o) => o.userId),
      kind: 'project',
      title: `${ctx.userName} asked you to review a price card for ${access.program.key}`,
      url: `${routes.programTab(access.program.key, 'price-card')}?version=${versionId}`,
      projectId: access.program.id,
    });
    await logActivity(tx, ctx, { verb: 'price_card.review_requested', entityType: 'price_card_version', entityId: versionId, projectId: access.program.id, after: { effectiveFrom: row.effectiveFrom } });
  });
}

export async function sendBack(ctx: DomainContext, versionId: string, note: string): Promise<void> {
  const { row, access } = await loadVersion(ctx, versionId, 'pricing:manage');
  assertDraft(row);
  const text = note.trim();
  if (!text) throw invalid('Add a note that says what to change.', { note: 'Add a note that says what to change.' });
  await db.transaction(async (tx) => {
    await tx.update(priceCardVersions).set({ reviewStatus: 'sent_back', reviewNote: text.slice(0, 2000), version: row.version + 1, updatedAt: new Date() }).where(eq(priceCardVersions.id, versionId));
    if (row.reviewRequestedBy) {
      await notify(tx, ctx, {
        recipients: [row.reviewRequestedBy],
        kind: 'project',
        title: `${ctx.userName} sent back the ${access.program.key} price card draft`,
        body: text,
        url: `${routes.programTab(access.program.key, 'price-card')}?version=${versionId}`,
        projectId: access.program.id,
      });
    }
    await logActivity(tx, ctx, { verb: 'price_card.sent_back', entityType: 'price_card_version', entityId: versionId, projectId: access.program.id, after: { note: text } });
  });
}

/** Current (in force today) and next (Scheduled) versions, plus the drafts count. */
export async function cardOverview(executor: Executor, ctx: DomainContext, access: Pick<ProgramAccess, 'program' | 'settings' | 'caps'>): Promise<{ current: CardVersionDTO | null; next: CardVersionDTO | null; drafts: number }> {
  const today = todayInZone(access.settings.timezone);
  const rows = await executor.select().from(priceCardVersions).where(and(eq(priceCardVersions.programId, access.program.id), isNull(priceCardVersions.deletedAt)));
  const published = rows.filter((r) => r.status === 'published').sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const current = [...published].reverse().find((r) => r.effectiveFrom <= today) ?? null;
  const next = published.find((r) => r.effectiveFrom > today) ?? null;
  const dtos = await toVersionDTOs(executor, ctx, access, [current, next].filter((r): r is PriceCardVersion => Boolean(r)));
  return { current: current ? (dtos.find((d) => d.id === current.id) ?? null) : null, next: next ? (dtos.find((d) => d.id === next.id) ?? null) : null, drafts: rows.filter((r) => r.status === 'draft').length };
}

