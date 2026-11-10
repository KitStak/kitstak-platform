import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { defineRoute } from "@/server/api/define-route";
import { successBody } from "@/server/api/envelope";
import * as scheduler from "@/server/scheduler";
import { log } from "@/server/log";

interface MigrationStatus {
  readonly applied: number;
  readonly latestAppliedAt: string | null;
}

function checkDb(db: AppDb): { ok: boolean; latencyMs: number } {
  const started = performance.now();
  try {
    db.get(sql`SELECT 1 AS ok`);
    return { ok: true, latencyMs: Math.round((performance.now() - started) * 100) / 100 };
  } catch (error: unknown) {
    log.error("health: db check failed", { err: error });
    return { ok: false, latencyMs: Math.round(performance.now() - started) };
  }
}

function migrationStatus(db: AppDb): MigrationStatus | null {
  try {
    const row = db.get<{ n: number; latest: number | null }>(
      sql`SELECT COUNT(*) AS n, MAX(created_at) AS latest FROM __drizzle_migrations`,
    );
    return { applied: row?.n ?? 0, latestAppliedAt: row?.latest ? new Date(Number(row.latest)).toISOString() : null };
  } catch {
    return null;
  }
}

/**
 * F6 contract: `@/server/scheduler` may export `getSchedulerHeartbeat(): { lastTickAt: string | null, ... }`.
 * Until it does, the scheduler is reported as "not configured".
 */
function schedulerStatus(): Record<string, unknown> {
  const mod = scheduler as Record<string, unknown>;
  const heartbeat = mod.getSchedulerHeartbeat;
  if (typeof heartbeat !== "function") return { status: "not_configured" };
  try {
    const value: unknown = heartbeat();
    return typeof value === "object" && value !== null ? { status: "ok", ...(value as Record<string, unknown>) } : { status: "unknown" };
  } catch (error: unknown) {
    log.warn("health: scheduler heartbeat failed", { err: error });
    return { status: "error" };
  }
}

/** GET /api/health — public liveness/readiness: DB, migration version, scheduler heartbeat. */
export const GET = defineRoute({
  name: "GET /api/health",
  auth: "public",
  handler: ({ db }) => {
    const database = checkDb(db);
    const migrations = migrationStatus(db);
    const healthy = database.ok && migrations !== null && migrations.applied > 0;
    const body = successBody({
      status: healthy ? "ok" : "degraded",
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      db: database,
      migrations,
      scheduler: schedulerStatus(),
    });
    return NextResponse.json(body, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  },
});
