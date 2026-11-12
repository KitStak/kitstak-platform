import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { VendorsPage } from '@/components/vendors/vendors-page';
import { requirePagePermission } from '@/server/auth/permissions';
import { VENDOR_VIEW_PERMISSIONS } from '@/lib/grid-defs/receiving/vendors';

export const metadata: Metadata = { title: 'Vendors' };

/** Server-side gate (same any-of set as `GET /api/vendors`): roles without vendor access land on /forbidden, not on a grid error. */
async function Gated() {
  await requirePagePermission(VENDOR_VIEW_PERMISSIONS, '/receiving/vendors');
  return <VendorsPage tabs="receiving" />;
}

/** Vendors (PO & Receiving tab group). The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
