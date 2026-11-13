import { ROUTES } from '../site-links';

export interface NavLink {
  readonly href: string;
  readonly label: string;
  readonly note?: string;
}

export interface ProductNav {
  readonly id: 'wms' | 'crm';
  readonly href: string;
  readonly name: string;
  readonly tag: string;
  readonly blurb: string;
  readonly links: readonly NavLink[];
}

/** Products shown in the header menu, the mobile drawer and the footer. */
export const PRODUCT_NAV: readonly ProductNav[] = [
  {
    id: 'wms',
    href: ROUTES.wms,
    name: 'KitStak WMS',
    tag: 'WMS',
    blurb: 'Receiving, inventory and shipping, from the dock to the door.',
    links: [
      { href: `${ROUTES.wms}#inbound`, label: 'Receiving and putaway' },
      { href: `${ROUTES.wms}#inventory`, label: 'Locations and counts' },
      { href: `${ROUTES.wms}#outbound`, label: 'Pick, pack and ship' },
      { href: `${ROUTES.wms}#clients`, label: 'Clients and billing' },
    ],
  },
  {
    id: 'crm',
    href: ROUTES.crm,
    name: 'KitStak CRM',
    tag: 'CRM',
    blurb: 'Accounts, pipelines and follow-ups on boards your team shapes.',
    links: [
      { href: `${ROUTES.crm}#boards`, label: 'Boards and views' },
      { href: `${ROUTES.crm}#automations`, label: 'Automations' },
      { href: `${ROUTES.crm}#dashboards`, label: 'Dashboards' },
      { href: `${ROUTES.crm}#work`, label: 'Inbox and My Work' },
    ],
  },
];

/** A product that is announced but not yet available. Listed apart from the ones you can buy. */
export const PREVIEW_PRODUCT = {
  id: 'projects',
  href: ROUTES.projects,
  name: 'KitStak Projects',
  badge: 'Preview',
  blurb: 'Plans, tasks and timelines on the same stack. In development.',
} as const;

/** Top-level header links (the Products menu is rendered separately, before these). */
export const PRIMARY_NAV: readonly NavLink[] = [
  { href: ROUTES.platform, label: 'Platform' },
  { href: ROUTES.pricing, label: 'Pricing' },
  { href: ROUTES.contact, label: 'Contact' },
];

/** Routes that light up the Products menu trigger. */
export const PRODUCT_PATHS: readonly string[] = [ROUTES.products, ROUTES.wms, ROUTES.crm, ROUTES.projects];

/** True when `href` is the page at `pathname`. Links to a section (`#...`) are never "the page". */
export function isCurrentPath(pathname: string, href: string): boolean {
  if (href.includes('#')) return false;
  const path = href.split('?')[0] ?? '';
  if (path === '' || path === '/') return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}
