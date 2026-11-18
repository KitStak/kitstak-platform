/** Production app origins (from the platform's custom-domain configuration, docs/DEPLOYMENT.md). */
export const LINKS = {
  portal: 'https://kitstak.app',
  crm: 'https://crm.kitstak.app',
  wms: 'https://wms.kitstak.app',
  projects: 'https://projects.kitstak.app',
  pulse: 'https://pulse.kitstak.app',
} as const;

/**
 * Whether customers can open the Pulse app yet. It is still being built, so the site does not send
 * anyone to it: the Pulse page leads with "Book a walkthrough", and the footer leaves out the Pulse
 * start and sign in links. Set this to true on the day pulse.kitstak.app opens. That one line brings
 * "Start with Pulse" and the sign in link back.
 */
export const PULSE_IS_LIVE: boolean = false;

/** False for a product whose app customers cannot open yet. Such a product gets no start button. */
export function isAppLive(product: 'crm' | 'wms' | 'projects' | 'pulse'): boolean {
  return product !== 'pulse' || PULSE_IS_LIVE;
}

/** Marketing-site routes. Every internal link goes through here so navigation stays consistent. */
export const ROUTES = {
  home: '/',
  platform: '/#flow',
  products: '/products',
  wms: '/wms',
  crm: '/crm',
  projects: '/projects',
  pulse: '/pulse',
  pricing: '/products#pricing',
  bundle: '/products#bundle',
  getStarted: '/get-started',
  contact: '/contact',
  founder: '/contact?topic=founder',
  demo: '/contact?topic=demo',
} as const;

/** The licensable apps, in the order the stack is drawn (matches @kitstak/entitlements `MODULES`). */
export const PRODUCT_IDS = ['crm', 'wms', 'projects', 'pulse'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

/** A chosen set of products, always in `PRODUCT_IDS` order with no repeats. Empty means none yet. */
export type Stack = readonly ProductId[];

export const FULL_STACK: Stack = PRODUCT_IDS;

export function isProductId(value: string): value is ProductId {
  return (PRODUCT_IDS as readonly string[]).includes(value);
}

/** Puts any list of product ids into canonical stack form. */
export function toStack(products: readonly string[]): Stack {
  return PRODUCT_IDS.filter((id) => products.includes(id));
}

/** The stack with `product` switched on or off. */
export function toggleProduct(stack: Stack, product: ProductId): Stack {
  return stack.includes(product) ? stack.filter((id) => id !== product) : toStack([...stack, product]);
}

/**
 * Reads `?stack=`: a comma list (`crm,projects`) or one of the older values (`crm`, `wms`, `both`).
 * Unknown parts are dropped; nothing valid gives an empty stack.
 */
export function parseStack(value: string | null | undefined): Stack {
  if (!value) return [];
  if (value === 'both') return ['crm', 'wms'];
  return toStack(value.split(','));
}

export function stackParam(stack: Stack): string {
  return stack.join(',');
}

/** How each product reads after "Start with": "Start with the CRM", "Start with Pulse". */
export const START_NAME: Readonly<Record<ProductId, string>> = {
  crm: 'the CRM',
  wms: 'the WMS',
  projects: 'Projects',
  pulse: 'Pulse',
};

/** Deep link into the setup wizard with products already chosen. */
export function getStartedHref(stack?: Stack | ProductId): string {
  const products = typeof stack === 'string' ? [stack] : (stack ?? []);
  return products.length > 0
    ? `${ROUTES.getStarted}?stack=${stackParam(toStack(products))}`
    : ROUTES.getStarted;
}

/**
 * PLACEHOLDER contact details. Nothing on the site sends mail yet; replace these before the
 * contact form and founder booking are wired up.
 */
export const CONTACT = {
  email: 'hello@kitstak.com',
  founderName: 'the founder',
} as const;
