/**
 * The only SQL that reads program money inputs (docs/programs/SPEC.md 3.14 and 4.3.1). Projects
 * (ledger writer, summary, statements), pm-bridge (CRM and WMS panels) and Pulse (sync) all read
 * the same rows through these functions, so the same filters apply everywhere:
 *
 * - Output: `pm.build_output.deleted_at IS NULL`, joined to `pm.tasks` and `pm.projects`, both live.
 * - Finished: builds with `finished_on` in the month, task and container live, status category not
 *   `cancelled`, `built_qty > 0`.
 * - Time: `pm.time_entries` live, ended, `duration_minutes > 0`, task and project live, task in the
 *   program; `billable = true` unless the program's `hourly_time_basis = 'all'`; the day is
 *   `(started_at AT TIME ZONE <program zone>)::date`.
 * - One time charges: live rows with `charge_on` in the month.
 * - Versions: published and live, with their lines and rate rules.
 * - Calendar: the A15 merge (`mergeProgramCalendar`).
 *
 * Raw `sql` over a structural executor, driver portable. Nothing here throws because Programs is
 * not installed: every reader returns empty results and `programsAvailable` reports false.
 */
import { sql } from 'drizzle-orm';
import type {
  CardLine,
  CardVersion,
  FinishedBuild,
  IsoDate,
  IsoMonth,
  LedgerKind,
  LedgerRow,
  OneTimeCharge,
  OutputRow,
  Posting,
  PriceLineKind,
  PriceSource,
  ProgramCalendar,
  RateRule,
  TimeDay,
} from '@kitstak/programs-engine/types';
import { mergeProgramCalendar, parseHolidays, parsePausedRanges, safeTimezone } from './calendar';
import {
  isIsoDate,
  isIsoMonth,
  isUuid,
  queryFirst,
  queryRows,
  sqlUuidList,
  textOf,
  textOrNull,
  ttlCache,
  type Executor,
} from './executor';

/** The month inputs of `monthCharges` without `asOf` (the caller passes today in the program zone). */
export interface ProgramMonthInputs {
  readonly programId: string;
  readonly month: IsoMonth;
  readonly calendar: ProgramCalendar;
  readonly versions: readonly CardVersion[];
  readonly output: readonly OutputRow[];
  readonly finished: readonly FinishedBuild[];
  readonly time: readonly TimeDay[];
  readonly oneTime: readonly OneTimeCharge[];
}

/** A ledger row as stored, with where its money goes. */
export interface ProgramLedgerRow extends LedgerRow {
  readonly month: IsoDate;
  readonly posting: 'program' | 'program_job';
  readonly pulseJobId: string | null;
}

export interface ProgramMonthRead {
  readonly output: OutputRow[];
  readonly ledger: ProgramLedgerRow[];
  readonly settledThrough: IsoDate | null;
}

export interface ProgramsAvailability {
  /** `pm.projects.kind` exists (Projects 0006 applied). */
  readonly kinds: boolean;
  /** The program tables exist (`pm.build_output`, `pm.program_ledger`). */
  readonly tables: boolean;
}

/** Settings and calendar facts of one program, as the loader reads them. */
export interface ProgramFacts {
  readonly programId: string;
  readonly calendar: ProgramCalendar;
  readonly hourlyTimeBasis: 'billable' | 'all';
  readonly settledThrough: IsoDate | null;
  readonly lockedThrough: IsoDate | null;
}

const availability = ttlCache<ProgramsAvailability>();

/** Feature detection, cached for a minute per executor. Never throws. */
export async function programsAvailable(db: Executor): Promise<ProgramsAvailability> {
  const cached = availability.get(db);
  if (cached) return cached;
  let value: ProgramsAvailability = { kinds: false, tables: false };
  try {
    const row = await queryFirst<{ kinds: boolean; tables: boolean }>(
      db,
      sql`select exists (select 1 from information_schema.columns
                          where table_schema = 'pm' and table_name = 'projects' and column_name = 'kind') as kinds,
                 (to_regclass('pm.build_output') is not null and to_regclass('pm.program_ledger') is not null
                  and to_regclass('pm.program_settings') is not null and to_regclass('pm.builds') is not null) as tables`,
    );
    value = { kinds: row?.kinds === true, tables: row?.tables === true };
  } catch {
    value = { kinds: false, tables: false };
  }
  availability.set(db, value);
  return value;
}

