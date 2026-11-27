/**
 * Programs (docs/programs/SPEC.md D1, D2, 4.2 `programs.ts`, 4.3.6, 4.3.7): the directory, the
 * program detail, the wizard create (one transaction for the program and everything the wizard
 * set up, then schedule generation and the Pulse link after commit), updates, status (pause, end),
 * archive, delete and copy.
 */
import 'server-only';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { customers } from '@kitstak/db/schema';
import { linkRecords, listRecordLinks, unlinkRecords } from '@kitstak/db/record-links';
import { addDays, monthOf } from '@kitstak/programs-engine/calendar';
import { describeRule, nextWorkDay } from '@kitstak/programs-engine/schedule';
import { db, type Executor } from '@/server/db';
import { buildSchedules, favorites, programSettings, programVariants, projectMembers, projects, statuses, type Project, type ProgramSettingsRow } from '@/server/db/schema';
import { conflict, invalid, locked, notFound } from '@/server/errors';
import { PROJECT_KEY_PATTERN, type ProjectStatus } from '@/lib/constants';
import { programWizardPayloadSchema, type IsoDate, type ProgramDetailDTO, type ProgramListItemDTO, type ProgramWizardPayload } from '@/lib/program-types';
import { routes } from '@/lib/routes';
import { toStatusDTO, type DomainContext } from '../_shared';
import { requireOrg, visibleProjectsWhere } from '../access';
import { logActivity } from '../activity';
import { getPeople } from '../people';
import { insertProject, listProjectMembers, takenProjectKeys } from '../projects';
import { calendarFor, centsOut, lockSettings, shared, toCalendarDTO, toSettingsDTO, todayInZone, uniq } from './_program';
import { requireProgram, seesMoneyFor, type ProgramAccess } from './access';
import { emitProgramChanged, emitProgramsChanged } from './events';
import { monthsFrom, refreshLedgerFor } from './ledger';
import { assertOpen, programLocks } from './locks';
import { programJobId } from './postings';
import { cardOverview, insertVersion, pendingRateChanges, type ResolvedLine } from './price-cards';
import { generateForSchedule, insertSchedule } from './schedules';
import { programMonthStats } from './stats';
import { insertAttributes, insertVariants, type VariantRowInput } from './variants';

// --- List ------------------------------------------------------------------------------------------

export interface ListProgramsOptions {
  readonly status?: readonly ProjectStatus[];
  readonly customerId?: string;
  readonly q?: string;
  readonly ids?: readonly string[];
  readonly includeArchived?: boolean;
  readonly ownerId?: string;
  readonly health?: readonly ('on_track' | 'at_risk' | 'off_track')[];
}

async function settingsFor(executor: Executor, ids: readonly string[]): Promise<Map<string, ProgramSettingsRow>> {
  if (ids.length === 0) return new Map();
  const rows = await executor.select().from(programSettings).where(inArray(programSettings.programId, [...ids]));
  return new Map(rows.map((row) => [row.programId, row]));
}

interface DayStat {
  program_id: string;
  builds: number;
  done: number;
  planned: string;
  built: string;
}

