import type { Metadata } from 'next';
import { Undo2 } from 'lucide-react';
import { requireBillingContext } from '@/server/billing/context';
import { LinkButton } from '@/components/ui';
import { BillingMessage } from '@/features/billing/billing-chrome';

export const metadata: Metadata = { title: 'Checkout not finished' };

/** Back or closed on the pay page (SPEC 6.5). Nothing was charged and the cart is kept. */
export default async function CheckoutCanceledPage() {
  await requireBillingContext('/billing/checkout/canceled');
  return (
    <BillingMessage
      testId="checkout-canceled"
      icon={<Undo2 aria-hidden className="size-6" />}
      title="No charge was made. Your cart is saved."
      actions={
        <>
          <LinkButton href="/billing/checkout" size="xl" data-testid="checkout-resume">
            Go back to checkout
          </LinkButton>
          <LinkButton href="/billing/plan" variant="secondary" size="xl">
            Change my plan
          </LinkButton>
        </>
      }
    >
      Pick up where you left off any time. Your apps keep working as before.
    </BillingMessage>
  );
}
