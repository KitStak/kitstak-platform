import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Showcase } from './showcase';

export const metadata: Metadata = { title: 'UI showcase', robots: { index: false, follow: false } };

/** Dev-only gallery of every design-system primitive in every state. 404s in production. */
export default function UiShowcasePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Showcase />;
}
