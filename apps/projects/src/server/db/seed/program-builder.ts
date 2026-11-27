/**
 * ProgramBuilder (docs/programs/SPEC.md 7): seeds programs through the program domain by walking
 * the calendar one day at a time on the program clock. Each day: programs that start that day are
 * made (wizard payload, so the card, schedule, links and members are real), the sweep makes the
 * next builds and settles finished months, each program's day hook logs output, and the rows
 * written that day get that day's time. At the end the rows get stable ids (program-ids.ts).
 *
 * The finish trigger stamps `finished_on` from the database clock, so builds finished on a past
 * seed day are moved back to that day and the ledger is refreshed for both months.
 */
import { sql } from 'drizzle-orm';
import { isWorkDay as engineIsWorkDay, addDays } from '@kitstak/programs-engine/calendar';
import { todayIn } from '@kitstak/programs-engine/schedule';
import type { ProgramCalendar } from '@kitstak/programs-engine/types';
import { db } from '@/server/db';
import type { DomainContext } from '@/server/domain/_shared';
import { addComment, addManualTime, createTask, updateTask } from '@/server/domain';
import { getUserPrefs, updateUserPrefs } from '@/server/domain/prefs';
import {
  addOneTimeCharge,
  closeMonth,
  createBuild,
  createDraftVersion,
  createProgram,
  getOrgCalendar,
  linkVariantKit,
  listAttributes,
  listSchedules,
  listVariants,
  logOutput,
  programCalendar,
  publishVersion,
  refreshLedgerFor,
  requestReview,
  resetProgramClock,
  runProgramSweep,
  saveDraft,
  saveProgramTemplate,
  setProgramClock,
  skipDate,
  updateBuild,
  updateDraftVersion,
  updateOrgCalendar,
  updateVariant,
  wizardPrefill,
} from '@/server/domain/programs';
import { emptyPayload } from '@/server/domain/programs/prefill';
import type { IsoDate, ProgramWizardPayload } from '@/lib/program-types';
import type { ResolvedLine } from '@/server/domain/programs/price-cards';
import { hash01, restampActivity } from './backdate';
import { orgBySlug, orgMembers, seedContext } from './context';
import { RecordPicker } from './records';
import { stabilizeProgramIds } from './program-ids';
import type { DayApi, OrgDayApi, OrgProgramsSeed, ProgramSeed, SeedBuildRow, SeedCardLine, SeedLogRow, SeedRule } from './program-types';
import type { Handle } from './types';
import { workspaceHolidays } from './data/northwind-programs';

const TIMEZONE = 'America/Chicago';

const log = (message: string) => process.stdout.write(`${message}\n`);

interface BuiltProgram {
  readonly spec: ProgramSeed;
  readonly id: string;
  readonly key: string;
  readonly startDate: IsoDate;
  readonly calendar: ProgramCalendar;
}

export interface ProgramSeedResult {
  readonly org: string;
  readonly orgId: string;
  readonly programs: readonly { readonly key: string; readonly id: string }[];
  readonly idsMoved: number;
  readonly warnings: readonly string[];
}

/** Noon in Chicago on `date`, as the program clock. */
function noonOf(date: IsoDate): Date {
  return new Date(`${date}T18:00:00Z`);
}

/** Tables whose rows a seed day re-times (org scoped, with a created_at). */
const TIMED_TABLES = [
  'build_output',
  'builds',
  'tasks',
  'comments',
  'notifications',
  'time_entries',
  'watchers',
  'program_ledger',
  'program_one_time_charges',
  'price_card_versions',
  'price_card_lines',
  'build_schedules',
  'program_variants',
  'program_attributes',
  'program_settings',
  'project_members',
  'projects',
  'templates',
  'wizard_drafts',
] as const;

