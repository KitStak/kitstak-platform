import {
  PLANNED_PRODUCT_IDS,
  PRODUCT_IDS,
  isPlannedProductId,
  isProductId,
  parseStack,
  stackParam,
  toStack,
  toggleProduct,
} from '@kitstak/billing/catalog';
import { normalizeSelection } from '@kitstak/billing/catalog';
import type { PlannedProductId, ProductId, Stack } from '@kitstak/billing/catalog';
import { signupUrl } from '@kitstak/billing/handoff';
import type { HandoffSource } from '@kitstak/billing/handoff';

export interface AppOrigins {
  readonly portal: string;
  readonly crm: string;
  readonly wms: string;
  readonly projects: string;
  readonly pulse: string;
}

/** Production app origins (from the platform's custom-domain configuration, docs/DEPLOYMENT.md). */
export const PRODUCTION_ORIGINS: AppOrigins = {
  portal: 'https://kitstak.app',
  crm: 'https://crm.kitstak.app',
  wms: 'https://wms.kitstak.app',
  projects: 'https://projects.kitstak.app',
  pulse: 'https://pulse.kitstak.app',
};

/** The local dev ports from docs/billing/DEV.md. Used only by `next dev`, and only when no variable is set. */
export const LOCAL_DEV_ORIGINS: AppOrigins = {
  portal: 'http://localhost:3300',
  crm: 'http://localhost:3100',
  wms: 'http://localhost:3000',
  projects: 'http://localhost:3400',
  pulse: 'http://localhost:3500',
};

/** An origin from an env value: trimmed, no trailing slash. Blank or not a web address gives null. */
function cleanOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  return /^https?:\/\/[^\s/]+/.test(trimmed) ? trimmed : null;
}

/** The `NEXT_PUBLIC_*_URL` values, one per app. Any of them may be missing or blank. */
export type OriginEnv = Partial<Record<keyof AppOrigins, string | undefined>>;

/**
 * Where each app lives. A `NEXT_PUBLIC_*_URL` variable wins. An app with no variable, or a blank or
 * broken one, gets its origin from `fallback`, so a link is never empty.
 */
export function resolveAppOrigins(env: OriginEnv, fallback: AppOrigins = PRODUCTION_ORIGINS): AppOrigins {
  return {
    portal: cleanOrigin(env.portal) ?? fallback.portal,
    crm: cleanOrigin(env.crm) ?? fallback.crm,
    wms: cleanOrigin(env.wms) ?? fallback.wms,
    projects: cleanOrigin(env.projects) ?? fallback.projects,
    pulse: cleanOrigin(env.pulse) ?? fallback.pulse,
  };
}

/**
 * The app origins every link on the site uses. With no variable set, a production build points at
 * the real domains and `next dev` points at the local dev ports, so a wizard run on a local site
 * lands on the local portal's sign-up with no setup. Each variable is named in full, so Next can put
 * its value into the browser bundle.
 */
export const LINKS: AppOrigins = resolveAppOrigins(
  {
    portal: process.env.NEXT_PUBLIC_PORTAL_URL,
    crm: process.env.NEXT_PUBLIC_CRM_URL,
    wms: process.env.NEXT_PUBLIC_WMS_URL,
    projects: process.env.NEXT_PUBLIC_PROJECTS_URL,
    pulse: process.env.NEXT_PUBLIC_PULSE_URL,
  },
  process.env.NODE_ENV === 'development' ? LOCAL_DEV_ORIGINS : PRODUCTION_ORIGINS,
);

/**
 * Whether customers can open the Pulse app. It is open: Pulse is live at pulse.kitstak.app and is
 * sold through the same sign-up as the other three apps (docs/billing/DECISIONS.md), so it gets
 * "Start with Pulse", the wizard row and the sign in link like the other apps. This stays the one
 * switch for a product whose app is closed. Set to false, every start link leaves Pulse out, its
 * buttons book a walkthrough, and the site labels Pulse "Coming soon".
 */
export const PULSE_IS_LIVE: boolean = true;

/**
 * Every app the site has a page for: the four you can buy, then Crew and Ledger, which are announced
 * with a price but have no app yet (docs/crew/REFERENCE.md, docs/ledger/REFERENCE.md). A planned app
 * never rides along in a start, sign-up or calculator link: those take `ProductId` only.
 */
export type SiteProductId = ProductId | PlannedProductId;
export { PLANNED_PRODUCT_IDS, isPlannedProductId };
export type { PlannedProductId };
export const SITE_PRODUCT_IDS: readonly SiteProductId[] = [...PRODUCT_IDS, ...PLANNED_PRODUCT_IDS];

/** False for a product whose app customers cannot open yet. Such a product gets no start button. */
export function isAppLive(product: SiteProductId): boolean {
  if (isPlannedProductId(product)) return false;
  return product !== 'pulse' || PULSE_IS_LIVE;
}

/** The one wording for a product that is not available yet. */
export const COMING_SOON = 'Coming soon';

