import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StakWizard } from '@/components/wizard/stak-wizard';

export const metadata: Metadata = {
  title: 'Set up your Stak - KitStak',
  description:
    'Choose the CRM, the WMS, Projects, Pulse or any mix. Tell us about your operation. Get a setup plan and a price in about five minutes.',
  alternates: { canonical: '/get-started' },
};

export default function GetStartedPage() {
  return (
    // The wizard reads the step and any prefill from the query string, which needs a boundary.
    <Suspense fallback={null}>
      <StakWizard />
    </Suspense>
  );
}
