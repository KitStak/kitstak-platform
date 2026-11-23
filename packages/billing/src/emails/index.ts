/**
 * @kitstak/billing/emails: render and send KitStak's transactional email (docs/billing/CONTRACTS.md
 * section 13.2). Server only. Resend when its key is set, a dev outbox outside production when it is
 * not, and in production with no key the mail stays queued.
 */
export { renderEmail, emailContent, emailAuditSummary, isEmailTemplateId, EmailPayloadError, CODE_TEMPLATES } from './render';
export type { RenderedEmail, EmailContent, EmailBlock, EmailButton } from './layout';
export { resolveEmailProvider, type EmailProvider } from './provider';
export {
  deliverQueuedEmails,
  getOutboxEmail,
  listOutbox,
  outboxHealth,
  MAX_EMAIL_ATTEMPTS,
  type DeliverOptions,
  type OutboxRow,
} from './deliver';
export { sendEmailNow } from './send';
export { SAMPLE_EMAIL_PAYLOADS } from './samples';
