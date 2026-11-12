'use client';

import { useEffect, useState } from 'react';

/**
 * Rendered inside streaming skeletons. If the server has not streamed the page after `slowMs`,
 * shows a "still loading" notice with Retry; after `failMs` it switches to an error state, so a
 * hung request never leaves the user on a skeleton forever.
 */
export function SlowLoadNotice({ slowMs = 6000, failMs = 20000 }: { slowMs?: number; failMs?: number }) {
  const [phase, setPhase] = useState<'ok' | 'slow' | 'failed'>('ok');
  useEffect(() => {
    const a = window.setTimeout(() => setPhase('slow'), slowMs);
    const b = window.setTimeout(() => setPhase('failed'), failMs);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [slowMs, failMs]);
  if (phase === 'ok') return null;
  const failed = phase === 'failed';
  return (
    <div
      role={failed ? 'alert' : 'status'}
      data-testid="slow-load-notice"
      className={`flex max-w-[720px] items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
        failed
          ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
      }`}
    >
      <span>
        {failed
          ? "This page didn't load. The server may be busy or unreachable."
          : 'Still loading. This is taking longer than usual.'}
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded border border-current px-2 py-0.5 text-xs font-medium hover:bg-black/5"
      >
        Retry
      </button>
    </div>
  );
}
