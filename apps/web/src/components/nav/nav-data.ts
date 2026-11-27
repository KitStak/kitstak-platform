import { ROUTES, availabilityLabel } from '../site-links';

export interface NavLink {
  readonly href: string;
  readonly label: string;
  readonly note?: string;
}

export interface ProductNav {
  readonly id: 'wms' | 'crm' | 'projects' | 'pulse' | 'crew' | 'ledger';
  readonly href: string;
  readonly name: string;
  readonly tag: string;
  readonly blurb: string;
  /** "Coming soon" while the product's app is not open yet. Null once it is. */
  readonly status: string | null;
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
    status: availabilityLabel('wms'),
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
    status: availabilityLabel('crm'),
    links: [
      { href: `${ROUTES.crm}#boards`, label: 'Boards and views' },
      { href: `${ROUTES.crm}#automations`, label: 'Automations' },
      { href: `${ROUTES.crm}#dashboards`, label: 'Dashboards' },
      { href: `${ROUTES.crm}#work`, label: 'Inbox and My Work' },
    ],
  },
  {
    id: 'projects',
    href: ROUTES.projects,
    name: 'KitStak Projects',
    tag: 'Projects',
    blurb: 'Plans, tasks and timelines tied to the deals and orders they are for.',
    status: availabilityLabel('projects'),
    links: [
      { href: `${ROUTES.projects}#tasks`, label: 'Tasks and quick add' },
      { href: `${ROUTES.projects}#views`, label: 'Board, timeline and workload' },
      { href: `${ROUTES.projects}#automations`, label: 'Automations' },
      { href: `${ROUTES.projects}#stack`, label: 'Linked to CRM and WMS' },
    ],
  },
  {
    id: 'pulse',
    href: ROUTES.pulse,
    name: 'KitStak Pulse',
    tag: 'Pulse',
    blurb: 'Profit by job, client and extra service, so you know which jobs make money.',
    status: availabilityLabel('pulse'),
    links: [
      { href: `${ROUTES.pulse}#profit`, label: 'Profit by job and client' },
      { href: `${ROUTES.pulse}#log`, label: 'Log work' },
      { href: `${ROUTES.pulse}#plan`, label: 'Quote vs actual' },
      { href: `${ROUTES.pulse}#risk`, label: 'Jobs at risk' },
    ],
  },
];

/**
 * Apps that are announced but not open yet (Crew, Ledger). They get their own "Coming soon" row in
 * the Products menu and sit after the live apps in the drawer and the footer. No deep links: the
 * pages are short and the visitor should land on the top.
 */
export const PLANNED_NAV: readonly ProductNav[] = [
  {
    id: 'crew',
    href: ROUTES.crew,
    name: 'KitStak Crew',
    tag: 'Crew',
    blurb: 'Shifts, a time clock and the labor plan for the floor.',
    status: availabilityLabel('crew'),
    links: [],
  },
  {
    id: 'ledger',
    href: ROUTES.ledger,
    name: 'KitStak Ledger',
    tag: 'Ledger',
    blurb: 'Invoices, collections, bills and one month-end close.',
    status: availabilityLabel('ledger'),
    links: [],
  },
];

/** Top-level header links (the Products menu is rendered separately, before these). */
export const PRIMARY_NAV: readonly NavLink[] = [
  { href: ROUTES.platform, label: 'Platform' },
  { href: ROUTES.customers, label: 'Customers' },
  { href: ROUTES.docs, label: 'Docs' },
  { href: ROUTES.articles, label: 'Articles' },
  { href: ROUTES.pricing, label: 'Pricing' },
  { href: ROUTES.contact, label: 'Contact' },
];

/** Routes that light up the Products menu trigger. */
export const PRODUCT_PATHS: readonly string[] = [
  ROUTES.products,
  ROUTES.wms,
  ROUTES.crm,
  ROUTES.projects,
  ROUTES.pulse,
  ROUTES.crew,
  ROUTES.ledger,
];

/** True when `href` is the page at `pathname`. Links to a section (`#...`) are never "the page". */
export function isCurrentPath(pathname: string, href: string): boolean {
  if (href.includes('#')) return false;
  const path = href.split('?')[0] ?? '';
  if (path === '' || path === '/') return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}
