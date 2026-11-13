import Link from 'next/link';
import { ROUTES, getStartedHref } from '../site-links';
import { AppIcon } from '../app-icon';
import { StakMark } from '../stak-mark';
import { PREVIEW_PRODUCT, PRODUCT_NAV, isCurrentPath } from './nav-data';
import styles from './products-menu.module.css';

interface ProductsMenuProps {
  readonly id: string;
  readonly isOpen: boolean;
  readonly pathname: string;
  readonly onNavigate: () => void;
}

/** Full-width panel under the header: both products, their deep links, and the bundle. */
export function ProductsMenu({ id, isOpen, pathname, onNavigate }: ProductsMenuProps) {
  return (
    <div id={id} className={styles.panel} data-open={isOpen || undefined} inert={!isOpen}>
      <div className={`container ${styles.grid}`}>
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
                  {product.name} <span className={styles.arrow} aria-hidden>→</span>
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

        <aside className={styles.bundle} aria-label="Bundle">
          <StakMark lit="both" size={36} />
          <p className={styles.bundleTitle}>Run both. Pay less.</p>
          <p className={styles.bundleBody}>
            The CRM and the WMS share customers, items and one sign-in. License them together and save.
          </p>
          <Link href={getStartedHref('both')} className={`btn btn-primary ${styles.bundleCta}`} onClick={onNavigate}>
            Build the bundle <span className="btn-arrow" aria-hidden>→</span>
          </Link>
          <Link href={ROUTES.products} className={styles.all} onClick={onNavigate}>
            Compare all products
          </Link>
        </aside>

        <Link
          href={PREVIEW_PRODUCT.href}
          className={styles.preview}
          aria-current={isCurrentPath(pathname, PREVIEW_PRODUCT.href) ? 'page' : undefined}
          onClick={onNavigate}
        >
          <AppIcon app="projects" size={34} />
          <span className={styles.previewName}>{PREVIEW_PRODUCT.name}</span>
          <span className={styles.previewBadge}>{PREVIEW_PRODUCT.badge}</span>
          <span className={styles.previewBlurb}>{PREVIEW_PRODUCT.blurb}</span>
          <span className={styles.previewGo}>
            See what is coming <span aria-hidden>→</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
