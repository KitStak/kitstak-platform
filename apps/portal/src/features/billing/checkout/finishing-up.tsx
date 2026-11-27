'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { Button, LinkButton, Spinner } from '@/components/ui';

const TRIES = 10;

/**
 * The gateway has not confirmed the payment yet. Ask again each second for up to 10 seconds (each
 * refresh runs the same sync the webhook runs), then offer a button. Nothing is granted by waiting.
 */
export function FinishingUp() {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries >= TRIES) return;
    const timer = window.setTimeout(() => {
      setTries((count) => count + 1);
      router.refresh();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [tries, router]);

  const waiting = tries < TRIES;
  return (
    <section data-testid="checkout-finishing" role="status" className="mx-auto flex max-w-[520px] flex-col items-center py-16 text-center">
      {waiting ? <Spinner size="lg" label={null} className="text-fg-secondary" /> : null}
      <h1 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-fg">{waiting ? 'Finishing up.' : 'This is taking longer than usual.'}</h1>
      <p className="mt-2 text-md text-fg-secondary">
        {waiting ? 'This takes a few seconds.' : 'Your payment may still be on its way. Nothing is lost. Check again in a moment.'}
      </p>
      {waiting ? null : (
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            size="xl"
            leadingIcon={<RotateCw aria-hidden />}
            onClick={() => {
              setTries(0);
              router.refresh();
            }}
          >
            Refresh
          </Button>
          <LinkButton href="/billing" variant="secondary" size="xl">
            Go to Billing
          </LinkButton>
        </div>
      )}
    </section>
  );
}
