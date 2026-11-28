/**
 * Health check. Public answer: `{ status, app, database }` only, the CRM rule: the migration name
 * and the state of the database guard are details for the people who run the app, so they need
 * the health token (`HEALTH_TOKEN`, sent as the `x-health-token` header).
 *
 *   200 `ok`        the database answers, and the guard is off or in force.
 *   503 `degraded`  the database answers, LEDGER_DB_GUARD is on, but the plain role cannot be used,
 *                   so the guard is NOT in force (the app keeps running as the login role).
 *   503 `down`      the database does not answer.
 *
 * With the token the body adds `migration`, `guard { on, active, ready, reason, role, login,
 * loginCanStepOut }` and `tookMs`. Never returns secrets or org data.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';
import { dbGuardStatus } from '@/server/db/system';
import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

const HEALTH_TOKEN_HEADER = 'x-health-token';
const NO_STORE = { 'Cache-Control': 'no-store' };

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Details need a valid HEALTH_TOKEN in every environment. No token set: nobody sees details. */
function canSeeDetails(request: Request): boolean {
  const expected = env.HEALTH_TOKEN;
  const presented = request.headers.get(HEALTH_TOKEN_HEADER);
  if (!expected || !presented) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

async function migrationVersionAsSystem(): Promise<string | null> {
  try {
    const exists = await db.execute<{ present: boolean }>(sql`select to_regclass('drizzle.__kitstak_ledger_migrations') is not null as present`);
    if (!exists.rows[0]?.present) return null;
    const result = await db.execute<{ tag: string }>(sql`select tag from drizzle.__kitstak_ledger_migrations order by tag desc limit 1`);
    return result.rows[0]?.tag ?? null;
  } catch {
    return null;
  }
}

/** The health check belongs to no workspace: it reads the migration table and pings the database. */
const migrationVersion = (): Promise<string | null> => asSystem('health check (no workspace data)', migrationVersionAsSystem);

export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const details = canSeeDetails(request);
  try {
    await asSystem('health check (no workspace data)', () => db.execute(sql`select 1`));
    const guard = await dbGuardStatus();
    const degraded = guard.on && !guard.active;
    const status = degraded ? 'degraded' : 'ok';
    const body = details
      ? { status, app: 'kitstak-ledger', database: 'ok', migration: await migrationVersion(), guard, tookMs: Date.now() - startedAt }
      : { status, app: 'kitstak-ledger', database: 'ok' };
    return NextResponse.json(body, { status: degraded ? 503 : 200, headers: NO_STORE });
  } catch (error) {
    console.error('[ledger] health check failed', error instanceof Error ? error.message : error);
    const body = details ? { status: 'down', app: 'kitstak-ledger', database: 'down', migration: null, tookMs: Date.now() - startedAt } : { status: 'down', app: 'kitstak-ledger', database: 'down' };
    return NextResponse.json(body, { status: 503, headers: NO_STORE });
  }
}
