import Link from 'next/link';
import { Logo } from './logo';
import { PRODUCT_NAV } from './nav/nav-data';
import { LINKS, ROUTES, getStartedHref } from './site-links';
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
      { href: ROUTES.products, label: 'Compare products' },
      { href: ROUTES.bundle, label: 'Bundle and save' },
      { href: ROUTES.pricing, label: 'Pricing' },
    ],
  },
  {
    title: 'Get started',
    links: [
      { href: ROUTES.getStarted, label: 'Set up your Stak' },
      { href: getStartedHref('wms'), label: 'Start with the WMS' },
      { href: getStartedHref('crm'), label: 'Start with the CRM' },
      { href: getStartedHref('projects'), label: 'Start with Projects' },
      { href: getStartedHref('pulse'), label: 'Start with Pulse' },
      { href: ROUTES.demo, label: 'Book a walkthrough' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: ROUTES.platform, label: 'Platform' },
      { href: ROUTES.founder, label: 'Talk to the founder' },
      { href: ROUTES.contact, label: 'Contact' },
    ],
  },
  {
    title: 'Sign in',
    links: [
      { href: LINKS.portal, label: 'Portal', external: true },
      { href: LINKS.wms, label: 'KitStak WMS', external: true },
      { href: LINKS.crm, label: 'KitStak CRM', external: true },
      { href: LINKS.projects, label: 'KitStak Projects', external: true },
      { href: LINKS.pulse, label: 'KitStak Pulse', external: true },
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
          <Link href={ROUTES.getStarted} className={`btn btn-primary ${styles.cta}`}>
            Set up your Stak <span className="btn-arrow" aria-hidden>→</span>
          </Link>
        </div>
        <nav aria-label="Footer" className={styles.cols}>
          {COLUMNS.map((col) => (
          <div key={col.title} className={styles.col}>
            <h3 className={styles.colTitle}>{col.title}</h3>
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
