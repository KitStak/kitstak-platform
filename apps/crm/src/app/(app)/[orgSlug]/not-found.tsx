'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Home } from 'lucide-react';
import { EmptyState } from '@/components/ui';

/** 404 inside the app shell: sidebar and top bar stay usable, with a clear way back. */
export default function OrgNotFound() {
  const params = useParams<{ orgSlug?: string }>();
  const home = params.orgSlug ? `/${params.orgSlug}` : '/';
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        illustration="search"
        title="We couldn't find that page"
        description="It may have been moved, deleted, or you may not have access. Press Ctrl K to search everything."
        actions={
          <Link
            href={home}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Home aria-hidden className="size-4" />
            Go home
          </Link>
        }
      />
    </div>
  );
}
