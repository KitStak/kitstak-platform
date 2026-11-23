/**
 * The portal's billing runtime (docs/billing/CONTRACTS.md section 16.2): one `BillingRuntime` per
 * process, built from the validated env and the shared database handle. The portal is the only app
 * that talks to a gateway, so this is the only place the Stripe adapter is passed in.
 */
import 'server-only';
import { createStripeGateway } from '@kitstak/billing/gateway/stripe';
import { createBillingRuntime, type BillingRuntime } from '@kitstak/billing/server';
import { db } from '@/server/db';
import { env } from '@/server/env';

interface RuntimeGlobal {
  __kitstakPortalBillingRuntime?: BillingRuntime;
}

const globalSlot = globalThis as typeof globalThis & RuntimeGlobal;

/** This app's own origin, with no trailing slash. Return URLs for the gateway are built from it. */
export function portalUrl(): string {
  return (env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
}

/** Cached per process (and across dev hot reloads), built from env and db. */
export function billingRuntime(): BillingRuntime {
  globalSlot.__kitstakPortalBillingRuntime ??= createBillingRuntime({
    db,
    // Read through the validated env, so a blank line in an env file never counts as a key.
    env: {
      NODE_ENV: env.NODE_ENV,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
      STRIPE_PORTAL_CONFIGURATION_ID: env.STRIPE_PORTAL_CONFIGURATION_ID,
      STRIPE_AUTOMATIC_TAX: env.STRIPE_AUTOMATIC_TAX,
      BILLING_TEST_WEBHOOK_SECRET: env.BILLING_TEST_WEBHOOK_SECRET,
    },
    portalUrl: portalUrl(),
    stripe: createStripeGateway,
  });
  return globalSlot.__kitstakPortalBillingRuntime;
}
