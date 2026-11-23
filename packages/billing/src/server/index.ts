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
  getBillingAccess,
  listBillingHolders,
  removeBillingManager,
  type BillingAccess,
  type BillingManagerRow,
} from './access';
export { canStartTrial, changeTrialProducts, startTrial } from './trial';
export { getCart, saveCart } from './cart';
export { checkoutPreview, createCheckout, syncCheckoutSession } from './checkout';
export { applyPlanChange, previewPlanChange } from './changes';
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
export { listAuditLog, recordAudit, type AuditAction, type AuditEntry, type AuditRow } from './audit';
export { billingRecipients, enqueueEmail, enqueueForBillingRecipients } from './outbox';
export { enforceRateLimit } from './rate-limit';
export { completeSignupIntent, getOpenSignupIntent, upsertSignupIntent, type SignupIntent } from './intents';
export { processWebhook, type WebhookOutcome } from './webhook';
export { applyInvoiceSnapshot, applySubscriptionSnapshot, clearBillingCaches, refreshFromGateway } from './sync';
export { billingOrganizationOptions } from './auth-hooks';
export type { ChangePreview, GatewayInvoice, GatewayInvoiceLine, GatewaySubscription } from '../gateway/types';
export type { PlanState } from '../plan-state';
export type { BillingResult } from '../errors';
