'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/components/ui';

const EVERY_MS = 5000;

/** "Refresh" and a "Live" switch that reloads the list every 5 seconds while the tab is in view. */
export function AutoRefresh() {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [live, router]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={live}
        onClick={() => setLive((value) => !value)}
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          live ? 'border-success/40 bg-success-subtle text-success-text' : 'border-border-input bg-panel text-fg hover:bg-muted',
        )}
      >
        <span aria-hidden className={cn('size-2 rounded-full', live ? 'bg-success motion-safe:animate-pulse' : 'bg-border-strong')} />
        {live ? 'Live. Checks every 5 seconds' : 'Go live'}
      </button>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        aria-busy={pending}
        className={cn(
          'inline-flex h-10 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg',
          'hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        <RefreshCw aria-hidden className={cn('size-4', pending && 'motion-safe:animate-spin')} />
        Refresh
      </button>
    </div>
  );
}
