/**
 * Runs once before the suite: checks that the portal answers and is in test gateway mode, and clears
 * the signup rate limit counters. A clear message here beats sixteen confusing timeouts later.
 */
import { BASE_URL, resetRateLimits } from './support';

export default async function globalSetup(): Promise<void> {
  // The dev server may be in the middle of a restart: `deploy/dev/app-supervise.sh` restarts it at a
  // quiet moment when it has grown over its memory budget, and the gap between two specs is such a
  // moment. It answers again in under a minute, so wait for it before calling the run off.
  let status = 0;
  const giveUpAt = Date.now() + 120_000;
  for (;;) {
    try {
      const response = await fetch(`${BASE_URL}/login`, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      status = response.status;
    } catch {
      status = 0;
    }
    if ((status !== 0 && status < 500) || Date.now() >= giveUpAt) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (status === 0 || status >= 500) {
    throw new Error(`The portal does not answer at ${BASE_URL} (waited 2 minutes). Start it with: deploy/dev/app-start.sh portal`);
  }

  // The test webhook route exists only in test gateway mode. Anything else answers 404 or 503.
  const probe = await fetch(`${BASE_URL}/api/billing/webhooks/test`, { method: 'POST', body: '{}' });
  if (probe.status !== 400) {
    throw new Error(
      `The portal at ${BASE_URL} is not in test gateway mode (the test webhook answered ${probe.status}, expected 400). ` +
        'Remove STRIPE_SECRET_KEY from apps/portal/.env.local and start it with NODE_ENV=development.',
    );
  }

  const outbox = await fetch(`${BASE_URL}/dev/outbox`);
  if (outbox.status !== 200) {
    throw new Error(`The dev outbox at ${BASE_URL}/dev/outbox answered ${outbox.status}. The suite reads email codes there.`);
  }

  await resetRateLimits();
}
