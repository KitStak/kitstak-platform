'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { LINKS, ROUTES } from '../site-links';
import { AppIcon } from '../app-icon';
import { StakMark } from '../stak-mark';
import { PRIMARY_NAV, PRODUCT_NAV, isCurrentPath } from './nav-data';
import styles from './mobile-menu.module.css';

const DESKTOP_QUERY = '(min-width: 901px)';

interface MobileMenuProps {
  readonly id: string;
  readonly isOpen: boolean;
  readonly pathname: string;
  readonly onClose: () => void;
}

/** Full-screen navigation for small screens. Locks page scroll and takes the page out of the tab order. */
export function MobileMenu({ id, isOpen, pathname, onClose }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const background = Array.from(document.querySelectorAll<HTMLElement>('main, footer'));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    background.forEach((el) => el.setAttribute('inert', ''));
    panelRef.current?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // The drawer only exists on small screens; close it if the window grows past them.
    const wide = window.matchMedia(DESKTOP_QUERY);
    const onWiden = () => {
      if (wide.matches) onClose();
    };
    const panel = panelRef.current;
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWiden);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((el) => el.removeAttribute('inert'));
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWiden);
      // Hand focus back to the button that opened the drawer, unless a link took it elsewhere.
      if (panel?.contains(document.activeElement) || document.activeElement === document.body) {
        document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus({ preventScroll: true });
      }
    };
  }, [isOpen, onClose, id]);

  return (
    <div id={id} ref={panelRef} className={styles.panel} data-open={isOpen || undefined} inert={!isOpen}>
      <nav aria-label="Menu" className={`container ${styles.inner}`}>
        <p className={styles.heading}>Products</p>
        <ul className={styles.products}>
          {PRODUCT_NAV.map((product, i) => (
            <li key={product.id} style={{ '--i': i } as React.CSSProperties}>
              <Link
                href={product.href}
                className={styles.product}
                aria-current={isCurrentPath(pathname, product.href) ? 'page' : undefined}
                onClick={onClose}
              >
                <AppIcon app={product.id} size={40} />
                <span>
                  <span className={styles.productName}>
                    {product.name}
                    {product.status ? <span className={styles.status}>{product.status}</span> : null}
                  </span>
                  <span className={styles.blurb}>{product.blurb}</span>
                </span>
              </Link>
            </li>
          ))}
          <li style={{ '--i': PRODUCT_NAV.length } as React.CSSProperties}>
            <Link
              href={ROUTES.products}
              className={styles.product}
              aria-current={pathname === ROUTES.products ? 'page' : undefined}
              onClick={onClose}
            >
              <StakMark lit="both" size={40} />
              <span>
                <span className={styles.productName}>The whole stack</span>
                <span className={styles.blurb}>Compare the products and see what you save.</span>
              </span>
            </Link>
          </li>
        </ul>

        <ul className={styles.links}>
          {PRIMARY_NAV.map((item, i) => (
            <li key={item.href} style={{ '--i': i + PRODUCT_NAV.length + 1 } as React.CSSProperties}>
              <Link
                href={item.href}
                aria-current={isCurrentPath(pathname, item.href) ? 'page' : undefined}
                onClick={onClose}
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li style={{ '--i': PRIMARY_NAV.length + PRODUCT_NAV.length + 1 } as React.CSSProperties}>
            <Link href={ROUTES.founder} onClick={onClose}>
              Talk to the founder
            </Link>
          </li>
        </ul>

        <div className={styles.actions}>
          <Link href={ROUTES.getStarted} className="btn btn-primary" onClick={onClose}>
            Set up your Stak{' '}
            <span className="btn-arrow" aria-hidden>
              →
            </span>
          </Link>
          <a href={LINKS.portal} className="btn btn-ghost">
            Sign in
          </a>
        </div>
      </nav>
    </div>
  );
}
