import type { Metadata } from 'next';
import { SecuritySection } from '@/features/admin/sections/security-section';

export const metadata: Metadata = { title: 'Admin · Security' };

export default function Page() {
  return <SecuritySection />;
}
