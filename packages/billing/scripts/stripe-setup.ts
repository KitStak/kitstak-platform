/**
 * Stripe setup for KitStak billing (docs/billing/CONTRACTS.md section 20, SPEC 15.2).
 *
 * Usage, from the repo root:
 *   pnpm -F @kitstak/billing stripe:setup check            read only. One line per product, price and
 *                                                          portal configuration: ok, missing or differs.
 *                                                          Exits 1 if anything is not ok.
 *   pnpm -F @kitstak/billing stripe:setup apply            creates what is missing and fixes labels.
 *                                                          Prints the portal configuration id.
 *   pnpm -F @kitstak/billing stripe:setup apply reprice    also replaces a price whose amount differs
 *                                                          from the catalog (new price, lookup key moved,
 *                                                          old price switched off).
 *
 * It needs STRIPE_SECRET_KEY in the environment (a test key or a live key). With no key, `check`
 * prints the 4 products and 16 prices it would look for and exits 0, so the mapping can be read
 * anywhere. Optional: STRIPE_PORTAL_CONFIGURATION_ID (check that exact configuration) and
 * STRIPE_PORTAL_RETURN_URL (default https://kitstak.app/billing).
 *
 * Safe to run again and again. It never edits an amount in place, never touches a product or price
 * that does not start with `kitstak_`, and never creates, changes or disables a webhook endpoint.
 *
 * This file and `src/gateway/stripe.ts` are the only two that import the Stripe SDK. This one is a
 * command line tool and is never bundled into an app.
 */
import Stripe from 'stripe';
import {
  applyStripe,
  buildStripeSpec,
  checkStripe,
  formatApplyLine,
  formatCheckLine,
  formatDryRun,
  type PortalSpec,
  type RemotePortal,
  type RemotePrice,
  type RemoteProduct,
  type SetupClient,
} from './stripe-setup-lib';

const USAGE = `Usage:
  stripe:setup check
  stripe:setup apply
  stripe:setup apply reprice`;

function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function isMissing(error: unknown): boolean {
  const record = (error ?? {}) as { code?: unknown; statusCode?: unknown };
  return record.code === 'resource_missing' || record.statusCode === 404;
}

function toProduct(product: Stripe.Product): RemoteProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    unit_label: product.unit_label ?? null,
    tax_code: idOf(product.tax_code),
    metadata: product.metadata,
    active: product.active,
  };
}

function toPrice(price: Stripe.Price): RemotePrice {
  return {
    id: price.id,
    product: idOf(price.product) ?? '',
    currency: price.currency,
    unit_amount: price.unit_amount,
    billing_scheme: price.billing_scheme,
    tax_behavior: price.tax_behavior,
    recurring: price.recurring
      ? { interval: price.recurring.interval, interval_count: price.recurring.interval_count, usage_type: price.recurring.usage_type }
      : null,
    lookup_key: price.lookup_key,
    nickname: price.nickname,
    metadata: price.metadata,
    active: price.active,
  };
}

function toPortal(portal: Stripe.BillingPortal.Configuration): RemotePortal {
  const features = portal.features as Stripe.BillingPortal.Configuration['features'] & {
    subscription_pause?: { enabled?: boolean } | null;
  };
  return {
    id: portal.id,
    active: portal.active,
    default_return_url: portal.default_return_url,
    features: {
      payment_method_update: features.payment_method_update.enabled,
      invoice_history: features.invoice_history.enabled,
      customer_update: features.customer_update.enabled,
      customer_update_allowed: features.customer_update.allowed_updates.map(String),
      subscription_cancel: features.subscription_cancel.enabled,
      subscription_update: features.subscription_update.enabled,
      subscription_pause: features.subscription_pause?.enabled === true,
    },
    metadata: portal.metadata ?? {},
  };
}

function portalParams(spec: PortalSpec): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    default_return_url: spec.default_return_url,
    business_profile: { headline: spec.business_profile.headline },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: [...spec.features.customer_update.allowed_updates] },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
      subscription_pause: { enabled: false },
    },
    metadata: { ...spec.metadata },
  };
}

