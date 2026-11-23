/**
 * The email contract (docs/billing/CONTRACTS.md section 13.1). PURE. Foundation queues these with
 * `enqueueEmail`; the lifecycle lane renders and sends them. All dates in payloads are ISO strings.
 */
import type { BillingInterval, Stack } from './catalog';

export type EmailTemplateId =
  | 'verify_email'
  | 'reset_password'
  | 'invitation'
  | 'welcome'
  | 'trial_ending'
  | 'trial_ended'
  | 'plan_started'
  | 'receipt'
  | 'payment_failed'
  | 'payment_action_required'
  | 'grace_ending'
  | 'cancel_scheduled'
  | 'paused'
  | 'plan_ended';

export const EMAIL_TEMPLATE_IDS: readonly EmailTemplateId[] = [
  'verify_email',
  'reset_password',
  'invitation',
  'welcome',
  'trial_ending',
  'trial_ended',
  'plan_started',
  'receipt',
  'payment_failed',
  'payment_action_required',
  'grace_ending',
  'cancel_scheduled',
  'paused',
  'plan_ended',
];

interface Base {
  readonly orgName: string;
  readonly portalUrl: string;
}

export interface EmailPayloads {
  verify_email: { readonly code: string; readonly minutes: number };
  reset_password: { readonly code: string; readonly minutes: number };
  invitation: Base & { readonly inviterName: string; readonly acceptUrl: string; readonly expiresAt: string };
  welcome: Base & { readonly firstName: string; readonly products: Stack; readonly trialEndsAt: string };
  trial_ending: Base & {
    readonly daysLeft: 7 | 3 | 1;
    readonly trialEndsAt: string;
    readonly totalCents: number;
    readonly interval: BillingInterval;
    readonly products: Stack;
  };
  trial_ended: Base & { readonly trialEndedAt: string; readonly products: Stack };
  plan_started: Base & {
    readonly products: Stack;
    readonly totalCents: number;
    readonly interval: BillingInterval;
    readonly firstChargeAt: string;
    readonly dueTodayCents: number;
  };
  receipt: Base & {
    readonly invoiceId: string;
    readonly invoiceNumber: string | null;
    readonly amountPaidCents: number;
    readonly taxCents: number;
    readonly paidAt: string;
    readonly last4: string | null;
    readonly lines: readonly { description: string; amountCents: number }[];
    readonly nextChargeAt: string | null;
  };
  payment_failed: Base & {
    readonly amountDueCents: number;
    readonly last4: string | null;
    readonly nextRetryAt: string | null;
    readonly accessChangesAt: string;
    readonly attempt: number;
  };
  payment_action_required: Base & { readonly amountDueCents: number; readonly last4: string | null };
  grace_ending: Base & { readonly amountDueCents: number; readonly accessChangesAt: string };
  cancel_scheduled: Base & { readonly endsAt: string };
  paused: Base & { readonly startsAt: string; readonly resumesAt: string };
  plan_ended: Base & { readonly endedAt: string };
}
