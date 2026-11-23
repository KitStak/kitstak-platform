import type { Metadata } from 'next';
import { getBillingContext } from '@/server/billing/context';
import { BillingNav } from '@/features/billing/billing-nav';

export const metadata: Metadata = { title: 'Billing' };

/** The billing area: tabs for people who can see billing, then the page. */
export default async function BillingLayout({ children }: { readonly children: React.ReactNode }) {
  const context = await getBillingContext();
  return (
    <div className="mx-auto w-full max-w-[1120px]">
      {context?.access.canView ? <BillingNav /> : null}
      {children}
    </div>
  );
}
