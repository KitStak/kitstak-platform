/**
 * Locks (docs/programs/SPEC.md M9, 4.3.4, A9). A date is locked for a program when its month is
 * closed in the program (`pm.program_closes`, a set of months, not a high water mark), or when
 * the day goes to a Pulse job and its month is closed in Pulse. Every write that can change a
 * stored money row on a locked date is refused with LOCKED.
 */
import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { getClosedMonths } from '@kitstak/pulse-bridge/programs';
import { monthOf } from '@kitstak/programs-engine/calendar';
import type { IsoDate, IsoMonth } from '@kitstak/programs-engine/types';
import { db, type Executor } from '@/server/db';
import { programCloses, programSettings, type Project } from '@/server/db/schema';
import { locked } from '@/server/errors';
import type { DomainContext } from '../_shared';
import { bridge, lockSettings, monthName } from './_program';

export interface ProgramLocks {
  readonly programId: string;
  readonly programKey: string;
  readonly lockedThrough: IsoDate | null;
  readonly programClosed: readonly IsoMonth[];
  readonly pulseClosed: readonly IsoMonth[];
  /** Pulse answered (its closed months are known). */
  readonly pulseApplies: boolean;
}

/** Pulse closed months per org, cached briefly inside one request burst. */
const pulseCache = new Map<string, { at: number; months: IsoMonth[]; applies: boolean }>();
const PULSE_TTL_MS = 5_000;

export async function pulseClosedMonths(ctx: DomainContext, executor: Executor = db): Promise<{ months: IsoMonth[]; applies: boolean }> {
  const cached = pulseCache.get(ctx.orgId);
  if (cached && Date.now() - cached.at < PULSE_TTL_MS && executor === db) return cached;
  const result = await getClosedMonths(bridge(executor), ctx.orgId);
  const value = result.available ? { months: result.months, applies: true } : { months: [], applies: false };
  if (executor === db) pulseCache.set(ctx.orgId, { at: Date.now(), ...value });
  return value;
}

/** Forget cached Pulse months (after a test inserts a closed period). */
export function resetPulseLockCache(): void {
  pulseCache.clear();
}

/**
 * The locks in force for a program. Inside a transaction (any executor but the pool) the settings
 * row is locked `FOR UPDATE` first, the row `closeMonth` and `reopenMonth` also lock, so the
 * answer cannot change before the caller's writes commit (M9 under concurrency, 8.4). Callers
 * that touch several programs lock them all with `lockSettings` (sorted) before calling this.
 */
export async function programLocks(ctx: DomainContext, program: Pick<Project, 'id' | 'key'>, executor: Executor = db): Promise<ProgramLocks> {
  if (executor !== db) await lockSettings(executor, [program.id], 'update');
  const [closes, settings, pulse] = await Promise.all([
    executor
      .select({ month: programCloses.month })
      .from(programCloses)
      .where(and(eq(programCloses.programId, program.id), isNull(programCloses.reopenedAt))),
    executor.select({ lockedThrough: programSettings.lockedThrough }).from(programSettings).where(eq(programSettings.programId, program.id)),
    pulseClosedMonths(ctx, executor),
  ]);
  return {
    programId: program.id,
    programKey: program.key,
    lockedThrough: settings[0]?.lockedThrough ?? null,
    programClosed: [...new Set(closes.map((row) => monthOf(row.month)))].sort(),
    pulseClosed: pulse.months,
    pulseApplies: pulse.applies,
  };
}

/** Why a date is locked, or null when it is open. */
export function lockReason(locks: ProgramLocks, date: IsoDate, options: { readonly goesToJob: boolean }): 'program' | 'pulse' | null {
  const month = monthOf(date);
  if (locks.programClosed.includes(month)) return 'program';
  if (options.goesToJob && locks.pulseClosed.includes(month)) return 'pulse';
  return null;
}

export function isLocked(locks: ProgramLocks, date: IsoDate, options: { readonly goesToJob: boolean }): boolean {
  return lockReason(locks, date, options) !== null;
}

export function lockMessage(locks: ProgramLocks, date: IsoDate, reason: 'program' | 'pulse'): string {
  const name = monthName(monthOf(date));
  return reason === 'pulse' ? `${name} is closed in Pulse. Ask a Pulse admin to reopen it.` : `${name} is closed for ${locks.programKey}. An owner can reopen it.`;
}

/** Throws LOCKED with the exact message when `date` is locked. */
export function assertOpen(locks: ProgramLocks, date: IsoDate, options: { readonly goesToJob: boolean }): void {
  const reason = lockReason(locks, date, options);
  if (reason) throw locked(lockMessage(locks, date, reason));
}

/** The latest locked day of the program (either kind), for "locked through" chips. */
export function lastLockedDay(locks: ProgramLocks, options: { readonly goesToJob: boolean }): { through: IsoDate; reason: 'program' | 'pulse' } | null {
  const months = [...locks.programClosed.map((m) => ({ m, reason: 'program' as const })), ...(options.goesToJob ? locks.pulseClosed.map((m) => ({ m, reason: 'pulse' as const })) : [])];
  if (months.length === 0) return null;
  const latest = months.sort((a, b) => (a.m < b.m ? -1 : 1)).at(-1)!;
  const [y, mo] = latest.m.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { through: `${latest.m}-${String(last).padStart(2, '0')}`, reason: latest.reason };
}
