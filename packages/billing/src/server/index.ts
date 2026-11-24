/**
 * @kitstak/billing/server: everything that touches the database or a gateway (docs/billing/
 * CONTRACTS.md section 11). Never import this from client code or from the marketing site.
 *
 * This barrel never imports `gateway/stripe.ts`, so product apps that only read plan state do not
 * bundle the Stripe SDK. The portal passes `createStripeGateway` into `createBillingRuntime`.
 */
export { type BillingActor, type BillingDb, type BillingReadDb, type BillingRuntime, rows, SYSTEM_ACTOR } from './db';
export {
  billingMode,
  createGateway,
  resolveBillingConfig,
  type BillingConfig,
  type StripeGatewayFactory,
} from './config';
export { createBillingRuntime } from './runtime';
export { clearPlanCache, getAppPlanView, getPlanState, type AppPlanView } from './state';
export {
  addBillingManager,
  checkBillingInvite,
  getBillingAccess,
  listBillingHolders,
  listBillingInvites,
  removeBillingManager,
  type BillingAccess,
  type BillingInviteRow,
  type BillingManagerRow,
} from './access';
export { BILLING_ONLY_ROLE, hasBillingRole, isBillingOnlyRole } from './roles';
export { canStartTrial, changeTrialProducts, startTrial } from './trial';
export { getCart, saveCart, writeCart } from './cart';
export { checkoutPreview, createCheckout, syncCheckoutSession } from './checkout';
export { applyPlanChange, planBasis, previewPlanChange, type PlanChangePreview } from './changes';
export { pausePlan, resumePlan, scheduleCancel, undoCancel, undoPause, type CancelReason } from './cancel';
export { createPaymentUpdateSession, retryPayment } from './payment';
export { getInvoice, getInvoicePdf, listInvoices, type InvoiceRow } from './invoices';
export {
  getBillingProfile,
  updateBillingProfile,
  validateBillingProfile,
  type BillingAddress,
  type BillingProfile,
} from './profile';
export { checkSeatAvailable, checkWarehouseAvailable, countBillableSeats, countWarehouses } from './usage';
export { listAuditLog, recordAudit, recordAuditOnce, type AuditAction, type AuditEntry, type AuditRow } from './audit';
export { billingRecipients, enqueueEmail, enqueueForBillingRecipients } from './outbox';
export { enforceRateLimit } from './rate-limit';
export { completeSignupIntent, getOpenSignupIntent, upsertSignupIntent, type SignupIntent } from './intents';
export { processWebhook, type WebhookOutcome } from './webhook';
export { applyInvoiceSnapshot, applySubscriptionSnapshot, clearBillingCaches, refreshFromGateway } from './sync';
export { billingOrganizationOptions, INVITE_NEEDS_VERIFIED_EMAIL_SINCE, INVITES_PER_DAY } from './auth-hooks';
export { signInviteProof, verifyInviteProof } from './invite-proof';
export type { GatewayInvoice, GatewayInvoiceLine, GatewaySubscription, GatewayUpcoming } from '../gateway/types';
/** What the confirm panel works with: the gateway's preview plus the `basis` the server checks on confirm. */
export type { PlanChangePreview as ChangePreview } from './changes';
export type { PlanState } from '../plan-state';
export type { BillingResult } from '../errors';
