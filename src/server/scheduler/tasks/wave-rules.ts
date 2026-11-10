/**
 * Scheduler task "wave-rules" (owner M03). Every tick it:
 *   - runs each active rule whose `next_run_at` has passed (warehouse time zone,
 *     runBy "Integration"), one transaction per rule;
 *   - applies Delete-if-not-started: cancels the rule's still-Pending jobs once the
 *     configured time (At Specific Time, warehouse tz) or age (After Hours) is reached.
 */
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { localParts, toMinutes, zonedToUtc } from "@/lib/grid-defs/jobs/schedule";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { systemCtx } from "@/server/domain";
import { cancelJobCascade } from "@/server/repositories/jobs-commands";
import { settleDeadJobs } from "@/server/repositories/jobs-settle";
import { ensureNextRuns } from "@/server/repositories/wave-rules";
import { resumeStalledAiWaves, runWave } from "@/server/repositories/waves-run";
import type { SchedulerTask, TaskResult } from "../types";

const TICK_MS = 30_000;
const HOUR_MS = 3_600_000;
export const SCHEDULER_RUN_BY = "Integration";

export function dueRules(db: AppDb, now: Date) {
  return db.select().from(schema.waveRules).where(and(
    eq(schema.waveRules.isActive, true), isNotNull(schema.waveRules.nextRunAt), lte(schema.waveRules.nextRunAt, now.toISOString()),
  )).all();
}

/** Instant before which Pending jobs of the rule are deleted, or null when not yet due. */
export function deleteCutoff(rule: Pick<typeof schema.waveRules.$inferSelect, "deleteIfNotStarted" | "deleteMethod" | "deleteTime">, timeZone: string, now: Date): Date | null {
  if (!rule.deleteIfNotStarted || !rule.deleteTime) return null;
  if (rule.deleteMethod === "After Hours") {
    const hours = Number(rule.deleteTime);
    return Number.isFinite(hours) && hours > 0 ? new Date(now.getTime() - hours * HOUR_MS) : null;
  }
  if (rule.deleteMethod === "At Specific Time") {
    const p = localParts(now, timeZone);
    const at = zonedToUtc(p.year, p.month, p.day, toMinutes(rule.deleteTime), timeZone);
    return now.getTime() >= at.getTime() ? at : null;
  }
  return null;
}

function applyDeletes(db: AppDb, now: Date): number {
  const rules = db.select({ rule: schema.waveRules, tz: schema.warehouses.timezone }).from(schema.waveRules)
    .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.waveRules.warehouseId))
    .where(and(eq(schema.waveRules.isActive, true), eq(schema.waveRules.deleteIfNotStarted, true))).all();
  let cancelled = 0;
  for (const { rule, tz } of rules) {
    const cutoff = deleteCutoff(rule, tz, now);
    if (!cutoff) continue;
    const stale = db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(
      eq(schema.jobs.waveRuleId, rule.id), eq(schema.jobs.status, "Pending"), sql`${schema.jobs.createdAt} < ${cutoff.toISOString()}`,
    )).all();
    for (const job of stale) {
      try {
        db.transaction((tx) => cancelJobCascade(tx, systemCtx(SCHEDULER_RUN_BY), job.id));
        cancelled += 1;
      } catch {
        // A job that started between the read and the cancel is simply kept.
      }
    }
  }
  return cancelled;
}

export async function runDueWaveRules(db: AppDb, now: Date): Promise<TaskResult> {
  // Active scheduled rules always carry a next run (seeded / imported rules arrive without one).
  ensureNextRuns(db, now);
  const due = dueRules(db, now);
  const results: string[] = [];
  for (const rule of due) {
    const res = db.transaction((tx) => runWave(tx, systemCtx(SCHEDULER_RUN_BY), rule.id, {
      runBy: SCHEDULER_RUN_BY, now, notifyUserIds: rule.createdBy ? [rule.createdBy] : [],
    }));
    results.push(res.summary);
  }
  const deleted = applyDeletes(db, now);
  // AI waves a restart left mid-optimization are finished here (the run route normally completes them via after()).
  const resumed = resumeStalledAiWaves(db, systemCtx(SCHEDULER_RUN_BY), now);
  if (resumed > 0) results.push(`${resumed} stalled AI ${resumed === 1 ? "wave" : "waves"} completed`);
  // Jobs left with no open task by cancels in other modules close here (critic R4 zombie jobs).
  const settled = settleDeadJobs(db, systemCtx(SCHEDULER_RUN_BY)).filter((s) => s.from !== s.to).length;
  if (settled > 0) results.push(`${settled} ${settled === 1 ? "job" : "jobs"} with no open tasks closed`);
  if (due.length === 0 && deleted === 0 && resumed === 0 && settled === 0) return { status: "skipped", message: "No wave rules due" };
  return { status: "ok", message: [...results, deleted > 0 ? `${deleted} not-started jobs deleted` : ""].filter(Boolean).join(" | ") };
}

export const task: SchedulerTask = {
  key: "wave-rules",
  title: "Wave rule runs",
  owner: "M03",
  configured: true,
  schedule: { kind: "interval", everyMs: TICK_MS },
  run: ({ db, now }) => runDueWaveRules(db, now),
};
