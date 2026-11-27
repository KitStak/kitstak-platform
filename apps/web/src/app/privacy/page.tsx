import type { Metadata } from 'next';
import { LEGAL_UPDATED, PRIVACY_INTRO, PRIVACY_SECTIONS } from '@/components/legal/legal-content';
import { LegalPage } from '@/components/legal/legal-page';
import { ROUTES } from '@/components/site-links';

export const metadata: Metadata = {
  title: 'Privacy policy - KitStak',
  description: 'What KitStak collects, how it is used and protected, how card payments are handled, and the choices you have.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated={LEGAL_UPDATED}
      intro={PRIVACY_INTRO}
      sections={PRIVACY_SECTIONS}
      other={{ href: ROUTES.terms, label: 'Terms of service' }}
    />
  );
}
