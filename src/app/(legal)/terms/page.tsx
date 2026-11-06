import type { Metadata } from 'next';
import { LegalDocument, type LegalSection } from '../_components/legal-document';

export const metadata: Metadata = { title: 'Terms of service' };

const SECTIONS: readonly LegalSection[] = [
  {
    heading: 'Accounts',
    paragraphs: [
      'You must provide accurate information when you create an account and keep your credentials confidential. You are responsible for activity that happens under your account.',
      'The person who creates an organization is its owner and may invite members, assign roles and remove access.',
    ],
  },
  {
    heading: 'Your content',
    paragraphs: [
      'Your organization keeps all rights to the content it stores in KitStak. You grant us only the permissions needed to host, display and process that content to provide the service.',
    ],
  },
  {
    heading: 'Acceptable use',
    paragraphs: [
      'Do not use KitStak to break the law, send unsolicited bulk messages, store malware, probe or overload the service, or access data you are not authorized to see.',
      'We may suspend access that threatens the security or availability of the service, and will notify the organization owner when we do.',
    ],
  },
  {
    heading: 'Availability and changes',
    paragraphs: [
      'We work to keep KitStak available and continuously improve it. Features may change, and we will give reasonable notice before removing functionality your organization relies on.',
    ],
  },
  {
    heading: 'Termination',
    paragraphs: [
      'You may stop using KitStak at any time. Organization owners can export their data before closing an account. We may terminate accounts that materially breach these terms.',
    ],
  },
  {
    heading: 'Liability',
    paragraphs: [
      'The service is provided as is to the extent permitted by law. Our total liability for any claim is limited to the amounts paid for the service in the twelve months before the claim.',
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of service"
      updated="November 1, 2026"
      intro="These terms govern your organization's use of KitStak. By creating an account or using the service you agree to them."
      sections={SECTIONS}
    />
  );
}
