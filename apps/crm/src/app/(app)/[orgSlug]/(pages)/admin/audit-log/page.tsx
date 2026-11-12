import type { Metadata } from 'next';
import { AuditSection } from '@/features/admin/sections/audit-section';

export const metadata: Metadata = { title: 'Admin · Audit log' };

export default function Page() {
  return <AuditSection />;
}
