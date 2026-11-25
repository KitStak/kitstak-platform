/**
 * Internal plumbing shared by the program domain modules (docs/programs/SPEC.md 4.2): the clock,
 * settings rows, the bridge executor, money visibility helpers and the program lock order.
 * Not exported from the barrel.
 */
import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BridgeExecutor } from '@kitstak/pulse-bridge';
import type { Executor as SharedExecutor } from '@kitstak/db/programs';
import { mergeProgramCalendar, parseHolidays, parsePausedRanges, safeTimezone } from '@kitstak/db/programs';
import { todayIn } from '@kitstak/programs-engine/schedule';
import { monthOf } from '@kitstak/programs-engine/calendar';
import type { Cents, IsoDate, IsoMonth, ProgramCalendar } from '@kitstak/programs-engine/types';
import { db, type Executor } from '@/server/db';
import { orgCalendar, programSettings, projects, type Project, type ProgramSettingsRow } from '@/server/db/schema';
import { DomainError, notFound } from '@/server/errors';
import { DEFAULT_PROGRAM_TIMEZONE } from '@/lib/constants';
import type { ProgramCalendarDTO, ProgramSettingsDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';

// --- Clock ---------------------------------------------------------------------------------------

let clock: () => Date = () => new Date();

/** Test and seed hook: make every program "now" read from `fn` (restore with `resetProgramClock`). */
export function setProgramClock(fn: () => Date): void {
  clock = fn;
}

export function resetProgramClock(): void {
  clock = () => new Date();
}

export function programNow(): Date {
  return clock();
}

/** Today in a time zone, on the program clock. */
export function todayInZone(timezone: string | null | undefined): IsoDate {
  return todayIn(safeTimezone(timezone ?? DEFAULT_PROGRAM_TIMEZONE), programNow());
}

// --- Executors -----------------------------------------------------------------------------------

/** The Drizzle executor as the structural executor of `@kitstak/db` helpers. */
export const shared = (executor: Executor = db): SharedExecutor => executor as unknown as SharedExecutor;
/** The Drizzle executor as a pulse-bridge executor. */
export const bridge = (executor: Executor = db): BridgeExecutor => executor as unknown as BridgeExecutor;

// --- Money visibility ----------------------------------------------------------------------------

/** Cents as a decimal string, or null when money is hidden. */
export function centsOut(value: Cents | bigint | string | number | null | undefined, hidden: boolean): string | null {
  if (hidden || value === null || value === undefined) return null;
  return typeof value === 'bigint' ? value.toString() : String(value);
}

/** Months (`YYYY-MM`) of a list of dates, sorted and unique. */
export function monthsOf(dates: Iterable<IsoDate | null | undefined>): IsoMonth[] {
  const out = new Set<IsoMonth>();
  for (const date of dates) if (date) out.add(monthOf(date));
  return [...out].sort();
}

// --- Programs and settings -----------------------------------------------------------------------

export function assertProgram(project: Project): void {
  if (project.kind !== 'program') throw notFound('That program');
}

export async function loadSettings(executor: Executor, programId: string): Promise<ProgramSettingsRow> {
  const [row] = await executor.select().from(programSettings).where(eq(programSettings.programId, programId));
  if (!row) throw new DomainError('NOT_FOUND', "This program's settings are missing. Ask an admin to repair it.");
  return row;
}

/** Locks settings rows in one order (8.4): `FOR UPDATE` for money writers, `FOR SHARE` for output. */
export async function lockSettings(tx: Executor, programIds: readonly string[], mode: 'update' | 'share'): Promise<void> {
  const ids = [...new Set(programIds)].sort();
  if (ids.length === 0) return;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  if (mode === 'update') {
    await tx.execute(sql`select program_id from pm.program_settings where program_id in (${list}) order by program_id for update`);
  } else {
    await tx.execute(sql`select program_id from pm.program_settings where program_id in (${list}) order by program_id for share`);
  }
}

/** Live programs by id (any status). */
export async function loadPrograms(executor: Executor, ctx: DomainContext, ids: readonly string[]): Promise<Project[]> {
  if (ids.length === 0) return [];
  return executor
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, ctx.orgId), inArray(projects.id, [...new Set(ids)]), eq(projects.kind, 'program'), isNull(projects.deletedAt)));
}

export interface OrgCalendarFacts {
  readonly timezone: string;
  readonly workingDays: readonly number[];
  readonly holidays: readonly { date: IsoDate; name: string }[];
  readonly dailyCapacityHours: string | null;
  readonly version: number;
}

