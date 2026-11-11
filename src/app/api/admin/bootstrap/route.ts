/**
 * `POST /api/admin/bootstrap` — one-off database setup for a hosted deployment (Vercel + Supabase).
 *
 * The database credentials live only in the hosting platform's encrypted env, so migrations and
 * demo data cannot be loaded from a workstation. This route does it from inside the deployment.
 *
 * Actions (JSON body `{ "action": ... }`):
 * - `migrate` (default): applies the committed migrations over one direct connection; seeds the
 *   demo dataset by replaying it (slow over the network) only when no user exists yet.
 * - `restore-snapshot`: replaces ALL data with the bundled, pre-verified demo snapshot
 *   (`seed-snapshot/`, built from a fresh local seed) in one transaction, uploads its file blobs to
 *   Supabase Storage, then runs the ledger verification. Requires `"confirm": "replace-all-data"`.
 *
 * Guarded three ways: disabled unless BOOTSTRAP_ENABLED=1, requires `Authorization: Bearer
 * <CRON_SECRET>`, and destructive steps need explicit confirmation. Turn BOOTSTRAP_ENABLED off
 * again right after use.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { openPostgres } from "@/server/db";
import { applyMigrations, migrationUrl } from "@/server/db/migrate";
import { dbGet } from "@/server/db/sql";
import { restoreSnapshot, type DataSnapshot } from "@/server/db/restore-snapshot";
import { runSeed } from "@/server/db/seed/index";
import { verifyDatabase } from "@/server/db/seed/verify";
import { createFileStore, defaultBlobStorage } from "@/server/files";
import { verifyCronAuthorization } from "@/server/scheduler/cron-auth";

export const maxDuration = 800;

const SNAPSHOT_DIR = path.join(process.cwd(), "seed-snapshot");
function json(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function readGz<T>(file: string): T {
  return JSON.parse(gunzipSync(fs.readFileSync(/* turbopackIgnore: true */ path.join(SNAPSHOT_DIR, file))).toString("utf8")) as T;
}

/** Uploads the snapshot's file blobs; already-present objects count as done. */
async function uploadBlobs(): Promise<{ uploaded: number; failed: number }> {
  const blobs = readGz<Array<{ id: string; mime: string; b64: string }>>("blobs.json.gz");
  const storage = defaultBlobStorage();
  let uploaded = 0, failed = 0, next = 0;
  const worker = async (): Promise<void> => {
    while (next < blobs.length) {
      const blob = blobs[next++];
      try {
        await storage.put(blob.id, Buffer.from(blob.b64, "base64"), blob.mime);
        uploaded++;
      } catch (error: unknown) {
        const cause = (error as { cause?: { message?: string } }).cause?.message ?? "";
        if (/exists|duplicate/i.test(cause)) uploaded++;
        else failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { uploaded, failed };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.BOOTSTRAP_ENABLED !== "1") return json(404, { success: false, error: "Not found" });
  const auth = verifyCronAuthorization(request.headers.get("authorization"));
  if (auth === "not_configured") return json(503, { success: false, error: "CRON_SECRET is not configured" });
  if (auth !== "ok") return json(401, { success: false, error: "Invalid token" });

  const url = migrationUrl();
  if (!url) return json(503, { success: false, error: "No database URL is configured" });
  const body = (await request.json().catch(() => ({}))) as { action?: string; confirm?: string };

  const started = Date.now();
  const handle = await openPostgres(url, { max: 1 });
  try {
    const migrations = await applyMigrations(handle.db);

    if (body.action === "restore-snapshot") {
      if (body.confirm !== "replace-all-data") {
        return json(400, { success: false, migrations, error: 'restore-snapshot replaces all data: send "confirm": "replace-all-data"' });
      }
      const restored = await restoreSnapshot(handle.db, readGz<DataSnapshot>("snapshot.json.gz"));
      const files = await uploadBlobs();
      const { issues, stats } = await verifyDatabase(handle.db);
      return json(200, {
        success: issues.length === 0 && files.failed === 0,
        migrations,
        restored,
        files,
        verify: { ok: issues.length === 0, issues: issues.length, sample: issues.slice(0, 5), stats },
        ms: Date.now() - started,
      });
    }

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
      ms: Date.now() - started,
    });
  } finally {
    await handle.close();
  }
}
