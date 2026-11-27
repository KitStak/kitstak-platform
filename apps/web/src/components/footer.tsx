import Link from 'next/link';
import { Logo } from './logo';
import { PLANNED_NAV, PRODUCT_NAV } from './nav/nav-data';
import { HELP_LABEL, LINKS, PULSE_IS_LIVE, ROUTES, START_LABEL, startFreeHref } from './site-links';
import styles from './footer.module.css';

interface FooterLink {
  readonly href: string;
  readonly label: string;
  readonly external?: boolean;
}

const COLUMNS: readonly { readonly title: string; readonly links: readonly FooterLink[] }[] = [
  {
    title: 'Products',
    links: [
      ...PRODUCT_NAV.map((p) => ({ href: p.href, label: p.name })),
      ...PLANNED_NAV.map((p) => ({ href: p.href, label: `${p.name} (${p.status ?? 'Coming soon'})` })),
      { href: ROUTES.products, label: 'Compare products' },
      { href: ROUTES.bundle, label: 'Bundle and save' },
      { href: ROUTES.pricing, label: 'Pricing' },
    ],
  },
  {
    title: 'Get started',
    links: [
      { href: startFreeHref(), label: START_LABEL, external: true },
      { href: ROUTES.getStarted, label: HELP_LABEL },
      { href: startFreeHref('wms', 'product'), label: 'Start with the WMS', external: true },
      { href: startFreeHref('crm', 'product'), label: 'Start with the CRM', external: true },
      { href: startFreeHref('projects', 'product'), label: 'Start with Projects', external: true },
      ...(PULSE_IS_LIVE ? [{ href: startFreeHref('pulse', 'product'), label: 'Start with Pulse', external: true }] : []),
      { href: ROUTES.demo, label: 'Book a walkthrough' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: ROUTES.platform, label: 'Platform' },
      { href: ROUTES.team1, label: 'Customer story: Team 1' },
      { href: ROUTES.docs, label: 'Docs' },
      { href: ROUTES.articles, label: 'Articles' },
      { href: ROUTES.founder, label: 'Talk to the founder' },
      { href: ROUTES.contact, label: 'Contact' },
      { href: ROUTES.security, label: 'Security' },
      { href: ROUTES.terms, label: 'Terms' },
      { href: ROUTES.privacy, label: 'Privacy' },
    ],
  },
  {
    title: 'Sign in',
    links: [
      { href: LINKS.portal, label: 'Portal', external: true },
      { href: LINKS.wms, label: 'KitStak WMS', external: true },
      { href: LINKS.crm, label: 'KitStak CRM', external: true },
      { href: LINKS.projects, label: 'KitStak Projects', external: true },
      ...(PULSE_IS_LIVE ? [{ href: LINKS.pulse, label: 'KitStak Pulse', external: true }] : []),
    ],
  },
];

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.brand}>
          <Link href={ROUTES.home} aria-label="KitStak home">
            <Logo height={22} />
          </Link>
          <p className={styles.tag}>CRM, WMS, Projects and Pulse on one stack.</p>
          <a href={startFreeHref()} className={`btn btn-primary ${styles.cta}`}>
            {START_LABEL} <span className="btn-arrow" aria-hidden>→</span>
          </a>
        </div>
        <nav aria-label="Footer" className={styles.cols}>
          {COLUMNS.map((col) => (
          <div key={col.title} className={styles.col}>
            <h2 className={styles.colTitle}>{col.title}</h2>
            <ul>
              {col.links.map((link) => (
                <li key={link.label}>
                  {link.external ? <a href={link.href}>{link.label}</a> : <Link href={link.href}>{link.label}</Link>}
                </li>
              ))}
            </ul>
          </div>
          ))}
        </nav>
      </div>
      <div className={`container ${styles.base}`}>
        <span>© {new Date().getFullYear()} KitStak</span>
        <span>Sell it. Stock it. Ship it.</span>
      </div>
    </footer>
  );
}
