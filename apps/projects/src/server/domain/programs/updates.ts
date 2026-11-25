/**
 * The status update draft for a program (docs/programs/SPEC.md 4.2 `updates.ts`): one line of
 * plain facts for the composer ("5 of 8 builds done today · $29,970.40 this month · 105% of target").
 */
import 'server-only';
import { formatCents, formatPercentBp } from '@kitstak/programs-engine/format';
import { db } from '@/server/db';
import type { DomainContext } from '../_shared';
import { requireProgram } from './access';
import { listRuns } from './runs';
import { programMonthStats } from './stats';

export async function draftProgramUpdate(ctx: DomainContext, key: string): Promise<string> {
  const access = await requireProgram(ctx, key);
  const stats = await programMonthStats(db, ctx, access.program, access.settings);
  const runs = await listRuns(ctx, access.program.key, { from: stats.asOf, to: stats.asOf });
  const builds = runs.reduce((sum, run) => sum + run.builds, 0);
  const done = runs.reduce((sum, run) => sum + run.done, 0);
  const parts = [builds > 0 ? `${done} of ${builds} builds done today` : 'No builds today'];
  if (access.caps.seesMoney) {
    parts.push(`${formatCents(stats.revenueCents)} this month`);
    if (stats.forecast.targetBp !== null) parts.push(`${formatPercentBp(stats.forecast.targetBp)} of target`);
  }
  return parts.join(' · ');
}