/** The real SDK behind the small interface the setup logic uses. */
function adapt(stripe: Stripe): SetupClient {
  return {
    async getProduct(id) {
      try {
        const product = await stripe.products.retrieve(id);
        // A deleted product comes back as { id, deleted: true }.
        return (product as { deleted?: boolean }).deleted ? null : toProduct(product);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async createProduct(spec) {
      return toProduct(
        await stripe.products.create({
          id: spec.id,
          name: spec.name,
          description: spec.description,
          ...(spec.unit_label ? { unit_label: spec.unit_label } : {}),
          tax_code: spec.tax_code,
          metadata: { ...spec.metadata },
        }),
      );
    },
    async updateProduct(id, change) {
      return toProduct(
        await stripe.products.update(id, {
          name: change.name,
          description: change.description,
          unit_label: change.unit_label ?? '',
          tax_code: change.tax_code,
          metadata: { ...change.metadata },
          active: true,
        }),
      );
    },
    async listPricesByLookupKeys(keys) {
      const page = await stripe.prices.list({ lookup_keys: [...keys], limit: 100 });
      return page.data.map(toPrice);
    },
    async createPrice(spec, options) {
      return toPrice(
        await stripe.prices.create({
          product: spec.product,
          currency: spec.currency,
          unit_amount: spec.unit_amount,
          billing_scheme: spec.billing_scheme,
          tax_behavior: spec.tax_behavior,
          recurring: { ...spec.recurring },
          lookup_key: spec.lookup_key,
          ...(options.transferLookupKey ? { transfer_lookup_key: true } : {}),
          nickname: spec.nickname,
          metadata: { ...spec.metadata },
        }),
      );
    },
    async updatePriceLabels(id, change) {
      return toPrice(await stripe.prices.update(id, { nickname: change.nickname, metadata: { ...change.metadata }, active: true }));
    },
    async deactivatePrice(id) {
      await stripe.prices.update(id, { active: false });
    },
    async getPortal(id) {
      try {
        return toPortal(await stripe.billingPortal.configurations.retrieve(id));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async listPortals() {
      const page = await stripe.billingPortal.configurations.list({ limit: 100 });
      return page.data.map(toPortal);
    },
    async createPortal(spec) {
      return toPortal(await stripe.billingPortal.configurations.create(portalParams(spec)));
    },
    async updatePortal(id, spec) {
      return toPortal(await stripe.billingPortal.configurations.update(id, { ...portalParams(spec), active: true }));
    },
  };
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

async function main(): Promise<void> {
  const [command = 'check', ...rest] = process.argv.slice(2);
  if (command !== 'check' && command !== 'apply') fail(`Unknown command '${command}'.\n${USAGE}`);
  const extra = rest.filter((word) => word !== 'reprice');
  if (extra.length > 0 || (command === 'check' && rest.length > 0)) fail(`Unknown word '${(extra[0] ?? rest[0]) as string}'.\n${USAGE}`);
  const reprice = rest.includes('reprice');

  const returnUrl = clean(process.env.STRIPE_PORTAL_RETURN_URL);
  const spec = buildStripeSpec(returnUrl ? { portalReturnUrl: returnUrl } : undefined);
  const key = clean(process.env.STRIPE_SECRET_KEY);
  const portalConfigurationId = clean(process.env.STRIPE_PORTAL_CONFIGURATION_ID);

  if (!key) {
    if (command === 'apply') fail('STRIPE_SECRET_KEY is not set. Nothing was changed.');
    print(`Dry run. STRIPE_SECRET_KEY is not set, so Stripe was not asked. Catalog ${spec.catalogVersion}.`);
    print(`This is what check looks for: ${spec.products.length} products, ${spec.prices.length} prices and 1 portal configuration.`);
    print();
    for (const line of formatDryRun(spec)) print(line);
    return;
  }

  const live = /^(sk|rk)_live_/.test(key);
  if (!live && !/^(sk|rk)_test_/.test(key)) fail('STRIPE_SECRET_KEY does not look like a Stripe secret key. Nothing was changed.');
  const client = adapt(new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: 'KitStak billing setup' } }));
  print(`Stripe ${live ? 'LIVE mode' : 'test mode'}. Catalog ${spec.catalogVersion}. Command: ${command}${reprice ? ' reprice' : ''}.`);
  print();

  if (command === 'check') {
    const report = await checkStripe(client, spec, { portalConfigurationId });
    for (const line of report.lines) for (const text of formatCheckLine(line)) print(text);
    print();
    if (report.allOk) {
      print('All ok. Stripe matches the catalog.');
      if (report.portalConfigurationId && !portalConfigurationId) {
        print(`Portal configuration: ${report.portalConfigurationId}. Set STRIPE_PORTAL_CONFIGURATION_ID to this value.`);
      }
      return;
    }
    const open = report.lines.filter((line) => line.status !== 'ok').length;
    print(`${open} of ${report.lines.length} are not ok. Run "stripe:setup apply" to create what is missing.`);
    process.exit(1);
  }

  const report = await applyStripe(client, spec, { reprice, portalConfigurationId });
  for (const line of report.lines) print(formatApplyLine(line));
  print();
  print(`${report.changed} changed, ${report.skipped} skipped, ${report.lines.length - report.changed - report.skipped} already ok.`);
  if (report.portalConfigurationId) {
    print(`Portal configuration: ${report.portalConfigurationId}. Set STRIPE_PORTAL_CONFIGURATION_ID to this value.`);
  }
  print('No webhook endpoint was created or changed. See docs/billing/GO-LIVE.md step 8.');
  if (report.skipped > 0) process.exit(1);
}

main().catch((error: unknown) => {
  // Never print the key. A Stripe error message does not hold it.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`stripe:setup failed. ${message}\n`);
  process.exit(2);
});
