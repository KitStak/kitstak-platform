/**
 * Public health check: database ping and the newest applied Pulse migration.
 * 200 when the database answers, 503 when it does not. Never returns secrets or org data.
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

async function migrationVersion(): Promise<string | null> {
  try {
    const exists = await db.execute<{ present: boolean }>(sql`select to_regclass('drizzle.__kitstak_pulse_migrations') is not null as present`);
    if (!exists.rows[0]?.present) return null;
    const result = await db.execute<{ tag: string }>(sql`select tag from drizzle.__kitstak_pulse_migrations order by tag desc limit 1`);
    return result.rows[0]?.tag ?? null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: 'ok', app: 'kitstak-pulse', database: 'ok', migration: await migrationVersion(), tookMs: Date.now() - startedAt });
  } catch {
    return NextResponse.json({ status: 'down', app: 'kitstak-pulse', database: 'down', migration: null, tookMs: Date.now() - startedAt }, { status: 503 });
  }
}
