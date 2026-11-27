/**
 * The words of the Terms and the Privacy policy. The account, content, use, security and rights
 * sections are the text KitStak already published inside the apps (apps/crm/src/app/(legal)).
 * The billing sections are new: they state, in plain words, what the product does today, and every
 * number in them is read from the one pricing catalog, so they cannot drift from sign-up or from an
 * invoice. The owner and counsel review this file before go-live (docs/billing/GO-LIVE.md).
 */
import { BILLING_POLICY, BUNDLE_OFF, CATALOG, TRIAL_DAYS, YEARLY_OFF } from '@/lib/pricing';
import type { LegalSection } from './legal-page';

export const LEGAL_UPDATED = 'November 23, 2026';

const pause = CATALOG.pauseMonths;

export const TERMS_INTRO =
  "These terms cover your organization's use of KitStak. By creating an account or using the service you agree to them.";

export const TERMS_SECTIONS: readonly LegalSection[] = [
  {
    heading: 'Accounts',
    paragraphs: [
      'You must provide accurate information when you create an account and keep your credentials confidential. You are responsible for activity that happens under your account.',
      'The person who creates an organization is its owner and may invite members, assign roles and remove access.',
    ],
  },
  {
    heading: 'Free trial',
    paragraphs: [
      `A new organization can try the apps it picks free for ${TRIAL_DAYS} days. No card is needed to start, and nothing is charged during the trial.`,
      'When the trial ends with no plan, your apps become view only. Nothing is deleted. You can pick a plan at any time to keep working.',
    ],
  },
  {
    heading: 'Plans, prices and renewal',
    paragraphs: [
      'You pay for the apps you pick. Some apps are priced for each person on your team, the warehouse app is priced for each warehouse, and some have one flat price. The prices are the ones shown on the pricing page and on the review screen before you pay.',
      `With two or more apps you save ${BUNDLE_OFF} on every app. Paying yearly saves ${YEARLY_OFF}. Both discounts show as their own lines before you pay and on every invoice.`,
      'A plan renews by itself at the end of each month or year, at the price shown in Billing, until you cancel. We charge the card on file on the renewal day and email a receipt.',
    ],
  },
  {
    heading: 'Changing your plan',
    paragraphs: [
      'You can add or remove seats, warehouses and apps at any time. A change starts right away. When you add something you pay only for the days left in the period, and you see the exact amount before you confirm.',
      'When you remove something, the unused part becomes credit on your account. Credit comes off your next bills. It is not paid out as money.',
      'A day that has started counts as used. When you add something, you pay for the day you add it and for each day left. When you remove something, the credit is for the full days left. So adding a seat and removing it on the same day costs one day.',
    ],
  },
  {
    heading: 'Canceling, pausing and refunds',
    paragraphs: [
      'You can cancel in Billing at any time, in two clicks. You do not need to call or write to us.',
      BILLING_POLICY.refund,
      `A monthly plan can pause for ${pause[0]} to ${pause[pause.length - 1]} months instead. There are no bills while a plan is paused, and your apps are view only until it starts again.`,
      'After a plan ends, your apps are view only. Your data stays, and you can still open, read and export it.',
    ],
  },
  {
    heading: 'Late payments',
    paragraphs: [
      `If a payment fails, we email the owners and billing managers and try the card again. Your apps stay fully open for ${CATALOG.graceDays} days while you fix the card. After that they are view only until the bill is paid. Nothing is deleted.`,
    ],
  },
  {
    heading: 'Taxes',
    paragraphs: [
      'Prices do not include sales tax. If sales tax applies where you are, it is added at checkout and shown as its own line on the review screen and on every invoice.',
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

export const PRIVACY_INTRO =
  'This policy explains what information KitStak collects when your team uses the product, how it is used and protected, and the choices you have.';

export const PRIVACY_SECTIONS: readonly LegalSection[] = [
  {
    heading: 'Information we collect',
    paragraphs: [
      'Account data you give us: your name, work email address, password (stored only as a salted hash) and the organization you create or join.',
      'Workspace content your team stores in KitStak: boards, items, updates, files, dashboards and automations. This content belongs to your organization.',
      'Service data generated as you use the product: sign-in events, security audit records, device and browser type, and request logs used to keep the service reliable and secure.',
    ],
  },
  {
    heading: 'Payments and billing data',
    paragraphs: [
      BILLING_POLICY.payments,
      'We keep what Billing needs to show you: the card brand, its last four digits and its expiry date, your invoices, and the billing details you enter (company name, billing email, address and tax ID).',
      'We keep a record of billing activity, such as plan changes and payments, so owners and billing managers can see who did what and when.',
    ],
  },
  {
    heading: 'How we use information',
    paragraphs: [
      'We use account and service data to provide, secure and support KitStak, to authenticate you, to send notifications you have enabled, and to detect abuse.',
      'We send billing emails, such as receipts, trial reminders and payment problems, to the owners and billing managers of an organization.',
      'We do not sell personal information and we do not use workspace content for advertising or to train models.',
    ],
  },
  {
    heading: 'Sharing',
    paragraphs: [
      'Workspace content is visible to members of your organization according to the board, workspace and role permissions your administrators configure.',
      'We share data with infrastructure sub-processors (hosting, email delivery, payment processing, error monitoring) only as needed to run the service and under written data-protection terms.',
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
      'When a trial or a plan ends, your data is kept and your apps become view only, so you can come back or export it.',
    ],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      'Depending on where you live you may have the right to access, correct, export or delete your personal information, and to object to certain processing. Contact your organization administrator or privacy@kitstak.app to exercise these rights.',
    ],
  },
];
