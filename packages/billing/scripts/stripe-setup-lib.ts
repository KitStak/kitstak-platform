/**
 * The logic of `stripe:setup` (docs/billing/CONTRACTS.md sections 5 and 20), kept apart from the
 * command line so it can be tested with a fake client. This file never imports the Stripe SDK.
 *
 * What it knows:
 *  - `buildStripeSpec()` turns the one pricing catalog into what Stripe must hold: 4 products with
 *    fixed ids, 16 prices found by lookup key, and one Billing Portal configuration.
 *  - `checkStripe()` reads the account and says `ok`, `missing` or `differs` for each of them.
 *  - `applyStripe()` creates what is missing and fixes labels. It never changes an amount in place:
 *    a price with a wrong amount is replaced by a new price (the lookup key moves to it and the old
 *    one is switched off), and only when asked with the word `reprice`.
 *
 * What it never does: touch a product or price that does not start with `kitstak_`, or create,
 * change or disable a webhook endpoint.
 */
import {
  CATALOG,
  PRODUCT_IDS,
  allPriceKeys,
  formatMoney,
  parsePriceKey,
  priceKeyCents,
  priceTermsLabel,
  type PriceKey,
  type ProductId,
} from '../src/catalog';

export const PRODUCT_ID_PREFIX = 'kitstak_';
/** "Software as a Service (SaaS), Business Use" in the Stripe tax code list (CONTRACTS 5.1). */
export const SAAS_TAX_CODE = 'txcd_10103001';
export const PORTAL_METADATA_KEY = 'kitstak_config';
export const PORTAL_METADATA_VALUE = 'billing_portal';
export const DEFAULT_PORTAL_RETURN_URL = 'https://kitstak.app/billing';

/* ===== what Stripe must hold ===== */

export interface ProductSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** null for a flat price (Pulse). */
  readonly unit_label: string | null;
  readonly tax_code: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface PriceSpec {
  readonly lookup_key: PriceKey;
  readonly product: string;
  readonly currency: 'usd';
  readonly unit_amount: number;
  readonly billing_scheme: 'per_unit';
  readonly tax_behavior: 'exclusive';
  readonly recurring: { readonly interval: 'month' | 'year'; readonly interval_count: 1; readonly usage_type: 'licensed' };
  readonly nickname: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface PortalSpec {
  readonly default_return_url: string;
  readonly business_profile: { readonly headline: string };
  readonly features: {
    readonly payment_method_update: { readonly enabled: true };
    readonly invoice_history: { readonly enabled: true };
    readonly customer_update: { readonly enabled: true; readonly allowed_updates: readonly ('name' | 'email' | 'address' | 'tax_id')[] };
    readonly subscription_cancel: { readonly enabled: false };
    readonly subscription_update: { readonly enabled: false };
    readonly subscription_pause: { readonly enabled: false };
  };
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StripeSpec {
  readonly catalogVersion: string;
  readonly products: readonly ProductSpec[];
  readonly prices: readonly PriceSpec[];
  readonly portal: PortalSpec;
}

export function stripeProductId(product: ProductId): string {
  return `${PRODUCT_ID_PREFIX}${product}`;
}

function priceNickname(key: PriceKey): string {
  const parsed = parsePriceKey(key);
  if (!parsed) throw new Error(`Unknown price key: ${key}`);
  const words = [CATALOG.products[parsed.product].shortName, parsed.interval];
  if (parsed.bundle) words.push('bundle');
  return words.join(' ');
}

/** Everything Stripe must hold, worked out from the catalog. Change a price there, never here. */
export function buildStripeSpec(options?: { portalReturnUrl?: string }): StripeSpec {
  const products: ProductSpec[] = PRODUCT_IDS.map((id) => {
    const pricing = CATALOG.products[id];
    return {
      id: stripeProductId(id),
      name: pricing.name,
      description: pricing.tagline,
      unit_label: pricing.quantityFrom === 'flat' ? null : pricing.unit,
      tax_code: SAAS_TAX_CODE,
      metadata: { kitstak_module: id, kitstak_catalog: CATALOG.version },
    };
  });

  const prices: PriceSpec[] = allPriceKeys().map((key) => {
    const parsed = parsePriceKey(key);
    if (!parsed) throw new Error(`Unknown price key: ${key}`);
    return {
      lookup_key: key,
      product: stripeProductId(parsed.product),
      currency: CATALOG.currency,
      unit_amount: priceKeyCents(key),
      billing_scheme: 'per_unit',
      tax_behavior: 'exclusive',
      recurring: { interval: parsed.interval === 'yearly' ? 'year' : 'month', interval_count: 1, usage_type: 'licensed' },
      nickname: priceNickname(key),
      metadata: {
        kitstak_module: parsed.product,
        kitstak_interval: parsed.interval,
        kitstak_bundle: parsed.bundle ? 'true' : 'false',
        kitstak_catalog: CATALOG.version,
      },
    };
  });

  return {
    catalogVersion: CATALOG.version,
    products,
    prices,
    portal: {
      default_return_url: options?.portalReturnUrl ?? DEFAULT_PORTAL_RETURN_URL,
      business_profile: { headline: 'Update the card for your KitStak plan.' },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ['name', 'email', 'address', 'tax_id'] },
        // KitStak runs cancel, plan changes and pause in its own screens, with one proration rule.
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
        subscription_pause: { enabled: false },
      },
      metadata: { [PORTAL_METADATA_KEY]: PORTAL_METADATA_VALUE, kitstak_catalog: CATALOG.version },
    },
  };
}

