/**
 * `renderEmail`: one template id and its payload in, the subject, HTML and text out
 * (docs/billing/CONTRACTS.md section 13.2). Templates are plain functions. No React, no dependency.
 */
import type { EmailPayloads, EmailTemplateId } from '../email-types';
import { EMAIL_TEMPLATE_IDS } from '../email-types';
import { renderContent, type EmailContent, type RenderedEmail } from './layout';
import { invitation, resetPassword, verifyEmail } from './templates/account';
import { graceEnding, paymentActionRequired, paymentFailed, receipt } from './templates/payment';
import { cancelScheduled, paused, planEnded, planStarted } from './templates/plan';
import { trialEnded, trialEnding, welcome } from './templates/trial';

export type { RenderedEmail } from './layout';
export { EmailPayloadError } from './templates/shared';

const TEMPLATES: Readonly<Record<EmailTemplateId, (payload: unknown) => EmailContent>> = {
  verify_email: verifyEmail,
  reset_password: resetPassword,
  invitation,
  welcome,
  trial_ending: trialEnding,
  trial_ended: trialEnded,
  plan_started: planStarted,
  receipt,
  payment_failed: paymentFailed,
  payment_action_required: paymentActionRequired,
  grace_ending: graceEnding,
  cancel_scheduled: cancelScheduled,
  paused,
  plan_ended: planEnded,
};

export function isEmailTemplateId(value: unknown): value is EmailTemplateId {
  return typeof value === 'string' && (EMAIL_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** The content blocks of an email, before layout. Tests and the copy rules read these. */
export function emailContent<T extends EmailTemplateId>(template: T, payload: EmailPayloads[T]): EmailContent {
  return TEMPLATES[template](payload);
}

export function renderEmail<T extends EmailTemplateId>(template: T, payload: EmailPayloads[T]): RenderedEmail {
  return renderContent(emailContent(template, payload));
}

/** Templates that carry a secret code. Their payload is wiped once the email has gone out. */
export const CODE_TEMPLATES: readonly EmailTemplateId[] = ['verify_email', 'reset_password'];

const AUDIT_WORDS: Readonly<Record<EmailTemplateId, string | null>> = {
  // Codes are personal and belong to no organization. They are never written to the activity log.
  verify_email: null,
  reset_password: null,
  invitation: 'an invite',
  welcome: 'a welcome note',
  trial_ending: 'a trial reminder',
  trial_ended: 'a trial ended notice',
  plan_started: 'a plan confirmation',
  receipt: 'a receipt',
  payment_failed: 'a failed payment notice',
  payment_action_required: 'a bank approval request',
  grace_ending: 'a last day reminder',
  cancel_scheduled: 'a cancel confirmation',
  paused: 'a pause confirmation',
  plan_ended: 'a plan ended notice',
};

/** 'We emailed a receipt to billing@northwind.example.' or null when nothing should be logged. */
export function emailAuditSummary(template: EmailTemplateId, to: string): string | null {
  const words = AUDIT_WORDS[template];
  return words === null ? null : `We emailed ${words} to ${to}.`;
}