/** Test hook: forget the cached availability for an executor. */
export function resetProgramsAvailability(db: Executor): void {
  availability.clear(db);
}

function monthBounds(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function numberList(value: unknown): number[] | null {
  const list = jsonOf(value);
  return Array.isArray(list) ? list.map(Number).filter((n) => Number.isInteger(n)) : null;
}

function dateList(value: unknown): IsoDate[] {
  const list = jsonOf(value);
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 10)) : [];
}

function emptyCalendar(): ProgramCalendar {
  return mergeProgramCalendar(null, {
    timezone: null,
    workingDays: null,
    useOrgHolidays: true,
    extraDaysOff: [],
    extraWorkDays: [],
    pausedRanges: [],
    activeFrom: null,
    activeTo: null,
  });
}

interface FactsRow {
  start_date: string | null;
  due_date: string | null;
  timezone: string | null;
  working_days: unknown;
  use_org_holidays: boolean | null;
  extra_days_off: unknown;
  extra_work_days: unknown;
  paused_ranges: unknown;
  hourly_time_basis: string | null;
  settled_through: string | null;
  locked_through: string | null;
  org_timezone: string | null;
  org_working_days: unknown;
  org_holidays: unknown;
}

/** The program's merged calendar and money settings, or null when the program does not exist. */
export async function loadProgramFacts(db: Executor, orgId: string, programId: string): Promise<ProgramFacts | null> {
  if (!isUuid(orgId) || !isUuid(programId)) return null;
  if (!(await programsAvailable(db)).tables) return null;
  const row = await queryFirst<FactsRow>(
    db,
    sql`select p.start_date::text as start_date, p.due_date::text as due_date,
               ps.timezone, to_jsonb(ps.working_days) as working_days, ps.use_org_holidays,
               to_jsonb(ps.extra_days_off) as extra_days_off, to_jsonb(ps.extra_work_days) as extra_work_days,
               ps.paused_ranges, ps.hourly_time_basis, ps.settled_through::text as settled_through,
               ps.locked_through::text as locked_through,
               oc.timezone as org_timezone, to_jsonb(oc.working_days) as org_working_days, oc.holidays as org_holidays
          from pm.projects p
          left join pm.program_settings ps on ps.program_id = p.id
          left join pm.org_calendar oc on oc.org_id = p.org_id
         where p.id = ${programId}::uuid and p.org_id = ${orgId}::uuid`,
  );
  if (!row) return null;
  const calendar = mergeProgramCalendar(
    { timezone: row.org_timezone, workingDays: numberList(row.org_working_days), holidays: parseHolidays(jsonOf(row.org_holidays)) },
    {
      timezone: row.timezone,
      workingDays: numberList(row.working_days),
      useOrgHolidays: row.use_org_holidays !== false,
      extraDaysOff: dateList(row.extra_days_off),
      extraWorkDays: dateList(row.extra_work_days),
      pausedRanges: parsePausedRanges(jsonOf(row.paused_ranges)),
      activeFrom: row.start_date,
      activeTo: row.due_date,
    },
  );
  return {
    programId,
    calendar,
    hourlyTimeBasis: row.hourly_time_basis === 'all' ? 'all' : 'billable',
    settledThrough: row.settled_through,
    lockedThrough: row.locked_through,
  };
}

interface VersionRaw {
  id: string;
  number: number | string | null;
  effective_from: string;
}
interface LineRaw {
  id: string;
  version_id: string;
  kind: string;
  variant_id: string | null;
  rule_id: string | null;
  unit_price: string | null;
  rate_cents: number | string | null;
  amount_cents: string | number | null;
  prorate: boolean;
  charge_while_paused: boolean;
  label: string | null;
}
interface RuleRaw {
  id: string;
  version_id: string;
  attribute_id: string;
  value_id: string;
  op: string;
  amount: string;
}

