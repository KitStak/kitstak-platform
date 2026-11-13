import { Logo } from './logo';
import { LINKS } from './site-links';
import styles from './footer.module.css';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '#wms', label: 'Warehouse' },
      { href: '#crm', label: 'CRM' },
      { href: '#licensing', label: 'Licensing' },
    ],
  },
  {
    title: 'Apps',
    links: [
      { href: LINKS.portal, label: 'Portal' },
      { href: LINKS.wms, label: 'KitStak WMS' },
      { href: LINKS.crm, label: 'KitStak CRM' },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.brand}>
          <Logo height={22} />
          <p className={styles.tag}>CRM and WMS on one stack.</p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title} className={styles.col}>
            <h3 className={styles.colTitle}>{col.title}</h3>
            <ul>
              {col.links.map((link) => (
                <li key={link.label}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className={`container ${styles.base}`}>
        <span>© {new Date().getFullYear()} KitStak</span>
      </div>
    </footer>
  );
}
