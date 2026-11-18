'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ROUTES } from '../site-links';
import { prefersReducedMotion } from '../use-reveal';
import styles from './sub-nav.module.css';

export interface SubNavSection {
  readonly id: string;
  readonly label: string;
}

interface SubNavProps {
  /** Which page this bar sits on; lights the matching entry in the product switch. */
  readonly current: 'wms' | 'crm' | 'projects' | 'pulse' | 'products';
  readonly sections: readonly SubNavSection[];
  /** Product-specific action shown once the bar sticks. Omit where the header's own action is the same. */
  readonly cta?: { readonly href: string; readonly label: string };
}

const SWITCH = [
  { id: 'wms', href: ROUTES.wms, label: 'WMS' },
  { id: 'crm', href: ROUTES.crm, label: 'CRM' },
  { id: 'projects', href: ROUTES.projects, label: 'Projects' },
  { id: 'pulse', href: ROUTES.pulse, label: 'Pulse' },
  { id: 'products', href: ROUTES.products, label: 'Stack' },
] as const;

/**
 * Sticky bar under the header on product pages: switch between products, jump to a section, and
 * keep the primary action in reach. Highlights the section currently on screen.
 */
export function SubNav({ current, sections, cta }: SubNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isStuck, setIsStuck] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      // A thin band just below the two sticky bars: whichever section crosses it is "current".
      { rootMargin: '-30% 0px -65% 0px' },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    const headerHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 72;
    const onScroll = () => {
      const top = barRef.current?.getBoundingClientRect().top ?? Infinity;
      const stuck = top <= headerHeight + 1;
      setIsStuck(stuck);
      // Back up in the hero, no section is current.
      if (!stuck) setActiveId(null);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Keep the active link visible when the bar scrolls sideways on small screens.
  useEffect(() => {
    const track = trackRef.current;
    const link = track?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!track || !link) return;
    const target = link.offsetLeft - (track.clientWidth - link.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(target, 0), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [activeId]);

  return (
    <div ref={barRef} className={styles.bar} data-subnav data-stuck={isStuck || undefined}>
      <div className={`container ${styles.inner}`}>
        <nav aria-label="Switch product" className={styles.switch}>
          {SWITCH.map((item) => (
            <Link key={item.id} href={item.href} aria-current={item.id === current ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="On this page" className={styles.sections}>
          <ul ref={trackRef}>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} aria-current={section.id === activeId ? 'location' : undefined}>
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {cta ? (
          <Link href={cta.href} className={styles.cta}>
            {cta.label} <span aria-hidden>→</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
