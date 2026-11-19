/**
 * Public health check: database ping, the newest applied Pulse migration, and the database guard
 * (`guard.on`: PULSE_DB_GUARD is set, `guard.ready`: the plain role exists and this login can use it).
 * 200 when the database answers, 503 when it does not. Never returns secrets or org data.
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';
import { dbGuardStatus } from '@/server/db/system';

export const dynamic = 'force-dynamic';

async function migrationVersionAsSystem(): Promise<string | null> {
  try {
    const exists = await db.execute<{ present: boolean }>(sql`select to_regclass('drizzle.__kitstak_pulse_migrations') is not null as present`);
    if (!exists.rows[0]?.present) return null;
    const result = await db.execute<{ tag: string }>(sql`select tag from drizzle.__kitstak_pulse_migrations order by tag desc limit 1`);
    return result.rows[0]?.tag ?? null;
  } catch {
    return null;
  }
}

/** The health check belongs to no workspace: it reads the migration table and pings the database. */
const migrationVersion = (): Promise<string | null> => asSystem('health check (no workspace data)', migrationVersionAsSystem);

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    await asSystem('health check (no workspace data)', () => db.execute(sql`select 1`));
    const guard = await dbGuardStatus();
    return NextResponse.json({ status: 'ok', app: 'kitstak-pulse', database: 'ok', migration: await migrationVersion(), guard: { on: guard.on, ready: guard.ready }, tookMs: Date.now() - startedAt });
  } catch (error) {
    console.error('[pulse] health check failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ status: 'down', app: 'kitstak-pulse', database: 'down', migration: null, tookMs: Date.now() - startedAt }, { status: 503 });
  }
}
