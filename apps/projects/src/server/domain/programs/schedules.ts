/**
 * Build schedules (docs/programs/SPEC.md D8, 4.2 `schedules.ts`, 4.9 step 1). A schedule makes
 * builds ahead of time: for every occurrence in the generation window, one build per line, with
 * the unique occurrence key plus a savepoint per occurrence, so parallel sweeps never double make
 * builds and a deleted generated build never comes back.
 */
import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { addDays, maxDate } from '@kitstak/programs-engine/calendar';
import { describeRule, generationWindow, nextOccurrence, occurrences, qtyFor, type ScheduleRule } from '@kitstak/programs-engine/schedule';
import { fromScaled, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { db, type Executor } from '@/server/db';
import { buildScheduleLines, buildSchedules, programVariants, type BuildSchedule, type Project, type ProgramSettingsRow } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { IsoDate, ScheduleDTO, ScheduleInput, SchedulePreviewDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { logActivity } from '../activity';
import { projectStatuses } from '../tasks';
import { calendarFor, pgError, todayInZone, versionConflict } from './_program';
import { requireProgram } from './access';
import { insertBuild, notifyGenerated, type BuildContainer } from './builds';

type LineInput = ScheduleInput['lines'][number];

function ruleOf(row: Pick<BuildSchedule, 'pattern' | 'days' | 'intervalWeeks' | 'startsOn' | 'endsOn' | 'skipHolidays' | 'skipDates'>): ScheduleRule {
  return { pattern: row.pattern, days: row.days ?? [], intervalWeeks: row.intervalWeeks, startsOn: row.startsOn, endsOn: row.endsOn, skipHolidays: row.skipHolidays, skipDates: row.skipDates ?? [] };
}

export async function toScheduleDTOs(executor: Executor, ctx: DomainContext, program: Project, settings: ProgramSettingsRow, rows: readonly BuildSchedule[]): Promise<ScheduleDTO[]> {
  if (rows.length === 0) return [];
  const calendar = await calendarFor(executor, ctx, program, settings);
  const today = todayInZone(settings.timezone);
  const list = sql.join(rows.map((row) => sql`${row.id}::uuid`), sql`, `);
  const lines = await executor
    .select({ line: buildScheduleLines, variantName: programVariants.name })
    .from(buildScheduleLines)
    .innerJoin(programVariants, eq(programVariants.id, buildScheduleLines.variantId))
    .where(sql`${buildScheduleLines.scheduleId} in (${list})`)
    .orderBy(asc(buildScheduleLines.position));
  return rows.map((row) => {
    const mine = lines.filter((l) => l.line.scheduleId === row.id);
    const units = mine.reduce((sum, l) => sum + quantityToScaled(l.line.qty), ZERO);
    const unit = units === BigInt(1000) ? settings.unitSingular : settings.unitPlural;
    const rule = ruleOf(row);
    return {
      id: row.id,
      programId: row.programId,
      name: row.name,
      status: row.status,
      pattern: row.pattern,
      days: row.days ?? [],
      intervalWeeks: row.intervalWeeks,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      leadDays: row.leadDays,
      skipHolidays: row.skipHolidays,
      skipDates: row.skipDates ?? [],
      defaultAssigneeId: row.defaultAssigneeId,
      defaultStatusId: row.defaultStatusId,
      generatedThrough: row.generatedThrough,
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      text: `${describeRule(rule, calendar)} · ${fromScaled(units, 3).replace(/\.?0+$/, '')} ${unit}`,
      nextDate: row.status === 'active' ? nextOccurrence(rule, calendar, addDays(today, -1)) : null,
      lines: mine.map((l) => ({ id: l.line.id, variantId: l.line.variantId, variantName: l.variantName, qty: l.line.qty, qtyByWeekday: l.line.qtyByWeekday ?? null, assigneeId: l.line.assigneeId, position: l.line.position })),
      version: row.version,
    };
  });
}

export async function listSchedules(ctx: DomainContext, key: string): Promise<ScheduleDTO[]> {
  const { program, settings } = await requireProgram(ctx, key);
  const rows = await db.select().from(buildSchedules).where(and(eq(buildSchedules.programId, program.id), isNull(buildSchedules.deletedAt))).orderBy(asc(buildSchedules.createdAt));
  return toScheduleDTOs(db, ctx, program, settings, rows);
}

async function resolveLines(tx: Executor, programId: string, lines: readonly LineInput[]): Promise<{ variantId: string; qty: string; qtyByWeekday: Record<string, string> | null; assigneeId: string | null }[]> {
  const variants = await tx.select().from(programVariants).where(and(eq(programVariants.programId, programId), isNull(programVariants.deletedAt)));
  const seen = new Set<string>();
  return lines.map((line) => {
    const variant = variants.find((v) => (line.variantId && v.id === line.variantId) || (line.variantKey && v.key === line.variantKey.toUpperCase()));
    if (!variant) throw invalid(`The schedule names a variant that is not in this program${line.variantKey ? ` (${line.variantKey})` : ''}.`);
    if (seen.has(variant.id)) throw invalid(`${variant.name} is in the schedule twice. Keep one line.`);
    seen.add(variant.id);
    return { variantId: variant.id, qty: line.qty, qtyByWeekday: line.qtyByWeekday ?? null, assigneeId: line.assigneeId ?? null };
  });
}

function assertRule(input: Pick<ScheduleInput, 'pattern' | 'days' | 'startsOn' | 'endsOn'>): void {
  if ((input.pattern === 'custom_days' || input.pattern === 'every_n_weeks') && input.days.length === 0) throw invalid('Pick at least one day.', { days: 'Pick at least one day.' });
  if (input.endsOn && input.endsOn < input.startsOn) throw invalid('The end date has to be on or after the start date.', { endsOn: 'End is before the start.' });
}

/** Inserts a schedule and its lines in `tx` (wizard, copy, templates). */
export async function insertSchedule(tx: Executor, ctx: DomainContext, programId: string, input: ScheduleInput): Promise<BuildSchedule> {
  assertRule(input);
  const lines = await resolveLines(tx, programId, input.lines);
  const [row] = await tx
    .insert(buildSchedules)
    .values({
      orgId: ctx.orgId,
      programId,
      name: input.name.trim(),
      pattern: input.pattern,
      days: [...input.days],
      intervalWeeks: input.intervalWeeks,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      leadDays: input.leadDays,
      skipHolidays: input.skipHolidays,
      skipDates: [...input.skipDates],
      defaultAssigneeId: input.defaultAssigneeId ?? null,
      defaultStatusId: input.defaultStatusId ?? null,
      createdBy: ctx.actorKind === 'user' ? ctx.userId : null,
    })
    .returning();
  await tx.insert(buildScheduleLines).values(lines.map((line, index) => ({ orgId: ctx.orgId, scheduleId: row!.id, variantId: line.variantId, qty: line.qty, qtyByWeekday: line.qtyByWeekday, assigneeId: line.assigneeId, position: index })));
  await logActivity(tx, ctx, { verb: 'schedule.created', entityType: 'schedule', entityId: row!.id, projectId: programId, after: { name: row!.name, pattern: row!.pattern, lines: lines.length } });
  return row!;
}

export async function createSchedule(ctx: DomainContext, key: string, input: ScheduleInput): Promise<ScheduleDTO> {
  const { program, settings } = await requireProgram(ctx, key, 'schedule:manage');
  const row = await db.transaction((tx) => insertSchedule(tx, ctx, program.id, input));
  await generateForSchedule(ctx, program, settings, row.id);
  const [fresh] = await db.select().from(buildSchedules).where(eq(buildSchedules.id, row.id));
  const [dto] = await toScheduleDTOs(db, ctx, program, settings, [fresh!]);
  return dto!;
}

async function loadSchedule(ctx: DomainContext, id: string) {
  const [row] = await db.select().from(buildSchedules).where(and(eq(buildSchedules.id, id), eq(buildSchedules.orgId, ctx.orgId), isNull(buildSchedules.deletedAt)));
  if (!row) throw notFound('That schedule');
  const access = await requireProgram(ctx, { id: row.programId }, 'schedule:manage');
  return { row, ...access };
}

/** Removes generated builds dated after today that are untouched (no output, time or comments, still to do). */
async function removeUntouchedFuture(tx: Executor, ctx: DomainContext, scheduleId: string, after: IsoDate): Promise<number> {
  const result = await tx.execute(
    sql`with gone as (
          select b.task_id from pm.builds b join pm.tasks t on t.id = b.task_id join pm.statuses s on s.id = t.status_id
           where b.schedule_id = ${scheduleId}::uuid and b.build_date > ${after}::date and t.deleted_at is null and s.category = 'todo'
             and b.built_qty = 0
             and not exists (select 1 from pm.build_output o where o.build_id = b.task_id)
             and not exists (select 1 from pm.time_entries te where te.task_id = b.task_id and te.deleted_at is null)
             and not exists (select 1 from pm.comments c where c.task_id = b.task_id and c.deleted_at is null))
        , freed as (update pm.builds set schedule_id = null, schedule_date = null, occurrence_variant_id = null where task_id in (select task_id from gone) returning task_id)
        update pm.tasks set deleted_at = now(), updated_at = now() where id in (select task_id from freed) returning id`,
  );
  return (result as unknown as { rows: unknown[] }).rows.length;
}

export async function updateSchedule(ctx: DomainContext, id: string, patch: Partial<ScheduleInput>, expectedVersion: number, options: { readonly regenerateFuture?: boolean } = {}): Promise<ScheduleDTO> {
  const { row, program, settings } = await loadSchedule(ctx, id);
  if (row.version !== expectedVersion) throw versionConflict();
  const today = todayInZone(settings.timezone);
  const merged = {
    pattern: patch.pattern ?? row.pattern,
    days: patch.days ?? row.days ?? [],
    startsOn: patch.startsOn ?? row.startsOn,
    endsOn: patch.endsOn !== undefined ? (patch.endsOn ?? null) : row.endsOn,
  };
  assertRule(merged);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(buildSchedules)
      .set({
        name: patch.name?.trim() ?? row.name,
        pattern: merged.pattern,
        days: [...merged.days],
        intervalWeeks: patch.intervalWeeks ?? row.intervalWeeks,
        startsOn: merged.startsOn,
        endsOn: merged.endsOn,
        leadDays: patch.leadDays ?? row.leadDays,
        skipHolidays: patch.skipHolidays ?? row.skipHolidays,
        skipDates: patch.skipDates ? [...patch.skipDates] : row.skipDates,
        defaultAssigneeId: patch.defaultAssigneeId !== undefined ? patch.defaultAssigneeId : row.defaultAssigneeId,
        defaultStatusId: patch.defaultStatusId !== undefined ? patch.defaultStatusId : row.defaultStatusId,
        generatedThrough: options.regenerateFuture ? (row.generatedThrough && row.generatedThrough > today ? today : row.generatedThrough) : row.generatedThrough,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(buildSchedules.id, id), eq(buildSchedules.version, expectedVersion)))
      .returning();
    if (updated.length === 0) throw versionConflict();
    if (patch.lines) {
      const lines = await resolveLines(tx, program.id, patch.lines);
      await tx.delete(buildScheduleLines).where(eq(buildScheduleLines.scheduleId, id));
      await tx.insert(buildScheduleLines).values(lines.map((line, index) => ({ orgId: ctx.orgId, scheduleId: id, variantId: line.variantId, qty: line.qty, qtyByWeekday: line.qtyByWeekday, assigneeId: line.assigneeId, position: index })));
    }
    let removed = 0;
    if (options.regenerateFuture) removed = await removeUntouchedFuture(tx, ctx, id, today);
    await logActivity(tx, ctx, { verb: 'schedule.updated', entityType: 'schedule', entityId: id, projectId: program.id, after: { name: updated[0]!.name, regenerated: Boolean(options.regenerateFuture), removed } });
  });
  if (options.regenerateFuture) await generateForSchedule(ctx, program, settings, id);
  const [fresh] = await db.select().from(buildSchedules).where(eq(buildSchedules.id, id));
  const [dto] = await toScheduleDTOs(db, ctx, program, settings, [fresh!]);
  return dto!;
}

