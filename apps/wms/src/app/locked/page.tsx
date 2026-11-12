import type { Metadata } from 'next';
import { Lock } from 'lucide-react';
import { BRAND_NAME } from '@/config/brand';
import { BrandLogo } from '@/components/layout/brand-logo';

export const metadata: Metadata = {
  title: 'Module locked',
};

/**
 * Entitlement lock screen (BLUEPRINT.md §3.3): shown when the platform org does not
 * hold the `wms` module (`loadShellProps` redirects here). Intentionally outside the
 * (app) group so it renders without the gated shell. Billing lives in the portal; the
 * link only appears when NEXT_PUBLIC_PORTAL_URL is configured (Stripe is deferred —
 * access is restored by a manual grant).
 */
export default function LockedPage() {
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL?.trim().replace(/\/+$/, '');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted/30 px-6">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
        <div className="mb-6 flex justify-center">
          <BrandLogo tone="light" height={24} showProduct />
        </div>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold">WMS is not enabled for this organization</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your organization does not currently have an active {BRAND_NAME} WMS subscription.
          Contact your administrator to restore access.
        </p>
        {portalUrl ? (
          <a
            href={`${portalUrl}/billing`}
            className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Manage billing
          </a>
        ) : null}
      </div>
    </main>
  );
}
