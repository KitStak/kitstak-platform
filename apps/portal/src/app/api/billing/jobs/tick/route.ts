/**
 * The one minute billing job (docs/billing/CONTRACTS.md section 14). Vercel Cron calls it with GET
 * and the header `Authorization: Bearer ${CRON_SECRET}` (see apps/portal/vercel.json). POST does the
 * same, for a scheduler that prefers it and for `deploy/dev/billing-tick.sh`.
 *
 * Each call: sends queued emails, queues the trial and late payment reminders, asks the gateway
 * again about plans a missed webhook could have left behind, and in test gateway mode runs what is
 * due for the test subscriptions. Every step is safe to run twice.
 *
 * There is no session here and no CSRF surface: the bearer secret is the only way in. The answer
 * holds counts only, never an address or an amount.
 */
import { runBillingTick } from '@kitstak/billing/jobs';
import { billingRuntime } from '@/server/billing/runtime';
import { env } from '@/server/env';
import { mailEnv } from '../mail-env';
import { authorizeTick } from './auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A full batch of 50 emails at the provider's pace takes about half a minute. */
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

async function tick(request: Request): Promise<Response> {
  const auth = authorizeTick({
    cronSecret: env.CRON_SECRET,
    nodeEnv: env.NODE_ENV,
    authorization: request.headers.get('authorization'),
  });
  if (!auth.ok) {
    return Response.json({ ok: false, message: auth.message }, { status: auth.status, headers: NO_STORE });
  }

  try {
    const report = await runBillingTick(billingRuntime(), { env: mailEnv() });
    // 200 even when a step failed: the report says which one, and the next tick tries again. A 500
    // here would only make the scheduler retry at once and run the healthy steps twice.
    return Response.json({ ok: report.errors.length === 0, ...report }, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error('[portal] billing tick failed', error);
    return Response.json({ ok: false, message: 'The billing job failed. See the server log.' }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: Request): Promise<Response> {
  return tick(request);
}

export async function POST(request: Request): Promise<Response> {
  return tick(request);
}