async function setStatus(ctx: DomainContext, id: string, status: 'active' | 'paused' | 'ended', extra: Partial<typeof buildSchedules.$inferInsert> = {}, verb = 'schedule.updated'): Promise<ScheduleDTO> {
  const { row, program, settings } = await loadSchedule(ctx, id);
  await db.transaction(async (tx) => {
    await tx.update(buildSchedules).set({ status, ...extra, version: row.version + 1, updatedAt: new Date() }).where(eq(buildSchedules.id, id));
    await logActivity(tx, ctx, { verb, entityType: 'schedule', entityId: id, projectId: program.id, after: { name: row.name, status, ...('endsOn' in extra ? { endsOn: extra.endsOn } : {}) } });
  });
  if (status === 'active') await generateForSchedule(ctx, program, settings, id);
  const [fresh] = await db.select().from(buildSchedules).where(eq(buildSchedules.id, id));
  const [dto] = await toScheduleDTOs(db, ctx, program, settings, [fresh!]);
  return dto!;
}

export const pauseSchedule = (ctx: DomainContext, id: string) => setStatus(ctx, id, 'paused', {}, 'schedule.paused');
export const resumeSchedule = (ctx: DomainContext, id: string) => setStatus(ctx, id, 'active', {}, 'schedule.resumed');
export async function endSchedule(ctx: DomainContext, id: string, input: { readonly endsOn: IsoDate }): Promise<ScheduleDTO> {
  return setStatus(ctx, id, 'ended', { endsOn: input.endsOn }, 'schedule.ended');
}

