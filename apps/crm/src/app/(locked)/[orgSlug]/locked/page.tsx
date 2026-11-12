import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import { Logo } from '@/features/shell/logo';

export const metadata: Metadata = { title: 'CRM locked' };

/**
 * Entitlement lock page (BLUEPRINT.md §3.3): `getPageOrgMembership` redirects members of
 * an org without the `crm` module here. Lives in its own route group — NOT under
 * (app)/[orgSlug] — so the gated layout never wraps it (no redirect loop). Billing lives
 * in the portal; the link only appears when NEXT_PUBLIC_PORTAL_URL is configured
 * (Stripe is deferred — access is restored by a manual grant).
 */
export default function LockedPage() {
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL?.trim().replace(/\/+$/, '');
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
          illustration="error"
          title="CRM is not enabled for this organization"
          description="Your organization doesn't have an active KitStak CRM subscription. Contact your organization owner to restore access."
          actions={
            portalUrl ? (
              <a
                href={`${portalUrl}/billing`}
                className="inline-flex h-10 items-center rounded-sm bg-primary px-4 text-md font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Manage billing
              </a>
            ) : undefined
          }
        />
      </main>
    </div>
  );
}