/** Builds the list items for loaded programs with grouped queries (8.5: no per row queries for counts). */
async function listItems(executor: Executor, ctx: DomainContext, rows: readonly Project[]): Promise<ProgramListItemDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const [settings, money, starred, owners] = await Promise.all([
    settingsFor(executor, ids),
    seesMoneyFor(ctx, ids, executor),
    executor.select({ id: favorites.entityId }).from(favorites).where(and(eq(favorites.orgId, ctx.orgId), eq(favorites.userId, ctx.userId), eq(favorites.entityType, 'project'))),
    getPeople(rows.map((row) => row.ownerId).filter((id): id is string => Boolean(id)), executor),
  ]);
  const zoneToday = new Map(ids.map((id) => [id, todayInZone(settings.get(id)?.timezone)]));
  const anyToday = [...zoneToday.values()].sort()[0] ?? todayInZone(null);
  const [today, variantCounts, schedules, sparks, customerRows] = await Promise.all([
    executor.execute(
      sql`select b.program_id::text as program_id, count(*)::int as builds, count(*) filter (where s.category = 'done')::int as done,
                 coalesce(sum(b.planned_qty) filter (where s.category <> 'cancelled'), 0)::text as planned, coalesce(sum(b.built_qty), 0)::text as built
            from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
           where b.program_id in (${list}) and b.build_date = ${anyToday}::date group by 1`,
    ),
    executor.execute(sql`select program_id::text as program_id, count(*)::int as n from pm.program_variants where program_id in (${list}) and deleted_at is null and status = 'active' group by 1`),
    executor.select().from(buildSchedules).where(and(inArray(buildSchedules.programId, ids), eq(buildSchedules.status, 'active'), isNull(buildSchedules.deletedAt))),
    executor.execute(
      sql`select o.program_id::text as program_id, o.work_date::text as date, sum(o.qty)::text as units from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
           where o.program_id in (${list}) and o.deleted_at is null and o.work_date > (${anyToday}::date - 30) and o.work_date <= ${anyToday}::date group by 1, 2 order by 2`,
    ),
    executor.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.orgId, ctx.orgId), inArray(customers.id, rows.map((r) => r.crmCustomerId).filter((id): id is string => Boolean(id)).concat(['00000000-0000-0000-0000-000000000000'])))),
  ]);
  const dayBy = new Map((today as unknown as { rows: DayStat[] }).rows.map((row) => [row.program_id, row]));
  const variantsBy = new Map((variantCounts as unknown as { rows: { program_id: string; n: number }[] }).rows.map((row) => [row.program_id, row.n]));
  const sparkRows = (sparks as unknown as { rows: { program_id: string; date: string; units: string }[] }).rows;
  const customerBy = new Map(customerRows.map((row) => [row.id, row.name]));
  const starredSet = new Set(starred.map((row) => row.id));
  const out: ProgramListItemDTO[] = [];
  for (const row of rows) {
    const s = settings.get(row.id);
    if (!s) continue;
    const hidden = !money.has(row.id);
    const stats = await programMonthStats(executor, ctx, row, s);
    const calendar = stats.calendar;
    const mySchedules = schedules.filter((sc) => sc.programId === row.id);
    const jobId = await programJobId(executor, ctx, row.id);
    const accountEdge = !row.crmCustomerId ? (await listRecordLinks(shared(executor), ctx.orgId, { type: 'pm_program', id: row.id }, { relation: 'belongs_to' })).find((e) => e.to.type === 'crm_account' || e.from.type === 'crm_account') : undefined;
    const day = dayBy.get(row.id);
    const override = (row.settings as { healthOverride?: boolean } | null)?.healthOverride === true;
    const owner = row.ownerId ? owners.get(row.ownerId) : undefined;
    const date = zoneToday.get(row.id) ?? anyToday;
    out.push({
      id: row.id,
      key: row.key,
      name: row.name,
      color: row.color,
      icon: row.icon,
      status: row.status,
      health: override ? row.health : (stats.health?.health ?? null),
      healthBasis: override ? null : (stats.health?.basis ?? null),
      healthAuto: !override,
      customer: row.crmCustomerId
        ? { kind: 'core', id: row.crmCustomerId, name: customerBy.get(row.crmCustomerId) ?? 'Customer' }
        : accountEdge
          ? { kind: 'crm_account', id: accountEdge.to.type === 'crm_account' ? accountEdge.to.id : accountEdge.from.id, name: accountEdge.cachedTitle ?? 'CRM account' }
          : null,
      owner: owner ? { id: owner.id, name: owner.name } : null,
      unit: { singular: s.unitSingular, plural: s.unitPlural },
      variantsCount: variantsBy.get(row.id) ?? 0,
      schedulesActive: mySchedules.length,
      scheduleText: mySchedules[0] ? describeRule({ pattern: mySchedules[0].pattern, days: mySchedules[0].days ?? [], intervalWeeks: mySchedules[0].intervalWeeks, startsOn: mySchedules[0].startsOn, endsOn: mySchedules[0].endsOn, skipHolidays: mySchedules[0].skipHolidays, skipDates: mySchedules[0].skipDates ?? [] }, calendar) : null,
      today: { date, builds: day?.builds ?? 0, done: day?.done ?? 0, plannedUnits: day?.planned ?? '0.000', builtUnits: day?.built ?? '0.000' },
      month: {
        month: stats.month,
        units: stats.result.units,
        revenueCents: centsOut(stats.revenueCents, hidden),
        forecastCents: centsOut(stats.forecast.forecastCents, hidden),
        targetCents: centsOut(s.monthlyTargetCents, hidden),
        targetBp: hidden ? null : stats.forecast.targetBp,
        minimumGapSoFarCents: stats.result.minimum.status === 'none' ? null : centsOut(stats.result.minimum.gapSoFarCents, hidden),
        projectedGapCents: stats.result.minimum.status === 'none' ? null : centsOut(stats.forecast.projectedGapCents, hidden),
        linkedJobsCents: null,
      },
      sparkline: Array.from({ length: 30 }, (_, index) => {
        const d = addDays(date, index - 29);
        return { date: d, units: sparkRows.find((r) => r.program_id === row.id && r.date === d)?.units ?? '0' };
      }),
      pulseJob: jobId ? { id: jobId, number: '', name: '' } : null,
      starred: starredSet.has(row.id),
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
      moneyHidden: hidden,
    });
  }
  // Fill job numbers from the cached edge titles.
  const jobEdges = await Promise.all(out.filter((item) => item.pulseJob).map((item) => listRecordLinks(shared(executor), ctx.orgId, { type: 'pm_program', id: item.id }, { relation: 'bills_to' })));
  for (const edges of jobEdges) {
    const edge = edges[0];
    if (!edge) continue;
    const item = out.find((i) => i.id === edge.from.id);
    if (item?.pulseJob) {
      const [number, ...name] = (edge.cachedTitle ?? '').split(' ');
      (item as { pulseJob: ProgramListItemDTO['pulseJob'] }).pulseJob = { id: edge.to.id, number: number ?? '', name: name.join(' ') };
    }
  }
  return out;
}