/** Skips one date of a schedule; an untouched build already made for it is removed. */
export async function skipDate(ctx: DomainContext, id: string, date: IsoDate): Promise<ScheduleDTO> {
  const { row, program, settings } = await loadSchedule(ctx, id);
  await db.transaction(async (tx) => {
    const dates = [...new Set([...(row.skipDates ?? []), date])].sort();
    await tx.update(buildSchedules).set({ skipDates: dates, version: row.version + 1, updatedAt: new Date() }).where(eq(buildSchedules.id, id));
    await removeUntouchedFuture(tx, ctx, id, addDays(date, -1)).then(async () => undefined);
    await logActivity(tx, ctx, { verb: 'schedule.updated', entityType: 'schedule', entityId: id, projectId: program.id, after: { skipped: date } });
  });
  await generateForSchedule(ctx, program, settings, id);
  const [fresh] = await db.select().from(buildSchedules).where(eq(buildSchedules.id, id));
  const [dto] = await toScheduleDTOs(db, ctx, program, settings, [fresh!]);
  return dto!;
}

/** Read only: the dates and units a rule would make. */
export async function previewSchedule(ctx: DomainContext, key: string, input: ScheduleInput, range: { readonly from: IsoDate; readonly to: IsoDate }): Promise<SchedulePreviewDTO> {
  const { program, settings } = await requireProgram(ctx, key);
  const calendar = await calendarFor(db, ctx, program, settings);
  const rule: ScheduleRule = { pattern: input.pattern, days: input.days, intervalWeeks: input.intervalWeeks, startsOn: input.startsOn, endsOn: input.endsOn ?? null, skipHolidays: input.skipHolidays, skipDates: input.skipDates };
  const to = range.to > addDays(range.from, 92) ? addDays(range.from, 92) : range.to;
  const dates = occurrences(rule, calendar, maxDate(range.from, input.startsOn), to);
  let units = ZERO;
  for (const date of dates) for (const line of input.lines) units += quantityToScaled(qtyFor({ variantId: line.variantId ?? '', qty: line.qty, qtyByWeekday: line.qtyByWeekday ?? null }, date));
  return { dates, builds: dates.length * input.lines.length, units: fromScaled(units, 3), text: describeRule(rule, calendar) };
}

