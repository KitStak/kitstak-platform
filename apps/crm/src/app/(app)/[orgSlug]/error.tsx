'use client';
import { RotateCcw } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';

/** Page-level error boundary inside the shell: navigation keeps working, the page can retry. */
export default function OrgError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        illustration="error"
        title="This page hit a snag"
        description={
          <>
            Something went wrong while loading. Your data is safe.
            {error.digest ? (
              <span className="mt-1 block text-xs text-fg-muted">Reference: {error.digest}</span>
            ) : null}
          </>
        }
        actions={
          <Button leadingIcon={<RotateCcw aria-hidden />} onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
