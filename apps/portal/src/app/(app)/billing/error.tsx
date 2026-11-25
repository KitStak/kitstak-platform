'use client';
import { useEffect } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button, LinkButton } from '@/components/ui';

/** A read error in the billing area. The rest of the portal keeps working. */
export default function BillingError({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => {
    console.error('[billing] page failed', error.digest ?? error.message);
  }, [error]);
  return (
    <section role="alert" className="mx-auto flex max-w-[520px] flex-col items-center py-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-danger-subtle text-danger-text">
        <TriangleAlert aria-hidden className="size-6" />
      </span>
      <h1 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-fg">We could not load billing.</h1>
      <p className="mt-2 text-md text-fg-secondary">Nothing was charged and nothing changed. Try again.</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button size="xl" leadingIcon={<RotateCw aria-hidden />} onClick={reset}>
          Try again
        </Button>
        <LinkButton href="/" variant="secondary" size="xl">
          Back to my apps
        </LinkButton>
      </div>
    </section>
  );
}
