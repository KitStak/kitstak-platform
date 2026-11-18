import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { orgsUsingPulse, runDueReportSchedules, systemContext } from '@/server/domain';
import { orgHasPulseModule } from '@/server/entitlements';
import { env } from '@/server/env';

export const maxDuration = 300;

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
function authorized(request: Request, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Every hour: builds the report schedules whose time has come, for every org that uses Pulse.
 * Cron only: 503 when `CRON_SECRET` is not set, 401 without the bearer token.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: 'INTERNAL', message: 'The scheduler is not set up on this server.' } }, { status: 503 });
  if (!authorized(request, secret)) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'This route is for the scheduler.' } }, { status: 401 });
  const started = Date.now();
  let built = 0;
  let failed = 0;
  let orgs = 0;
  for (const orgId of await orgsUsingPulse()) {
    if (Date.now() - started > 240_000) break;
    try {
      if (!(await orgHasPulseModule(orgId))) continue;
      const ctx = await systemContext(orgId);
      if (!ctx) continue;
      const result = await runDueReportSchedules(ctx);
      orgs += 1;
      built += result.built;
      failed += result.failed;
    } catch (error) {
      failed += 1;
      console.error('[pulse] report schedules failed', { orgId, error });
    }
  }
  return NextResponse.json({ data: { orgs, built, failed } }, { headers: { 'Cache-Control': 'no-store' } });
}
