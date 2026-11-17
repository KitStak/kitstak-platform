'use client';
/** /import — the full-page import wizard (deep-linkable steps, resumable draft). */
import { Suspense } from 'react';
import Link from 'next/link';
import { Upload } from 'lucide-react';
import { EmptyState, Skeleton, buttonVariants } from '@/components/ui';
import { useCan, useOrg } from '@/features/shell/org-context';
import { ImportWizard } from './import-wizard';

export function ImportPage() {
  const canImport = useCan('data:import');
  const { org } = useOrg();
  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="import-page">
      <header className="flex items-center gap-2.5 px-4 pt-3 pb-3 sm:px-8 sm:pt-4">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-text [&_svg]:size-4"
        >
          <Upload />
        </span>
        <h1 className="truncate text-lg font-semibold text-fg">Import data</h1>
      </header>
      <div className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs sm:mx-8 sm:mb-6">
        {canImport ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-4 p-6" data-skeleton>
                <Skeleton height={28} width={280} />
                <Skeleton height={140} rounded="lg" />
              </div>
            }
          >
            <ImportWizard scope="page" variant="page" />
          </Suspense>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6" data-testid="import-no-permission">
            <EmptyState
              title="You need edit access to import"
              description="Importing adds items and columns to boards. Ask an admin of this organization to give you a member role."
              illustration="board"
              actions={
                <Link href={`/${org.slug}`} className={buttonVariants({ variant: 'secondary' })}>
                  Back to home
                </Link>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