export class ProgramBuilder {
  private orgId = '';
  private readonly people = new Map<Handle, string>();
  private readonly contexts = new Map<Handle, DomainContext>();
  private readonly built = new Map<string, BuiltProgram>();
  private readonly warnings: string[] = [];
  private today: IsoDate = todayIn(TIMEZONE, new Date());
  private workspaceDays: readonly number[] = [1, 2, 3, 4, 5];
  private holidays: { date: IsoDate; name: string }[] = [];
  private picker!: RecordPicker;
  private timedTables: string[] = [];
  private updatedTables: string[] = [];

  constructor(private readonly spec: OrgProgramsSeed) {}

  async run(): Promise<ProgramSeedResult> {
    const org = await orgBySlug(this.spec.slug);
    if (!org) throw new Error(`Seed: org ${this.spec.slug} not found.`);
    this.orgId = org.id;
    this.picker = new RecordPicker(org.id);
    const members = await orgMembers(org.id);
    for (const [handle, email] of Object.entries(this.spec.people)) {
      const member = members.find((m) => m.email.toLowerCase() === email.toLowerCase());
      if (!member) {
        this.warn(`${email} is not a member of ${this.spec.slug}; skipped in programs`);
        continue;
      }
      this.people.set(handle, member.id);
      this.contexts.set(handle, await seedContext(this.spec.slug, email));
    }
    if (!this.people.has(this.spec.me)) throw new Error(`Seed: ${this.spec.people[this.spec.me]} must be a member of ${this.spec.slug}.`);
    const existing = await db.execute<{ t: string }>(sql`select table_name as t from information_schema.columns where table_schema = 'pm' and column_name = 'created_at'
      and table_name in (select table_name from information_schema.columns where table_schema = 'pm' and column_name = 'org_id')`);
    const have = new Set(existing.rows.map((r) => r.t));
    this.timedTables = TIMED_TABLES.filter((t) => have.has(t));
    const updated = await db.execute<{ t: string }>(sql`select table_name as t from information_schema.columns where table_schema = 'pm' and column_name = 'updated_at'`);
    const withUpdated = new Set(updated.rows.map((r) => r.t));
    this.updatedTables = this.timedTables.filter((t) => withUpdated.has(t));

    await this.setCalendar();
    const starts = this.spec.programs.map((p) => addDays(this.today, p.startOffset));
    const first = starts.reduce((a, b) => (a < b ? a : b), this.today);
    log(`seed:${this.spec.slug} - programs from ${first} to ${this.today}`);
    try {
      for (let date = first; date <= this.today; date = addDays(date, 1)) await this.runDay(date);
      setProgramClock(() => new Date());
      await this.finish();
    } finally {
      resetProgramClock();
    }
    const programs = [...this.built.values()].map((p) => ({ key: p.key, id: p.id }));
    const stable = await stabilizeProgramIds(this.orgId, programs.map((p) => p.id));
    if (stable.skipped) this.warn(`program ids kept as made: ${stable.skipped}`);
    const fresh = await db.execute<{ id: string; key: string }>(sql`select id::text, key from pm.projects where org_id = ${this.orgId}::uuid and kind = 'program' and deleted_at is null order by key`);
    return { org: this.spec.slug, orgId: this.orgId, programs: fresh.rows, idsMoved: stable.moved, warnings: this.warnings };
  }

  private warn(message: string): void {
    this.warnings.push(message);
    log(`  warning: ${message}`);
  }

  private ctx(handle: Handle): DomainContext {
    const ctx = this.contexts.get(handle) ?? this.contexts.get(this.spec.me);
    if (!ctx) throw new Error(`Seed: no context for ${handle}`);
    return ctx;
  }

  private id(handle: Handle): string | null {
    return this.people.get(handle) ?? null;
  }

  // --- Calendar --------------------------------------------------------------------------------

  private async setCalendar(): Promise<void> {
    const ctx = this.ctx(this.spec.me);
    const current = await getOrgCalendar(ctx);
    this.holidays = workspaceHolidays(this.today);
    this.workspaceDays = this.spec.calendar.workingDays;
    await updateOrgCalendar(
      ctx,
      { timezone: this.spec.calendar.timezone, workingDays: this.spec.calendar.workingDays, holidays: this.holidays, dailyCapacityHours: this.spec.calendar.dailyCapacityHours },
      current.version,
    );
  }