/** Published, live card versions of a program, oldest first, with lines and rules. */
export async function loadPublishedVersions(db: Executor, orgId: string, programId: string): Promise<CardVersion[]> {
  if (!isUuid(orgId) || !isUuid(programId)) return [];
  if (!(await programsAvailable(db)).tables) return [];
  const versions = await queryRows<VersionRaw>(
    db,
    sql`select v.id::text as id, v.number, v.effective_from::text as effective_from
          from pm.price_card_versions v
         where v.org_id = ${orgId}::uuid and v.program_id = ${programId}::uuid
           and v.status = 'published' and v.deleted_at is null
         order by v.effective_from, v.id`,
  );
  if (versions.length === 0) return [];
  const ids = sqlUuidList(versions.map((version) => version.id));
  const [lines, rules] = await Promise.all([
    queryRows<LineRaw>(
      db,
      sql`select l.id::text as id, l.version_id::text as version_id, l.kind, l.variant_id::text as variant_id,
                 l.rule_id::text as rule_id, l.unit_price::text as unit_price, l.rate_cents,
                 l.amount_cents::text as amount_cents, l.prorate, l.charge_while_paused, l.label
            from pm.price_card_lines l
           where l.org_id = ${orgId}::uuid and l.version_id in ${ids}
           order by l.position, l.kind, l.variant_id nulls first, l.id`,
    ),
    queryRows<RuleRaw>(
      db,
      sql`select r.id::text as id, r.version_id::text as version_id, r.attribute_id::text as attribute_id,
                 r.value_id, r.op, r.amount::text as amount
            from pm.price_card_rules r
           where r.org_id = ${orgId}::uuid and r.version_id in ${ids}
           order by r.position, r.id`,
    ),
  ]);
  return versions.map((version) => ({
    id: version.id,
    number: version.number === null ? null : Number(version.number),
    effectiveFrom: version.effective_from,
    lines: lines
      .filter((line) => line.version_id === version.id)
      .map(
        (line): CardLine => ({
          id: line.id,
          kind: line.kind as PriceLineKind,
          variantId: line.variant_id,
          ruleId: line.rule_id,
          unitPrice: line.unit_price,
          rateCents: line.rate_cents === null ? null : Number(line.rate_cents),
          amountCents: line.amount_cents === null ? null : String(line.amount_cents),
          prorate: line.prorate,
          chargeWhilePaused: line.charge_while_paused,
          label: line.label,
        }),
      ),
    rules: rules
      .filter((rule) => rule.version_id === version.id)
      .map((rule): RateRule => ({ id: rule.id, attributeId: rule.attribute_id, valueId: rule.value_id, op: rule.op as 'add' | 'set', amount: rule.amount })),
  }));
}

interface OutputRaw {
  build_id: string;
  variant_id: string | null;
  work_date: string;
  qty: string;
  scrap_qty: string;
  unit_price: string;
  price_source: string;
  card_version_id: string | null;
  revenue_cents: string | number;
  posting: string;
  pulse_job_id: string | null;
}

const OUTPUT_COLUMNS = sql.raw(
  `o.build_id::text as build_id, o.variant_id::text as variant_id, o.work_date::text as work_date,
   o.qty::text as qty, o.scrap_qty::text as scrap_qty, o.unit_price::text as unit_price, o.price_source,
   o.card_version_id::text as card_version_id, o.revenue_cents::text as revenue_cents, o.posting,
   o.pulse_job_id::text as pulse_job_id`,
);

const LIVE_OUTPUT_JOINS = sql.raw(
  `join pm.tasks t on t.id = o.build_id and t.deleted_at is null
   join pm.projects p on p.id = t.project_id and p.deleted_at is null`,
);

function toOutputRow(raw: OutputRaw): OutputRow {
  return {
    buildId: raw.build_id,
    variantId: raw.variant_id,
    workDate: raw.work_date,
    qty: raw.qty,
    scrapQty: raw.scrap_qty,
    unitPrice: raw.unit_price,
    priceSource: raw.price_source as PriceSource,
    versionId: raw.card_version_id,
    revenueCents: textOf(raw.revenue_cents),
    posting: raw.posting as Posting,
    pulseJobId: raw.pulse_job_id,
  };
}

