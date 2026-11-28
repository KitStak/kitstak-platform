import Link from 'next/link';
import { FULL_STACK, ROUTES, getStartedHref, isAppLive } from '../site-links';
import { AppIcon } from '../app-icon';
import { StakMark } from '../stak-mark';
import { PLANNED_NAV, PRODUCT_NAV, isCurrentPath } from './nav-data';
import styles from './products-menu.module.css';

interface ProductsMenuProps {
  readonly id: string;
  readonly isOpen: boolean;
  readonly pathname: string;
  readonly onNavigate: () => void;
}

/** Full-width panel under the header: every product, its deep links, and the bundle. */
export function ProductsMenu({ id, isOpen, pathname, onNavigate }: ProductsMenuProps) {
  return (
    <div id={id} className={styles.panel} data-open={isOpen || undefined} inert={!isOpen}>
      {/* One column per live app: four today, up to six when Crew and Ledger go live. */}
      <div className={`container ${styles.grid}`} style={{ '--menu-cols': PRODUCT_NAV.length } as React.CSSProperties}>
        {PRODUCT_NAV.map((product) => (
          <section key={product.id} className={styles.product} aria-label={product.name}>
            <Link
              href={product.href}
              className={styles.productHead}
              aria-current={isCurrentPath(pathname, product.href) ? 'page' : undefined}
              onClick={onNavigate}
            >
              <AppIcon app={product.id} size={44} />
              <span>
                <span className={styles.productName}>
                  {product.name}{' '}
                  <span className={styles.arrow} aria-hidden>
                    →
                  </span>
                  {product.status ? <span className={styles.status}>{product.status}</span> : null}
                </span>
                <span className={styles.blurb}>{product.blurb}</span>
              </span>
            </Link>
            <ul className={styles.links}>
              {product.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} onClick={onNavigate}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* The apps coming soon: one slim row under the live ones. Gone once both are live. */}
        {PLANNED_NAV.length > 0 ? (
        <section className={styles.planned} aria-label="Coming soon">
          <p className={styles.plannedLabel}>Coming soon</p>
          {PLANNED_NAV.map((product) => (
            <Link
              key={product.id}
              href={product.href}
              className={styles.plannedItem}
              aria-current={isCurrentPath(pathname, product.href) ? 'page' : undefined}
              onClick={onNavigate}
            >
              <AppIcon app={product.id} size={32} />
              <span>
                <span className={styles.plannedName}>{product.name}</span>
                <span className={styles.plannedBlurb}>{product.blurb}</span>
              </span>
            </Link>
          ))}
        </section>
        ) : null}

        <aside className={styles.bundle} aria-label="Bundle">
          <StakMark lit="both" size={36} />
          <p className={styles.bundleTitle}>Run more. Pay less.</p>
          <p className={styles.bundleBody}>
            The CRM, the WMS, Projects and Pulse run on one sign-in. Pulse links its clients to the customers
            the other apps already know. License two or more and save.
            {isAppLive('pulse') ? null : ' Pulse is coming soon, so the button sets up the other three.'}
          </p>
          <Link
            href={getStartedHref(FULL_STACK)}
            className={`btn btn-primary ${styles.bundleCta}`}
            onClick={onNavigate}
          >
            Build the bundle{' '}
            <span className="btn-arrow" aria-hidden>
              →
            </span>
          </Link>
          <Link href={ROUTES.products} className={styles.all} onClick={onNavigate}>
            Compare all products
          </Link>
        </aside>
      </div>
    </div>
  );
}
