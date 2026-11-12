import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import { Logo } from '@/features/shell/logo';

/** Global 404 (outside any org): branded, with a way back into the app. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="px-6 py-5">
        <Link href="/" aria-label="KitStak home" className="inline-flex rounded-md">
          <Logo size={28} />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <EmptyState
          size="lg"
          illustration="search"
          title="This page doesn't exist"
          description="Check the address, or head back to your workspace."
          actions={
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-sm bg-primary px-4 text-md font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Go to KitStak
            </Link>
          }
        />
      </main>
    </div>
  );
}
