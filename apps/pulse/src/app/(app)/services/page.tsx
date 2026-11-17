import type { Metadata } from 'next';
import { ServicesPage } from '@/features/services';

export const metadata: Metadata = { title: 'Extra services' };

export default function Page() {
  return <ServicesPage />;
}