export async function listPrograms(ctx: DomainContext, options: ListProgramsOptions = {}): Promise<ProgramListItemDTO[]> {
  const conditions = [visibleProjectsWhere(ctx, { kind: 'program' }), eq(projects.isTemplate, false)];
  if (!options.includeArchived) conditions.push(isNull(projects.archivedAt));
  if (options.status?.length) conditions.push(inArray(projects.status, [...options.status]));
  if (options.ids?.length) conditions.push(inArray(projects.id, [...options.ids]));
  if (options.ownerId) conditions.push(eq(projects.ownerId, options.ownerId));
  if (options.customerId) conditions.push(eq(projects.crmCustomerId, options.customerId));
  if (options.q?.trim()) {
    const term = `%${options.q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(sql`(${projects.name} ilike ${term} or ${projects.key} ilike ${term})`);
  }
  const rows = await db.select().from(projects).where(and(...conditions)).orderBy(asc(projects.name));
  const items = await listItems(db, ctx, rows);
  return options.health?.length ? items.filter((item) => item.health && options.health!.includes(item.health)) : items;
}

// --- Detail ----------------------------------------------------------------------------------------

export async function programDetail(ctx: DomainContext, access: ProgramAccess): Promise<ProgramDetailDTO> {
  const { program, settings, caps } = access;
  const [item] = await listItems(db, ctx, [program]);
  const [statusRows, members, calendar, locks, card, pending, variantCount, scheduleCount, links] = await Promise.all([
    db.select().from(statuses).where(eq(statuses.projectId, program.id)).orderBy(sql`${statuses.position} COLLATE "C"`),
    listProjectMembers(ctx, program.id),
    calendarFor(db, ctx, program, settings),
    programLocks(ctx, program),
    cardOverview(db, ctx, access),
    pendingRateChanges(db, ctx, access),
    db.select({ n: sql<number>`count(*)::int` }).from(programVariants).where(and(eq(programVariants.programId, program.id), isNull(programVariants.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(buildSchedules).where(and(eq(buildSchedules.programId, program.id), isNull(buildSchedules.deletedAt), eq(buildSchedules.status, 'active'))),
    import('./links').then((m) => m.listRecordLinksFor(ctx, { type: 'pm_program', id: program.id })),
  ]);
  const today = todayInZone(settings.timezone);
  const pulseAvailable = locks.pulseApplies;
  const job = links.find((l) => l.type === 'pulse_job' && l.relation === 'bills_to') ?? null;
  return {
    ...item!,
    description: program.description,
    startDate: program.startDate,
    endDate: program.dueDate,
    settings: toSettingsDTO(settings, !caps.seesMoney),
    calendar: toCalendarDTO(calendar, today, nextWorkDay(calendar, today)),
    statuses: statusRows.map(toStatusDTO),
    members,
    capabilities: caps,
    locks: { lockedThrough: locks.lockedThrough, programClosed: locks.programClosed, pulseClosed: locks.pulseClosed },
    currentVersion: card.current,
    nextVersion: card.next,
    draftsCount: card.drafts,
    pendingRateChanges: pending,
    setup: { hasPriceCard: Boolean(card.current || card.next), hasVariants: Number(variantCount[0]?.n ?? 0) > 0, hasSchedule: Number(scheduleCount[0]?.n ?? 0) > 0, hasPulseJob: pulseAvailable ? Boolean(job) : null },
    links: {
      crmDeal: links.find((l) => l.type === 'crm_deal') ?? null,
      crmAccount: links.find((l) => l.type === 'crm_account') ?? null,
      pulseJob: job,
      count: links.length,
    },
  };
}

export async function getProgramDetail(ctx: DomainContext, key: string): Promise<ProgramDetailDTO> {
  return programDetail(ctx, await requireProgram(ctx, key));
}

export async function takenKeys(ctx: DomainContext): Promise<string[]> {
  return [...(await takenProjectKeys(ctx))].sort();
}

// --- Create ----------------------------------------------------------------------------------------

function parseCombo(comboKey: string): [string, string][] {
  return comboKey.split('|').filter(Boolean).map((pair) => {
    const [axis, value] = pair.split('=');
    return [axis ?? '', value ?? ''];
  });
}

export interface CreateProgramResult {
  readonly key: string;
  readonly url: string;
  readonly generated: { readonly builds: number; readonly units: string; readonly through: IsoDate | null };
}

/** The wizard create (4.2): one transaction, then generation and the Pulse link after commit. */
export async function createProgram(ctx: DomainContext, payloadInput: ProgramWizardPayload, options: { readonly versionSource?: 'manual' | 'crm_deal' | 'copy' | 'template' | 'seed' } = {}): Promise<CreateProgramResult> {
  requireOrg(ctx, 'project:create');
  const parsed = programWizardPayloadSchema.safeParse(payloadInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalid(issue?.message ?? 'Some fields need another look.', Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
  }
  const payload = parsed.data;
  const { basics } = payload;
  const key = basics.key.toUpperCase();
  if (!PROJECT_KEY_PATTERN.test(key)) throw invalid('Use 2 to 6 letters or numbers for the key, starting with a letter.', { 'basics.key': 'Use 2 to 6 letters or numbers, starting with a letter.' });
  if (basics.endDate && basics.endDate < basics.startDate) throw invalid('The end date has to be on or after the start date.', { 'basics.endDate': 'End is before the start.' });
  const created = await db.transaction(async (tx) => {
    const project = await insertProject(tx, ctx, {
      kind: 'program',
      name: basics.name,
      key,
      description: basics.description ?? null,
      ownerId: basics.ownerId,
      startDate: basics.startDate,
      dueDate: basics.endDate ?? null,
      color: basics.color,
      icon: basics.icon,
      status: 'active',
      crmCustomerId: basics.customer?.kind === 'core' ? basics.customer.id : null,
      crmItemId: payload.links.crmDealId ?? null,
      members: payload.links.members,
      program: {
        unitSingular: basics.unit.singular,
        unitPlural: basics.unit.plural,
        timezone: basics.timezone,
        workingDays: basics.calendar.useWorkspace ? null : basics.calendar.workingDays,
        extraDaysOff: basics.calendar.extraDaysOff,
        extraWorkDays: basics.calendar.extraWorkDays,
        monthlyTargetCents: basics.monthlyTargetCents ? BigInt(basics.monthlyTargetCents) : null,
      },
    }).catch((error) => {
      if (error instanceof Error && 'fields' in error && (error as { fields?: Record<string, string> }).fields?.key) throw invalid(error.message, { 'basics.key': error.message });
      throw error;
    });
    // Attributes and variants.
    const attributes = await insertAttributes(tx, ctx, project.id, payload.variants.mode === 'matrix' ? payload.variants.axes : []);
    const axisIdOf = new Map<string, string>();
    payload.variants.axes.forEach((axis, index) => {
      const row = attributes[index];
      if (!row) return;
      axisIdOf.set(axis.id ?? axis.name, row.id);
      axisIdOf.set(axis.name, row.id);
      axisIdOf.set(axis.name.toLowerCase(), row.id);
    });
    const valueIdOf = (attributeId: string, value: string): string | null => {
      const attribute = attributes.find((a) => a.id === attributeId);
      return attribute?.values.find((v) => v.id === value || v.code === value.toUpperCase() || v.label.toLowerCase() === value.toLowerCase())?.id ?? null;
    };
    const variantRows: VariantRowInput[] =
      payload.variants.mode === 'matrix'
        ? payload.variants.rows
            .filter((row) => row.include)
            .map((row) => {
              const attrs: Record<string, string> = {};
              for (const [axis, value] of parseCombo(row.comboKey)) {
                const attributeId = axisIdOf.get(axis);
                if (!attributeId) continue;
                const valueId = valueIdOf(attributeId, value);
                if (valueId) attrs[attributeId] = valueId;
              }
              return { name: row.name, key: row.key, sku: row.sku, attributes: attrs, defaultQty: row.defaultQty, coreItemId: row.coreItemId ?? null, unitPrice: row.unitPrice };
            })
        : payload.variants.manual.map((row) => ({ name: row.name, key: row.key, sku: row.sku, defaultQty: row.defaultQty, unitPrice: row.unitPrice }));
    const variants = await insertVariants(tx, ctx, project.id, variantRows);
    const variantIdOfKey = new Map(variants.map((v) => [v.key, v.id]));
    // Price card (unless "Set prices later").
    let versionNumber: number | null = null;
    if (!payload.priceCard.later) {
      const lines: ResolvedLine[] = payload.priceCard.lines.map((line) => {
        const variantId = line.variantKey ? (variantIdOfKey.get(line.variantKey.toUpperCase()) ?? null) : (line.variantId ?? null);
        if (line.variantKey && !variantId) throw invalid(`A price line names a variant that is not in this program (${line.variantKey}).`, { 'priceCard.lines': 'A line names a missing variant.' });
        return { ...line, variantId };
      });
      // Variant rates typed in the variants step are variant lines on the first version.
      for (const [index, row] of variantRows.entries()) {
        const variant = variants[index];
        if (variant && row.unitPrice && !lines.some((l) => l.kind === 'per_unit' && l.variantId === variant.id)) lines.push({ kind: 'per_unit', variantId: variant.id, unitPrice: row.unitPrice });
      }
      const rules = payload.priceCard.rules.map((rule) => {
        const attributeId = axisIdOf.get(rule.attributeId) ?? axisIdOf.get(rule.attributeId.toLowerCase()) ?? rule.attributeId;
        const valueId = valueIdOf(attributeId, rule.valueId);
        if (!valueId) throw invalid('A rate rule names a value that is not in the attributes.', { 'priceCard.rules': 'A rule names a missing value.' });
        return { ...rule, attributeId, valueId };
      });
      if (lines.length > 0 || rules.length > 0) {
        const version = await insertVersion(tx, ctx, project.id, { effectiveFrom: payload.priceCard.effectiveFrom, status: 'published', source: options.versionSource ?? (payload.start.mode === 'deal' ? 'crm_deal' : 'manual'), sourceRef: payload.start.crmItemId ?? null, lines, rules });
        versionNumber = version.number;
      }
    }
    for (const charge of payload.priceCard.oneTime) {
      await tx.execute(
        sql`insert into pm.program_one_time_charges (org_id, program_id, kind, charge_on, amount_cents, label, created_by)
            values (${ctx.orgId}::uuid, ${project.id}::uuid, 'setup', ${charge.chargeOn}::date, ${charge.amountCents}::bigint, ${charge.label}, ${ctx.actorKind === 'user' ? ctx.userId : null}::uuid)`,
      );
    }
    // Schedule.
    let scheduleId: string | null = null;
    if (payload.schedule.enabled && payload.schedule.lines.length > 0) {
      const schedule = await insertSchedule(tx, ctx, project.id, {
        name: payload.schedule.name || `${basics.name} run`,
        pattern: payload.schedule.pattern,
        days: payload.schedule.days,
        intervalWeeks: payload.schedule.intervalWeeks,
        startsOn: payload.schedule.startsOn,
        endsOn: payload.schedule.endsOn,
        leadDays: payload.schedule.leadDays,
        skipHolidays: true,
        skipDates: [],
        defaultAssigneeId: payload.schedule.defaultAssigneeId ?? null,
        lines: payload.schedule.lines.map((line) => ({ variantKey: line.variantKey, qty: line.qty, qtyByWeekday: line.qtyByWeekday ?? null, assigneeId: line.assigneeId ?? null })),
      });
      scheduleId = schedule.id;
    }
    // Record links.
    const ref = { type: 'pm_program' as const, id: project.id };
    if (basics.customer?.kind === 'crm_account' || payload.links.crmAccountId) {
      const accountId = basics.customer?.kind === 'crm_account' ? basics.customer.id : payload.links.crmAccountId!;
      await linkRecords(shared(tx), { orgId: ctx.orgId, from: ref, to: { type: 'crm_account', id: accountId }, relation: 'belongs_to', createdBy: ctx.userId }).catch(() => undefined);
    }
    if (basics.customer?.kind === 'core') {
      await linkRecords(shared(tx), { orgId: ctx.orgId, from: ref, to: { type: 'core_customer', id: basics.customer.id }, relation: 'belongs_to', createdBy: ctx.userId }).catch(() => undefined);
    }
    if (payload.links.crmDealId) {
      await linkRecords(shared(tx), { orgId: ctx.orgId, from: ref, to: { type: 'crm_deal', id: payload.links.crmDealId }, relation: 'created_from', createdBy: ctx.userId }).catch(() => undefined);
    }
    for (const projectId of payload.links.projectIds ?? []) {
      await linkRecords(shared(tx), { orgId: ctx.orgId, from: ref, to: { type: 'pm_project', id: projectId }, relation: 'related', createdBy: ctx.userId }).catch(() => undefined);
    }
    // Ledger for the start month (setup fees, a monthly fee already due).
    await refreshLedgerFor(tx, ctx, { programIds: [project.id], months: monthsFrom(basics.startDate, todayInZone(basics.timezone)) });
    await logActivity(tx, ctx, { verb: 'program.updated', entityType: 'project', entityId: project.id, projectId: project.id, field: 'setup', after: { variants: variants.length, versionNumber, schedule: Boolean(scheduleId) } });
    return { project, scheduleId };
  });
  const access = await requireProgram(ctx, { id: created.project.id });
  let generated: CreateProgramResult['generated'] = { builds: 0, units: '0.000', through: null };
  if (created.scheduleId) generated = await generateForSchedule(ctx, access.program, access.settings, created.scheduleId);
  if (payload.links.pulseJobId) {
    const { linkPulseJob } = await import('./links');
    await linkPulseJob(ctx, { programId: created.project.id }, payload.links.pulseJobId);
  }
  await emitProgramsChanged(ctx, [created.project.id]);
  return { key: created.project.key, url: routes.program(created.project.key), generated };
}

// --- Update ----------------------------------------------------------------------------------------

export interface UpdateProgramPatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly ownerId?: string;
  readonly startDate?: IsoDate | null;
  readonly endDate?: IsoDate | null;
  readonly color?: string;
  readonly icon?: string;
  readonly visibility?: 'org' | 'private';
  readonly healthOverride?: 'on_track' | 'at_risk' | 'off_track' | null;
}

export async function updateProgram(ctx: DomainContext, key: string, patch: UpdateProgramPatch): Promise<ProgramDetailDTO> {
  const needsOwner = patch.visibility !== undefined || patch.ownerId !== undefined || patch.startDate !== undefined || patch.endDate !== undefined;
  const access = await requireProgram(ctx, key, needsOwner ? 'project:manage_members' : 'project:update');
  const { program } = access;
  const set: Partial<typeof projects.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw invalid('Give the program a name.', { name: 'Give the program a name.' });
    set.name = name.slice(0, 120);
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (patch.healthOverride !== undefined) {
    set.settings = { ...(program.settings ?? {}), healthOverride: patch.healthOverride !== null };
    if (patch.healthOverride) set.health = patch.healthOverride;
  }
  const start = patch.startDate !== undefined ? patch.startDate : program.startDate;
  const end = patch.endDate !== undefined ? patch.endDate : program.dueDate;
  if (start && end && start > end) throw invalid('The end date has to be on or after the start date.', { endDate: 'End is before the start.' });
  const datesChanged = start !== program.startDate || end !== program.dueDate;
  await db.transaction(async (tx) => {
    if (datesChanged) {
      await lockSettings(tx, [program.id], 'update');
      const locks = await programLocks(ctx, program, tx);
      const goesToJob = Boolean(await programJobId(tx, ctx, program.id));
      // Every day whose fixed charges would change must be open (4.3.7).
      for (const [before, after] of [[program.startDate, start], [program.dueDate, end]] as const) {
        if (before === after) continue;
        for (const day of [before, after]) if (day) assertOpen(locks, day, { goesToJob });
      }
      set.startDate = start;
      set.dueDate = end;
    }
    if (Object.keys(set).length === 0) return;
    await tx.update(projects).set({ ...set, updatedAt: new Date() }).where(eq(projects.id, program.id));
    if (patch.ownerId) {
      await tx.insert(projectMembers).values({ projectId: program.id, userId: patch.ownerId, orgId: ctx.orgId, role: 'owner', addedBy: ctx.userId }).onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: 'owner' } });
    }
    if (datesChanged) {
      const today = todayInZone(access.settings.timezone);
      const days = [program.startDate, start, program.dueDate, end].filter((d): d is string => Boolean(d));
      const months = uniq([...days.map(monthOf), ...monthsFrom(days.sort()[0] ?? today, today)]);
      await refreshLedgerFor(tx, ctx, { programIds: [program.id], months });
      await emitProgramChanged(tx, ctx, program.id);
    }
    await logActivity(tx, ctx, { verb: 'program.updated', entityType: 'project', entityId: program.id, projectId: program.id, after: { fields: Object.keys(set) } });
  });
  return getProgramDetail(ctx, program.key);
}

/** Pause, resume, end or reopen a program (4.3.7). */
export async function setProgramStatus(
  ctx: DomainContext,
  key: string,
  status: 'active' | 'on_hold' | 'completed',
  options: { readonly futureBuilds?: 'cancel' | 'keep'; readonly endsOn?: IsoDate | null } = {},
): Promise<{ cancelledBuilds: number }> {
  const access = await requireProgram(ctx, key, 'project:manage_members');
  const { program, settings } = access;
  const today = todayInZone(settings.timezone);
  let cancelIds: string[] = [];
  await db.transaction(async (tx) => {
    await lockSettings(tx, [program.id], 'update');
    const locks = await programLocks(ctx, program, tx);
    const ranges = [...(settings.pausedRanges ?? [])];
    const set: Partial<typeof projects.$inferInsert> = { status, updatedAt: new Date() };
    let cutoff: IsoDate | null = null;
    if (status === 'on_hold') {
      if (!ranges.some((r) => r.to === null)) ranges.push({ from: today, to: null });
      await tx.update(buildSchedules).set({ status: 'paused', updatedAt: new Date() }).where(and(eq(buildSchedules.programId, program.id), eq(buildSchedules.status, 'active')));
      cutoff = addDays(today, -1);
    } else if (status === 'active') {
      for (const range of ranges) if (range.to === null) (range as { to: string | null }).to = addDays(today, -1) < range.from ? range.from : addDays(today, -1);
      await tx.update(buildSchedules).set({ status: 'active', updatedAt: new Date() }).where(and(eq(buildSchedules.programId, program.id), eq(buildSchedules.status, 'paused')));
      set.completedAt = null;
    } else {
      const endsOn = options.endsOn ?? today;
      assertOpen(locks, endsOn, { goesToJob: Boolean(await programJobId(tx, ctx, program.id)) });
      set.dueDate = endsOn;
      set.completedAt = new Date();
      await tx.update(buildSchedules).set({ status: 'ended', endsOn, updatedAt: new Date() }).where(and(eq(buildSchedules.programId, program.id), isNull(buildSchedules.deletedAt), sql`${buildSchedules.status} <> 'ended'`));
      cutoff = endsOn;
    }
    await tx.update(projects).set(set).where(eq(projects.id, program.id));
    await tx.update(programSettings).set({ pausedRanges: ranges, version: settings.version + 1, updatedAt: new Date() }).where(eq(programSettings.programId, program.id));
    if (cutoff && (options.futureBuilds ?? 'cancel') === 'cancel') {
      const result = await tx.execute(
        sql`select b.task_id::text as id from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
             where b.program_id = ${program.id}::uuid and b.build_date > ${cutoff}::date and s.category = 'todo' and b.built_qty = 0`,
      );
      cancelIds = (result as unknown as { rows: { id: string }[] }).rows.map((r) => r.id);
    }
    await refreshLedgerFor(tx, ctx, { programIds: [program.id], months: [monthOf(today), ...(options.endsOn ? [monthOf(options.endsOn)] : [])] });
    await logActivity(tx, ctx, { verb: 'program.status_changed', entityType: 'project', entityId: program.id, projectId: program.id, before: { status: program.status }, after: { status, endsOn: set.dueDate ?? null, cancelled: cancelIds.length } });
    await emitProgramChanged(tx, ctx, program.id);
  });
  if (cancelIds.length > 0) {
    const { cancelBuilds } = await import('./builds');
    await cancelBuilds(ctx, cancelIds);
  }
  return { cancelledBuilds: cancelIds.length };
}

export async function archiveProgram(ctx: DomainContext, key: string): Promise<void> {
  const access = await requireProgram(ctx, key, 'project:manage_members');
  if (!access.program.dueDate || access.program.status !== 'completed') await setProgramStatus(ctx, key, 'completed', { futureBuilds: 'cancel' });
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ archivedAt: new Date(), status: 'archived', updatedAt: new Date() }).where(eq(projects.id, access.program.id));
    await logActivity(tx, ctx, { verb: 'program.archived', entityType: 'project', entityId: access.program.id, projectId: access.program.id });
  });
}

export async function restoreProgram(ctx: DomainContext, key: string): Promise<void> {
  const [row] = await db.select().from(projects).where(and(eq(projects.orgId, ctx.orgId), eq(projects.key, key.toUpperCase()), eq(projects.kind, 'program')));
  if (!row) throw notFound('That program');
  if (row.deletedAt) {
    const taken = await takenProjectKeys(ctx);
    if (taken.has(row.key)) throw conflict(`Another project now uses the key ${row.key}. Change that project's key first.`);
    await db.transaction(async (tx) => {
      await tx.update(projects).set({ deletedAt: null, updatedAt: new Date() }).where(eq(projects.id, row.id));
      await logActivity(tx, ctx, { verb: 'program.restored', entityType: 'project', entityId: row.id, projectId: row.id });
    });
    await requireProgram(ctx, { id: row.id }, 'project:delete');
    return;
  }
  await requireProgram(ctx, { id: row.id }, 'project:manage_members');
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ archivedAt: null, status: 'completed', updatedAt: new Date() }).where(eq(projects.id, row.id));
    await logActivity(tx, ctx, { verb: 'program.restored', entityType: 'project', entityId: row.id, projectId: row.id });
  });
}