async function programOutput(db: Executor, orgId: string, programId: string, from: IsoDate, to: IsoDate): Promise<OutputRow[]> {
  const rows = await queryRows<OutputRaw>(
    db,
    sql`select ${OUTPUT_COLUMNS}
          from pm.build_output o
          ${LIVE_OUTPUT_JOINS}
         where o.org_id = ${orgId}::uuid and o.program_id = ${programId}::uuid and o.deleted_at is null
           and o.work_date between ${from}::date and ${to}::date
         order by o.work_date, o.build_id`,
  );
  return rows.map(toOutputRow);
}

/** Everything `monthCharges` needs for one program month, except `asOf`. */
export async function loadProgramMonthInputs(db: Executor, orgId: string, programId: string, month: IsoMonth): Promise<ProgramMonthInputs> {
  const empty: ProgramMonthInputs = { programId, month, calendar: emptyCalendar(), versions: [], output: [], finished: [], time: [], oneTime: [] };
  if (!isUuid(orgId) || !isUuid(programId) || !isIsoMonth(month)) return empty;
  if (!(await programsAvailable(db)).tables) return empty;
  const facts = await loadProgramFacts(db, orgId, programId);
  if (!facts) return empty;
  const { from, to } = monthBounds(month);
  const timezone = safeTimezone(facts.calendar.timezone);
  const billable = facts.hourlyTimeBasis === 'all' ? sql`` : sql` and te.billable = true`;

  const [versions, output, finishedRaw, timeRaw, oneTimeRaw] = await Promise.all([
    loadPublishedVersions(db, orgId, programId),
    programOutput(db, orgId, programId, from, to),
    queryRows<{ build_id: string; build_key: string; variant_id: string | null; finished_on: string; built_qty: string }>(
      db,
      sql`select b.task_id::text as build_id, p.key || '-' || t.number::text as build_key, b.variant_id::text as variant_id,
                 b.finished_on::text as finished_on, b.built_qty::text as built_qty
            from pm.builds b
            join pm.tasks t on t.id = b.task_id and t.deleted_at is null
            join pm.projects p on p.id = t.project_id and p.deleted_at is null
            join pm.statuses s on s.id = t.status_id
           where b.org_id = ${orgId}::uuid and b.program_id = ${programId}::uuid
             and b.finished_on between ${from}::date and ${to}::date
             and s.category <> 'cancelled' and b.built_qty > 0
           order by b.finished_on, b.task_id`,
    ),
    queryRows<{ work_date: string; task_id: string; kind: string; variant_id: string | null; minutes: number | string }>(
      db,
      sql`select (te.started_at at time zone ${timezone})::date::text as work_date, t.id::text as task_id, t.kind,
                 b.variant_id::text as variant_id, sum(te.duration_minutes)::bigint as minutes
            from pm.time_entries te
            join pm.tasks t on t.id = te.task_id and t.deleted_at is null
            join pm.projects p on p.id = t.project_id and p.deleted_at is null
            left join pm.builds b on b.task_id = t.id
           where te.org_id = ${orgId}::uuid and t.project_id = ${programId}::uuid
             and te.deleted_at is null and te.ended_at is not null and te.duration_minutes > 0${billable}
             and te.started_at >= (${from}::date::timestamp at time zone ${timezone})
             and te.started_at < ((${to}::date + 1)::timestamp at time zone ${timezone})
           group by 1, 2, 3, 4
           order by 1, 2`,
    ),
    queryRows<{ id: string; kind: string; charge_on: string; amount_cents: string | number; label: string; variant_id: string | null; counts_toward_minimum: boolean }>(
      db,
      sql`select c.id::text as id, c.kind, c.charge_on::text as charge_on, c.amount_cents::text as amount_cents, c.label,
                 c.variant_id::text as variant_id, c.counts_toward_minimum
            from pm.program_one_time_charges c
           where c.org_id = ${orgId}::uuid and c.program_id = ${programId}::uuid and c.deleted_at is null
             and c.charge_on between ${from}::date and ${to}::date
           order by c.charge_on, c.id`,
    ),
  ]);

  return {
    programId,
    month,
    calendar: facts.calendar,
    versions,
    output,
    finished: finishedRaw.map((row) => ({ buildId: row.build_id, buildKey: row.build_key, variantId: row.variant_id, finishedOn: row.finished_on, builtQty: row.built_qty })),
    time: timeRaw.map((row) => ({
      workDate: row.work_date,
      buildId: row.kind === 'build' ? row.task_id : null,
      variantId: row.kind === 'build' ? row.variant_id : null,
      minutes: Number(row.minutes),
    })),
    oneTime: oneTimeRaw.map((row) => ({
      id: row.id,
      kind: row.kind === 'adjustment' ? 'adjustment' : 'setup',
      chargeOn: row.charge_on,
      amountCents: textOf(row.amount_cents),
      label: row.label,
      variantId: row.variant_id,
      countsTowardMinimum: row.counts_toward_minimum === true,
    })),
  };
}