/**
 * Generation (4.9 step 1) for one schedule. Idempotent: occurrences already made (or skipped by
 * the unique occurrence key) are not made again. Returns the builds made.
 */
export async function generateForSchedule(ctx: DomainContext, program: Project, settings: ProgramSettingsRow, scheduleId: string): Promise<{ builds: number; units: string; through: IsoDate | null }> {
  const system: DomainContext = { ...ctx, actorKind: ctx.actorKind === 'user' ? ctx.actorKind : 'system' };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(buildSchedules).where(eq(buildSchedules.id, scheduleId)).for('update');
    if (!row || row.deletedAt || row.status !== 'active') return { builds: 0, units: '0.000', through: row?.generatedThrough ?? null };
    if (program.status === 'completed' || program.status === 'archived' || program.status === 'on_hold' || program.archivedAt) return { builds: 0, units: '0.000', through: row.generatedThrough };
    const today = todayInZone(settings.timezone);
    const window = generationWindow({ asOf: today, leadDays: row.leadDays, generatedThrough: row.generatedThrough, startsOn: row.startsOn, endsOn: row.endsOn });
    await tx.update(buildSchedules).set({ lastRunAt: new Date() }).where(eq(buildSchedules.id, scheduleId));
    if (!window) return { builds: 0, units: '0.000', through: row.generatedThrough };
    const calendar = await calendarFor(tx, ctx, program, settings);
    const dates = occurrences(ruleOf(row), calendar, window.from, window.to);
    const lines = await tx.select().from(buildScheduleLines).where(eq(buildScheduleLines.scheduleId, scheduleId)).orderBy(asc(buildScheduleLines.position));
    const statusList = await projectStatuses(tx, program.id);
    const container: BuildContainer = { project: program, settings, programId: program.id, seesMoney: true, timezone: settings.timezone };
    let made = 0;
    let units = ZERO;
    const byAssignee = new Map<string, number>();
    const runCounts = new Map<IsoDate, number>();
    for (const date of dates) {
      for (const line of lines) {
        const qty = qtyFor({ variantId: line.variantId, qty: line.qty, qtyByWeekday: line.qtyByWeekday ?? null }, date);
        if (quantityToScaled(qty) <= ZERO) continue;
        const assigneeId = line.assigneeId ?? row.defaultAssigneeId ?? null;
        try {
          await tx.transaction(async (sp) => {
            await insertBuild(
              sp,
              system,
              container,
              { variantId: line.variantId, buildDate: date, plannedQty: qty, assigneeId, statusId: row.defaultStatusId ?? null, plannedFrom: 'schedule', scheduleId, scheduleDate: date },
              { statusList, quiet: true, logVerb: 'task.created' },
            );
          });
          made += 1;
          units += quantityToScaled(qty);
          runCounts.set(date, (runCounts.get(date) ?? 0) + 1);
          if (assigneeId) byAssignee.set(assigneeId, (byAssignee.get(assigneeId) ?? 0) + 1);
        } catch (error) {
          // The occurrence was made before (or by a parallel sweep): skip it.
          if (pgError(error)?.code !== '23505') throw error;
        }
      }
    }
    await tx.update(buildSchedules).set({ generatedThrough: window.to, lastRunAt: new Date() }).where(eq(buildSchedules.id, scheduleId));
    if (made > 0) {
      await logActivity(
        tx,
        { ...ctx, actorKind: 'system' },
        [...runCounts.entries()].map(([date, count]) => ({ verb: 'schedule.generated', entityType: 'schedule', entityId: scheduleId, projectId: program.id, after: { dates: [date], count, name: row.name } })),
      );
      await notifyGenerated(tx, ctx, container, byAssignee);
    }
    return { builds: made, units: fromScaled(units, 3), through: window.to };
  });
}