/** Owner only; refused when any output or ledger row is locked (4.3.6). */
export async function deleteProgram(ctx: DomainContext, key: string): Promise<void> {
  const access = await requireProgram(ctx, key, 'project:delete');
  const { program } = access;
  await db.transaction(async (tx) => {
    await lockSettings(tx, [program.id], 'update');
    const locks = await programLocks(ctx, program, tx);
    const lockedMonths = [...locks.programClosed, ...locks.pulseClosed].map((m) => sql`${`${m}-01`}::date`);
    if (lockedMonths.length > 0) {
      const held = await tx.execute(
        sql`select (exists (select 1 from pm.build_output where program_id = ${program.id}::uuid and deleted_at is null and date_trunc('month', work_date)::date in (${sql.join(lockedMonths, sql`, `)}))
                 or exists (select 1 from pm.program_ledger where program_id = ${program.id}::uuid and deleted_at is null and month in (${sql.join(lockedMonths, sql`, `)}))) as held`,
      );
      if ((held as unknown as { rows: { held: boolean }[] }).rows[0]?.held) throw locked('This program has money in a closed month. Archive it instead.');
    }
    await tx.update(projects).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(projects.id, program.id));
    await tx.execute(sql`update pm.build_output set deleted_at = now(), updated_at = now() where program_id = ${program.id}::uuid and deleted_at is null`);
    await tx.execute(sql`update pm.program_ledger set deleted_at = now(), updated_at = now() where program_id = ${program.id}::uuid and deleted_at is null`);
    const edges = await listRecordLinks(shared(tx), ctx.orgId, { type: 'pm_program', id: program.id }, { relation: 'bills_to' });
    for (const edge of edges) await unlinkRecords(shared(tx), ctx.orgId, edge.id);
    const buildEdges = await tx.execute(sql`select l.id::text as id from core.record_links l join pm.builds b on b.task_id::text = l.from_id where l.org_id = ${ctx.orgId}::uuid and l.from_type = 'pm_build' and l.relation = 'bills_to' and b.program_id = ${program.id}::uuid`).catch(() => ({ rows: [] }));
    for (const row of (buildEdges as unknown as { rows: { id: string }[] }).rows) await unlinkRecords(shared(tx), ctx.orgId, row.id);
    await logActivity(tx, ctx, { verb: 'program.deleted', entityType: 'project', entityId: program.id, projectId: program.id, before: { name: program.name, key: program.key } });
    await emitProgramChanged(tx, ctx, program.id);
  });
}

