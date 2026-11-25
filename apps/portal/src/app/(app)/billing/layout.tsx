import type { Metadata } from 'next';
import { LifeBuoy } from 'lucide-react';
import { getBillingContext } from '@/server/billing/context';
import { env } from '@/server/env';
import { BillingNav } from '@/features/billing/billing-nav';

// A plain string here would end the root layout's title pattern for every page below, and the tabs
// of the billing pages would read "Plan" or "Invoices" with no product name. So the pattern is
// repeated for them.
export const metadata: Metadata = { title: { default: 'Billing', template: '%s · KitStak Portal' } };

/** The billing area: tabs for people who can see billing, then the page, then where to get help. */
export default async function BillingLayout({ children }: { readonly children: React.ReactNode }) {
  const context = await getBillingContext();
  const helpHref = `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')}/contact?topic=billing`;
  const supportEmail = env.BILLING_SUPPORT_EMAIL;
  // A promise only the owner can make ("1 business day"). Shown only once it is set.
  const replyTime = env.BILLING_SUPPORT_REPLY_TIME ?? null;
  const LINK = 'font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg';
  return (
    <div className="mx-auto w-full max-w-[1120px]">
      {context?.access.canView ? <BillingNav /> : null}
      {children}
      {/*
        A person with a billing question always has a way to reach a human, on every billing page.
        The address is written out, so it can be read and copied without an email app. The contact
        form is the second way.
      */}
      <p data-testid="billing-help" className="mt-10 flex items-start gap-2 border-t border-border-subtle pt-5 text-sm text-fg-secondary print:hidden">
        <LifeBuoy aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
        <span>
          A question about a charge, an invoice or your plan? Email{' '}
          <a href={`mailto:${supportEmail}?subject=${encodeURIComponent('Billing question')}`} data-testid="billing-help-email" className={LINK}>
            {supportEmail}
          </a>
          {replyTime ? <span data-testid="billing-help-reply">. We reply within {replyTime}</span> : null}. You can also{' '}
          <a href={helpHref} target="_blank" rel="noopener" className={LINK}>
            talk to us
          </a>{' '}
          on our site.
        </span>
      </p>
    </div>
  );
}
