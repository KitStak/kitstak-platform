import type { Metadata } from 'next';
import { PermissionsSection } from '@/features/admin/sections/permissions-section';

export const metadata: Metadata = { title: 'Admin · Permissions' };

export default function Page() {
  return <PermissionsSection />;
}
