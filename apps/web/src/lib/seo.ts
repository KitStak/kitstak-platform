/**
 * Search and structured data for kitstak.com. One place for the site address and the schema.org
 * objects Google reads (Organization, WebSite, SoftwareApplication, Article, BreadcrumbList,
 * FAQPage). Every price comes from the shared catalog through `@/lib/pricing`.
 *
 * Validate a page with https://search.google.com/test/rich-results after a change.
 */
import type { PlannedProductId, ProductId } from '@/lib/pricing';
import { CATALOG, TRIAL_DAYS, priceOf } from '@/lib/pricing';
import { CONTACT } from '@/components/site-links';

/** The one public address of the marketing site. No trailing slash. */
export const SITE_URL = 'https://kitstak.com';

export const SITE_NAME = 'KitStak';

/** An absolute URL on the site for a path like `/articles`. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path === '/' ? '' : path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * JSON for a `<script type="application/ld+json">` tag. `<` is escaped so no string in the data
 * can close the tag (the Next.js JSON-LD guide).
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

type Thing = Record<string, unknown>;

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

export function organizationLd(): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl('/brand/kitstak-icon-512.png'),
    email: CONTACT.email,
    slogan: 'Sell it. Stock it. Ship it.',
    description:
      'KitStak is one platform for a CRM, a WMS, Projects and Pulse, on one database and one sign-in.',
    contactPoint: [
      { '@type': 'ContactPoint', contactType: 'sales', email: CONTACT.email, url: absoluteUrl('/contact') },
      {
        '@type': 'ContactPoint',
        contactType: 'security',
        email: CONTACT.email,
        url: absoluteUrl('/security'),
      },
    ],
  };
}

export function websiteLd(): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': SITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: 'en-US',
    publisher: { '@id': ORG_ID },
  };
}

interface AppFacts {
  readonly name: string;
  readonly path: string;
  readonly category: string;
  readonly description: string;
}

/** What each app is, for search. The words match the product pages. */
const APP_FACTS: Readonly<Record<ProductId, AppFacts>> = {
  crm: {
    name: 'KitStak CRM',
    path: '/crm',
    category: 'BusinessApplication',
    description:
      'Accounts, pipelines, boards, automations and dashboards your team shapes, on the same stack as your warehouse.',
  },
  wms: {
    name: 'KitStak WMS',
    path: '/wms',
    category: 'BusinessApplication',
    description:
      'Warehouse management from the dock to the door: receiving, locations, counts, pick, pack, ship, returns and 3PL client billing.',
  },
  projects: {
    name: 'KitStak Projects',
    path: '/projects',
    category: 'BusinessApplication',
    description: 'Plans, tasks and timelines tied to the CRM deals and WMS orders they are for.',
  },
  pulse: {
    name: 'KitStak Pulse',
    path: '/pulse',
    category: 'BusinessApplication',
    description: 'Profit by job, client and extra service, so you know which jobs make money.',
  },
};

/** One app as a SoftwareApplication with its monthly list price as the offer. */
export function softwareApplicationLd(product: ProductId): Thing {
  const facts = APP_FACTS[product];
  const pricing = priceOf(product);
  const unit =
    pricing.quantityFrom === 'seats'
      ? 'Per user'
      : pricing.quantityFrom === 'warehouses'
        ? 'Per warehouse'
        : 'Per organization';
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: facts.name,
    url: absoluteUrl(facts.path),
    applicationCategory: facts.category,
    operatingSystem: 'Web browser',
    description: facts.description,
    publisher: { '@id': ORG_ID },
    offers: {
      '@type': 'Offer',
      price: (pricing.cents.monthly / 100).toFixed(2),
      priceCurrency: CATALOG.currency.toUpperCase(),
      url: absoluteUrl('/pricing'),
      description: `${unit} each month. ${TRIAL_DAYS} days free, no card needed.`,
      availability: 'https://schema.org/InStock',
    },
  };
}

/** What each planned app will be. The words match the Crew and Ledger pages. */
const PLANNED_FACTS: Readonly<Record<PlannedProductId, AppFacts>> = {
  crew: {
    name: 'KitStak Crew',
    path: '/crew',
    category: 'BusinessApplication',
    description:
      'People, shifts, a time clock, attendance, skills and labor planning for kitting, 3PL and contract packaging floors. Coming soon.',
  },
  ledger: {
    name: 'KitStak Ledger',
    path: '/ledger',
    category: 'BusinessApplication',
    description:
      'Invoices, collections, vendor bills, expenses, bank reconciliation and month-end close for kitting, 3PL and contract packaging shops. Coming soon.',
  },
};

/** A planned app as a SoftwareApplication. No offer: nobody can buy it yet, and the data says only what the page says. */
export function plannedApplicationLd(product: PlannedProductId): Thing {
  const facts = PLANNED_FACTS[product];
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: facts.name,
    url: absoluteUrl(facts.path),
    applicationCategory: facts.category,
    operatingSystem: 'Web browser',
    description: facts.description,
    publisher: { '@id': ORG_ID },
  };
}

export interface Crumb {
  readonly name: string;
  readonly path: string;
}

export function breadcrumbLd(crumbs: readonly Crumb[]): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...crumbs].map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

export function faqLd(items: readonly FaqEntry[]): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export interface ArticleFacts {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  /** ISO date, "2026-11-25". */
  readonly published: string;
  readonly updated: string;
  readonly section: string;
  readonly wordCount: number;
}

export function articleLd(article: ArticleFacts): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    url: absoluteUrl(article.path),
    mainEntityOfPage: absoluteUrl(article.path),
    image: absoluteUrl(`${article.path}/opengraph-image`),
    datePublished: article.published,
    dateModified: article.updated,
    articleSection: article.section,
    wordCount: article.wordCount,
    inLanguage: 'en-US',
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@id': ORG_ID },
  };
}

export interface DocFacts {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly section: string;
  readonly app: string;
  readonly updated: string;
  readonly wordCount: number;
}

/** One docs page as a TechArticle, the type Google expects for product documentation. */
export function techArticleLd(doc: DocFacts): Thing {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: doc.title,
    description: doc.description,
    url: absoluteUrl(doc.path),
    mainEntityOfPage: absoluteUrl(doc.path),
    dateModified: doc.updated,
    datePublished: doc.updated,
    articleSection: doc.section,
    about: { '@type': 'SoftwareApplication', name: doc.app },
    wordCount: doc.wordCount,
    inLanguage: 'en-US',
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@id': ORG_ID },
  };
}
