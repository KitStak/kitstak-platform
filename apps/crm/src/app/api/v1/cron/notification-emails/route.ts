import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { deliverNotificationEmails } from '@/server/services/notification-emails';

/**
 * Vercel Cron, every 5 minutes (vercel.json), with CRON_SECRET set: emails each active member their
 * new CRM notifications (server/services/notification-emails.ts).
 */
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHENTICATED', message: 'This route is for the scheduler.' } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const result = await deliverNotificationEmails();
  return NextResponse.json({ ok: true, data: result }, { headers: { 'Cache-Control': 'no-store' } });
}