/* ===== what the account holds (the small part we read) ===== */

export interface RemoteProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly unit_label: string | null;
  readonly tax_code: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly active: boolean;
}

export interface RemotePrice {
  readonly id: string;
  readonly product: string;
  readonly currency: string;
  readonly unit_amount: number | null;
  readonly billing_scheme: string;
  readonly tax_behavior: string | null;
  readonly recurring: { readonly interval: string; readonly interval_count: number; readonly usage_type: string } | null;
  readonly lookup_key: string | null;
  readonly nickname: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly active: boolean;
}

export interface RemotePortal {
  readonly id: string;
  readonly active: boolean;
  readonly default_return_url: string | null;
  readonly features: {
    readonly payment_method_update: boolean;
    readonly invoice_history: boolean;
    readonly customer_update: boolean;
    readonly customer_update_allowed: readonly string[];
    readonly subscription_cancel: boolean;
    readonly subscription_update: boolean;
    readonly subscription_pause: boolean;
  };
  readonly metadata: Readonly<Record<string, string>>;
}

/** The few calls the setup needs. The command line file adapts the real SDK to this. */
export interface SetupClient {
  getProduct(id: string): Promise<RemoteProduct | null>;
  createProduct(spec: ProductSpec): Promise<RemoteProduct>;
  updateProduct(id: string, change: Omit<ProductSpec, 'id'> & { active: true }): Promise<RemoteProduct>;
  /** Active and inactive prices that hold any of these lookup keys. */
  listPricesByLookupKeys(keys: readonly string[]): Promise<readonly RemotePrice[]>;
  createPrice(spec: PriceSpec, options: { transferLookupKey: boolean }): Promise<RemotePrice>;
  updatePriceLabels(id: string, change: { nickname: string; metadata: Readonly<Record<string, string>>; active: true }): Promise<RemotePrice>;
  deactivatePrice(id: string): Promise<void>;
  getPortal(id: string): Promise<RemotePortal | null>;
  listPortals(): Promise<readonly RemotePortal[]>;
  createPortal(spec: PortalSpec): Promise<RemotePortal>;
  updatePortal(id: string, spec: PortalSpec): Promise<RemotePortal>;
}

/* ===== check ===== */

export type SetupStatus = 'ok' | 'missing' | 'differs';

export interface SetupLine {
  readonly kind: 'product' | 'price' | 'portal';
  /** The product id, the lookup key, or the portal configuration id. */
  readonly name: string;
  readonly status: SetupStatus;
  /** A plain note, for example the price in words. */
  readonly note: string;
  /** One entry per value that differs: "unit_amount: Stripe 2800, catalog 2900". */
  readonly differences: readonly string[];
  /** True when a difference is in a value Stripe never lets anyone change (the amount, the period). */
  readonly needsReprice: boolean;
  /** True when this script must not touch the object (it belongs to something else). */
  readonly blocked: boolean;
  readonly remoteId: string | null;
}

