/**
 * Wizard prefill (docs/programs/SPEC.md 4.2 `prefill.ts`, D10): a partial `ProgramWizardPayload`
 * from a CRM deal (facts plus engine `dealPrefill`), a program template, a copy of a program, or
 * a customer. Every path returns a full payload the wizard can edit.
 */
import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { dealPrefill } from '@kitstak/programs-engine/deal';
import { suggestProjectKey } from '@/lib/task-key';
import { versionFor } from '@kitstak/programs-engine/price';
import { addDays } from '@kitstak/programs-engine/calendar';
import { db } from '@/server/db';
import { buildScheduleLines, buildSchedules, programAttributes, programVariants, projectMembers, templates } from '@/server/db/schema';
import { notFound } from '@/server/errors';
import { dealFactsFor } from '@/server/integrations/crm';
import { programTemplatePayloadSchema, type ProgramWizardPayload } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { takenProjectKeys } from '../projects';
import { loadOrgCalendar, todayInZone } from './_program';
import { requireProgram } from './access';
import { versionsFor } from './pricing';

export function emptyPayload(input: { readonly ownerId: string; readonly timezone: string; readonly today: string }): ProgramWizardPayload {
  return {
    start: { mode: 'scratch' },
    basics: {
      name: '',
      key: '',
      customer: null,
      ownerId: input.ownerId,
      startDate: input.today,
      endDate: null,
      unit: { singular: 'kit', plural: 'kits' },
      timezone: input.timezone,
      calendar: { useWorkspace: true, workingDays: null, extraDaysOff: [], extraWorkDays: [] },
      monthlyTargetCents: null,
    },
    variants: { mode: 'matrix', axes: [], patterns: { name: '', key: '', sku: null }, rows: [], manual: [] },
    priceCard: { later: false, effectiveFrom: input.today, lines: [], rules: [], oneTime: [] },
    schedule: { enabled: false, name: '', pattern: 'weekdays', days: [], intervalWeeks: 1, startsOn: input.today, endsOn: null, leadDays: 7, lines: [] },
    links: { crmDealId: null, crmAccountId: null, pulseJobId: null, projectIds: [], members: [] },
  };
}

