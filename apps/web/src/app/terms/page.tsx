import type { Metadata } from 'next';
import { LEGAL_UPDATED, TERMS_INTRO, TERMS_SECTIONS } from '@/components/legal/legal-content';
import { LegalPage } from '@/components/legal/legal-page';
import { ROUTES } from '@/components/site-links';

export const metadata: Metadata = {
  title: 'Terms of service - KitStak',
  description: 'The KitStak terms of service, with the billing rules in plain words: the free trial, renewal, plan changes, canceling, refunds and tax.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated={LEGAL_UPDATED}
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
      other={{ href: ROUTES.privacy, label: 'Privacy policy' }}
    />
  );
}
