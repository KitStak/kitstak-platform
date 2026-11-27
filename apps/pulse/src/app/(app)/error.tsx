'use client';
import { useEffect } from 'react';
import { Button, EmptyState } from '@/components/ui';

export default function ErrorBoundary({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        illustration="error"
        title="Something went wrong"
        description="This page hit a problem. Try again, and if it keeps happening let us know."
        actions={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
