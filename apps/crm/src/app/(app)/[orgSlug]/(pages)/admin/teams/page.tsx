import type { Metadata } from 'next';
import { TeamsSection } from '@/features/admin/sections/teams-section';

export const metadata: Metadata = { title: 'Admin · Teams' };

export default function Page() {
  return <TeamsSection />;
}
