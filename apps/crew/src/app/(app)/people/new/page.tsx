import type { Metadata } from 'next';
import { NewPersonPage } from '@/features/people/new-person-page';

export const metadata: Metadata = { title: 'Add a person' };

export default function Page() {
  return <NewPersonPage />;
}