  private workspaceWorkDay(date: IsoDate): boolean {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return this.workspaceDays.includes(weekday) && !this.holidays.some((h) => h.date === date);
  }

  // --- Days ------------------------------------------------------------------------------------

  private async runDay(date: IsoDate): Promise<void> {
    setProgramClock(() => (date === this.today ? new Date() : noonOf(date)));
    const marker = await this.marker();
    for (const spec of this.spec.programs) {
      if (addDays(this.today, spec.startOffset) === date) await this.create(spec, date);
    }
    if (this.built.size > 0) await runProgramSweep(this.ctx(this.spec.me));
    for (const program of this.built.values()) {
      await program.spec.day(this.dayApi(program, date));
      await this.prepTime(program, date);
      await this.prepDone(program, date);
    }
    if (this.spec.orgDay && this.built.size > 0) await this.spec.orgDay(this.orgApi(date));
    await this.stampDay(marker, date);
  }

  private async marker(): Promise<string> {
    const result = await db.execute<{ ts: string }>(sql`select clock_timestamp()::text as ts`);
    return result.rows[0]!.ts;
  }

  /** Rows written since `marker` get `date` at a working hour (today: a few minutes ago at most). */
  private async stampDay(marker: string, date: IsoDate): Promise<void> {
    if (date === this.today) return;
    const at = new Date(`${date}T21:30:00Z`);
    await db.transaction(async (tx) => {
      await restampActivity(tx, sql`a.org_id = ${this.orgId}::uuid and a.created_at >= ${marker}::timestamptz`, at);
      for (const table of this.timedTables) {
        await tx.execute(sql.raw(`update pm."${table}" set created_at = '${at.toISOString()}'::timestamptz + (random() * interval '40 minutes') where org_id = '${this.orgId}' and created_at >= '${marker}'::timestamptz`));
      }
      for (const table of this.updatedTables) {
        await tx.execute(sql.raw(`update pm."${table}" set updated_at = '${at.toISOString()}'::timestamptz + interval '45 minutes' where org_id = '${this.orgId}' and updated_at >= '${marker}'::timestamptz`));
      }
      await tx.execute(sql.raw(`update pm.tasks set completed_at = '${at.toISOString()}'::timestamptz + interval '50 minutes' where org_id = '${this.orgId}' and completed_at >= '${marker}'::timestamptz`));
      await tx.execute(sql.raw(`update pm.program_closes set closed_at = '${at.toISOString()}'::timestamptz - interval '3 hours' where org_id = '${this.orgId}' and closed_at >= '${marker}'::timestamptz`));
    });
  }

  // --- Programs --------------------------------------------------------------------------------

