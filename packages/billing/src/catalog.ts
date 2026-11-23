/**
 * The one pricing catalog for KitStak (docs/billing/CONTRACTS.md section 4). PURE: no imports, safe in
 * the browser and on the marketing site. Every screen, the quote, the Stripe mapping and the test
 * gateway read prices from here and from nowhere else.
 */

export const PRODUCT_IDS = ['crm', 'wms', 'projects', 'pulse'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];
/** Always in PRODUCT_IDS order, no repeats. */
export type Stack = readonly ProductId[];
export type BillingInterval = 'monthly' | 'yearly';
export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly'];
export type QuantitySource = 'seats' | 'warehouses' | 'flat';
export type UnitNoun = 'user' | 'warehouse' | 'organization';

export interface ProductPricing {
  readonly id: ProductId;
  /** 'KitStak CRM' */
  readonly name: string;
  /** 'CRM' */
  readonly shortName: string;
  /** One plain line, shown on tiles and pickers. */
  readonly tagline: string;
  readonly unit: UnitNoun;
  readonly unitPlural: string;
  readonly quantityFrom: QuantitySource;
  /** Largest quantity a person can pick: crm 500, projects 500, wms 50, pulse 1. */
  readonly max: number;
  /** Seats a flat price covers: pulse 5, others null. */
  readonly includedSeats: number | null;
  /** Unit amounts in cents, per unit per period. These are what the gateway charges. */
  readonly cents: {
    readonly monthly: number;
    readonly monthlyBundle: number;
    readonly yearly: number;
    readonly yearlyBundle: number;
  };
}

/**
 * Prices. Pulse ($29 per organization, up to 5 seats) was confirmed by the owner first. On 2026-11-23 the owner
 * chose the per product model for self serve signup (docs/billing/DECISIONS.md section 1), so CRM, WMS and
 * Projects are live prices too. Customers never see the word "preliminary". Change a price here and nowhere
 * else, then run `pnpm -F @kitstak/billing stripe:setup check` to see what Stripe needs.
 */
export const PRICING_IS_PLACEHOLDER = false;

/**
 * The money rules people ask about before they buy, in plain words. One place, so the pricing page,
 * sign-up, the cancel page and billing home always say the same thing. The refund sentence states
 * what the product does today (a canceled plan runs to the end of the paid period and nothing is
 * paid back for the time left). The owner confirms or changes it here before go-live.
 */
export const BILLING_POLICY = {
  payments: 'Card payments run on Stripe. KitStak never sees your full card number.',
  refund:
    'When you cancel, your plan stays on until the end of the month or year you paid for. We do not refund the time left. Charged by mistake? Tell us and we will fix it.',
} as const;

export const CATALOG: {
  readonly version: '2026-11';
  readonly currency: 'usd';
  readonly bundlePercentOff: 20;
  readonly yearlyPercentOff: 15;
  readonly bundleMinProducts: 2;
  readonly trialDays: 14;
  /** Must equal GRACE_DAYS in @kitstak/entitlements (a test asserts it). */
  readonly graceDays: 7;
  readonly trialReminderDays: readonly [7, 3, 1, 0];
  readonly pauseMonths: readonly [1, 2, 3];
  /** Members with only these roles do not use a seat. */
  readonly freeRoles: readonly ['guest'];
  readonly trialsPerUser: 1;
  readonly products: Readonly<Record<ProductId, ProductPricing>>;
} = {
  version: '2026-11',
  currency: 'usd',
  bundlePercentOff: 20,
  yearlyPercentOff: 15,
  bundleMinProducts: 2,
  trialDays: 14,
  graceDays: 7,
  trialReminderDays: [7, 3, 1, 0],
  pauseMonths: [1, 2, 3],
  freeRoles: ['guest'],
  trialsPerUser: 1,
  products: {
    crm: {
      id: 'crm',
      name: 'KitStak CRM',
      shortName: 'CRM',
      tagline: 'Track every customer, deal and follow up in one place.',
      unit: 'user',
      unitPlural: 'users',
      quantityFrom: 'seats',
      max: 500,
      includedSeats: null,
      cents: { monthly: 2900, monthlyBundle: 2320, yearly: 29580, yearlyBundle: 23664 },
    },
    wms: {
      id: 'wms',
      name: 'KitStak WMS',
      shortName: 'WMS',
      tagline: 'Run receiving, inventory, picking and shipping in your warehouse.',
      unit: 'warehouse',
      unitPlural: 'warehouses',
      quantityFrom: 'warehouses',
      max: 50,
      includedSeats: null,
      cents: { monthly: 34900, monthlyBundle: 27920, yearly: 355980, yearlyBundle: 284784 },
    },
    projects: {
      id: 'projects',
      name: 'KitStak Projects',
      shortName: 'Projects',
      tagline: 'Plan work, assign tasks and see what is due.',
      unit: 'user',
      unitPlural: 'users',
      quantityFrom: 'seats',
      max: 500,
      includedSeats: null,
      cents: { monthly: 1200, monthlyBundle: 960, yearly: 12240, yearlyBundle: 9792 },
    },
    pulse: {
      id: 'pulse',
      name: 'KitStak Pulse',
      shortName: 'Pulse',
      tagline: 'See the profit on every job, client and month.',
      unit: 'organization',
      unitPlural: 'organizations',
      quantityFrom: 'flat',
      max: 1,
      includedSeats: 5,
      cents: { monthly: 2900, monthlyBundle: 2320, yearly: 29580, yearlyBundle: 23664 },
    },
  },
};