interface LedgerRaw {
  ref: string;
  kind: string;
  charge_date: string;
  month: string;
  cents: string | number;
  quantity: string | null;
  unit_price: string | null;
  variant_id: string | null;
  build_id: string | null;
  version_id: string | null;
  line_id: string | null;
  one_time_id: string | null;
  label: string;
  counts_toward_minimum: boolean;
  posting: string;
  pulse_job_id: string | null;
}

/** Live ledger rows of one program month, by charge date then ref. */
export async function readProgramLedger(db: Executor, orgId: string, programId: string, month: IsoMonth): Promise<ProgramLedgerRow[]> {
  if (!isUuid(orgId) || !isUuid(programId) || !isIsoMonth(month)) return [];
  if (!(await programsAvailable(db)).tables) return [];
  const rows = await queryRows<LedgerRaw>(
    db,
    sql`select l.ref, l.kind, l.charge_date::text as charge_date, l.month::text as month, l.cents::text as cents,
               l.quantity::text as quantity, l.unit_price::text as unit_price, l.variant_id::text as variant_id,
               l.build_id::text as build_id, l.version_id::text as version_id, l.line_id::text as line_id,
               l.one_time_id::text as one_time_id, l.label, l.counts_toward_minimum, l.posting,
               l.pulse_job_id::text as pulse_job_id
          from pm.program_ledger l
         where l.org_id = ${orgId}::uuid and l.program_id = ${programId}::uuid
           and l.month = ${`${month}-01`}::date and l.deleted_at is null
         order by l.charge_date, l.ref`,
  );
  return rows.map((row) => ({
    ref: row.ref,
    kind: row.kind as LedgerKind,
    chargeDate: row.charge_date,
    month: row.month,
    cents: BigInt(textOf(row.cents)),
    quantity: textOrNull(row.quantity),
    unitPrice: textOrNull(row.unit_price),
    variantId: row.variant_id,
    buildId: row.build_id,
    versionId: row.version_id,
    lineId: row.line_id,
    oneTimeId: row.one_time_id,
    label: row.label,
    countsTowardMinimum: row.counts_toward_minimum === true,
    posting: row.posting === 'program_job' ? 'program_job' : 'program',
    pulseJobId: row.pulse_job_id,
  }));
}

/** Stored money of one program month: output snapshots and posted fees (statements, pm-bridge, Pulse). */
export async function readProgramMonth(db: Executor, orgId: string, programId: string, month: IsoMonth): Promise<ProgramMonthRead> {
  if (!isUuid(orgId) || !isUuid(programId) || !isIsoMonth(month)) return { output: [], ledger: [], settledThrough: null };
  if (!(await programsAvailable(db)).tables) return { output: [], ledger: [], settledThrough: null };
  const { from, to } = monthBounds(month);
  const [output, ledger, settings] = await Promise.all([
    programOutput(db, orgId, programId, from, to),
    readProgramLedger(db, orgId, programId, month),
    queryFirst<{ settled_through: string | null }>(
      db,
      sql`select settled_through::text as settled_through from pm.program_settings
           where program_id = ${programId}::uuid and org_id = ${orgId}::uuid`,
    ),
  ]);
  return { output, ledger, settledThrough: settings?.settled_through ?? null };
}