export interface SetupReport {
  readonly lines: readonly SetupLine[];
  readonly allOk: boolean;
  readonly portalConfigurationId: string | null;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) return value.length === 0 ? 'nothing' : value.join(', ');
  return String(value);
}

function compare(differences: string[], field: string, remote: unknown, wanted: unknown): boolean {
  const same = Array.isArray(remote) && Array.isArray(wanted)
    ? [...remote].sort().join('|') === [...wanted].sort().join('|')
    : (remote ?? null) === (wanted ?? null);
  if (!same) differences.push(`${field}: Stripe ${show(remote)}, catalog ${show(wanted)}`);
  return same;
}

function compareMetadata(differences: string[], remote: Readonly<Record<string, string>>, wanted: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(wanted)) compare(differences, `metadata.${key}`, remote[key], value);
}

function priceWords(spec: PriceSpec): string {
  const parsed = parsePriceKey(spec.lookup_key);
  if (!parsed) return formatMoney(spec.unit_amount);
  return `${formatMoney(spec.unit_amount)} ${priceTermsLabel(parsed.product, parsed.interval)}${parsed.bundle ? ', bundle price' : ''}`;
}

function checkProduct(spec: ProductSpec, remote: RemoteProduct | null): SetupLine {
  const base = { kind: 'product' as const, name: spec.id, note: spec.name, needsReprice: false, blocked: false };
  if (!remote) return { ...base, status: 'missing', differences: [], remoteId: null };
  const differences: string[] = [];
  compare(differences, 'name', remote.name, spec.name);
  compare(differences, 'description', remote.description, spec.description);
  compare(differences, 'unit_label', remote.unit_label, spec.unit_label);
  compare(differences, 'tax_code', remote.tax_code, spec.tax_code);
  compare(differences, 'active', remote.active, true);
  compareMetadata(differences, remote.metadata, spec.metadata);
  return { ...base, status: differences.length === 0 ? 'ok' : 'differs', differences, remoteId: remote.id };
}

function checkPrice(spec: PriceSpec, found: readonly RemotePrice[]): SetupLine {
  const base = { kind: 'price' as const, name: spec.lookup_key, note: priceWords(spec) };
  // A lookup key lives on one price. If Stripe ever shows two, the active one is the one in use.
  const remote = found.find((price) => price.active) ?? found[0] ?? null;
  if (!remote) return { ...base, status: 'missing', differences: [], needsReprice: false, blocked: false, remoteId: null };

  if (!remote.product.startsWith(PRODUCT_ID_PREFIX)) {
    return {
      ...base,
      status: 'differs',
      differences: [`product: Stripe ${remote.product}, catalog ${spec.product}. This price belongs to a product KitStak billing does not manage. Fix it by hand.`],
      needsReprice: false,
      blocked: true,
      remoteId: remote.id,
    };
  }

  const fixed: string[] = [];
  compare(fixed, 'product', remote.product, spec.product);
  compare(fixed, 'unit_amount', remote.unit_amount, spec.unit_amount);
  compare(fixed, 'currency', remote.currency, spec.currency);
  compare(fixed, 'billing_scheme', remote.billing_scheme, spec.billing_scheme);
  compare(fixed, 'tax_behavior', remote.tax_behavior, spec.tax_behavior);
  compare(fixed, 'recurring.interval', remote.recurring?.interval, spec.recurring.interval);
  compare(fixed, 'recurring.interval_count', remote.recurring?.interval_count, spec.recurring.interval_count);
  compare(fixed, 'recurring.usage_type', remote.recurring?.usage_type, spec.recurring.usage_type);

  const labels: string[] = [];
  compare(labels, 'active', remote.active, true);
  compare(labels, 'nickname', remote.nickname, spec.nickname);
  compareMetadata(labels, remote.metadata, spec.metadata);

  const differences = [...fixed, ...labels];
  return {
    ...base,
    status: differences.length === 0 ? 'ok' : 'differs',
    differences,
    needsReprice: fixed.length > 0,
    blocked: false,
    remoteId: remote.id,
  };
}