export async function loadOrgCalendar(executor: Executor, orgId: string): Promise<OrgCalendarFacts> {
  const [row] = await executor.select().from(orgCalendar).where(eq(orgCalendar.orgId, orgId));
  return {
    timezone: safeTimezone(row?.timezone ?? DEFAULT_PROGRAM_TIMEZONE),
    workingDays: row?.workingDays?.length ? row.workingDays : [1, 2, 3, 4, 5],
    holidays: parseHolidays(row?.holidays ?? []),
    dailyCapacityHours: row?.dailyCapacityHours ?? null,
    version: row?.version ?? 0,
  };
}

/** A15: the program's calendar from the workspace calendar and its own settings. */
export function mergeCalendar(org: OrgCalendarFacts, program: Pick<Project, 'startDate' | 'dueDate'>, settings: ProgramSettingsRow): ProgramCalendar {
  return mergeProgramCalendar(
    { timezone: org.timezone, workingDays: [...org.workingDays], holidays: [...org.holidays] },
    {
      timezone: settings.timezone,
      workingDays: settings.workingDays,
      useOrgHolidays: settings.useOrgHolidays,
      extraDaysOff: settings.extraDaysOff ?? [],
      extraWorkDays: settings.extraWorkDays ?? [],
      pausedRanges: parsePausedRanges(settings.pausedRanges ?? []),
      activeFrom: program.startDate ?? null,
      activeTo: program.dueDate ?? null,
    },
  );
}

export async function calendarFor(executor: Executor, ctx: DomainContext, program: Project, settings?: ProgramSettingsRow): Promise<ProgramCalendar> {
  const [org, row] = await Promise.all([loadOrgCalendar(executor, ctx.orgId), settings ? Promise.resolve(settings) : loadSettings(executor, program.id)]);
  return mergeCalendar(org, program, row);
}

export function toSettingsDTO(row: ProgramSettingsRow, moneyHidden: boolean): ProgramSettingsDTO {
  return {
    programId: row.programId,
    unitSingular: row.unitSingular,
    unitPlural: row.unitPlural,
    timezone: row.timezone,
    workingDays: row.workingDays ?? null,
    useOrgHolidays: row.useOrgHolidays,
    extraDaysOff: row.extraDaysOff ?? [],
    extraWorkDays: row.extraWorkDays ?? [],
    currency: row.currency,
    monthlyTargetCents: centsOut(row.monthlyTargetCents, moneyHidden),
    dailyTargetUnits: row.dailyTargetUnits ?? null,
    buildTitlePattern: row.buildTitlePattern,
    autoStartOnOutput: row.autoStartOnOutput,
    autoDoneWhenFull: row.autoDoneWhenFull,
    moneyMinRole: row.moneyMinRole,
    hourlyTimeBasis: row.hourlyTimeBasis,
    remindAt: row.remindAt ? row.remindAt.slice(0, 5) : null,
    pausedRanges: parsePausedRanges(row.pausedRanges ?? []),
    lockedThrough: row.lockedThrough ?? null,
    settledThrough: row.settledThrough ?? null,
    version: row.version,
  };
}

export function toCalendarDTO(calendar: ProgramCalendar, today: IsoDate, nextWorkDay: IsoDate): ProgramCalendarDTO {
  return {
    timezone: calendar.timezone,
    workingDays: calendar.workingDays,
    daysOff: calendar.daysOff,
    extraWorkDays: calendar.extraWorkDays,
    activeFrom: calendar.activeFrom,
    activeTo: calendar.activeTo,
    paused: calendar.paused,
    today,
    nextWorkDay,
  };
}

/** Optimistic version check (8.4). */
export function versionConflict(): DomainError {
  return new DomainError('CONFLICT', 'Someone else changed this. Reload to see their change.');
}

/** "Nov 25" for UI messages. */
export function dayText(date: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "October" for UI messages. */
export function monthName(month: IsoMonth): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
}

/** Unique, sorted. */
export function uniq<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}

/** The SQLSTATE and constraint of a Postgres error, through Drizzle's wrapper. */
export function pgError(error: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const value = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof value.code === 'string' && /^[0-9A-Z]{5}$/.test(value.code)) {
      return { code: value.code, constraint: typeof value.constraint === 'string' ? value.constraint : undefined };
    }
    current = value.cause;
  }
  return null;
}