export const MAX_SEATS = 500;
export const MAX_WAREHOUSES = 50;

export interface PlanSelection {
  readonly products: Stack;
  /** 1..500, people who sign in; used by crm and projects. */
  readonly seats: number;
  /** 1..50, used by wms. */
  readonly warehouses: number;
  readonly interval: BillingInterval;
}

export const DEFAULT_SELECTION: PlanSelection = Object.freeze({
  products: Object.freeze([]) as Stack,
  seats: 1,
  warehouses: 1,
  interval: 'monthly',
});

export function isProductId(value: string): value is ProductId {
  return (PRODUCT_IDS as readonly string[]).includes(value);
}

/** Cleans a list of product ids: unknown ids dropped, repeats dropped, PRODUCT_IDS order. */
export function toStack(products: readonly string[]): Stack {
  const wanted = new Set(products);
  return PRODUCT_IDS.filter((id) => wanted.has(id));
}

/** 'crm,wms' to a stack. The legacy value 'both' means crm and wms. */
export function parseStack(value: string | null | undefined): Stack {
  if (!value) return [];
  const parts = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (parts.includes('both')) return toStack([...parts, 'crm', 'wms']);
  return toStack(parts);
}

export function stackParam(stack: Stack): string {
  return toStack(stack).join(',');
}

export function toggleProduct(stack: Stack, product: ProductId): Stack {
  return stack.includes(product)
    ? toStack(stack.filter((id) => id !== product))
    : toStack([...stack, product]);
}

/** True when the stack gets the bundle discount. */
export function isBundle(stack: Stack): boolean {
  return toStack(stack).length >= CATALOG.bundleMinProducts;
}