/** Live output rows of the given builds in a date range (builds outside programs, Pulse build jobs). */
export async function readBuildOutput(
  db: Executor,
  orgId: string,
  buildIds: readonly string[],
  range: { from: IsoDate; to: IsoDate },
): Promise<OutputRow[]> {
  const ids = buildIds.filter(isUuid);
  if (!isUuid(orgId) || ids.length === 0 || !isIsoDate(range.from) || !isIsoDate(range.to)) return [];
  if (!(await programsAvailable(db)).tables) return [];
  const rows = await queryRows<OutputRaw>(
    db,
    sql`select ${OUTPUT_COLUMNS}
          from pm.build_output o
          ${LIVE_OUTPUT_JOINS}
         where o.org_id = ${orgId}::uuid and o.build_id in ${sqlUuidList(ids)} and o.deleted_at is null
           and o.work_date between ${range.from}::date and ${range.to}::date
         order by o.work_date, o.build_id`,
  );
  return rows.map(toOutputRow);
}

const TIME_FILTERS = sql.raw(
  `te.deleted_at is null and te.ended_at is not null and te.duration_minutes > 0`,
);

/** Labor minutes and head count per build per day, in the program zone (Pulse labor on `pmb` rows). */
export async function loadBuildHoursByDay(
  db: Executor,
  orgId: string,
  input: { buildIds: readonly string[]; timezone: string; from: IsoDate; to: IsoDate },
): Promise<{ buildId: string; workDate: IsoDate; minutes: number; people: number }[]> {
  const ids = input.buildIds.filter(isUuid);
  if (!isUuid(orgId) || ids.length === 0 || !isIsoDate(input.from) || !isIsoDate(input.to)) return [];
  if (!(await programsAvailable(db)).tables) return [];
  const timezone = safeTimezone(input.timezone);
  const rows = await queryRows<{ build_id: string; work_date: string; minutes: number | string; people: number | string }>(
    db,
    sql`select t.id::text as build_id, (te.started_at at time zone ${timezone})::date::text as work_date,
               sum(te.duration_minutes)::bigint as minutes, count(distinct te.user_id)::int as people
          from pm.time_entries te
          join pm.tasks t on t.id = te.task_id and t.deleted_at is null and t.kind = 'build'
          join pm.projects p on p.id = t.project_id and p.deleted_at is null
         where te.org_id = ${orgId}::uuid and te.task_id in ${sqlUuidList(ids)} and ${TIME_FILTERS}
           and te.started_at >= (${input.from}::date::timestamp at time zone ${timezone})
           and te.started_at < ((${input.to}::date + 1)::timestamp at time zone ${timezone})
         group by 1, 2
         order by 2, 1`,
  );
  return rows.map((row) => ({ buildId: row.build_id, workDate: row.work_date, minutes: Number(row.minutes), people: Number(row.people) }));
}

/**
 * Labor on program tasks that are not builds, per day (Pulse `pmt` rows). Tasks in `perTaskIds`
 * keep their own row; every other task's time folds into one program row per day (`taskId` null).
 */
export async function loadPrepTimeByDay(
  db: Executor,
  orgId: string,
  input: { programId: string; timezone: string; from: IsoDate; to: IsoDate; perTaskIds: readonly string[] },
): Promise<{ taskId: string | null; workDate: IsoDate; minutes: number; people: number }[]> {
  if (!isUuid(orgId) || !isUuid(input.programId) || !isIsoDate(input.from) || !isIsoDate(input.to)) return [];
  if (!(await programsAvailable(db)).tables) return [];
  const timezone = safeTimezone(input.timezone);
  const perTask = input.perTaskIds.filter(isUuid);
  const taskKey = perTask.length > 0 ? sql`case when t.id in ${sqlUuidList(perTask)} then t.id::text else null end` : sql`null::text`;
  const rows = await queryRows<{ task_id: string | null; work_date: string; minutes: number | string; people: number | string }>(
    db,
    sql`select ${taskKey} as task_id, (te.started_at at time zone ${timezone})::date::text as work_date,
               sum(te.duration_minutes)::bigint as minutes, count(distinct te.user_id)::int as people
          from pm.time_entries te
          join pm.tasks t on t.id = te.task_id and t.deleted_at is null and t.kind <> 'build'
          join pm.projects p on p.id = t.project_id and p.deleted_at is null
         where te.org_id = ${orgId}::uuid and t.project_id = ${input.programId}::uuid and ${TIME_FILTERS}
           and te.started_at >= (${input.from}::date::timestamp at time zone ${timezone})
           and te.started_at < ((${input.to}::date + 1)::timestamp at time zone ${timezone})
         group by 1, 2
         order by 2, 1 nulls first`,
  );
  return rows.map((row) => ({ taskId: row.task_id, workDate: row.work_date, minutes: Number(row.minutes), people: Number(row.people) }));
}

