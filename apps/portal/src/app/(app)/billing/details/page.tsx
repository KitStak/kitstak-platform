import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getBillingProfile, getPlanState } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { Card, Notice } from '@/components/ui';
import { BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import { countryOptions } from '@/features/billing/details/countries';
import { DetailsForm } from '@/features/billing/details/details-form';

export const metadata: Metadata = { title: 'Billing details' };

/** Billing contact, address and tax ID (SPEC 6.7). */
export default async function BillingDetailsPage() {
  const context = await requireBillingContext('/billing/details');
  const { rt, org, access } = context;
  if (!access.canView) redirect('/billing');
  const [profile, state] = await Promise.all([getBillingProfile(rt.db, org.id), getPlanState(rt, org.id)]);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      <BillingHeader
        orgName={org.name}
        title="Billing details"
        description="These show on your invoices. Changes apply from your next invoice."
        badges={<TestModeBadge mode={state.mode} />}
      />
      {!access.canManage ? (
        <Notice tone="neutral" role="status">
          You can see these details. Only an owner or a billing manager can change them.
        </Notice>
      ) : null}
      <Card className="p-5 sm:p-6" aria-label="Billing details">
        <DetailsForm profile={profile} orgName={org.name} countries={countryOptions()} canEdit={access.canManage} />
      </Card>
    </div>
  );
}
