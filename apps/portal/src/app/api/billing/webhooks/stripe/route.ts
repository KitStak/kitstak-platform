/**
 * Stripe webhook endpoint (docs/billing/CONTRACTS.md section 12.1). No session and no CORS: the
 * signature on the raw body is the only thing that is trusted. The body is never logged.
 */
import { processWebhook } from '@kitstak/billing/server';
import { billingRuntime } from '@/server/billing/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: Request): Promise<Response> {
  const rt = billingRuntime();
  if (rt.mode !== 'live' && rt.mode !== 'stripe_test') {
    return Response.json(
      { ok: false, message: 'Stripe is not set up on this server. Nothing was processed.' },
      { status: 503, headers: NO_STORE },
    );
  }
  // The signature covers the exact bytes Stripe sent, so read the raw text and never re-serialize.
  const rawBody = await request.text();
  const outcome = await processWebhook(rt, { rawBody, signature: request.headers.get('stripe-signature') });
  return Response.json(
    { ok: outcome.status === 200, result: outcome.result },
    { status: outcome.status, headers: NO_STORE },
  );
}
