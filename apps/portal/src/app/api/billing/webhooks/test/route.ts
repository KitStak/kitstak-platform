/**
 * Test gateway webhook endpoint (docs/billing/CONTRACTS.md section 12.1). It runs the same
 * `processWebhook` as the Stripe route, with the test gateway's signature. It answers 404 unless the
 * server is in test gateway mode, which can never be the case in production.
 */
import { processWebhook } from '@kitstak/billing/server';
import { billingRuntime } from '@/server/billing/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: Request): Promise<Response> {
  const rt = billingRuntime();
  if (rt.mode !== 'test_gateway') {
    return Response.json({ ok: false, message: 'Not found.' }, { status: 404, headers: NO_STORE });
  }
  const rawBody = await request.text();
  const outcome = await processWebhook(rt, { rawBody, signature: request.headers.get('kitstak-test-signature') });
  return Response.json(
    { ok: outcome.status === 200, result: outcome.result },
    { status: outcome.status, headers: NO_STORE },
  );
}
