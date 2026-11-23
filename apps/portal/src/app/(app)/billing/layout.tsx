import type { Metadata } from 'next';
import { LifeBuoy } from 'lucide-react';
import { getBillingContext } from '@/server/billing/context';
import { env } from '@/server/env';
import { BillingNav } from '@/features/billing/billing-nav';

export const metadata: Metadata = { title: 'Billing' };

/** The billing area: tabs for people who can see billing, then the page, then where to get help. */
export default async function BillingLayout({ children }: { readonly children: React.ReactNode }) {
  const context = await getBillingContext();
  const helpHref = `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')}/contact?topic=billing`;
  return (
    <div className="mx-auto w-full max-w-[1120px]">
      {context?.access.canView ? <BillingNav /> : null}
      {children}
      {/* A person with a billing question always has a way to reach a human, on every billing page. */}
      <p data-testid="billing-help" className="mt-10 flex items-center gap-2 border-t border-border-subtle pt-5 text-sm text-fg-secondary print:hidden">
        <LifeBuoy aria-hidden className="size-4 shrink-0 text-icon" />
        <span>
          A question about a charge, an invoice or your plan?{' '}
          <a
            href={helpHref}
            target="_blank"
            rel="noopener"
            className="font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg"
          >
            Talk to us
          </a>
          .
        </span>
      </p>
    </div>
  );
}
