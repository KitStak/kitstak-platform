import type { Metadata } from 'next';
import { GeneralSection } from '@/features/admin/sections/general-section';

export const metadata: Metadata = { title: 'Admin · General' };

export default function Page() {
  return <GeneralSection />;
}
