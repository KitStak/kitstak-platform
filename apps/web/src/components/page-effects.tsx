'use client';

import { useReveal } from './use-reveal';

/** Client-only effects that apply to the whole page. Renders nothing. */
export function PageEffects() {
  useReveal();
  return null;
}
