import type { Metadata } from 'next';
import { AgenciesPage } from '@/features/agencies/agencies-page';

export const metadata: Metadata = { title: 'Agencies' };

export default function Page() {
  return <AgenciesPage />;
}
