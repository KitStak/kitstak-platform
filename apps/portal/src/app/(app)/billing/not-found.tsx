import { SearchX } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { BillingMessage } from '@/features/billing/billing-chrome';

/** A billing link that points at nothing in this organization (an old or mistyped invoice link). */
export default function BillingNotFound() {
  return (
    <BillingMessage
      icon={<SearchX aria-hidden className="size-6" />}
      title="We could not find that."
      actions={
        <>
          <LinkButton href="/billing/invoices" size="xl">
            See all invoices
          </LinkButton>
          <LinkButton href="/billing" variant="secondary" size="xl">
            Back to Billing
          </LinkButton>
        </>
      }
    >
      It may belong to another organization, or the link may be old. Check which organization you are in at the top of the page.
    </BillingMessage>
  );
}
