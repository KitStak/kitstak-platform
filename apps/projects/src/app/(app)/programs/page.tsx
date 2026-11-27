import type { Metadata } from 'next';
import { ProgramsPage } from '@/features/programs/directory/programs-page';

export const metadata: Metadata = { title: 'Programs' };

export default async function Page() {
  return <ProgramsPage />;
}
