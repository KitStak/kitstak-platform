import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentTitle } from '@/components/layout/document-title';
import { EmptyState } from '@/components/ui';
import { ShellFrame } from '@/features/shell/shell-frame';
import { getContext } from '@/server/session';

export const metadata: Metadata = { title: 'Not found' };

function Message() {
  return (
    <>
      <DocumentTitle title="Not found · KitStak Pulse" />
      <EmptyState
        illustration="search"
        title="We could not find that"
        description="It may have been moved or deleted, or you may not have access to it."
        actions={
          <Link href="/jobs" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover">
            See all jobs
          </Link>
        }
      />
    </>
  );
}

/**
 * Root 404. Signed-in people keep the sidebar and top bar (unknown URLs land here); signed-out visitors get a plain page.
 */
export default async function NotFound() {
  const context = await getContext().catch(() => null);
  if (context) {
    return (
      <ShellFrame context={context}>
        <div className="flex h-full items-center justify-center p-6">
          <Message />
        </div>
      </ShellFrame>
    );
  }
  return (
    <div className="flex min-h-dvh items-center justify-center bg-app p-6">
      <Message />
    </div>
  );
}