function checkPortal(spec: PortalSpec, remote: RemotePortal | null): SetupLine {
  const base = { kind: 'portal' as const, note: 'Card updates only. Cancel, plan change and pause are off.', needsReprice: false, blocked: false };
  if (!remote) return { ...base, name: 'billing portal configuration', status: 'missing', differences: [], remoteId: null };
  const differences: string[] = [];
  compare(differences, 'active', remote.active, true);
  compare(differences, 'default_return_url', remote.default_return_url, spec.default_return_url);
  compare(differences, 'payment_method_update', remote.features.payment_method_update, true);
  compare(differences, 'invoice_history', remote.features.invoice_history, true);
  compare(differences, 'customer_update', remote.features.customer_update, true);
  compare(differences, 'customer_update.allowed_updates', [...remote.features.customer_update_allowed], [...spec.features.customer_update.allowed_updates]);
  compare(differences, 'subscription_cancel', remote.features.subscription_cancel, false);
  compare(differences, 'subscription_update', remote.features.subscription_update, false);
  compare(differences, 'subscription_pause', remote.features.subscription_pause, false);
  compareMetadata(differences, remote.metadata, spec.metadata);
  return { ...base, name: remote.id, status: differences.length === 0 ? 'ok' : 'differs', differences, remoteId: remote.id };
}

const LOOKUP_CHUNK = 10;

async function loadPrices(client: SetupClient, spec: StripeSpec): Promise<Map<string, RemotePrice[]>> {
  const byKey = new Map<string, RemotePrice[]>();
  const keys = spec.prices.map((price) => price.lookup_key as string);
  for (let index = 0; index < keys.length; index += LOOKUP_CHUNK) {
    const page = await client.listPricesByLookupKeys(keys.slice(index, index + LOOKUP_CHUNK));
    for (const price of page) {
      if (!price.lookup_key) continue;
      const list = byKey.get(price.lookup_key) ?? [];
      list.push(price);
      byKey.set(price.lookup_key, list);
    }
  }
  return byKey;
}

/** The configuration named in env, else the one this script made before (found by its metadata). */
async function findPortal(client: SetupClient, configuredId: string | null): Promise<RemotePortal | null> {
  if (configuredId) return client.getPortal(configuredId);
  const all = await client.listPortals();
  const ours = all.filter((portal) => portal.metadata[PORTAL_METADATA_KEY] === PORTAL_METADATA_VALUE);
  return ours.find((portal) => portal.active) ?? ours[0] ?? null;
}

export async function checkStripe(
  client: SetupClient,
  spec: StripeSpec,
  options?: { portalConfigurationId?: string | null },
): Promise<SetupReport> {
  const lines: SetupLine[] = [];
  for (const product of spec.products) lines.push(checkProduct(product, await client.getProduct(product.id)));
  const prices = await loadPrices(client, spec);
  for (const price of spec.prices) lines.push(checkPrice(price, prices.get(price.lookup_key) ?? []));
  const portal = await findPortal(client, options?.portalConfigurationId ?? null);
  const portalLine = checkPortal(spec.portal, portal);
  lines.push(portalLine);
  return { lines, allOk: lines.every((line) => line.status === 'ok'), portalConfigurationId: portal?.id ?? null };
}

/* ===== apply ===== */

export type ApplyAction = 'created' | 'updated' | 'repriced' | 'unchanged' | 'skipped';

export interface ApplyLine {
  readonly kind: SetupLine['kind'];
  readonly name: string;
  readonly action: ApplyAction;
  readonly note: string;
}

export interface ApplyReport {
  readonly lines: readonly ApplyLine[];
  readonly changed: number;
  readonly skipped: number;
  readonly portalConfigurationId: string | null;
}

/**
 * Creates what is missing and fixes labels. Running it twice changes nothing the second time.
 * `reprice` allows replacing a price whose amount or period differs from the catalog.
 */