export async function wizardPrefill(ctx: DomainContext, input: { readonly crmItemId?: string; readonly templateId?: string; readonly copyKey?: string; readonly customerId?: string }): Promise<ProgramWizardPayload> {
  const org = await loadOrgCalendar(db, ctx.orgId);
  const today = todayInZone(org.timezone);
  const base = emptyPayload({ ownerId: ctx.userId, timezone: org.timezone, today });
  const taken = await takenProjectKeys(ctx);
  if (input.copyKey) {
    const access = await requireProgram(ctx, input.copyKey);
    const { program, settings } = access;
    const [axes, variants, versions, schedules, members] = await Promise.all([
      db.select().from(programAttributes).where(and(eq(programAttributes.programId, program.id), isNull(programAttributes.deletedAt))).orderBy(sql`${programAttributes.position} COLLATE "C"`),
      db.select().from(programVariants).where(and(eq(programVariants.programId, program.id), isNull(programVariants.deletedAt), eq(programVariants.status, 'active'))).orderBy(sql`${programVariants.position} COLLATE "C"`),
      versionsFor(db, ctx, program.id),
      db.select().from(buildSchedules).where(and(eq(buildSchedules.programId, program.id), isNull(buildSchedules.deletedAt))).orderBy(asc(buildSchedules.createdAt)),
      db.select().from(projectMembers).where(eq(projectMembers.projectId, program.id)),
    ]);
    const card = access.caps.seesMoney ? versionFor(versions, today) : null;
    const keyOf = new Map(variants.map((v) => [v.id, v.key]));
    const combo = (attrs: Record<string, string>) => axes.map((axis) => `${axis.id}=${attrs[axis.id] ?? ''}`).join('|');
    const schedule = schedules[0];
    const scheduleLines = schedule ? await db.select().from(buildScheduleLines).where(eq(buildScheduleLines.scheduleId, schedule.id)).orderBy(asc(buildScheduleLines.position)) : [];
    return {
      ...base,
      start: { mode: 'copy', copyKey: program.key },
      basics: {
        ...base.basics,
        name: `${program.name} copy`,
        key: suggestProjectKey(`${program.name} copy`, taken),
        description: program.description ?? undefined,
        customer: program.crmCustomerId ? { kind: 'core', id: program.crmCustomerId } : null,
        unit: { singular: settings.unitSingular, plural: settings.unitPlural },
        timezone: settings.timezone,
        calendar: { useWorkspace: settings.workingDays === null, workingDays: settings.workingDays ?? null, extraDaysOff: [], extraWorkDays: [] },
        color: program.color,
        icon: program.icon,
        monthlyTargetCents: access.caps.seesMoney && settings.monthlyTargetCents !== null ? settings.monthlyTargetCents.toString() : null,
      },
      variants: {
        mode: axes.length > 0 ? 'matrix' : 'list',
        axes: axes.map((axis) => ({ id: axis.id, name: axis.name, values: axis.values.map((v) => ({ id: v.id, label: v.label, code: v.code, color: v.color })) })),
        patterns: { name: '', key: '', sku: null },
        rows: axes.length > 0 ? variants.map((v) => ({ comboKey: combo(v.attributes), include: true, name: v.name, key: v.key, sku: v.sku, defaultQty: v.defaultQty, unitPrice: null, coreItemId: v.coreItemId })) : [],
        manual: axes.length > 0 ? [] : variants.map((v) => ({ name: v.name, key: v.key, sku: v.sku, defaultQty: v.defaultQty, unitPrice: null })),
      },
      priceCard: card
        ? {
            later: false,
            effectiveFrom: today,
            lines: card.lines.filter((l) => !l.ruleId).map((l) => ({ kind: l.kind, variantKey: l.variantId ? (keyOf.get(l.variantId) ?? null) : null, unitPrice: l.unitPrice, rateCents: l.rateCents, amountCents: l.amountCents, prorate: l.prorate, chargeWhilePaused: l.chargeWhilePaused, label: l.label })).filter((l) => l.variantKey !== null || !card.lines.find((x) => x.kind === l.kind && x.variantId)),
            rules: card.rules.map((r) => ({ attributeId: r.attributeId, valueId: r.valueId, op: r.op, amount: r.amount })),
            oneTime: [],
          }
        : { ...base.priceCard, later: !access.caps.seesMoney },
      schedule: schedule
        ? { enabled: true, name: schedule.name, pattern: schedule.pattern, days: schedule.days ?? [], intervalWeeks: schedule.intervalWeeks, startsOn: today, endsOn: null, leadDays: schedule.leadDays, lines: scheduleLines.map((l) => ({ variantKey: keyOf.get(l.variantId) ?? '', qty: l.qty, qtyByWeekday: l.qtyByWeekday ?? null, assigneeId: l.assigneeId })).filter((l) => l.variantKey) }
        : base.schedule,
      links: { ...base.links, members: members.filter((m) => m.userId !== ctx.userId).map((m) => ({ userId: m.userId, role: m.role })) },
    };
  }
  if (input.templateId) {
    const [row] = await db.select().from(templates).where(and(eq(templates.id, input.templateId), eq(templates.orgId, ctx.orgId), eq(templates.kind, 'program'), isNull(templates.deletedAt)));
    if (!row) throw notFound('That template');
    const parsed = programTemplatePayloadSchema.safeParse(row.payload);
    if (!parsed.success) throw notFound('That template');
    const t = parsed.data;
    return {
      ...base,
      start: { mode: 'template', templateId: row.id },
      basics: { ...base.basics, name: row.name, key: suggestProjectKey(row.name, taken), unit: { singular: t.settings.unitSingular, plural: t.settings.unitPlural }, calendar: { ...base.basics.calendar, useWorkspace: t.settings.workingDays === null, workingDays: t.settings.workingDays } },
      variants: {
        mode: t.attributes.length > 0 ? 'matrix' : 'list',
        axes: t.attributes,
        patterns: { name: '', key: '', sku: null },
        rows: t.attributes.length > 0 ? t.variants.map((v) => ({ comboKey: t.attributes.map((a) => `${a.id ?? a.name}=${v.attributes[a.id ?? a.name] ?? v.attributes[a.name] ?? ''}`).join('|'), include: true, name: v.name, key: v.key, sku: v.sku, defaultQty: v.defaultQty, unitPrice: null })) : [],
        manual: t.attributes.length > 0 ? [] : t.variants.map((v) => ({ name: v.name, key: v.key, sku: v.sku, defaultQty: v.defaultQty, unitPrice: null })),
      },
      priceCard: t.card ? { later: false, effectiveFrom: today, lines: t.card.lines, rules: t.card.rules, oneTime: t.oneTime.map((o) => ({ label: o.label, amountCents: o.amountCents, chargeOn: addDays(today, o.offsetDays) })) } : base.priceCard,
      schedule: t.schedules[0]
        ? { enabled: true, name: t.schedules[0].name, pattern: t.schedules[0].pattern, days: t.schedules[0].days, intervalWeeks: t.schedules[0].intervalWeeks, startsOn: addDays(today, t.schedules[0].startOffsetDays), endsOn: t.schedules[0].endOffsetDays === null ? null : addDays(today, t.schedules[0].endOffsetDays), leadDays: t.schedules[0].leadDays, lines: t.schedules[0].lines }
        : base.schedule,
    };
  }
  if (input.crmItemId) {
    const facts = await dealFactsFor(ctx, input.crmItemId);
    if (!facts) return { ...base, start: { mode: 'deal', crmItemId: input.crmItemId }, links: { ...base.links, crmDealId: input.crmItemId } };
    const prefill = dealPrefill({ deal: { currency: facts.currency, valueCents: facts.valueCents, rates: facts.rates }, programCurrency: 'USD' });
    const rates = prefill.rates;
    const lines: ProgramWizardPayload['priceCard']['lines'] = [];
    if (rates?.unitPrice) lines.push({ kind: 'per_unit', variantKey: null, unitPrice: String(rates.unitPrice) });
    if (rates?.monthlyFeeCents) lines.push({ kind: 'flat_monthly', amountCents: String(rates.monthlyFeeCents), prorate: true, chargeWhilePaused: true });
    if (rates?.monthlyMinimumCents) lines.push({ kind: 'monthly_minimum', amountCents: String(rates.monthlyMinimumCents), prorate: true, chargeWhilePaused: true });
    const start = facts.closeDate && facts.closeDate > today ? facts.closeDate : today;
    return {
      ...base,
      start: { mode: 'deal', crmItemId: input.crmItemId },
      basics: {
        ...base.basics,
        name: facts.name,
        key: suggestProjectKey(facts.accountName ?? facts.name, taken),
        customer: facts.coreCustomerId ? { kind: 'core', id: facts.coreCustomerId } : facts.accountItemId ? { kind: 'crm_account', id: facts.accountItemId } : null,
        startDate: start,
        endDate: rates?.termMonths ? addDays(start, Math.round(rates.termMonths * 30.4) - 1) : null,
      },
      priceCard: { ...base.priceCard, effectiveFrom: start, lines, oneTime: rates?.setupFeeCents ? [{ label: 'Setup fee', amountCents: String(rates.setupFeeCents), chargeOn: start }] : [] },
      links: { ...base.links, crmDealId: input.crmItemId, crmAccountId: facts.accountItemId },
    };
  }
  if (input.customerId) return { ...base, basics: { ...base.basics, customer: { kind: 'core', id: input.customerId } } };
  return base;
}
