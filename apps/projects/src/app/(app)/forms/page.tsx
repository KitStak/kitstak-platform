import type { Metadata } from 'next';
import { FormsPage } from '@/features/forms';

export const metadata: Metadata = { title: 'Forms' };

export default function Page() {
  return <FormsPage />;
}