  private async create(spec: ProgramSeed, startDate: IsoDate): Promise<void> {
    const ctx = this.ctx(spec.owner);
    const account = spec.account ? await this.picker.pick({ type: 'crm_account', account: spec.account }) : null;
    const deal = spec.deal ? await this.picker.pick({ type: 'crm_item', deal: spec.deal }) : null;
    if (spec.account && !account) this.warn(`${spec.key}: CRM account ${spec.account} not found (run the CRM seed first)`);
    if (spec.deal && !deal) this.warn(`${spec.key}: CRM deal ${spec.deal} not found (run the CRM seed first)`);
    const core = spec.coreCustomer ? await this.picker.pick({ type: 'core_customer', code: spec.coreCustomer }) : null;
    const coreItems = new Map<string, string>();
    for (const variant of spec.variants) {
      if (!variant.coreItemSku) continue;
      const found = await db.execute<{ id: string }>(sql`select id::text from core.items where org_id = ${this.orgId}::uuid and sku = ${variant.coreItemSku} limit 1`);
      if (found.rows[0]) coreItems.set(variant.key, found.rows[0].id);
      else this.warn(`${spec.key}: core item ${variant.coreItemSku} not found`);
    }
    const axisId = (name: string) => `axis-${name.toLowerCase()}`;
    const valueId = (axis: string, code: string) => `${axis.toLowerCase()}-${code.toLowerCase()}`;
    const matrix = Boolean(spec.axes?.length);
    const payload: ProgramWizardPayload = {
      start: deal ? { mode: 'deal', crmItemId: deal.id } : { mode: 'scratch' },
      basics: {
        name: spec.name,
        key: spec.key,
        description: spec.description,
        customer: account ? { kind: 'crm_account', id: account.id } : core ? { kind: 'core', id: core.id } : null,
        ownerId: this.id(spec.owner)!,
        startDate,
        endDate: null,
        unit: spec.unit,
        timezone: TIMEZONE,
        calendar: { useWorkspace: spec.workingDays === null, workingDays: spec.workingDays ? [...spec.workingDays] : null, extraDaysOff: [], extraWorkDays: [] },
        color: spec.color,
        icon: spec.icon,
        monthlyTargetCents: spec.targetCents ?? null,
      },
      variants: {
        mode: matrix ? 'matrix' : 'list',
        axes: (spec.axes ?? []).map((axis) => ({ id: axisId(axis.name), name: axis.name, values: axis.values.map((v) => ({ id: valueId(axis.name, v.code), label: v.label, code: v.code, color: (v.color ?? null) as never })) })),
        patterns: spec.patterns ?? { name: '', key: '', sku: null },
        rows: matrix
          ? spec.variants.map((v) => ({
              comboKey: Object.entries(v.attrs ?? {})
                .map(([axis, code]) => `${axisId(axis)}=${valueId(axis, code)}`)
                .join('|'),
              include: true,
              name: v.name,
              key: v.key,
              sku: v.sku,
              defaultQty: v.defaultQty,
              unitPrice: v.unitPrice ?? null,
              coreItemId: coreItems.get(v.key) ?? null,
            }))
          : [],
        manual: matrix ? [] : spec.variants.map((v) => ({ name: v.name, key: v.key, sku: v.sku, defaultQty: v.defaultQty, unitPrice: v.unitPrice ?? null })),
      },
      priceCard: {
        later: false,
        effectiveFrom: startDate,
        lines: spec.card.lines.map((line) => this.wizardLine(line)),
        rules: spec.card.rules.map((rule) => ({ attributeId: rule.axis, valueId: rule.value, op: rule.op, amount: rule.amount })),
        oneTime: (spec.oneTime ?? []).map((charge) => ({ label: charge.label, amountCents: charge.amountCents, chargeOn: startDate })),
      },
      schedule: {
        enabled: true,
        name: spec.schedule.name,
        pattern: spec.schedule.pattern,
        days: [...spec.schedule.days],
        intervalWeeks: 1,
        startsOn: startDate,
        endsOn: null,
        leadDays: spec.schedule.leadDays,
        lines: spec.schedule.lines.map((line) => ({ variantKey: line.variantKey, qty: line.qty, qtyByWeekday: line.qtyByWeekday ? { ...line.qtyByWeekday } : null })),
      },
      links: {
        crmDealId: deal?.id ?? null,
        crmAccountId: account?.id ?? null,
        pulseJobId: null,
        projectIds: [],
        members: spec.members.flatMap((m) => (this.id(m.who) ? [{ userId: this.id(m.who)!, role: m.role }] : [])),
      },
    };
    await createProgram(ctx, payload, { versionSource: deal ? 'crm_deal' : 'seed' });
    const row = await db.execute<{ id: string }>(sql`select id::text from pm.projects where org_id = ${this.orgId}::uuid and key = ${spec.key} and kind = 'program' and deleted_at is null`);
    const id = row.rows[0]!.id;
    // The CRM edges carry the record names, the way the link dialog saves them.
    await db.execute(sql`update core.record_links l set cached_title = i.name, cached_status = case when l.to_type = 'crm_deal' then 'Won' else l.cached_status end, cached_at = now()
      from crm.items i where l.org_id = ${this.orgId}::uuid and l.from_type = 'pm_program' and l.from_id = ${id} and l.to_type in ('crm_account', 'crm_deal') and i.id::text = l.to_id`).catch(() => undefined);
    const { requireProgram } = await import('@/server/domain/programs/access');
    const access = await requireProgram(ctx, spec.key);
    const calendar = await programCalendar(ctx, access.program);
    this.built.set(spec.key, { spec, id, key: spec.key, startDate, calendar });

    // Standard minutes per variant (Pulse labor pace) and the schedule's skipped dates.
    const variants = await listVariants(ctx, spec.key);
    for (const variant of variants) {
      const seed = spec.variants.find((v) => v.key === variant.key);
      const patch = { ...(seed?.stdMinutes ? { stdMinutesPerUnit: seed.stdMinutes } : {}), ...(seed?.color ? { color: seed.color } : {}) };
      if (Object.keys(patch).length > 0) await updateVariant(ctx, variant.id, patch, variant.version);
    }
    const skips = spec.schedule.skipDates?.(this.today) ?? [];
    if (skips.length > 0) {
      const [schedule] = await listSchedules(ctx, spec.key);
      if (schedule) for (const date of skips) await skipDate(ctx, schedule.id, date);
    }
    // Prep tasks with comments and watchers.
    for (const task of spec.prepTasks) {
      const created = await createTask(ctx, {
        projectId: id,
        title: task.title,
        assigneeId: this.id(task.who),
        dueDate: addDays(this.today, task.due),
        watcherIds: (task.watchers ?? []).flatMap((w) => (this.id(w) ? [this.id(w)!] : [])),
      });
      this.prepTaskIds.set(`${spec.key}:${task.title}`, created.id);
      for (const [who, text] of task.comments ?? []) await addComment(this.ctx(who), { taskId: created.id, body: `<p>${text}</p>` });
    }
    log(`  ${spec.key}: made on ${startDate}`);
  }