/**
 * One `pm.builds` row of a program in a date range, as the month plan reads it (SPEC 3.8): a build
 * whose task is live and whose status is not cancelled, with `build_date` in the range.
 */
export interface ProgramBuildRow {
  /** `task_id`. */
  readonly id: string;
  /** `build_date`. */
  readonly date: IsoDate;
  /** `planned_qty`, 3 places. */
  readonly planned: string;
  /** `built_qty`, 3 places. */
  readonly built: string;
  readonly variantId: string | null;
  /** `rate_override`, or null. */
  readonly rate: string | null;
}

/** Builds of a program dated in `range` (the planned builds of a month), oldest first. */
export async function loadProgramBuilds(db: Executor, orgId: string, programId: string, range: { from: IsoDate; to: IsoDate }): Promise<ProgramBuildRow[]> {
  if (!isUuid(orgId) || !isUuid(programId) || !isIsoDate(range.from) || !isIsoDate(range.to)) return [];
  if (!(await programsAvailable(db)).tables) return [];
  const rows = await queryRows<{ id: string; date: string; planned: string; built: string; variant_id: string | null; rate: string | null }>(
    db,
    sql`select b.task_id::text as id, b.build_date::text as date, b.planned_qty::text as planned, b.built_qty::text as built,
               b.variant_id::text as variant_id, b.rate_override::text as rate
          from pm.builds b
          join pm.tasks t on t.id = b.task_id and t.deleted_at is null
          join pm.statuses s on s.id = t.status_id
         where b.org_id = ${orgId}::uuid and b.program_id = ${programId}::uuid
           and b.build_date between ${range.from}::date and ${range.to}::date and s.category <> 'cancelled'
         order by b.build_date, b.task_id`,
  );
  return rows.map((row) => ({ id: row.id, date: row.date, planned: row.planned, built: row.built, variantId: row.variant_id, rate: textOrNull(row.rate) }));
}

/** One day of recent program revenue: output of live builds plus `per_order` and `per_hour` ledger rows. */
export interface ProgramTrailingDay {
  readonly date: IsoDate;
  /** Good units that day, 3 places. */
  readonly units: string;
  /** Whole cents as text. */
  readonly cents: string;
}

/**
 * Revenue per day of a program from `from` up to the day before `before` (the forecast's recent
 * days, SPEC 3.8): output snapshots of live builds plus per batch and per hour ledger rows, summed
 * per day, oldest first. The caller keeps the plannable days and the last 20.
 */
export async function loadTrailingDays(db: Executor, orgId: string, programId: string, range: { from: IsoDate; before: IsoDate }): Promise<ProgramTrailingDay[]> {
  if (!isUuid(orgId) || !isUuid(programId) || !isIsoDate(range.from) || !isIsoDate(range.before)) return [];
  if (!(await programsAvailable(db)).tables) return [];
  const rows = await queryRows<{ date: string; units: string; cents: string }>(
    db,
    sql`select d.date::text as date, coalesce(sum(d.units), 0)::text as units, coalesce(sum(d.cents), 0)::text as cents from (
          select o.work_date as date, o.qty as units, o.revenue_cents as cents
            from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
           where o.org_id = ${orgId}::uuid and o.program_id = ${programId}::uuid and o.deleted_at is null
             and o.work_date >= ${range.from}::date and o.work_date < ${range.before}::date
          union all
          select l.charge_date, 0, l.cents from pm.program_ledger l
           where l.org_id = ${orgId}::uuid and l.program_id = ${programId}::uuid and l.deleted_at is null
             and l.kind in ('per_order', 'per_hour') and l.charge_date >= ${range.from}::date and l.charge_date < ${range.before}::date
        ) d group by 1 order by 1`,
  );
  return rows.map((row) => ({ date: row.date, units: row.units, cents: textOf(row.cents) }));
}
