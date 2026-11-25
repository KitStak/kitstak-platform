/**
 * Runs once before the suite: checks that the portal answers and is in test gateway mode, and clears
 * the signup rate limit counters. A clear message here beats sixteen confusing timeouts later.
 */
import { BASE_URL, resetRateLimits } from './support';

export default async function globalSetup(): Promise<void> {
  let status = 0;
  try {
    const response = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    status = response.status;
  } catch {
    status = 0;
  }
  if (status === 0 || status >= 500) {
    throw new Error(`The portal does not answer at ${BASE_URL}. Start it with: deploy/dev/app-start.sh portal`);
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
