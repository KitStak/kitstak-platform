/**
 * The workspace calendar (docs/programs/SPEC.md A15, 2.2.3): work days, holidays and daily
 * capacity, used by every program unless it sets its own. Changing it re plans nothing; days off
 * only change forecasts and future schedule generation.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { isKnownTimezone } from '@kitstak/db/programs';
import { nextWorkDay } from '@kitstak/programs-engine/schedule';
import type { ProgramCalendar } from '@kitstak/programs-engine/types';
import { db } from '@/server/db';
import { orgCalendar, type Project } from '@/server/db/schema';
import { invalid } from '@/server/errors';
import type { OrgCalendarDTO, ProgramCalendarDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { logActivity } from '../activity';
import { requireOrg } from '../access';
import { calendarFor, loadOrgCalendar, todayInZone, toCalendarDTO, versionConflict } from './_program';

export async function getOrgCalendar(ctx: DomainContext): Promise<OrgCalendarDTO> {
  const facts = await loadOrgCalendar(db, ctx.orgId);
  return { timezone: facts.timezone, workingDays: facts.workingDays, holidays: facts.holidays, dailyCapacityHours: facts.dailyCapacityHours, version: facts.version };
}

export interface OrgCalendarPatch {
  readonly timezone?: string;
  readonly workingDays?: readonly number[];
  readonly holidays?: readonly { readonly date: string; readonly name: string }[];
  readonly dailyCapacityHours?: string | null;
}

/** Owners and admins. `expectedVersion` 0 creates the row. */
export async function updateOrgCalendar(ctx: DomainContext, patch: OrgCalendarPatch, expectedVersion: number): Promise<OrgCalendarDTO> {
  requireOrg(ctx, 'workspace:manage');
  if (patch.timezone !== undefined && !isKnownTimezone(patch.timezone)) throw invalid('Pick a time zone from the list.', { timezone: 'Pick a time zone from the list.' });
  if (patch.workingDays !== undefined && (patch.workingDays.length === 0 || patch.workingDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
    throw invalid('Pick at least one work day.', { workingDays: 'Pick at least one work day.' });
  }
  const holidays = patch.holidays?.map((h) => ({ date: h.date, name: h.name.trim().slice(0, 80) }));
  if (holidays?.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h.date) || !h.name)) throw invalid('Every holiday needs a date and a name.', { holidays: 'Every holiday needs a date and a name.' });
  if (patch.dailyCapacityHours && !/^\d{1,6}(\.\d{1,2})?$/.test(patch.dailyCapacityHours)) throw invalid('Use hours with up to 2 decimals.', { dailyCapacityHours: 'Use hours with up to 2 decimals.' });
  const current = await loadOrgCalendar(db, ctx.orgId);
  if (current.version !== expectedVersion) throw versionConflict();
  await db.transaction(async (tx) => {
    const next = {
      timezone: patch.timezone ?? current.timezone,
      workingDays: [...(patch.workingDays ?? current.workingDays)].sort(),
      holidays: holidays ?? [...current.holidays],
      dailyCapacityHours: patch.dailyCapacityHours !== undefined ? patch.dailyCapacityHours : current.dailyCapacityHours,
    };
    if (expectedVersion === 0) {
      await tx.insert(orgCalendar).values({ orgId: ctx.orgId, ...next, version: 1 }).onConflictDoNothing();
    } else {
      const updated = await tx.execute(
        sql`update pm.org_calendar set timezone = ${next.timezone}, working_days = ${`{${next.workingDays.join(',')}}`}::smallint[],
                 holidays = ${JSON.stringify(next.holidays)}::jsonb, daily_capacity_hours = ${next.dailyCapacityHours}::numeric,
                 version = version + 1, updated_at = now()
             where org_id = ${ctx.orgId}::uuid and version = ${expectedVersion} returning org_id`,
      );
      if ((updated as unknown as { rows: unknown[] }).rows.length === 0) throw versionConflict();
    }
    await logActivity(tx, ctx, { verb: 'calendar.updated', entityType: 'calendar', entityId: ctx.orgId, after: { timezone: next.timezone, workingDays: next.workingDays, holidays: next.holidays.length } });
  });
  return getOrgCalendar(ctx);
}

/** A program's merged calendar (A15) as the engine reads it. */
export async function programCalendar(ctx: DomainContext, program: Project): Promise<ProgramCalendar> {
  return calendarFor(db, ctx, program);
}

export async function programCalendarDTO(ctx: DomainContext, program: Project): Promise<ProgramCalendarDTO> {
  const calendar = await programCalendar(ctx, program);
  const today = todayInZone(calendar.timezone);
  return toCalendarDTO(calendar, today, nextWorkDay(calendar, today));
}
