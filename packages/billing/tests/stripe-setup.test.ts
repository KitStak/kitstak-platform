/**
 * The Stripe setup logic against a fake account (docs/billing/CONTRACTS.md section 20). No network.
 * The fake keeps products, prices and portal configurations in memory and counts every write.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PORTAL_RETURN_URL,
  applyStripe,
  buildStripeSpec,
  checkStripe,
  formatApplyLine,
  formatCheckLine,
  type PortalSpec,
  type PriceSpec,
  type RemotePortal,
  type RemotePrice,
  type RemoteProduct,
  type SetupClient,
} from '../scripts/stripe-setup-lib';

function fakeStripe() {
  const products = new Map<string, RemoteProduct>();
  const prices: RemotePrice[] = [];
  const portals: RemotePortal[] = [];
  const writes: string[] = [];
  let counter = 0;

  const portalFrom = (id: string, spec: PortalSpec): RemotePortal => ({
    id,
    active: true,
    default_return_url: spec.default_return_url,
    features: {
      payment_method_update: spec.features.payment_method_update.enabled,
      invoice_history: spec.features.invoice_history.enabled,
      customer_update: spec.features.customer_update.enabled,
      customer_update_allowed: [...spec.features.customer_update.allowed_updates],
      subscription_cancel: spec.features.subscription_cancel.enabled,
      subscription_update: spec.features.subscription_update.enabled,
      subscription_pause: spec.features.subscription_pause.enabled,
    },
    metadata: { ...spec.metadata },
  });
  const priceFrom = (spec: PriceSpec): RemotePrice => ({
    id: `price_${(counter += 1)}`,
    product: spec.product,
    currency: spec.currency,
    unit_amount: spec.unit_amount,
    billing_scheme: spec.billing_scheme,
    tax_behavior: spec.tax_behavior,
    recurring: { ...spec.recurring },
    lookup_key: spec.lookup_key,
    nickname: spec.nickname,
    metadata: { ...spec.metadata },
    active: true,
  });

  const client: SetupClient = {
    async getProduct(id) {
      return products.get(id) ?? null;
    },
    async createProduct(spec) {
      writes.push(`create product ${spec.id}`);
      const product: RemoteProduct = { ...spec, metadata: { ...spec.metadata }, active: true };
      products.set(spec.id, product);
      return product;
    },
    async updateProduct(id, change) {
      writes.push(`update product ${id}`);
      const product: RemoteProduct = { id, ...change, metadata: { ...change.metadata } };
      products.set(id, product);
      return product;
    },
    async listPricesByLookupKeys(keys) {
      expect(keys.length).toBeLessThanOrEqual(10);
      return prices.filter((price) => price.lookup_key !== null && keys.includes(price.lookup_key));
    },
    async createPrice(spec, options) {
      writes.push(`create price ${spec.lookup_key}${options.transferLookupKey ? ' (transfer)' : ''}`);
      const holder = prices.findIndex((price) => price.lookup_key === spec.lookup_key);
      if (holder >= 0) {
        if (!options.transferLookupKey) throw new Error('lookup key already in use');
        prices[holder] = { ...prices[holder]!, lookup_key: null };
      }
      const price = priceFrom(spec);
      prices.push(price);
      return price;
    },
    async updatePriceLabels(id, change) {
      writes.push(`update price labels ${id}`);
      const index = prices.findIndex((price) => price.id === id);
      prices[index] = { ...prices[index]!, nickname: change.nickname, metadata: { ...change.metadata }, active: true };
      return prices[index]!;
    },
    async deactivatePrice(id) {
      writes.push(`deactivate price ${id}`);
      const index = prices.findIndex((price) => price.id === id);
      prices[index] = { ...prices[index]!, active: false };
    },
    async getPortal(id) {
      return portals.find((portal) => portal.id === id) ?? null;
    },
    async listPortals() {
      return portals;
    },
    async createPortal(spec) {
      writes.push('create portal');
      const portal = portalFrom(`bpc_${(counter += 1)}`, spec);
      portals.push(portal);
      return portal;
    },
    async updatePortal(id, spec) {
      writes.push(`update portal ${id}`);
      const index = portals.findIndex((portal) => portal.id === id);
      portals[index] = portalFrom(id, spec);
      return portals[index]!;
    },
  };
  return { client, products, prices, portals, writes };
}

const spec = buildStripeSpec();

describe('buildStripeSpec', () => {
  it('describes 4 products by fixed id, with the SaaS tax code and the catalog version', () => {
    expect(spec.products).toEqual([
      { id: 'kitstak_crm', name: 'KitStak CRM', description: 'Track every customer, deal and follow up in one place.', unit_label: 'user', tax_code: 'txcd_10103001', metadata: { kitstak_module: 'crm', kitstak_catalog: '2026-11' } },
      { id: 'kitstak_wms', name: 'KitStak WMS', description: 'Run receiving, inventory, picking and shipping in your warehouse.', unit_label: 'warehouse', tax_code: 'txcd_10103001', metadata: { kitstak_module: 'wms', kitstak_catalog: '2026-11' } },
      { id: 'kitstak_projects', name: 'KitStak Projects', description: 'Plan work, assign tasks and see what is due.', unit_label: 'user', tax_code: 'txcd_10103001', metadata: { kitstak_module: 'projects', kitstak_catalog: '2026-11' } },
      { id: 'kitstak_pulse', name: 'KitStak Pulse', description: 'See the profit on every job, client and month.', unit_label: null, tax_code: 'txcd_10103001', metadata: { kitstak_module: 'pulse', kitstak_catalog: '2026-11' } },
    ]);
  });

  it('describes one price in full', () => {
    expect(spec.prices.find((price) => price.lookup_key === 'kitstak_crm_yearly_bundle')).toEqual({
      lookup_key: 'kitstak_crm_yearly_bundle',
      product: 'kitstak_crm',
      currency: 'usd',
      unit_amount: 23664,
      billing_scheme: 'per_unit',
      tax_behavior: 'exclusive',
      recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' },
      nickname: 'CRM yearly bundle',
      metadata: { kitstak_module: 'crm', kitstak_interval: 'yearly', kitstak_bundle: 'true', kitstak_catalog: '2026-11' },
    });
    expect(spec.prices.find((price) => price.lookup_key === 'kitstak_pulse_monthly')?.nickname).toBe('Pulse monthly');
  });

  it('the portal lets a customer update a card and details, and nothing about the plan', () => {
    expect(spec.portal.default_return_url).toBe(DEFAULT_PORTAL_RETURN_URL);
    expect(spec.portal.features).toEqual({
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['name', 'email', 'address', 'tax_id'] },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
      subscription_pause: { enabled: false },
    });
    expect(buildStripeSpec({ portalReturnUrl: 'http://localhost:3300/billing' }).portal.default_return_url).toBe('http://localhost:3300/billing');
  });
});

describe('check and apply', () => {
  it('an empty account: everything is missing, apply creates 4 products, 16 prices and the portal', async () => {
    const account = fakeStripe();
    const before = await checkStripe(account.client, spec);
    expect(before.allOk).toBe(false);
    expect(before.lines).toHaveLength(21);
    expect(before.lines.every((line) => line.status === 'missing')).toBe(true);
    expect(account.writes).toEqual([]);

    const applied = await applyStripe(account.client, spec);
    expect(applied.changed).toBe(21);
    expect(applied.skipped).toBe(0);
    expect(applied.portalConfigurationId).toMatch(/^bpc_/);
    expect(account.products.size).toBe(4);
    expect(account.prices).toHaveLength(16);
    expect(account.portals).toHaveLength(1);
    // Products come first: a price needs its product.
    expect(account.writes.slice(0, 4).every((write) => write.startsWith('create product'))).toBe(true);

    const after = await checkStripe(account.client, spec);
    expect(after.allOk).toBe(true);
    expect(after.portalConfigurationId).toBe(applied.portalConfigurationId);
  });

  it('apply twice changes nothing the second time', async () => {
    const account = fakeStripe();
    await applyStripe(account.client, spec);
    const writes = account.writes.length;
    const second = await applyStripe(account.client, spec);
    expect(second.changed).toBe(0);
    expect(second.lines.every((line) => line.action === 'unchanged')).toBe(true);
    expect(account.writes).toHaveLength(writes);
  });

  it('check never writes', async () => {
    const account = fakeStripe();
    await applyStripe(account.client, spec);
    account.prices[0] = { ...account.prices[0]!, unit_amount: 1 };
    const writes = account.writes.length;
    const report = await checkStripe(account.client, spec);
    expect(report.allOk).toBe(false);
    expect(account.writes).toHaveLength(writes);
  });

  it('a price with a wrong amount is never edited: apply skips it, apply reprice replaces it', async () => {
    const account = fakeStripe();
    await applyStripe(account.client, spec);
    const old = account.prices.find((price) => price.lookup_key === 'kitstak_crm_monthly')!;
    account.prices[account.prices.indexOf(old)] = { ...old, unit_amount: 2800 };

    const report = await checkStripe(account.client, spec);
    const line = report.lines.find((entry) => entry.name === 'kitstak_crm_monthly')!;
    expect(line).toMatchObject({ status: 'differs', needsReprice: true, differences: ['unit_amount: Stripe 2800, catalog 2900'] });
    expect(formatCheckLine(line)).toEqual([
      'price   kitstak_crm_monthly               differs  $29.00 per user each month',
      '        unit_amount: Stripe 2800, catalog 2900',
    ]);

    account.writes.length = 0;
    const plain = await applyStripe(account.client, spec);
    expect(plain.changed).toBe(0);
    expect(plain.skipped).toBe(1);
    expect(plain.lines.find((entry) => entry.name === 'kitstak_crm_monthly')?.note).toContain('A price is never edited in place.');
    expect(account.writes).toEqual([]);

    const repriced = await applyStripe(account.client, spec, { reprice: true });
    expect(repriced.changed).toBe(1);
    expect(account.writes).toEqual(['create price kitstak_crm_monthly (transfer)', `deactivate price ${old.id}`]);
    const holders = account.prices.filter((price) => price.lookup_key === 'kitstak_crm_monthly');
    expect(holders).toHaveLength(1);
    expect(holders[0]).toMatchObject({ unit_amount: 2900, active: true });
    expect(account.prices.find((price) => price.id === old.id)).toMatchObject({ unit_amount: 2800, active: false, lookup_key: null });
    expect((await checkStripe(account.client, spec)).allOk).toBe(true);
  });

  it('labels that drifted are fixed by apply without a new price', async () => {
    const account = fakeStripe();
    await applyStripe(account.client, spec);
    const index = account.prices.findIndex((price) => price.lookup_key === 'kitstak_wms_yearly');
    const id = account.prices[index]!.id;
    account.prices[index] = { ...account.prices[index]!, nickname: null, metadata: {}, active: false };
    account.products.set('kitstak_pulse', { ...account.products.get('kitstak_pulse')!, name: 'Pulse', unit_label: 'seat' });

    const report = await checkStripe(account.client, spec);
    expect(report.lines.find((line) => line.name === 'kitstak_wms_yearly')).toMatchObject({ status: 'differs', needsReprice: false });
    expect(report.lines.find((line) => line.name === 'kitstak_pulse')?.differences).toEqual([
      'name: Stripe Pulse, catalog KitStak Pulse',
      'unit_label: Stripe seat, catalog nothing',
    ]);

    account.writes.length = 0;
    const applied = await applyStripe(account.client, spec);
    expect(applied.changed).toBe(2);
    expect(account.writes.sort()).toEqual([`update price labels ${id}`, 'update product kitstak_pulse']);
    expect(account.prices).toHaveLength(16);
    expect((await checkStripe(account.client, spec)).allOk).toBe(true);
  });

  it('never touches a price that sits on a product KitStak billing does not manage', async () => {
    const account = fakeStripe();
    await applyStripe(account.client, spec);
    const index = account.prices.findIndex((price) => price.lookup_key === 'kitstak_crm_monthly');
    account.prices[index] = { ...account.prices[index]!, product: 'prod_OldStarterTier', unit_amount: 4900 };
    account.writes.length = 0;
    const applied = await applyStripe(account.client, spec, { reprice: true });
    expect(applied.skipped).toBe(1);
    expect(applied.changed).toBe(0);
    expect(account.writes).toEqual([]);
    expect(formatApplyLine(applied.lines.find((line) => line.action === 'skipped')!)).toContain('does not manage');
  });

  it('checks the portal configuration named in env, and repairs one that was opened up', async () => {
    const account = fakeStripe();
    const applied = await applyStripe(account.client, spec);
    const id = applied.portalConfigurationId!;
    account.portals[0] = { ...account.portals[0]!, features: { ...account.portals[0]!.features, subscription_cancel: true } };

    const report = await checkStripe(account.client, spec, { portalConfigurationId: id });
    expect(report.lines.at(-1)).toMatchObject({ kind: 'portal', name: id, status: 'differs', differences: ['subscription_cancel: Stripe true, catalog false'] });
    await applyStripe(account.client, spec, { portalConfigurationId: id });
    expect(account.portals[0]!.features.subscription_cancel).toBe(false);
    expect(account.portals).toHaveLength(1);

    // An id that does not exist reads as missing, and apply makes a new one.
    const lost = await checkStripe(account.client, spec, { portalConfigurationId: 'bpc_gone' });
    expect(lost.lines.at(-1)?.status).toBe('missing');
  });

  it('ignores portal configurations it did not make', async () => {
    const account = fakeStripe();
    account.portals.push({
      id: 'bpc_someone_else',
      active: true,
      default_return_url: 'https://example.com',
      features: { payment_method_update: true, invoice_history: true, customer_update: false, customer_update_allowed: [], subscription_cancel: true, subscription_update: true, subscription_pause: false },
      metadata: {},
    });
    const report = await checkStripe(account.client, spec);
    expect(report.lines.at(-1)?.status).toBe('missing');
    const applied = await applyStripe(account.client, spec);
    expect(applied.portalConfigurationId).not.toBe('bpc_someone_else');
    expect(account.portals.find((portal) => portal.id === 'bpc_someone_else')?.features.subscription_cancel).toBe(true);
  });
});
