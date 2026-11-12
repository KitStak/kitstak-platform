/**
 * One shipment-order priority (Logiwa uses a single integer everywhere). The integer
 * `priority_rank` is what the wizard edits and the grid shows / sorts / filters; the
 * `priority` level (None/Low/Medium/High/Urgent) is derived from it one-to-one so
 * workflows, billing rules and saved views that speak in levels keep working.
 *
 * Mapping: 0 None · 1 Low · 2 Medium · 3 High · 4+ Urgent.
 * When something wrote only the level (a workflow "Set priority", an import, the bulk
 * menu) and the stored rank no longer maps to it, the level wins and the rank is the
 * level's index, so the column, the filter and the form always agree.
 */
import { PRIORITIES } from '@/lib/enums';

export type PriorityLevel = (typeof PRIORITIES)[number];

export function priorityFromRank(rank: number): PriorityLevel {
  if (!Number.isFinite(rank) || rank <= 0) return 'None';
  if (rank >= 4) return 'Urgent';
  return (['None', 'Low', 'Medium', 'High'] as const)[Math.floor(rank)] ?? 'None';
}

/** The integer the user sees: the stored rank when it matches the level, else the level's index. */
export function effectiveRank(priority: string | null | undefined, rank: number | null | undefined): number {
  const r = Number(rank) || 0;
  const level = (priority ?? 'None') as PriorityLevel;
  if (r > 0 && priorityFromRank(r) === level) return r;
  const i = (PRIORITIES as readonly string[]).indexOf(level);
  return i > 0 ? i : 0;
}

/** SQL fragment (SQLite) computing `effectiveRank(priority, priority_rank)` over the given column refs. */
export function effectiveRankSql(priorityCol: string, rankCol: string): string {
  const level = `CASE WHEN ${rankCol} >= 4 THEN 'Urgent' WHEN ${rankCol} = 3 THEN 'High' WHEN ${rankCol} = 2 THEN 'Medium' WHEN ${rankCol} = 1 THEN 'Low' ELSE 'None' END`;
  const index = `CASE ${priorityCol} WHEN 'Low' THEN 1 WHEN 'Medium' THEN 2 WHEN 'High' THEN 3 WHEN 'Urgent' THEN 4 ELSE 0 END`;
  return `(CASE WHEN ${rankCol} > 0 AND (${level}) = ${priorityCol} THEN ${rankCol} ELSE ${index} END)`;
}
