import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentTitle } from '@/components/layout/document-title';
import { EmptyState } from '@/components/ui';

export const metadata: Metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-app p-6">
      <DocumentTitle title="Not found · KitStak Projects" />
      <EmptyState
        illustration="search"
        title="We couldn’t find that"
        description="It may have been moved or deleted, or you may not have access to it."
        actions={
          <Link href="/" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover">
            Go home
          </Link>
        }
      />
    </div>
  );
}
