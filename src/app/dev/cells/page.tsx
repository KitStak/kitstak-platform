import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CellsGallery } from './gallery';

export const metadata: Metadata = { title: 'Cells gallery', robots: { index: false, follow: false } };

/** Dev-only gallery of every column type in display, hover, empty, editing and read-only states. */
export default function CellsGalleryPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <CellsGallery />;
}
