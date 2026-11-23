'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from './logo';
import { MobileMenu } from './nav/mobile-menu';
import { PRIMARY_NAV, PRODUCT_PATHS, isCurrentPath } from './nav/nav-data';
import { ProductsMenu } from './nav/products-menu';
import { LINKS, ROUTES, START_LABEL, startFreeHref } from './site-links';
import styles from './header.module.css';

const HEADER_HEIGHT = 72;
const HOVER_CLOSE_MS = 140;
const TINT_AFTER_PX = 8;

export function Header() {
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isTinted, setIsTinted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  /** True while the menu is open only because the pointer is over it (not yet clicked). */
  const isHoverOpen = useRef(false);

  // Transparent over the navy hero (#top), solid once the hero has scrolled away.
  useEffect(() => {
    const hero = document.getElementById('top');
    const onScroll = () => {
      const limit = hero ? hero.offsetHeight - HEADER_HEIGHT : 0;
      setIsScrolled(window.scrollY > Math.max(limit, 0));
      // Once the hero starts moving under the bar, give the bar the hero's own navy.
      setIsTinted(window.scrollY > TINT_AFTER_PX);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [pathname]);

  // Any navigation closes whatever is open.
  useEffect(() => {
    setIsMenuOpen(false);
    setIsDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsMenuOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isMenuOpen]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const openOnHover = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    window.clearTimeout(closeTimer.current);
    if (!isMenuOpen) isHoverOpen.current = true;
    setIsMenuOpen(true);
  };
  // A click right after hover-open pins the menu instead of closing what the pointer just opened.
  const toggleMenu = () => {
    if (isMenuOpen && isHoverOpen.current) {
      isHoverOpen.current = false;
      return;
    }
    isHoverOpen.current = false;
    setIsMenuOpen((open) => !open);
  };
  const closeOnLeave = (event: React.PointerEvent) => {
    // A menu pinned open by a click stays until it is dismissed on purpose.
    if (event.pointerType !== 'mouse' || !isHoverOpen.current) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setIsMenuOpen(false), HOVER_CLOSE_MS);
  };
  const closeOnBlur = (event: React.FocusEvent) => {
    // Switching windows blurs the trigger too; only close when focus moved elsewhere on the page.
    if (!document.hasFocus()) return;
    // Clicking empty space inside the panel blurs to nothing; that is not leaving the menu.
    if (event.relatedTarget === null && menuWrapRef.current?.matches(':hover')) return;
    if (!menuWrapRef.current?.contains(event.relatedTarget as Node | null)) setIsMenuOpen(false);
  };
  const closeAll = useCallback(() => {
    setIsMenuOpen(false);
    setIsDrawerOpen(false);
  }, []);

  const isSolid = isScrolled || isMenuOpen || isDrawerOpen;
  const isProductPage = PRODUCT_PATHS.some((path) => isCurrentPath(pathname, path));

  return (
    <header className={styles.header} data-solid={isSolid || undefined} data-tinted={(isTinted && !isSolid) || undefined}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <div className={`container ${styles.inner}`}>
        <Link href={ROUTES.home} className={styles.brand} aria-label="KitStak home" onClick={closeAll}>
          <Logo height={20} tone={isSolid ? 'auto' : 'inverse'} />
        </Link>

        <nav aria-label="Main navigation" className={styles.nav}>
          <div
            ref={menuWrapRef}
            className={styles.menuWrap}
            onPointerEnter={openOnHover}
            onPointerLeave={closeOnLeave}
            onBlur={closeOnBlur}
          >
            <button
              ref={triggerRef}
              type="button"
              className={styles.link}
              aria-expanded={isMenuOpen}
              aria-controls="products-menu"
              data-current={isProductPage || undefined}
              onClick={toggleMenu}
            >
              Products
              <svg className={styles.caret} viewBox="0 0 10 6" width="10" height="6" aria-hidden>
                <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
            <ProductsMenu id="products-menu" isOpen={isMenuOpen} pathname={pathname} onNavigate={closeAll} />
          </div>
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.link}
              aria-current={isCurrentPath(pathname, item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          <a href={LINKS.portal} className={styles.signIn}>
            Sign in
          </a>
          {/* The short road: four fields on portal sign-up. The wizard is "Help me choose" in the hero and the footer. */}
          <a href={startFreeHref()} className={`btn btn-primary ${styles.cta}`} data-testid="header-start">
            {START_LABEL}
          </a>
          <button
            type="button"
            className={styles.burger}
            aria-expanded={isDrawerOpen}
            aria-controls="mobile-menu"
            aria-label="Menu"
            onClick={() => setIsDrawerOpen((open) => !open)}
          >
            <span aria-hidden />
            <span aria-hidden />
          </button>
        </div>
      </div>
      <MobileMenu id="mobile-menu" isOpen={isDrawerOpen} pathname={pathname} onClose={closeAll} />
    </header>
  );
}
