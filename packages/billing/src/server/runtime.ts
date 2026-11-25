/**
 * `createBillingRuntime`: the one object every server function takes (docs/billing/CONTRACTS.md
 * section 11.1). It holds the database, the mode, the gateway (null when billing is off), the portal
 * URL and the clock.
 */
import { createGateway, resolveBillingConfig, type StripeGatewayFactory } from './config';
import type { BillingDb, BillingRuntime } from './db';

export function createBillingRuntime(input: {
  db: BillingDb;
  env?: NodeJS.ProcessEnv;
  portalUrl: string;
  now?: () => Date;
  /** `createStripeGateway` from `@kitstak/billing/gateway/stripe`. Needed in the two Stripe modes. */
  stripe?: StripeGatewayFactory;
}): BillingRuntime {
  const config = resolveBillingConfig(input.env ?? process.env);
  const portalUrl = input.portalUrl.replace(/\/+$/, '');
  const now = input.now ?? (() => new Date());
  const gateway = createGateway(config, input.db, portalUrl, {
    ...(input.stripe ? { stripe: input.stripe } : {}),
    now,
  });
  return { db: input.db, config, mode: config.mode, gateway, portalUrl, now };
}
