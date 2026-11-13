/** Production app origins (from the platform's custom-domain configuration). */
export const LINKS = {
  portal: 'https://kitstak.app',
  crm: 'https://crm.kitstak.app',
  wms: 'https://wms.kitstak.app',
} as const;

/** Marketing-site routes. Every internal link goes through here so navigation stays consistent. */
export const ROUTES = {
  home: '/',
  platform: '/#flow',
  products: '/products',
  wms: '/wms',
  crm: '/crm',
  projects: '/projects',
  pricing: '/products#pricing',
  bundle: '/products#bundle',
  getStarted: '/get-started',
  contact: '/contact',
  founder: '/contact?topic=founder',
  demo: '/contact?topic=demo',
  projectsAccess: '/contact?topic=projects',
} as const;

export type StackChoice = 'crm' | 'wms' | 'both';

/** Deep link into the setup wizard with a product already chosen. */
export function getStartedHref(stack?: StackChoice): string {
  return stack ? `${ROUTES.getStarted}?stack=${stack}` : ROUTES.getStarted;
}

/**
 * PLACEHOLDER contact details. Nothing on the site sends mail yet; replace these before the
 * contact form and founder booking are wired up.
 */
export const CONTACT = {
  email: 'hello@kitstak.com',
  founderName: 'the founder',
} as const;
