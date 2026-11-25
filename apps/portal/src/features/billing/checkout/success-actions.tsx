'use client';
import { useEffect, useState } from 'react';
import { LinkButton } from '@/components/ui';
import { clearAppReturn, readAppReturn } from '@/lib/app-return';

/** Where "Back to Pulse" leads, per app: the words and the app's address. From the server. */
export type SuccessBackTargets = Readonly<Record<string, { readonly label: string; readonly base: string }>>;

/**
 * The two buttons under "You are all set." A person who came from an app to pick a plan (the
 * "Pick a plan" button of a view only Pulse opens `/billing/plan?from=pulse`) gets the way back as
 * the main button: "Back to Pulse" (review round 5). The pay page drops the link's `from`, so the
 * app is the one this tab remembers. Everyone else gets "Open my apps".
 */
export function SuccessActions({ backTargets }: { readonly backTargets: SuccessBackTargets }) {
  const [back, setBack] = useState<{ readonly label: string; readonly href: string } | null>(null);

  useEffect(() => {
    const saved = readAppReturn();
    const target = saved ? backTargets[saved.from] : undefined;
    if (!saved || !target) return;
    const frame = window.requestAnimationFrame(() => {
      // Used once: cleared only when it is on screen (an effect can run twice in development).
      clearAppReturn();
      setBack({ label: target.label, href: `${target.base.replace(/\/+$/, '')}${saved.path ?? ''}` });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [backTargets]);

  return (
    <div className="mt-5 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      {back ? (
        <LinkButton href={back.href} size="xl" data-testid="checkout-success-back">
          {back.label}
        </LinkButton>
      ) : (
        <LinkButton href="/" size="xl" data-testid="checkout-success-open-apps">
          Open my apps
        </LinkButton>
      )}
      <LinkButton href="/billing" variant="secondary" size="xl">
        See my plan
      </LinkButton>
    </div>
  );
}
