'use client';
import { useEffect } from 'react';

/** Arriving with `?fix=payment`: bring the Payment method card into view and put focus on its button. */
export function PaymentFocus({ targetId }: { readonly targetId: string }) {
  useEffect(() => {
    const card = document.getElementById(targetId);
    if (!card) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    const button = card.querySelector<HTMLElement>('button, a[href]');
    button?.focus({ preventScroll: true });
  }, [targetId]);
  return null;
}
