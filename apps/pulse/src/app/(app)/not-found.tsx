import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentTitle } from '@/components/layout/document-title';
import { EmptyState } from '@/components/ui';

export const metadata: Metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <DocumentTitle title="Not found · KitStak Pulse" />
      <EmptyState
        illustration="search"
        title="We could not find that"
        description="It may have been moved or deleted, or you may not have access to it."
        actions={
          <Link href="/" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover">
            Go to Home
          </Link>
        }
      />
    </div>
  );
}
