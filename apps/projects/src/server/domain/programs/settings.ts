/**
 * Program settings (docs/programs/SPEC.md 2.2.4, 4.2 `settings.ts`): unit label, time zone, work
 * days, targets, build title pattern, automation switches, who sees money, the per hour time
 * basis and the end of day reminder. Optimistic version checks; a time zone change is refused once
 * a closed month holds time or output (A8).
 */
import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { isKnownTimezone } from '@kitstak/db/programs';
import { db, type Executor } from '@/server/db';
import { programSettings } from '@/server/db/schema';
import { invalid, locked } from '@/server/errors';
import { PROJECT_ROLES, type HourlyTimeBasis, type ProjectRole } from '@/lib/constants';
import type { ProgramSettingsDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { logActivity } from '../activity';
import { toSettingsDTO, todayInZone, versionConflict } from './_program';
import { requireProgram } from './access';
import { emitProgramChanged } from './events';
import { monthsFrom, refreshLedgerFor } from './ledger';
import { programLocks } from './locks';

export interface ProgramSettingsPatch {
  readonly unitSingular?: string;
  readonly unitPlural?: string;
  readonly timezone?: string;
  readonly workingDays?: readonly number[] | null;
  readonly useOrgHolidays?: boolean;
  readonly extraDaysOff?: readonly string[];
  readonly extraWorkDays?: readonly string[];
  readonly monthlyTargetCents?: string | null;
  readonly dailyTargetUnits?: string | null;
  readonly buildTitlePattern?: string;
  readonly autoStartOnOutput?: boolean;
  readonly autoDoneWhenFull?: boolean;
  readonly moneyMinRole?: ProjectRole;
  readonly hourlyTimeBasis?: HourlyTimeBasis;
  readonly remindAt?: string | null;
}

export async function getProgramSettings(ctx: DomainContext, key: string): Promise<ProgramSettingsDTO> {
  const access = await requireProgram(ctx, key);
  return toSettingsDTO(access.settings, !access.caps.seesMoney);
}

export async function updateProgramSettings(ctx: DomainContext, key: string, patch: ProgramSettingsPatch, expectedVersion: number): Promise<ProgramSettingsDTO> {
  const needsOwner = patch.moneyMinRole !== undefined || patch.monthlyTargetCents !== undefined || patch.hourlyTimeBasis !== undefined;
  const access = await requireProgram(ctx, key, needsOwner ? 'pricing:manage' : 'project:update');
  const current = access.settings;
  if (current.version !== expectedVersion) throw versionConflict();
  const set: Partial<typeof programSettings.$inferInsert> = {};
  if (patch.unitSingular !== undefined) {
    const text = patch.unitSingular.trim();
    if (!text || text.length > 24) throw invalid('Use 1 to 24 characters for the unit.', { unitSingular: 'Use 1 to 24 characters.' });
    set.unitSingular = text;
  }
  if (patch.unitPlural !== undefined) {
    const text = patch.unitPlural.trim();
    if (!text || text.length > 24) throw invalid('Use 1 to 24 characters for the unit.', { unitPlural: 'Use 1 to 24 characters.' });
    set.unitPlural = text;
  }
  if (patch.timezone !== undefined && patch.timezone !== current.timezone) {
    if (!isKnownTimezone(patch.timezone)) throw invalid('Pick a time zone from the list.', { timezone: 'Pick a time zone from the list.' });
    set.timezone = patch.timezone;
  }
  if (patch.workingDays !== undefined) {
    if (patch.workingDays !== null && (patch.workingDays.length === 0 || patch.workingDays.some((d) => d < 0 || d > 6))) throw invalid('Pick at least one work day.', { workingDays: 'Pick at least one work day.' });
    set.workingDays = patch.workingDays === null ? null : [...new Set(patch.workingDays)].sort();
  }
  if (patch.useOrgHolidays !== undefined) set.useOrgHolidays = patch.useOrgHolidays;
  if (patch.extraDaysOff !== undefined) set.extraDaysOff = [...new Set(patch.extraDaysOff)].sort();
  if (patch.extraWorkDays !== undefined) set.extraWorkDays = [...new Set(patch.extraWorkDays)].sort();
  if (patch.monthlyTargetCents !== undefined) {
    if (patch.monthlyTargetCents !== null && !/^\d{1,13}$/.test(patch.monthlyTargetCents)) throw invalid('Use whole cents for the target.', { monthlyTargetCents: 'Enter an amount.' });
    set.monthlyTargetCents = patch.monthlyTargetCents === null ? null : BigInt(patch.monthlyTargetCents);
  }
  if (patch.dailyTargetUnits !== undefined) {
    if (patch.dailyTargetUnits !== null && !/^\d{1,8}(\.\d{1,3})?$/.test(patch.dailyTargetUnits)) throw invalid('Use a number with up to 3 decimals.', { dailyTargetUnits: 'Use a number with up to 3 decimals.' });
    set.dailyTargetUnits = patch.dailyTargetUnits;
  }
  if (patch.buildTitlePattern !== undefined) {
    const text = patch.buildTitlePattern.trim();
    if (!text || text.length > 120) throw invalid('Use 1 to 120 characters for build names.', { buildTitlePattern: 'Use 1 to 120 characters.' });
    set.buildTitlePattern = text;
  }
  if (patch.autoStartOnOutput !== undefined) set.autoStartOnOutput = patch.autoStartOnOutput;
  if (patch.autoDoneWhenFull !== undefined) set.autoDoneWhenFull = patch.autoDoneWhenFull;
  if (patch.moneyMinRole !== undefined) {
    if (!PROJECT_ROLES.includes(patch.moneyMinRole)) throw invalid('Pick a role.');
    set.moneyMinRole = patch.moneyMinRole;
  }
  if (patch.hourlyTimeBasis !== undefined) set.hourlyTimeBasis = patch.hourlyTimeBasis;
  if (patch.remindAt !== undefined) {
    if (patch.remindAt !== null && !/^\d{2}:\d{2}$/.test(patch.remindAt)) throw invalid('Pick a time.', { remindAt: 'Pick a time.' });
    set.remindAt = patch.remindAt;
  }
  if (Object.keys(set).length === 0) return toSettingsDTO(current, !access.caps.seesMoney);
  const updated = await db.transaction(async (tx) => {
    if (set.timezone !== undefined) await assertTimezoneFree(tx, ctx, access.program);
    const rows = await tx
      .update(programSettings)
      .set({ ...set, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(programSettings.programId, access.program.id), eq(programSettings.version, expectedVersion)))
      .returning();
    if (rows.length === 0) throw versionConflict();
    const moneyChanged = set.hourlyTimeBasis !== undefined || set.timezone !== undefined;
    if (moneyChanged) {
      const today = todayInZone(rows[0]!.timezone);
      await refreshLedgerFor(tx, ctx, { programIds: [access.program.id], months: monthsFrom(access.program.startDate ?? today, today).slice(-3) });
      await emitProgramChanged(tx, ctx, access.program.id);
    }
    await logActivity(tx, ctx, {
      verb: 'program.settings_changed',
      entityType: 'project',
      entityId: access.program.id,
      projectId: access.program.id,
      after: { fields: Object.keys(set), ...(set.monthlyTargetCents !== undefined ? { money: { monthlyTargetCents: patch.monthlyTargetCents } } : {}) },
    });
    return rows[0]!;
  });
  return toSettingsDTO(updated, !access.caps.seesMoney);
}

/** A time zone change is refused once a closed month holds time or output (A8), read under the settings lock. */
async function assertTimezoneFree(tx: Executor, ctx: DomainContext, program: { id: string; key: string }): Promise<void> {
  const locks = await programLocks(ctx, program, tx);
  if (locks.programClosed.length > 0 || locks.pulseClosed.length > 0) {
    const months = [...locks.programClosed, ...locks.pulseClosed].map((m) => sql`${`${m}-01`}::date`);
    const held = await tx.execute(
      sql`select (exists (select 1 from pm.build_output o where o.program_id = ${program.id}::uuid and o.deleted_at is null and date_trunc('month', o.work_date)::date in (${sql.join(months, sql`, `)}))
               or exists (select 1 from pm.time_entries te where te.project_id = ${program.id}::uuid and te.deleted_at is null and date_trunc('month', te.started_at)::date in (${sql.join(months, sql`, `)}))) as held`,
    );
    if ((held as unknown as { rows: { held: boolean }[] }).rows[0]?.held) throw locked('A closed month holds time or output, so the time zone cannot change.');
  }
}