/** Copies a program's setup (not its builds or output) into a new program. */
export async function copyProgram(
  ctx: DomainContext,
  key: string,
  input: { readonly name: string; readonly key: string; readonly startDate: IsoDate; readonly include: { readonly variants?: boolean; readonly priceCard?: boolean; readonly schedules?: boolean; readonly members?: boolean; readonly links?: boolean } },
): Promise<{ key: string; url: string }> {
  const access = await requireProgram(ctx, key);
  const { wizardPrefill } = await import('./prefill');
  const payload = await wizardPrefill(ctx, { copyKey: access.program.key });
  const full: ProgramWizardPayload = {
    ...payload,
    start: { mode: 'copy', copyKey: access.program.key },
    basics: { ...payload.basics, name: input.name, key: input.key.toUpperCase(), startDate: input.startDate, endDate: null, ownerId: ctx.userId },
    variants: input.include.variants === false ? { ...payload.variants, mode: 'list', axes: [], rows: [], manual: [] } : payload.variants,
    priceCard: input.include.priceCard === false || input.include.variants === false ? { later: true, effectiveFrom: input.startDate, lines: [], rules: [], oneTime: [] } : { ...payload.priceCard, effectiveFrom: input.startDate, oneTime: [] },
    schedule: input.include.schedules === false || input.include.variants === false ? { ...payload.schedule, enabled: false, lines: [] } : { ...payload.schedule, startsOn: input.startDate },
    links: { ...payload.links, members: input.include.members === false ? [] : payload.links.members, crmDealId: null, pulseJobId: null, projectIds: input.include.links === false ? [] : payload.links.projectIds },
  };
  const created = await createProgram(ctx, full, { versionSource: 'copy' });
  const target = await requireProgram(ctx, created.key);
  await db.transaction(async (tx) => {
    await linkRecords(shared(tx), { orgId: ctx.orgId, from: { type: 'pm_program', id: target.program.id }, to: { type: 'pm_program', id: access.program.id }, relation: 'created_from', createdBy: ctx.userId }).catch(() => undefined);
    await logActivity(tx, ctx, { verb: 'program.copied', entityType: 'project', entityId: target.program.id, projectId: target.program.id, after: { from: access.program.key } });
  });
  return { key: created.key, url: created.url };
}

/** Units of the program on a list of days (directory and reports). */
export async function unitsOn(executor: Executor, programId: string, dates: readonly IsoDate[]): Promise<string> {
  if (dates.length === 0) return '0.000';
  const result = await executor.execute(sql`select coalesce(sum(qty), 0)::text as units from pm.build_output where program_id = ${programId}::uuid and deleted_at is null and work_date in (${sql.join(dates.map((d) => sql`${d}::date`), sql`, `)})`);
  return (result as unknown as { rows: { units: string }[] }).rows[0]?.units ?? '0.000';
}