export async function applyStripe(
  client: SetupClient,
  spec: StripeSpec,
  options?: { reprice?: boolean; portalConfigurationId?: string | null },
): Promise<ApplyReport> {
  const before = await checkStripe(client, spec, options);
  const lines: ApplyLine[] = [];
  let portalConfigurationId = before.portalConfigurationId;

  for (const line of before.lines) {
    if (line.status === 'ok') {
      lines.push({ kind: line.kind, name: line.name, action: 'unchanged', note: line.note });
      continue;
    }
    if (line.blocked) {
      lines.push({ kind: line.kind, name: line.name, action: 'skipped', note: line.differences.join('; ') });
      continue;
    }

    if (line.kind === 'product') {
      const product = spec.products.find((entry) => entry.id === line.name);
      if (!product) continue;
      if (line.status === 'missing') {
        await client.createProduct(product);
        lines.push({ kind: 'product', name: line.name, action: 'created', note: product.name });
      } else {
        const { id: _id, ...change } = product;
        await client.updateProduct(product.id, { ...change, active: true });
        lines.push({ kind: 'product', name: line.name, action: 'updated', note: line.differences.join('; ') });
      }
      continue;
    }

    if (line.kind === 'price') {
      const price = spec.prices.find((entry) => entry.lookup_key === line.name);
      if (!price) continue;
      if (line.status === 'missing') {
        await client.createPrice(price, { transferLookupKey: false });
        lines.push({ kind: 'price', name: line.name, action: 'created', note: line.note });
      } else if (line.needsReprice) {
        if (!options?.reprice || !line.remoteId) {
          lines.push({
            kind: 'price',
            name: line.name,
            action: 'skipped',
            note: `${line.differences.join('; ')}. A price is never edited in place. Run apply with the word reprice to replace it.`,
          });
          continue;
        }
        // The new price takes the lookup key in the same call, so there is never a moment with no
        // price behind the key. Then the old one is switched off. Plans already on it keep it.
        await client.createPrice(price, { transferLookupKey: true });
        await client.deactivatePrice(line.remoteId);
        lines.push({ kind: 'price', name: line.name, action: 'repriced', note: `${line.note}. Old price ${line.remoteId} is switched off.` });
      } else if (line.remoteId) {
        await client.updatePriceLabels(line.remoteId, { nickname: price.nickname, metadata: price.metadata, active: true });
        lines.push({ kind: 'price', name: line.name, action: 'updated', note: line.differences.join('; ') });
      }
      continue;
    }

    if (line.status === 'missing') {
      const created = await client.createPortal(spec.portal);
      portalConfigurationId = created.id;
      lines.push({ kind: 'portal', name: created.id, action: 'created', note: line.note });
    } else if (line.remoteId) {
      await client.updatePortal(line.remoteId, spec.portal);
      lines.push({ kind: 'portal', name: line.remoteId, action: 'updated', note: line.differences.join('; ') });
    }
  }

  return {
    lines,
    changed: lines.filter((line) => line.action === 'created' || line.action === 'updated' || line.action === 'repriced').length,
    skipped: lines.filter((line) => line.action === 'skipped').length,
    portalConfigurationId,
  };
}

/* ===== printing ===== */

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value + ' '.repeat(width - value.length);
}

export function formatCheckLine(line: SetupLine): string[] {
  const head = `${pad(line.kind, 8)}${pad(line.name, 34)}${pad(line.status, 9)}${line.note}`;
  return [head, ...line.differences.map((difference) => `${' '.repeat(8)}${difference}`)];
}

export function formatApplyLine(line: ApplyLine): string {
  return `${pad(line.kind, 8)}${pad(line.name, 34)}${pad(line.action, 10)}${line.note}`;
}

/** What `check` would look for. Printed when no key is set, so the mapping can be read offline. */
export function formatDryRun(spec: StripeSpec): string[] {
  return [
    ...spec.products.map((product) => `${pad('product', 8)}${pad(product.id, 34)}${pad('to check', 9)}${product.name}`),
    ...spec.prices.map((price) => `${pad('price', 8)}${pad(price.lookup_key, 34)}${pad('to check', 9)}${priceWords(price)}`),
    `${pad('portal', 8)}${pad('billing portal configuration', 34)}${pad('to check', 9)}Card updates only. Cancel, plan change and pause are off.`,
  ];
}
