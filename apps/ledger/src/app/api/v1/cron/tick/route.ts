import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runTick } from '@/server/domain/cron';
import { env } from '@/server/env';

export const maxDuration = 300;

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
function authorized(request: Request, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Every 5 minutes: people who left an org lose their Ledger role row.
 * Cron only: 503 when `CRON_SECRET` is not set, 401 without the bearer token.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: 'INTERNAL', message: 'The scheduler is not set up on this server.' } }, { status: 503 });
  if (!authorized(request, secret)) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'This route is for the scheduler.' } }, { status: 401 });
  return NextResponse.json({ data: await runTick() }, { headers: { 'Cache-Control': 'no-store' } });
}