  private readonly prepTaskIds = new Map<string, string>();

  private wizardLine(line: SeedCardLine): ProgramWizardPayload['priceCard']['lines'][number] {
    switch (line.kind) {
      case 'per_unit':
        return { kind: 'per_unit', variantKey: line.variantKey ?? null, unitPrice: line.unitPrice };
      case 'per_order':
        return { kind: 'per_order', amountCents: line.amountCents, label: line.label ?? null };
      case 'per_hour':
        return { kind: 'per_hour', rateCents: line.rateCents, label: line.label ?? null };
      default:
        return { kind: line.kind, amountCents: line.amountCents, prorate: line.prorate, chargeWhilePaused: true };
    }
  }

  private async prepTime(program: BuiltProgram, date: IsoDate): Promise<void> {
    if (date >= this.today) return;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const task of program.spec.prepTasks) {
      const time = task.billableTime;
      if (!time || !time.weekdays.includes(weekday) || !engineIsWorkDay(program.calendar, date)) continue;
      const taskId = this.prepTaskIds.get(`${program.key}:${task.title}`);
      if (!taskId) continue;
      const minutes = time.minutes[Math.floor(hash01(`${program.key}:${date}:prep`) * time.minutes.length)] ?? 60;
      await addManualTime(this.ctx(time.who), { taskId, minutes, date, note: 'Sorted returns and recounted the bins', billable: true });
    }
  }

  /** Prep tasks marked done finish on their due day (or the day the program starts, if later). */
  private async prepDone(program: BuiltProgram, date: IsoDate): Promise<void> {
    const due = program.spec.prepTasks.filter((t) => t.done && addDays(this.today, Math.min(t.due, 0)) <= date && !this.prepFinished.has(`${program.key}:${t.title}`));
    if (due.length === 0) return;
    const done = await db.execute<{ id: string }>(sql`select id::text from pm.statuses where project_id = ${program.id}::uuid and category = 'done' order by position limit 1`);
    const statusId = done.rows[0]?.id;
    if (!statusId) return;
    for (const task of due) {
      const taskId = this.prepTaskIds.get(`${program.key}:${task.title}`);
      if (!taskId) continue;
      await updateTask(this.ctx(task.who), taskId, { statusId });
      this.prepFinished.add(`${program.key}:${task.title}`);
    }
  }

  private readonly prepFinished = new Set<string>();

  private async buildsOf(programId: string, date: IsoDate): Promise<SeedBuildRow[]> {
    const result = await db.execute<{ id: string; key: string | null; planned: string; built: string; build_date: string; done: boolean }>(sql`
      select b.task_id::text as id, v.key, b.planned_qty::text as planned, b.built_qty::text as built, b.build_date::text, (b.finished_on is not null) as done
        from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null
        left join pm.program_variants v on v.id = b.variant_id
       where b.program_id = ${programId}::uuid and b.build_date = ${date}::date
       order by v.position nulls last, t.number`);
    return result.rows.map((r) => ({ id: r.id, variantKey: r.key, plannedQty: String(Number(r.planned)), builtQty: String(Number(r.built)), buildDate: r.build_date, done: r.done }));
  }

  /** Builds finished on a past seed day carry the database date; move them to that day. */
  private async backdateFinish(program: BuiltProgram, date: IsoDate): Promise<void> {
    if (date >= this.today) return;
    const moved = await db.execute<{ id: string }>(sql`
      update pm.builds set first_finished_on = ${date}::date, finished_on = ${date}::date
       where program_id = ${program.id}::uuid and finished_on is not null and finished_on > ${date}::date returning task_id::text as id`);
    if (moved.rows.length === 0) return;
    await db.transaction(async (tx) => {
      await refreshLedgerFor(tx, { ...this.ctx(this.spec.me), actorKind: 'system' }, { programIds: [program.id], dates: [date, this.today] });
    });
  }

  private dayApi(program: BuiltProgram, date: IsoDate): DayApi {
    const offset = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${this.today}T12:00:00Z`)) / 86_400_000);
    const owner = this.ctx(program.spec.owner);
    const variantId = async (key: string) => {
      const found = await db.execute<{ id: string }>(sql`select id::text from pm.program_variants where program_id = ${program.id}::uuid and key = ${key} and deleted_at is null`);
      return found.rows[0]?.id ?? null;
    };
    return {
      date,
      today: this.today,
      isToday: date === this.today,
      offset,
      weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
      builds: (on) => this.buildsOf(program.id, on ?? date),
      log: async (rows: readonly SeedLogRow[], options) => {
        if (rows.length === 0 && !options?.closeShort?.length) return;
        const entries: Parameters<typeof logOutput>[2]['entries'] = [];
        for (const row of rows) {
          if (row.buildId) entries.push({ buildId: row.buildId, mode: 'add', qty: row.qty, markDone: row.done ?? false, note: row.note });
          else if (row.newVariantKey) entries.push({ newBuild: { variantId: await variantId(row.newVariantKey) }, qty: row.qty, markDone: row.done ?? false, note: row.note });
        }
        await logOutput(owner, program.key, {
          date: options?.on ?? date,
          entries,
          endOfDay: options?.closeShort?.length ? { decisions: options.closeShort.map((c) => ({ buildId: c.buildId, action: 'close_short' as const, reason: c.reason })) } : undefined,
        });
        await this.backdateFinish(program, options?.on ?? date);
      },
      comment: async (taskId, who, text) => {
        await addComment(this.ctx(who), { taskId, body: `<p>${text}</p>` });
      },
      rateOverride: async (buildId, unitPrice, reason) => {
        await updateBuild(owner, buildId, { rateOverride: unitPrice, rateOverrideReason: reason });
      },
      newBuilds: async (rows) => {
        for (const row of rows) await createBuild(owner, program.key, { variantId: await variantId(row.variantKey), buildDate: row.date, plannedQty: row.qty });
      },
      time: async (taskId, who, minutes, billable) => {
        await addManualTime(this.ctx(who), { taskId, minutes, date, billable });
      },
      span: async (buildId, from, to) => {
        await updateTask(owner, buildId, { startDate: from, dueDate: to });
      },
      random: (salt) => hash01(`${program.key}:${salt}`),
      isWorkDay: (day) => engineIsWorkDay(program.calendar, day),
    };
  }

  // --- Org level -------------------------------------------------------------------------------

  private monthStart(months: number): IsoDate {
    const [y, m] = this.today.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + months, 1));
    return d.toISOString().slice(0, 10);
  }

  private async resolvedLines(ctx: DomainContext, key: string, lines: readonly SeedCardLine[]): Promise<ResolvedLine[]> {
    const variants = await listVariants(ctx, key);
    return lines.map((line) => {
      const base = this.wizardLine(line);
      const variantKey = line.kind === 'per_unit' ? line.variantKey : undefined;
      return { ...base, variantKey: undefined, variantId: variantKey ? (variants.find((v) => v.key === variantKey)?.id ?? null) : null } as ResolvedLine;
    });
  }

  private async resolvedRules(ctx: DomainContext, key: string, rules: readonly SeedRule[]) {
    const attributes = await listAttributes(ctx, key);
    return rules.map((rule) => {
      const attribute = attributes.find((a) => a.name === rule.axis);
      const value = attribute?.values.find((v) => v.code === rule.value);
      if (!attribute || !value) throw new Error(`Seed: ${key} has no ${rule.axis} value ${rule.value}`);
      return { attributeId: attribute.id, valueId: value.id, op: rule.op, amount: rule.amount };
    });
  }

  private orgApi(date: IsoDate): OrgDayApi {
    const offset = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${this.today}T12:00:00Z`)) / 86_400_000);
    return {
      date,
      today: this.today,
      offset,
      monthStart: (months) => this.monthStart(months),
      nthWorkDay: (start, n) => {
        let count = 0;
        for (let day = start; day.slice(0, 7) === start.slice(0, 7); day = addDays(day, 1)) {
          if (this.workspaceWorkDay(day)) count += 1;
          if (count === n) return day;
        }
        return start;
      },
      publishVersion: async (key, input) => {
        const ctx = this.ctx(input.by);
        const draft = await createDraftVersion(ctx, key, { from: 'empty', effectiveFrom: input.effectiveFrom });
        const filled = await updateDraftVersion(ctx, draft.id, { lines: await this.resolvedLines(ctx, key, input.lines), rules: await this.resolvedRules(ctx, key, input.rules) }, draft.version);
        await publishVersion(ctx, filled.id, filled.version);
      },
      draftVersion: async (key, input) => {
        const ctx = this.ctx(input.by);
        const draft = await createDraftVersion(ctx, key, { from: 'empty', effectiveFrom: input.effectiveFrom });
        await updateDraftVersion(ctx, draft.id, { lines: await this.resolvedLines(ctx, key, input.lines), rules: await this.resolvedRules(ctx, key, input.rules), note: input.note ?? null }, draft.version);
        if (input.askReview) await requestReview(ctx, draft.id);
      },
      closeMonth: async (key, month, by) => {
        await closeMonth(this.ctx(by), key, month, { adjustmentsReviewed: true });
      },
      adjustment: async (key, input) => {
        await addOneTimeCharge(this.ctx(input.by), key, { kind: 'adjustment', chargeOn: date, amountCents: input.amountCents, label: input.label, reason: input.reason, countsTowardMinimum: input.countsTowardMinimum });
      },
      projectBuild: async (projectKey, input) => {
        await createBuild(this.ctx(input.by), projectKey, { variantId: null, buildDate: addDays(this.today, input.offset), plannedQty: input.qty, title: input.title });
      },
      wizardDraft: async (input) => {
        const ctx = this.ctx(input.by);
        const deal = input.deal ? await this.picker.pick({ type: 'crm_item', deal: input.deal }) : null;
        const prefill = deal ? await wizardPrefill(ctx, { crmItemId: deal.id }).catch(() => null) : null;
        const base = prefill ?? emptyPayload({ ownerId: ctx.userId, timezone: TIMEZONE, today: this.today });
        const b = base.basics;
        const account = b.customer?.kind === 'crm_account' ? await this.picker.pick({ type: 'crm_account', account: input.deal?.split(' · ')[0] ?? '' }) : null;
        // Drafts hold the wizard's own state (v1, merged over an empty wizard when it opens), at the
        // step the person stopped on (0 Start, 1 Basics, 2 Variants).
        const steps = ['start', 'basics', 'variants', 'price', 'schedule', 'review'] as const;
        const state = {
          v: 1,
          step: steps[Math.max(0, Math.min(steps.length - 1, input.step))],
          start: { mode: deal ? 'deal' : 'scratch', crmItemId: deal?.id ?? null, crmItemTitle: deal?.label ?? null, templateId: null, templateName: null, copyKey: null },
          basics: {
            name: b.name || input.title,
            key: b.key || 'LINER',
            keyEdited: true,
            description: b.description ?? '',
            customer: b.customer ? { ...b.customer, name: account?.label ?? 'Customer' } : null,
            ownerId: ctx.userId,
            startDate: b.startDate,
            endDate: b.endDate ?? null,
          },
          variants: {},
          price: {},
          schedule: {},
          links: { crmDealId: deal?.id ?? null, crmDealTitle: deal?.label ?? null, crmAccountId: base.links.crmAccountId ?? null, crmAccountTitle: account?.label ?? null },
        };
        await saveDraft(ctx, { title: input.title, step: input.step, payload: state as unknown as Record<string, unknown> });
      },
      template: async (key, input) => {
        await saveProgramTemplate(this.ctx(input.by), key, { name: input.name, description: input.description });
      },
      linkKit: async (key, variantKey, wmsSku) => {
        const ctx = this.ctx(this.spec.me);
        const variant = (await listVariants(ctx, key)).find((v) => v.key === variantKey);
        if (!variant) return;
        const product = await db
          .execute<{ id: string; name: string }>(sql`select id::text, coalesce(name, sku) as name from wms.products where sku = ${wmsSku} limit 1`)
          .catch(() => ({ rows: [] as { id: string; name: string }[] }));
        if (!product.rows[0]) {
          this.warn(`${key}: WMS product ${wmsSku} not found`);
          return;
        }
        await linkVariantKit(ctx, variant.id, { wmsProductId: product.rows[0].id, title: product.rows[0].name, sku: wmsSku });
      },
    };
  }

  private async finish(): Promise<void> {
    const ctx = this.ctx(this.spec.me);
    if (this.spec.finish) await this.spec.finish(this.orgApi(this.today));
    await runProgramSweep(ctx);
    // Demo people have used Projects for months: no first run welcome or tour (the CRM seed
    // recreates the users, which drops their saved prefs).
    for (const person of this.contexts.values()) {
      const prefs = await getUserPrefs(person);
      const home = (prefs.home ?? {}) as Record<string, unknown>;
      await updateUserPrefs(person, { onboarding: { ...prefs.onboarding, welcomeSeen: true, tourSeen: true, dismissed: true }, home: { ...home, gettingStartedDismissed: true } });
    }
    // A program was last updated when output was last logged on it (the directory's "Updated").
    await db.execute(sql`update pm.projects p set updated_at = greatest(p.updated_at, o.at)
      from (select program_id, max(greatest(created_at, updated_at)) as at from pm.build_output
             where org_id = ${this.orgId}::uuid and deleted_at is null and program_id is not null group by program_id) o
     where p.id = o.program_id and p.org_id = ${this.orgId}::uuid`);
    // The inbox: program notices older than two days were read.
    await db.execute(sql`update pm.notifications set read_at = created_at + interval '3 hours'
      where org_id = ${this.orgId}::uuid and read_at is null and created_at < now() - interval '2 days'
        and project_id in (select id from pm.projects where org_id = ${this.orgId}::uuid and kind = 'program')`);
  }
}
