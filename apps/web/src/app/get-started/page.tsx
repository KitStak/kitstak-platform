import type { Metadata } from 'next';
import { Suspense } from 'react';
import { isAppLive } from '@/components/site-links';
import { StakWizard } from '@/components/wizard/stak-wizard';

/** Pulse is named as a choice only once its app is open, because the wizard will not take it before. */
const CHOICES = isAppLive('pulse') ? 'the CRM, the WMS, Projects, Pulse' : 'the CRM, the WMS, Projects';

export const metadata: Metadata = {
  title: 'Set up your Stak - KitStak',
  description: `Choose ${CHOICES} or any mix. Tell us about your operation. Get a price and a setup plan, then start your free trial. It takes about five minutes.`,
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
