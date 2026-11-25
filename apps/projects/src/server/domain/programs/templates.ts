/**
 * Program templates (docs/programs/SPEC.md 4.1 `templates.ts`, 4.5 `ProgramTemplatePayload`):
 * a program's setup without dates, opened by the program wizard. Stored in `pm.templates` with
 * `kind = 'program'` (the project gallery lists `project` templates only).
 */
import 'server-only';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { versionFor } from '@kitstak/programs-engine/price';
import { daysBetween } from '@kitstak/programs-engine/calendar';
import { db } from '@/server/db';
import { buildScheduleLines, buildSchedules, programAttributes, programOneTimeCharges, programVariants, templates } from '@/server/db/schema';
import { invalid } from '@/server/errors';
import { programTemplatePayloadSchema, type ProgramTemplateDTO, type ProgramTemplatePayload } from '@/lib/program-types';
import type { TemplatePayload } from '@/lib/template-types';
import type { DomainContext } from '../_shared';
import { requireOrg } from '../access';
import { logActivity } from '../activity';
import { todayInZone } from './_program';
import { requireProgram } from './access';
import { versionsFor } from './pricing';

export async function saveProgramTemplate(ctx: DomainContext, key: string, input: { readonly name: string; readonly description?: string | null }): Promise<{ templateId: string }> {
  requireOrg(ctx, 'template:manage');
  const access = await requireProgram(ctx, key);
  const { program, settings } = access;
  const name = input.name.trim();
  if (!name) throw invalid('Give the template a name.', { name: 'Give the template a name.' });
  const today = todayInZone(settings.timezone);
  const [axes, variants, versions, schedules, oneTime] = await Promise.all([
    db.select().from(programAttributes).where(and(eq(programAttributes.programId, program.id), isNull(programAttributes.deletedAt))).orderBy(sql`${programAttributes.position} COLLATE "C"`),
    db.select().from(programVariants).where(and(eq(programVariants.programId, program.id), isNull(programVariants.deletedAt), eq(programVariants.status, 'active'))).orderBy(sql`${programVariants.position} COLLATE "C"`),
    versionsFor(db, ctx, program.id),
    db.select().from(buildSchedules).where(and(eq(buildSchedules.programId, program.id), isNull(buildSchedules.deletedAt))).orderBy(asc(buildSchedules.createdAt)),
    db.select().from(programOneTimeCharges).where(and(eq(programOneTimeCharges.programId, program.id), eq(programOneTimeCharges.kind, 'setup'), isNull(programOneTimeCharges.deletedAt))),
  ]);
  const keyOf = new Map(variants.map((v) => [v.id, v.key]));
  const card = access.caps.seesMoney ? versionFor(versions, today) : null;
  const start = program.startDate ?? today;
  const scheduleRows = [];
  for (const schedule of schedules.slice(0, 10)) {
    const lines = await db.select().from(buildScheduleLines).where(eq(buildScheduleLines.scheduleId, schedule.id)).orderBy(asc(buildScheduleLines.position));
    scheduleRows.push({
      name: schedule.name,
      pattern: schedule.pattern,
      days: schedule.days ?? [],
      intervalWeeks: schedule.intervalWeeks,
      startOffsetDays: Math.max(0, daysBetween(start, schedule.startsOn)),
      endOffsetDays: schedule.endsOn ? Math.max(0, daysBetween(start, schedule.endsOn)) : null,
      leadDays: schedule.leadDays,
      lines: lines.map((l) => ({ variantKey: keyOf.get(l.variantId) ?? '', qty: l.qty, qtyByWeekday: l.qtyByWeekday ?? null })).filter((l) => l.variantKey),
    });
  }
  const payload: ProgramTemplatePayload = {
    kind: 'program',
    version: 1,
    settings: {
      unitSingular: settings.unitSingular,
      unitPlural: settings.unitPlural,
      buildTitlePattern: settings.buildTitlePattern,
      autoStartOnOutput: settings.autoStartOnOutput,
      autoDoneWhenFull: settings.autoDoneWhenFull,
      moneyMinRole: settings.moneyMinRole,
      hourlyTimeBasis: settings.hourlyTimeBasis,
      remindAt: settings.remindAt ? settings.remindAt.slice(0, 5) : null,
      workingDays: settings.workingDays ?? null,
    },
    attributes: axes.map((axis) => ({ id: axis.id, name: axis.name, values: axis.values.map((v) => ({ id: v.id, label: v.label, code: v.code, color: v.color })) })),
    variants: variants.map((v) => ({ key: v.key, name: v.name, sku: v.sku, attributes: v.attributes, defaultQty: v.defaultQty, packQty: v.packQty, stdMinutesPerUnit: v.stdMinutesPerUnit })),
    card: card
      ? {
          lines: card.lines.filter((l) => !l.ruleId).map((l) => ({ kind: l.kind, variantKey: l.variantId ? (keyOf.get(l.variantId) ?? null) : null, unitPrice: l.unitPrice, rateCents: l.rateCents, amountCents: l.amountCents, prorate: l.prorate, chargeWhilePaused: l.chargeWhilePaused, label: l.label })),
          rules: card.rules.map((r) => ({ attributeId: r.attributeId, valueId: r.valueId, op: r.op, amount: r.amount })),
        }
      : null,
    oneTime: access.caps.seesMoney ? oneTime.map((o) => ({ label: o.label, amountCents: o.amountCents.toString(), offsetDays: Math.max(0, daysBetween(start, o.chargeOn)) })) : [],
    schedules: scheduleRows,
  };
  programTemplatePayloadSchema.parse(payload);
  const [row] = await db
    .insert(templates)
    .values({ orgId: ctx.orgId, kind: 'program', name: name.slice(0, 120), description: input.description?.trim() || null, category: 'Programs', icon: 'repeat', color: program.color, payload: payload as unknown as TemplatePayload, sourceProjectId: program.id, createdBy: ctx.userId })
    .returning();
  await db.transaction((tx) => logActivity(tx, ctx, { verb: 'program.updated', entityType: 'project', entityId: program.id, projectId: program.id, field: 'template', after: { templateId: row!.id, name } }));
  return { templateId: row!.id };
}

export async function listProgramTemplates(ctx: DomainContext): Promise<ProgramTemplateDTO[]> {
  const rows = await db.select().from(templates).where(and(eq(templates.orgId, ctx.orgId), eq(templates.kind, 'program'), isNull(templates.deletedAt))).orderBy(desc(templates.updatedAt));
  return rows.flatMap((row) => {
    const parsed = programTemplatePayloadSchema.safeParse(row.payload);
    return parsed.success ? [{ id: row.id, name: row.name, description: row.description, payload: parsed.data, updatedAt: row.updatedAt.toISOString() }] : [];
  });
}
