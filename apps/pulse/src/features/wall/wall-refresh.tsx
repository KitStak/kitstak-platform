'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-reads the wall from the server on a timer (default every 60 seconds), pausing while the tab is hidden. */
export function WallRefresh({ seconds = 60 }: { readonly seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, Math.max(15, seconds) * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}
