/**
 * @kitstak/mail: KitStak's platform mail transport. Server only.
 *
 * Env (every app that sends mail): RESEND_API_KEY, EMAIL_FROM (a sender on a domain verified in
 * Resend), optional EMAIL_REPLY_TO and EMAIL_PROVIDER. See `resolveEmailProvider` for the table.
 */
export {
  resolveEmailProvider,
  resendReady,
  sendWithResend,
  idempotencyKeyFor,
  type EmailProvider,
  type FetchLike,
  type MailMessage,
  type SendOptions,
  type SendResult,
} from './resend';
export {
  emailDue,
  inQuietHours,
  localClock,
  renderNotificationEmail,
  MAX_LINES as MAX_NOTIFICATION_LINES,
  type EmailFrequency,
  type EmailDueInput,
  type NotificationEmailInput,
  type NotificationLine,
  type QuietHours,
} from './notifications';
