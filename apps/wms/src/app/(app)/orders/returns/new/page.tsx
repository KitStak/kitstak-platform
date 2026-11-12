import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { RmaCreatePage } from '@/components/returns/rma-create-page';
import { requirePagePermission } from '@/server/auth/permissions';
import { RETURN_PERMISSIONS } from '@/server/repositories/returns';

export const metadata: Metadata = { title: 'Create RMA' };

const ROUTE = '/orders/returns/new';

/** Server-side gate: no Create RMA permission → /forbidden (the API also rejects the post). */
async function Gated() {
  await requirePagePermission(RETURN_PERMISSIONS.createRma, ROUTE);
  return <RmaCreatePage />;
}

/** Create RMA (M04 §7) — `?orderIds=a,b` preselects shipped orders. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
