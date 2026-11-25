/**
 * Billing config (docs/billing/CONTRACTS.md section 10.2). Read only from env, never from a file in
 * the repo. The mode table lives in `./mode.ts`.
 */
import { createHmac } from 'node:crypto';
import type { BillingGateway } from '../gateway/types';
import { createTestGateway } from '../gateway/test';
import type { BillingMode } from '../plan-state';
import type { BillingDb } from './db';
import { billingMode, cleanEnv as clean, modeFor } from './mode';

export { billingMode };

export interface BillingConfig {
  readonly mode: BillingMode;
  readonly stripeSecretKey: string | null;
  readonly stripeWebhookSecret: string | null;
  readonly stripePortalConfigurationId: string | null;
  readonly automaticTax: boolean;
  /** Derived, see `resolveBillingConfig`. */
  readonly testWebhookSecret: string;
}

/** Builds the Stripe gateway. Passed in by the portal so this barrel never imports `stripe`. */
export type StripeGatewayFactory = (config: BillingConfig) => BillingGateway;

const TEST_SECRET_LABEL = 'kitstak-billing-test-gateway';
/** Only reachable outside production, where the test gateway moves no real money. */
const LOCAL_FALLBACK_SECRET = 'kitstak-local-test-gateway-only';

export function resolveBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const stripeSecretKey = clean(env.STRIPE_SECRET_KEY);
  const stripeWebhookSecret = clean(env.STRIPE_WEBHOOK_SECRET);
  const fixedTestSecret = clean(env.BILLING_TEST_WEBHOOK_SECRET);
  const testWebhookSecret =
    fixedTestSecret ??
    createHmac('sha256', clean(env.BETTER_AUTH_SECRET) ?? LOCAL_FALLBACK_SECRET)
      .update(TEST_SECRET_LABEL)
      .digest('hex');
  const taxFlag = clean(env.STRIPE_AUTOMATIC_TAX)?.toLowerCase();
  return {
    mode: modeFor(stripeSecretKey, stripeWebhookSecret, env.NODE_ENV),
    stripeSecretKey,
    stripeWebhookSecret,
    stripePortalConfigurationId: clean(env.STRIPE_PORTAL_CONFIGURATION_ID),
    automaticTax: taxFlag === '1' || taxFlag === 'true',
    testWebhookSecret,
  };
}

/**
 * The gateway for a config, or null when billing is off. In the two Stripe modes the caller must
 * pass `options.stripe` (`createStripeGateway` from `@kitstak/billing/gateway/stripe`): this file
 * never imports the Stripe SDK, so product apps that only read plan state do not bundle it.
 */
export function createGateway(
  config: BillingConfig,
  db: BillingDb,
  portalUrl: string,
  options?: { stripe?: StripeGatewayFactory; now?: () => Date },
): BillingGateway | null {
  if (config.mode === 'unavailable') return null;
  if (config.mode === 'test_gateway') {
    return createTestGateway({
      db,
      portalUrl,
      webhookSecret: config.testWebhookSecret,
      ...(options?.now ? { now: options.now } : {}),
    });
  }
  if (!options?.stripe) {
    throw new Error(
      "Stripe mode needs the Stripe gateway. Pass `stripe: createStripeGateway` from '@kitstak/billing/gateway/stripe'.",
    );
  }
  return options.stripe(config);
}