/** "Coming soon" for a product whose app is not open yet, otherwise null. */
export function availabilityLabel(product: SiteProductId): string | null {
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
  crew: '/crew',
  ledger: '/ledger',
  pricing: '/pricing',
  /** The Crew and Ledger cards on the pricing page. */
  pricingPlanned: '/pricing#coming-soon',
  /** The price calculator on the pricing page. */
  calculator: '/pricing#calculator',
  bundle: '/products#bundle',
  getStarted: '/get-started',
  contact: '/contact',
  terms: '/terms',
  privacy: '/privacy',
  security: '/security',
  articles: '/articles',
  docs: '/docs',
  customers: '/customers',
  /** The Team 1 customer story. */
  team1: '/customers/team-1',
  founder: '/contact?topic=founder',
  demo: '/contact?topic=demo',
  notify: '/contact?topic=notify',
} as const;

/** The page for each app the site sells or announces. */
export const PRODUCT_ROUTE: Readonly<Record<SiteProductId, string>> = {
  crm: ROUTES.crm,
  wms: ROUTES.wms,
  projects: ROUTES.projects,
  pulse: ROUTES.pulse,
  crew: ROUTES.crew,
  ledger: ROUTES.ledger,
};

/** The label on every button for an app that is announced but not open yet. */
export const NOTIFY_LABEL = "Tell me when it's ready";

/** The contact form, set to "Tell me when it's ready" and naming the planned app. */
export function notifyHref(product: PlannedProductId): string {
  return `${ROUTES.notify}&product=${product}`;
}

/**
 * The licensable apps and the stack helpers. They come from the shared catalog (`@kitstak/billing`),
 * so the site, sign-up and billing always agree on which apps exist and in what order.
 */
export { PRODUCT_IDS, isProductId, parseStack, stackParam, toStack, toggleProduct };
export type { ProductId, Stack };

export const FULL_STACK: Stack = PRODUCT_IDS;

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
 * The walkthrough form. A link from exactly one product names it (`&product=pulse`), so the form can
 * start the message for the visitor. Any other link is the plain walkthrough form.
 */
export function walkthroughHref(stack?: Stack | ProductId): string {
  const products = toStack(typeof stack === 'string' ? [stack] : (stack ?? []));
  return products.length === 1 ? `${ROUTES.demo}&product=${products[0]}` : ROUTES.demo;
}

/**
 * Deep link into the setup wizard with products already chosen. A product whose app is not open yet
 * never rides along. If none of the chosen products is open, the link goes to the walkthrough form.
 */
export function getStartedHref(stack?: Stack | ProductId): string {
  const products = toStack(typeof stack === 'string' ? [stack] : (stack ?? []));
  if (products.length === 0) return ROUTES.getStarted;
  const open = startableStack(products);
  return open.length > 0 ? `${ROUTES.getStarted}?stack=${stackParam(open)}` : walkthroughHref(products);
}

/**
 * The price calculator with products already switched on. A product whose app is not open yet is
 * left out, the same as every other start link.
 */
export function pricingHref(stack?: Stack | ProductId): string {
  const products = startableStack(toStack(typeof stack === 'string' ? [stack] : (stack ?? [])));
  return products.length === 0 ? ROUTES.calculator : `${ROUTES.pricing}?stack=${stackParam(products)}#calculator`;
}

/** The one label on every button that starts a free trial. The same words on every page. */
export const START_LABEL = 'Start free';

/** The label on every link to the five question wizard, for a visitor who wants help picking apps. */
export const HELP_LABEL = 'Help me choose';

/**
 * The short road: straight to portal sign-up. Four fields, then the app picker, and the trial is
 * running. With products, the picker opens with them switched on. A product whose app is not open
 * yet never rides along; if none of the named products is open, the link books a walkthrough.
 * The wizard (`ROUTES.getStarted`) is the long road and is always offered as "Help me choose".
 */
export function startFreeHref(stack?: Stack | ProductId, source: HandoffSource = 'direct'): string {
  const named = toStack(typeof stack === 'string' ? [stack] : (stack ?? []));
  const open = startableStack(named);
  if (named.length > 0 && open.length === 0) return walkthroughHref(named);
  return signupUrl(LINKS.portal, {
    selection: open.length > 0 ? normalizeSelection({ products: [...open], seats: 1, warehouses: 1, interval: 'monthly' }) : null,
    profile: {},
    source,
  });
}

export interface StartLink {
  readonly href: string;
  readonly label: string;
}

/**
 * The start button for one product: "Start with ..." when its app is open, a walkthrough when it is
 * not, and "Tell me when it's ready" for a planned app, which has nothing to walk through yet.
 */
export function startLink(product: SiteProductId): StartLink {
  if (isPlannedProductId(product)) return { href: notifyHref(product), label: NOTIFY_LABEL };
  return isAppLive(product)
    ? { href: startFreeHref(product, 'product'), label: `Start with ${START_NAME[product]}` }
    : { href: walkthroughHref(product), label: WALKTHROUGH_LABEL };
}

/**
 * PLACEHOLDER contact details. Nothing on the site sends mail yet; replace these before the
 * contact form and founder booking are wired up.
 */
export const CONTACT = {
  email: 'hello@kitstak.com',
  founderName: 'the founder',
} as const;
