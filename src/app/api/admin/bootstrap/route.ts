/**
 * `POST /api/admin/bootstrap` — one-off database setup for a hosted deployment (Vercel + Supabase).
 *
 * Applies the committed migrations over a single direct (non-pooled) connection, then seeds the
 * demo dataset when the database has no users yet. Exists because the database credentials live
 * only in the hosting platform's encrypted env, so migrations cannot be run from a workstation.
 *
 * Guarded three ways: disabled unless BOOTSTRAP_ENABLED=1, requires `Authorization: Bearer
 * <CRON_SECRET>`, and never seeds over existing users (seeding wipes every table first).
 * Turn BOOTSTRAP_ENABLED off again right after use.
 */
import { NextResponse } from "next/server";
import { openPostgres } from "@/server/db";
import { applyMigrations, migrationUrl } from "@/server/db/migrate";
import { dbGet } from "@/server/db/sql";
import { runSeed } from "@/server/db/seed/index";
import { createFileStore } from "@/server/files";
import { verifyCronAuthorization } from "@/server/scheduler/cron-auth";
import { sql } from "drizzle-orm";

export const maxDuration = 800;

function json(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.BOOTSTRAP_ENABLED !== "1") return json(404, { success: false, error: "Not found" });
  const auth = verifyCronAuthorization(request.headers.get("authorization"));
  if (auth === "not_configured") return json(503, { success: false, error: "CRON_SECRET is not configured" });
  if (auth !== "ok") return json(401, { success: false, error: "Invalid token" });

  const url = migrationUrl();
  if (!url) return json(503, { success: false, error: "No database URL is configured" });

  const started = Date.now();
  const handle = await openPostgres(url, { max: 1 });
  try {
    const migrations = await applyMigrations(handle.db);
    const users = await dbGet<{ n: number }>(handle.db, sql`SELECT count(*)::int AS n FROM users`);
    if ((users?.n ?? 0) > 0) {
      return json(200, { success: true, migrations, seeded: false, reason: "users already exist; seed skipped", ms: Date.now() - started });
    }
    const password = process.env.BOOTSTRAP_SEED_PASSWORD;
    if (!password || password.length < 12) {
      return json(400, { success: false, migrations, error: "Set BOOTSTRAP_SEED_PASSWORD (12+ characters) before seeding" });
    }
    const report = await runSeed(handle.db, { files: createFileStore(), password });
    return json(200, {
      success: report.ledgerIssues.length === 0,
      migrations,
      seeded: true,
      events: report.events,
      failures: report.failures,
      ledgerIssues: report.ledgerIssues.length,
      tables: Object.keys(report.counts).length,
      rows: Object.values(report.counts).reduce((a, b) => a + b, 0),
      ms: Date.now() - started,
    });
  } finally {
    await handle.close();
  }
}