/** Generation for every active schedule of one program or of the org (the sweep, Run now). */
export async function runScheduleGeneration(ctx: DomainContext, options: { readonly programId?: string } = {}): Promise<{ builds: number; units: string; through: IsoDate | null }> {
  const where = options.programId
    ? and(eq(buildSchedules.orgId, ctx.orgId), eq(buildSchedules.programId, options.programId), eq(buildSchedules.status, 'active'), isNull(buildSchedules.deletedAt))
    : and(eq(buildSchedules.orgId, ctx.orgId), eq(buildSchedules.status, 'active'), isNull(buildSchedules.deletedAt));
  const rows = await db.select({ id: buildSchedules.id, programId: buildSchedules.programId }).from(buildSchedules).where(where);
  let builds = 0;
  let units = ZERO;
  let through: IsoDate | null = null;
  for (const row of rows) {
    const access = await requireProgram({ ...ctx, actorKind: ctx.actorKind === 'user' ? ctx.actorKind : 'system' }, { id: row.programId }).catch(() => null);
    if (!access) continue;
    const result = await generateForSchedule(ctx, access.program, access.settings, row.id);
    builds += result.builds;
    units += quantityToScaled(result.units);
    if (result.through && (!through || result.through > through)) through = result.through;
  }
  return { builds, units: fromScaled(units, 3), through };
}
