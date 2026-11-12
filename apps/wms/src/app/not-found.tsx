import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { BrandLogo } from '@/components/layout/brand-logo';
import { GoBackButton } from '@/components/layout/go-back-button';
import { HomeLink, StatusScreen } from '@/components/layout/status-screen';
import { PRODUCT_NAME } from '@/config/brand';
import { loadShellProps } from '@/server/shell/shell-props';

export const metadata: Metadata = { title: 'Page not found' };

function NotFoundBody() {
  return (
    <StatusScreen
      code="404"
      icon={Compass}
      title="This page doesn't exist"
      description="Check the address, search with the / key, or go back to the dashboard."
      actions={
        <>
          <GoBackButton />
          <HomeLink />
        </>
      }
    />
  );
}

/** Signed-out (or still-loading) frame: the branded top bar, never a blank canvas. */
function BrandFrame({ children }: { readonly children?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center border-b border-border-subtle bg-panel px-4">
        <Link
          href="/dashboard"
          aria-label={`${PRODUCT_NAME} home`}
          className="flex items-center rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <BrandLogo tone="light" height={17} showProduct />
        </Link>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

/** Reads the session (runtime data), so it renders inside Suspense; the 404 status is set by routing. */
async function ShellOrFrame() {
  const shell = await loadShellProps();
  if (!shell) {
    return (
      <BrandFrame>
        <NotFoundBody />
      </BrandFrame>
    );
  }
  return (
    <AppShell
      user={shell.user}
      permissions={shell.permissions}
      initialContext={shell.initialContext}
      activeApps={shell.activeApps}
    >
      <NotFoundBody />
    </AppShell>
  );
}

/** Unmatched URLs anywhere: inside the full app shell for signed-in users. */
export default function NotFound() {
  return (
    <Suspense fallback={<BrandFrame />}>
      <ShellOrFrame />
    </Suspense>
  );
}
