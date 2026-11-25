'use client';
import { useEffect, useRef, useState } from 'react';
import { HandoffScreen } from '@kitstak/ui/handoff';
import { openCardUpdateAction } from '@/features/billing/actions';
import { saveAppReturn } from '@/lib/app-return';
import { PaymentFocus } from './payment-focus';

/**
 * Arriving with `?fix=payment` (the "Update card" button of an app banner or of the failed payment
 * email): the card form opens at once, with no second press on billing home (review round 5).
 *
 *   - The app the person came from is kept for this tab first, so the line that confirms the new
 *     card can still say "Back to WMS".
 *   - `fix` is taken out of the address right before leaving, so Back from the card form shows
 *     billing home and does not open the form a second time.
 *   - When the form cannot be opened, the page falls back to what it did before: the Payment
 *     method card comes into view and its button holds the focus.
 */
export function OpenCardForm({
  targetId,
  from,
  returnPath,
}: {
  readonly targetId: string;
  readonly from: string | null;
  readonly returnPath: string | null;
}) {
  const [opening, setOpening] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (from) saveAppReturn(from, returnPath);
    openCardUpdateAction()
      .then((result) => {
        if (!result.ok) return setOpening(false);
        // Right before leaving, and not earlier: the router puts its own address back when the
        // server action answers. With `fix` gone, Back from the card form loads plain billing home.
        const url = new URL(window.location.href);
        url.searchParams.delete('fix');
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
        window.location.assign(result.data.url);
      })
      .catch(() => setOpening(false));
  }, [from, returnPath]);

  // Restored by the browser's Back: never a stuck loader.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setOpening(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  if (opening) return <HandoffScreen title="Opening the card form" detail="You can change your card on the next screen" />;
  return <PaymentFocus targetId={targetId} />;
}
