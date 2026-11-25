import Link from 'next/link';
import { DocumentTitle } from '@/components/layout/document-title';
import { EmptyState } from '@/components/ui';
import { routes } from '@/lib/routes';

/** Unknown program keys, project keys under /programs, and program tabs a person cannot open. */
export default function ProgramNotFound() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <DocumentTitle title="Program not found · KitStak Projects" />
      <EmptyState
        illustration="search"
        title="We couldn't find that program page"
        description="The program may have been archived or deleted, the page may not exist, or you may not have access to it."
        actions={
          <Link href={routes.programs()} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover">
            Go to Programs
          </Link>
        }
      />
    </div>
  );
}
