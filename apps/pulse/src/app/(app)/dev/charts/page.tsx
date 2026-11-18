import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChartGallery } from '@/components/charts/gallery';

export const metadata: Metadata = { title: 'Chart gallery' };

/**
 * Scratch route for the chart library: every chart with sample data, used by the screenshot
 * script (`scripts/charts-shots.mjs`) and by people checking a chart by eye. It is not in the
 * nav and it does not exist in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ChartGallery />;
}
