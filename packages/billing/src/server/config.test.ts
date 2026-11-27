import { describe, expect, it } from 'vitest';
import type { BillingGateway } from '../gateway/types';
import { billingMode, createGateway, resolveBillingConfig } from './config';
import type { BillingDb } from './db';
import { createBillingRuntime } from './runtime';

const env = (values: Record<string, string | undefined>) => values as unknown as NodeJS.ProcessEnv;
const db = {} as BillingDb;
const SECRET = 'a-shared-secret-that-is-long-enough-for-auth';

describe('billing mode (CONTRACTS section 10.2)', () => {
  it.each([
    ['live key and webhook secret', { STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_1', NODE_ENV: 'production' }, 'live'],
    ['test key and webhook secret', { STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_1', NODE_ENV: 'development' }, 'stripe_test'],
    ['restricted live key', { STRIPE_SECRET_KEY: 'rk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_1', NODE_ENV: 'production' }, 'live'],
    ['key with no webhook secret', { STRIPE_SECRET_KEY: 'sk_live_abc', NODE_ENV: 'production' }, 'unavailable'],
    ['test key with no webhook secret, local', { STRIPE_SECRET_KEY: 'sk_test_abc', NODE_ENV: 'development' }, 'unavailable'],
    ['something that is not a Stripe key', { STRIPE_SECRET_KEY: 'hello', STRIPE_WEBHOOK_SECRET: 'whsec_1', NODE_ENV: 'development' }, 'unavailable'],
    ['no key, local', { NODE_ENV: 'development' }, 'test_gateway'],
    ['no key, tests', { NODE_ENV: 'test' }, 'test_gateway'],
    ['no key, NODE_ENV not set', {}, 'test_gateway'],
    ['blank key, local', { STRIPE_SECRET_KEY: '   ', NODE_ENV: 'development' }, 'test_gateway'],
    ['no key, production', { NODE_ENV: 'production' }, 'unavailable'],
    ['blank key, production', { STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', NODE_ENV: 'production' }, 'unavailable'],
  ] as const)('%s is %s', (_name, values, mode) => {
    expect(resolveBillingConfig(env(values)).mode).toBe(mode);
    expect(billingMode(env(values))).toBe(mode);
  });

  it('no env value turns the test gateway on in production', () => {
    for (const extra of [
      { BILLING_TEST_WEBHOOK_SECRET: 'x' },
      { ENTITLEMENTS_DEV_ALLOW_ALL: '1' },
      { BILLING_MODE: 'test_gateway' },
      { STRIPE_WEBHOOK_SECRET: 'whsec_1' },
    ]) {
      expect(resolveBillingConfig(env({ NODE_ENV: 'production', ...extra })).mode).toBe('unavailable');
    }
  });

  it('reads the optional settings', () => {
    const config = resolveBillingConfig(
      env({
        STRIPE_SECRET_KEY: ' sk_test_abc ',
        STRIPE_WEBHOOK_SECRET: 'whsec_1',
        STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_1',
        STRIPE_AUTOMATIC_TAX: '1',
      }),
    );
    expect(config).toMatchObject({
      stripeSecretKey: 'sk_test_abc',
      stripeWebhookSecret: 'whsec_1',
      stripePortalConfigurationId: 'bpc_1',
      automaticTax: true,
    });
    expect(resolveBillingConfig(env({})).automaticTax).toBe(false);
  });

  it('derives the test webhook secret from the auth secret, or takes the fixed one', () => {
    const derived = resolveBillingConfig(env({ BETTER_AUTH_SECRET: SECRET })).testWebhookSecret;
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveBillingConfig(env({ BETTER_AUTH_SECRET: SECRET })).testWebhookSecret).toBe(derived);
    expect(resolveBillingConfig(env({ BETTER_AUTH_SECRET: `${SECRET}x` })).testWebhookSecret).not.toBe(derived);
    expect(derived).not.toContain(SECRET);
    expect(resolveBillingConfig(env({ BETTER_AUTH_SECRET: SECRET, BILLING_TEST_WEBHOOK_SECRET: 'fixed' })).testWebhookSecret).toBe('fixed');
  });
});

describe('createGateway and the runtime', () => {
  it('has no gateway when billing is off (fail closed)', () => {
    const config = resolveBillingConfig(env({ NODE_ENV: 'production' }));
    expect(createGateway(config, db, 'https://kitstak.app')).toBeNull();
    const rt = createBillingRuntime({ db, env: env({ NODE_ENV: 'production' }), portalUrl: 'https://kitstak.app/' });
    expect(rt.mode).toBe('unavailable');
    expect(rt.gateway).toBeNull();
    expect(rt.portalUrl).toBe('https://kitstak.app');
  });

  it('uses the test gateway outside production with no key', () => {
    const rt = createBillingRuntime({ db, env: env({ NODE_ENV: 'development', BETTER_AUTH_SECRET: SECRET }), portalUrl: 'http://localhost:3300' });
    expect(rt.mode).toBe('test_gateway');
    expect(rt.gateway?.kind).toBe('test');
  });

  it('uses the Stripe gateway that is passed in, and refuses to guess without one', () => {
    const stripeEnv = env({ STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_1', NODE_ENV: 'production' });
    const fake = { kind: 'stripe' } as BillingGateway;
    const rt = createBillingRuntime({ db, env: stripeEnv, portalUrl: 'https://kitstak.app', stripe: () => fake });
    expect(rt.gateway).toBe(fake);
    expect(rt.mode).toBe('stripe_test');
    expect(() => createBillingRuntime({ db, env: stripeEnv, portalUrl: 'https://kitstak.app' })).toThrow(/Stripe gateway/);
  });
});
