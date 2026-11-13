'use client';

import { useEffect } from 'react';

/** Adds `.is-in` to every [data-reveal] element as it scrolls into view. */
export function useReveal(): void {
  useEffect(() => {
    document.documentElement.classList.add('js');
    const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

/** True when `el` is on screen. Used to pause animation loops that are out of view. */
export function observeVisibility(el: Element, onChange: (visible: boolean) => void): () => void {
  const observer = new IntersectionObserver(([entry]) => onChange(Boolean(entry?.isIntersecting)), {
    threshold: 0.15,
  });
  observer.observe(el);
  return () => observer.disconnect();
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
