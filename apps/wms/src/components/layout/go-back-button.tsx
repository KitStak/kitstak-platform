'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

const SECONDARY_ACTION =
  'inline-flex h-9 items-center rounded-md border border-border-strong/70 bg-surface px-4 text-sm font-medium text-body hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30';

/** Secondary "Go back" action for status pages; falls back to the dashboard without history. */
export function GoBackButton({ fallbackHref = '/dashboard' }: { readonly fallbackHref?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={SECONDARY_ACTION}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
    >
      Go back
    </button>
  );
}

export const NOT_FOUND_TITLE = 'Not found · KitStak WMS';

/**
 * A record page that calls notFound() keeps its static metadata title ("Shipment Order");
 * this corrects the tab title while the 404 is shown.
 */
export function NotFoundTitle() {
  // No restore on unmount: the next route's metadata sets its own title.
  React.useEffect(() => {
    document.title = NOT_FOUND_TITLE;
  }, []);
  return null;
}
