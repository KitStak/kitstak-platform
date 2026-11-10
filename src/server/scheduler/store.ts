/**
 * Scheduler persistence: the single-flight lease row and per-task run state.
 *
 * These two small tables are owned by the scheduler and created on demand
 * (`CREATE TABLE IF NOT EXISTS`) rather than by Drizzle migrations, so the scheduler works
 * on any database the app opens; `db:drop` removes them with everything else.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { TaskResult, TaskRunState } from "./types";

export const LEASE_NAME = "scheduler";

export function ensureSchedulerTables(db: AppDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS scheduler_lease (
    name TEXT PRIMARY KEY NOT NULL,
    owner TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS scheduler_task_runs (
    task_key TEXT PRIMARY KEY NOT NULL,
    last_started_at TEXT,
    last_finished_at TEXT,
    last_status TEXT,
    last_message TEXT,
    run_count INTEGER NOT NULL DEFAULT 0
  )`);
}

/**
 * Takes (or renews) the lease when it is free, expired, or already ours. Returns true when
 * this owner holds it afterwards. Atomic: a single UPSERT guarded by the expiry check.
 */
export function acquireLease(db: AppDb, owner: string, now: Date, ttlMs: number): boolean {
  const nowIso = now.toISOString();
  const expires = new Date(now.getTime() + ttlMs).toISOString();
  db.run(sql`INSERT INTO scheduler_lease (name, owner, expires_at, heartbeat_at)
    VALUES (${LEASE_NAME}, ${owner}, ${expires}, ${nowIso})
    ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at, heartbeat_at = excluded.heartbeat_at
    WHERE scheduler_lease.expires_at <= ${nowIso} OR scheduler_lease.owner = excluded.owner`);
  const row = db.get<{ owner: string }>(sql`SELECT owner FROM scheduler_lease WHERE name = ${LEASE_NAME}`);
  return row?.owner === owner;
}

/** Ends our lease early (heartbeat is kept for /api/health). */
export function releaseLease(db: AppDb, owner: string, now: Date): void {
  db.run(sql`UPDATE scheduler_lease SET expires_at = ${now.toISOString()} WHERE name = ${LEASE_NAME} AND owner = ${owner}`);
}

export function readLease(db: AppDb): { owner: string; expiresAt: string; heartbeatAt: string } | null {
  const row = db.get<{ owner: string; expires_at: string; heartbeat_at: string }>(
    sql`SELECT owner, expires_at, heartbeat_at FROM scheduler_lease WHERE name = ${LEASE_NAME}`,
  );
  return row ? { owner: row.owner, expiresAt: row.expires_at, heartbeatAt: row.heartbeat_at } : null;
}

interface RunRow {
  task_key: string;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_status: TaskRunState["lastStatus"];
  last_message: string | null;
  run_count: number;
}

const toState = (row: RunRow): TaskRunState => ({
  taskKey: row.task_key,
  lastStartedAt: row.last_started_at,
  lastFinishedAt: row.last_finished_at,
  lastStatus: row.last_status,
  lastMessage: row.last_message,
  runCount: row.run_count,
});

export function readTaskRuns(db: AppDb): ReadonlyMap<string, TaskRunState> {
  const rows = db.all<RunRow>(sql`SELECT * FROM scheduler_task_runs`);
  return new Map(rows.map((row) => [row.task_key, toState(row)]));
}

export function markTaskStarted(db: AppDb, taskKey: string, now: Date): void {
  db.run(sql`INSERT INTO scheduler_task_runs (task_key, last_started_at, run_count) VALUES (${taskKey}, ${now.toISOString()}, 1)
    ON CONFLICT(task_key) DO UPDATE SET last_started_at = excluded.last_started_at, run_count = scheduler_task_runs.run_count + 1`);
}

export function markTaskFinished(db: AppDb, taskKey: string, now: Date, result: TaskResult | { status: "error"; message: string }): void {
  const message = result.message ? result.message.slice(0, 1000) : null;
  db.run(sql`UPDATE scheduler_task_runs SET last_finished_at = ${now.toISOString()}, last_status = ${result.status}, last_message = ${message}
    WHERE task_key = ${taskKey}`);
}
