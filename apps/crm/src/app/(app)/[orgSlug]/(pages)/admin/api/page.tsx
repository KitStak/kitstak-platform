import type { Metadata } from 'next';
import { ApiSection } from '@/features/admin/sections/api-tokens-section';

export const metadata: Metadata = { title: 'Admin · API' };

export default function Page() {
  return <ApiSection />;
}
