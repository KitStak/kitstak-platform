/**
 * The billing mode for an env (docs/billing/CONTRACTS.md section 10.2). Kept apart from `config.ts`
 * so code that only needs the mode does not pull in a gateway.
 *
 *   STRIPE_SECRET_KEY            NODE_ENV          mode
 *   live key + webhook secret    any               live
 *   test key + webhook secret    any               stripe_test
 *   set, no webhook secret       any               unavailable
 *   not set                      not production    test_gateway
 *   not set                      production        unavailable
 *
 * There is no switch that turns the test gateway on in production.
 */
import type { BillingMode } from '../plan-state';

export function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function modeFor(key: string | null, webhookSecret: string | null, nodeEnv: string | undefined): BillingMode {
  if (key) {
    if (!webhookSecret) return 'unavailable';
    if (/^(sk|rk)_live_/.test(key)) return 'live';
    if (/^(sk|rk)_test_/.test(key)) return 'stripe_test';
    // A value that is not a Stripe secret key: fail closed.
    return 'unavailable';
  }
  return nodeEnv === 'production' ? 'unavailable' : 'test_gateway';
}

/** The billing mode for an env, without building the whole config. */
export function billingMode(env: NodeJS.ProcessEnv = process.env): BillingMode {
  return modeFor(cleanEnv(env.STRIPE_SECRET_KEY), cleanEnv(env.STRIPE_WEBHOOK_SECRET), env.NODE_ENV);
}
