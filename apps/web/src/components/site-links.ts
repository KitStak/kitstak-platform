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
 * anyone toward an account for it. While this is false, every Pulse start button becomes "Book a
 * walkthrough", start links leave Pulse out, the setup wizard will not take it, and the site labels
 * Pulse "Coming soon". Set this to true on the day pulse.kitstak.app opens. That one line brings
 * "Start with Pulse", the wizard row and the sign in link back.
 */
export const PULSE_IS_LIVE: boolean = false;

/** False for a product whose app customers cannot open yet. Such a product gets no start button. */
export function isAppLive(product: 'crm' | 'wms' | 'projects' | 'pulse'): boolean {
  return product !== 'pulse' || PULSE_IS_LIVE;
}

/** The one wording for a product that is not available yet. */
export const COMING_SOON = 'Coming soon';

/** "Coming soon" for a product whose app is not open yet, otherwise null. */
export function availabilityLabel(product: 'crm' | 'wms' | 'projects' | 'pulse'): string | null {
  return isAppLive(product) ? null : COMING_SOON;
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

/** The products in `stack` a visitor can start on today. Leaves out any whose app is not open yet. */
export function startableStack(stack: Stack): Stack {
  return stack.filter(isAppLive);
}

/** Every product a visitor can start on today. The whole stack once every app is open. */
export const STARTABLE_STACK: Stack = startableStack(PRODUCT_IDS);

/** The label on every button that books a walkthrough. */
export const WALKTHROUGH_LABEL = 'Book a walkthrough';

/**
 * Deep link into the setup wizard with products already chosen. A product whose app is not open yet
 * never rides along. If none of the chosen products is open, the link goes to the walkthrough form.
 */
export function getStartedHref(stack?: Stack | ProductId): string {
  const products = toStack(typeof stack === 'string' ? [stack] : (stack ?? []));
  if (products.length === 0) return ROUTES.getStarted;
  const open = startableStack(products);
  return open.length > 0 ? `${ROUTES.getStarted}?stack=${stackParam(open)}` : ROUTES.demo;
}

export interface StartLink {
  readonly href: string;
  readonly label: string;
}

/** The start button for one product: "Start with ..." when its app is open, a walkthrough when it is not. */
export function startLink(product: ProductId): StartLink {
  return isAppLive(product)
    ? { href: getStartedHref(product), label: `Start with ${START_NAME[product]}` }
    : { href: ROUTES.demo, label: WALKTHROUGH_LABEL };
}

/**
 * PLACEHOLDER contact details. Nothing on the site sends mail yet; replace these before the
 * contact form and founder booking are wired up.
 */
export const CONTACT = {
  email: 'hello@kitstak.com',
  founderName: 'the founder',
} as const;
