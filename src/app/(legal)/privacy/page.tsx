import type { Metadata } from 'next';
import { LegalDocument, type LegalSection } from '../_components/legal-document';

export const metadata: Metadata = { title: 'Privacy policy' };

const SECTIONS: readonly LegalSection[] = [
  {
    heading: 'Information we collect',
    paragraphs: [
      'Account data you give us: your name, work email address, password (stored only as a salted hash) and the organization you create or join.',
      'Workspace content your team stores in KitStak: boards, items, updates, files, dashboards and automations. This content belongs to your organization.',
      'Service data generated as you use the product: sign-in events, security audit records, device and browser type, and request logs used to keep the service reliable and secure.',
    ],
  },
  {
    heading: 'How we use information',
    paragraphs: [
      'We use account and service data to provide, secure and support KitStak, to authenticate you, to send notifications you have enabled, and to detect abuse.',
      'We do not sell personal information and we do not use workspace content for advertising or to train models.',
    ],
  },
  {
    heading: 'Sharing',
    paragraphs: [
      'Workspace content is visible to members of your organization according to the board, workspace and role permissions your administrators configure.',
      'We share data with infrastructure sub-processors (hosting, email delivery, error monitoring) only as needed to run the service and under written data-protection terms.',
    ],
  },
  {
    heading: 'Security',
    paragraphs: [
      'Data is encrypted in transit with TLS. Sessions use HTTP-only, same-site cookies, and every request is scoped to your organization and checked against role-based permissions.',
      'Security-relevant events, such as role changes and denied access attempts, are recorded in an audit log available to organization administrators.',
    ],
  },
  {
    heading: 'Retention and deletion',
    paragraphs: [
      'Deleted boards and items stay in Trash for 30 days so they can be restored, and are then permanently removed. Organization owners can request full account deletion at any time.',
    ],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      'Depending on where you live you may have the right to access, correct, export or delete your personal information, and to object to certain processing. Contact your organization administrator or privacy@kitstak.app to exercise these rights.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy policy"
      updated="November 1, 2026"
      intro="This policy explains what information KitStak collects when your team uses the product, how it is used and protected, and the choices you have."
      sections={SECTIONS}
    />
  );
}
