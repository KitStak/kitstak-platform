import type { Metadata } from 'next';
import { UsageSection } from '@/features/admin/sections/usage-section';

export const metadata: Metadata = { title: 'Admin · Usage & billing' };

export default function Page() {
  return <UsageSection />;
}
