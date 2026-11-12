import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { ReceivingLedgerPage } from '@/components/receiving/receiving-ledger-page';

export const metadata: Metadata = { title: 'Receiving transactions' };

/** Receiving-scoped inventory ledger. The grid reads its state from the URL (useSearchParams), so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReceivingLedgerPage />
    </Suspense>
  );
}
