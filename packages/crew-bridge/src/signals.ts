/**
 * Onboarding signals (docs/crew/SPEC.md section 9, docs/integration/ONBOARDING.md): which of the
 * five Crew steps are done for an org. Guarded by `to_regclass('crew.people')`: `null` quietly when
 * Crew is not in this database, or on any error. Tables that later phases add (schedule, clock,
 * approvals) count as "not done" until they exist.
 */
import { sql, type SQL } from 'drizzle-orm';
import { crewAvailability, isUuid, queryOne, tableExists, type BridgeExecutor } from './executor';
import type { CrewSetupSignals } from './types';

async function exists(db: BridgeExecutor, statement: SQL): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(db, sql`select exists (${statement}) as ok`);
  return row?.ok === true;
}

export async function getSetupSignals(db: BridgeExecutor, input: { readonly orgId: string }): Promise<CrewSetupSignals | null> {
  const { orgId } = input;
  if (!isUuid(orgId)) return null;
  try {
    if (!(await crewAvailability(db)).installed) return null;
    const [hasWeeks, hasKiosks, hasPunches, hasApprovals, hasPulse] = await Promise.all([
      tableExists(db, 'crew.schedule_weeks'),
      tableExists(db, 'crew.kiosk_devices'),
      tableExists(db, 'crew.punches'),
      tableExists(db, 'crew.week_approvals'),
      tableExists(db, 'pulse.time_punches'),
    ]);
    const people = await exists(db, sql`select 1 from crew.people where org_id = ${orgId} and deleted_at is null and is_sample = false`);
    const schedule = hasWeeks ? await exists(db, sql`select 1 from crew.schedule_weeks where org_id = ${orgId} and status = 'published'`) : false;
    const kiosk =
      (hasKiosks && (await exists(db, sql`select 1 from crew.kiosk_devices where org_id = ${orgId} and deleted_at is null and revoked_at is null`))) ||
      (hasPunches && (await exists(db, sql`select 1 from crew.punches where org_id = ${orgId} and source = 'phone' and superseded_at is null`)));
    const approve = hasApprovals ? await exists(db, sql`select 1 from crew.week_approvals where org_id = ${orgId} and status = 'approved'`) : false;
    const connect = hasPulse ? await exists(db, sql`select 1 from pulse.time_punches where org_id = ${orgId} and source = 'crew' and deleted_at is null`) : null;
    return { crew_people: people, crew_schedule: schedule, crew_kiosk: kiosk, crew_approve: approve, crew_connect: connect };
  } catch {
    return null;
  }
}
