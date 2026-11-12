import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ItemPanelDevHarness } from './harness';

export const metadata: Metadata = { title: 'Item panel', robots: { index: false, follow: false } };

/** Dev-only harness: a compact Deals list that opens the real item panel on seeded data. */
export default function ItemPanelDevPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={null}>
      <ItemPanelDevHarness />
    </Suspense>
  );
}
