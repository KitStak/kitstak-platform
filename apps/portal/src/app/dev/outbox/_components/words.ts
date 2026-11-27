/** Plain names for the email templates, and how a row's status reads. PURE. */
import type { EmailTemplateId } from '@kitstak/billing/email-types';

export const TEMPLATE_LABELS: Readonly<Record<EmailTemplateId, string>> = {
  verify_email: 'Verify email code',
  reset_password: 'Password reset code',
  invitation: 'Invite',
  welcome: 'Welcome',
  trial_ending: 'Trial ending',
  trial_ended: 'Trial ended',
  plan_started: 'Plan started',
  receipt: 'Receipt',
  payment_failed: 'Payment failed',
  payment_action_required: 'Bank approval',
  grace_ending: 'Last day reminder',
  cancel_scheduled: 'Cancel set',
  paused: 'Pause set',
  plan_ended: 'Plan ended',
  app_request: 'Ask for an app',
};

export function templateLabel(template: string): string {
  return (TEMPLATE_LABELS as Readonly<Record<string, string>>)[template] ?? template;
}

export type StatusTone = 'success' | 'info' | 'danger' | 'neutral';

export function statusWords(status: string): { label: string; tone: StatusTone } {
  if (status === 'sent') return { label: 'Delivered here', tone: 'success' };
  if (status === 'queued') return { label: 'Waiting', tone: 'info' };
  if (status === 'failed') return { label: 'Failed', tone: 'danger' };
  return { label: 'Skipped', tone: 'neutral' };
}

/** 'Nov 23, 2026, 8:15 PM UTC'. The outbox has no viewer, so times are in UTC and say so. */
export function outboxTime(date: Date): string {
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${text} UTC`;
}

/** 'just now', '4 min ago', '3 hr ago', else the date. */
export function timeAgo(date: Date, now: Date): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return outboxTime(date);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hr ago`;
  return outboxTime(date);
}

/** The 6 digit code in a code email, read from the text body. null for every other email. */
export function codeIn(template: string, text: string | null): string | null {
  if (template !== 'verify_email' && template !== 'reset_password') return null;
  return /(?:^|\s)(\d{6})(?:\s|$)/.exec(text ?? '')?.[1] ?? null;
}
