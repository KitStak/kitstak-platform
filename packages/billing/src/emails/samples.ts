/**
 * One real looking payload per template. The render test, the copy rules test and the template
 * gallery on the dev outbox page all use these, so every template is always exercised.
 */
import type { EmailPayloads, EmailTemplateId } from '../email-types';

const base = { orgName: 'Northwind Robotics', portalUrl: 'http://localhost:3300' } as const;

export const SAMPLE_EMAIL_PAYLOADS: { readonly [T in EmailTemplateId]: EmailPayloads[T] } = {
  verify_email: { code: '482913', minutes: 10 },
  reset_password: { code: '715204', minutes: 10 },
  invitation: {
    ...base,
    inviterName: 'Maya Chen',
    acceptUrl: 'http://localhost:3300/invite/inv_sample',
    expiresAt: '2026-12-07T15:00:00.000Z',
  },
  welcome: { ...base, firstName: 'Maya', products: ['crm', 'wms'], trialEndsAt: '2026-12-07T15:00:00.000Z' },
  trial_ending: {
    ...base,
    daysLeft: 3,
    trialEndsAt: '2026-12-07T15:00:00.000Z',
    totalCents: 39520,
    interval: 'monthly',
    products: ['crm', 'wms'],
  },
  trial_ended: { ...base, trialEndedAt: '2026-12-07T15:00:00.000Z', products: ['crm', 'wms'] },
  plan_started: {
    ...base,
    products: ['crm', 'wms'],
    totalCents: 39520,
    interval: 'monthly',
    firstChargeAt: '2026-12-07T15:00:00.000Z',
    dueTodayCents: 0,
  },
  receipt: {
    ...base,
    invoiceId: 'in_test_sample',
    invoiceNumber: 'KS-0001',
    amountPaidCents: 39520,
    taxCents: 0,
    paidAt: '2026-12-07T15:00:00.000Z',
    last4: '4242',
    lines: [
      { description: 'KitStak CRM, 5 users', amountCents: 11600 },
      { description: 'KitStak WMS, 1 warehouse', amountCents: 27920 },
    ],
    nextChargeAt: '2027-01-07T15:00:00.000Z',
  },
  payment_failed: {
    ...base,
    amountDueCents: 39520,
    last4: '4242',
    nextRetryAt: '2026-12-10T15:00:00.000Z',
    accessChangesAt: '2026-12-14T15:00:00.000Z',
    attempt: 1,
    asOf: '2026-12-07T15:00:00.000Z',
  },
  payment_action_required: { ...base, amountDueCents: 39520, last4: '4242' },
  grace_ending: { ...base, amountDueCents: 39520, accessChangesAt: '2026-12-14T15:00:00.000Z', asOf: '2026-12-13T15:00:00.000Z' },
  cancel_scheduled: { ...base, endsAt: '2026-12-23T15:00:00.000Z' },
  paused: { ...base, startsAt: '2026-12-23T15:00:00.000Z', resumesAt: '2027-02-23T15:00:00.000Z' },
  plan_ended: { ...base, endedAt: '2026-12-23T15:00:00.000Z', reason: 'canceled' },
  app_request: { ...base, askerName: 'Sofia Ramirez', product: 'projects', priceLine: 'It adds $28.80 per month.' },
};
