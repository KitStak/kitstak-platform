'use client';

import { useEffect, useState } from 'react';
import { Logo } from './logo';
import { LINKS } from './site-links';
import styles from './header.module.css';

const NAV = [
  { href: '#flow', label: 'Platform' },
  { href: '#wms', label: 'WMS' },
  { href: '#crm', label: 'CRM' },
  { href: '#licensing', label: 'Licensing' },
] as const;

const HEADER_HEIGHT = 72;

export function Header() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const hero = document.getElementById('top');
    const onScroll = () => {
      const limit = hero ? hero.offsetHeight - HEADER_HEIGHT : HEADER_HEIGHT;
      setIsScrolled(window.scrollY > limit);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={styles.header} data-scrolled={isScrolled || undefined}>
      <div className={`container ${styles.inner}`}>
        <a href="#top" className={styles.brand} aria-label="KitStak home">
          <Logo height={20} tone={isScrolled ? 'auto' : 'inverse'} />
        </a>
        <nav aria-label="Main navigation" className={styles.nav}>
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={styles.link}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className={styles.actions}>
          <a href={LINKS.portal} className={styles.signIn}>
            Sign in
          </a>
          <a href={LINKS.portal} className={`btn btn-primary ${styles.cta}`}>
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}
