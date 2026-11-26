/**
 * The plan of one program month, read from Projects (docs/programs/PULSE_PROGRAMS_SPEC.md 3.3):
 * the shared loader reads the inputs Projects reads, and `programMonthPlan` computes planned units
 * and the forecast the way Projects does, so they match to the cent. Used by the program tracker
 * (`programs.ts`) and by job stats for a program job (5.2). Kept apart from `programs.ts` so
 * `job-stats.ts` can import it without a cycle (programs -> recalc -> job-stats).
 */
import 'server-only';
import { programMonthPlan, type ProgramMonthPlan } from '@/lib/profit';
import type { ProgramCalendar } from '@kitstak/programs-engine/types';
import { scoped } from '@/server/db/scope';
import { programPlanSource } from '@/server/integrations/programs';
import { logSoftFail } from '@/server/integrations/log';
import { todayInZone, type DomainContext } from './_shared';

export interface LoadedProgramPlan {
  readonly plan: ProgramMonthPlan;
  /** The program's merged calendar (work days, days off, pauses), for the Days tab. */
  readonly calendar: ProgramCalendar;
}

/** The program facts the plan needs: its id, zone and monthly target. */
export interface ProgramPlanTarget {
  readonly id: string;
  readonly timezone: string;
  /** `pm.program_settings.monthly_target_cents`, whole cents as text, or null. */
  readonly monthlyTargetCents: string | null;
}

/**
 * The plan of `month` (default: this month in the program zone) as of today in the program zone.
 * Strict: a failed Projects read throws. Null when the program is not in Projects.
 */
export const loadProgramPlan = scoped(async function loadProgramPlan(ctx: DomainContext, program: ProgramPlanTarget, month?: string, today?: string): Promise<LoadedProgramPlan | null> {
  const asOf = today ?? todayInZone(program.timezone);
  const target = month ?? asOf.slice(0, 7);
  const source = await programPlanSource(ctx, program.id, target, asOf);
  if (!source) return null;
  const plan = programMonthPlan({
    facts: source.facts,
    versions: source.monthInputs.versions,
    monthInputs: source.monthInputs,
    asOf,
    builds: source.builds,
    trailing: source.trailing,
    monthlyTargetCents: program.monthlyTargetCents,
  });
  return { plan, calendar: source.facts.calendar };
});

/** `loadProgramPlan` that never throws: null on any failure (job stats keep working without Projects). */
export const loadProgramPlanSoft = scoped(async function loadProgramPlanSoft(ctx: DomainContext, program: ProgramPlanTarget, month?: string, today?: string): Promise<LoadedProgramPlan | null> {
  try {
    return await loadProgramPlan(ctx, program, month, today);
  } catch (error) {
    logSoftFail(ctx.orgId, 'programs.loadProgramPlan', error);
    return null;
  }
});