function clampWhole(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Clamps and cleans untrusted input. Never throws. Unknown products are dropped. */
export function normalizeSelection(input: unknown): PlanSelection {
  if (!isRecord(input)) return DEFAULT_SELECTION;
  const rawProducts = input.products;
  const products = Array.isArray(rawProducts)
    ? toStack(rawProducts.filter((entry): entry is string => typeof entry === 'string'))
    : typeof rawProducts === 'string'
      ? parseStack(rawProducts)
      : [];
  const rawInterval = input.interval;
  const interval: BillingInterval = rawInterval === 'yearly' || rawInterval === 'annual' ? 'yearly' : 'monthly';
  return {
    products,
    seats: clampWhole(input.seats, 1, MAX_SEATS, 1),
    warehouses: clampWhole(input.warehouses, 1, MAX_WAREHOUSES, 1),
    interval,
  };
}

/** Units charged for a product: seats, warehouses, or 1 for a flat price. */
export function quantityFor(product: ProductId, selection: PlanSelection): number {
  const source = CATALOG.products[product].quantityFrom;
  if (source === 'seats') return selection.seats;
  if (source === 'warehouses') return selection.warehouses;
  return 1;
}

/** What the gateway charges for one unit of a product for one period. */
export function unitCents(product: ProductId, interval: BillingInterval, bundle: boolean): number {
  const cents = CATALOG.products[product].cents;
  if (interval === 'yearly') return bundle ? cents.yearlyBundle : cents.yearly;
  return bundle ? cents.monthlyBundle : cents.monthly;
}

/** Seats the plan allows. Per user product in the stack: seats. Pulse without one: 5. WMS only: null. */
export function seatLimitFor(selection: PlanSelection): number | null {
  const stack = toStack(selection.products);
  if (stack.some((id) => CATALOG.products[id].quantityFrom === 'seats')) return selection.seats;
  for (const id of stack) {
    const included = CATALOG.products[id].includedSeats;
    if (included !== null) return included;
  }
  return null;
}

export type PriceKey =
  | `kitstak_${ProductId}_${BillingInterval}`
  | `kitstak_${ProductId}_${BillingInterval}_bundle`;

export function priceKey(product: ProductId, interval: BillingInterval, bundle: boolean): PriceKey {
  return bundle ? `kitstak_${product}_${interval}_bundle` : `kitstak_${product}_${interval}`;
}

const PRICE_KEY_RE = /^kitstak_([a-z]+)_(monthly|yearly)(_bundle)?$/;

export function parsePriceKey(
  key: string,
): { product: ProductId; interval: BillingInterval; bundle: boolean } | null {
  const match = PRICE_KEY_RE.exec(key);
  if (!match) return null;
  const product = match[1] ?? '';
  if (!isProductId(product)) return null;
  return { product, interval: match[2] as BillingInterval, bundle: match[3] !== undefined };
}

/** All 16 price lookup keys, in PRODUCT_IDS order. */
export function allPriceKeys(): readonly PriceKey[] {
  const keys: PriceKey[] = [];
  for (const product of PRODUCT_IDS) {
    for (const interval of BILLING_INTERVALS) {
      keys.push(priceKey(product, interval, false), priceKey(product, interval, true));
    }
  }
  return keys;
}

/** The amount in cents a price key charges per unit, read from the catalog. */
export function priceKeyCents(key: PriceKey): number {
  const parsed = parsePriceKey(key);
  if (!parsed) throw new Error(`Unknown price key: ${key}`);
  return unitCents(parsed.product, parsed.interval, parsed.bundle);
}

function groupThousands(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '$1,479.00'. With trimZeroCents: '$29' but still '$23.20'. Never rounds. Negative: '-$98.80'. */
export function formatMoney(cents: number, options?: { trimZeroCents?: boolean }): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const negative = safe < 0;
  const absolute = Math.abs(safe);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  const body =
    options?.trimZeroCents && fraction === 0
      ? groupThousands(whole)
      : `${groupThousands(whole)}.${String(fraction).padStart(2, '0')}`;
  return `${negative ? '-' : ''}$${body}`;
}

/** 20 to '20%'. */
export function percentLabel(percent: number): string {
  return `${percent}%`;
}

function safeTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** 'Dec 7, 2026' in the given IANA zone (default 'UTC'). One date format for every billing screen. */
export function formatDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** 'Dec 7' in the given IANA zone. The short form banners use (SPEC 9.2). */
export function formatDayShort(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    month: 'short',
    day: 'numeric',
  }).format(date);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until a date, rounded up, never below 0. */
export function daysLeft(until: Date, now: Date): number {
  const ms = until.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

/** 'CRM', 'CRM and WMS', 'CRM, WMS and Pulse'. Plain words for sentences. */
export function productListLabel(stack: Stack): string {
  const names = toStack(stack).map((id) => CATALOG.products[id].shortName);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** 'per user each month', 'per warehouse each year', 'each month for your whole team'. */
export function priceTermsLabel(product: ProductId, interval: BillingInterval): string {
  const period = interval === 'yearly' ? 'year' : 'month';
  const pricing = CATALOG.products[product];
  if (pricing.quantityFrom === 'flat') return `each ${period} for your whole team`;
  return `per ${pricing.unit} each ${period}`;
}
