'use client';
/**
 * The billing actions as the screens call them (review round 2). Each one is the server action of
 * the same name from `@/server/billing-actions`, with the organization this tab's page was made for
 * sent along as the first argument. The server compares it with the session's active organization
 * and refuses a stale tab. Screens import from here, never from `@/server/billing-actions` directly
 * (the test gateway pages are the one exception: their actions are tied to a pay page, not to the
 * active organization).
 */
import {
  startTrialAction as startTrialActionServer,
  changeTrialProductsAction as changeTrialProductsActionServer,
  saveCartAction as saveCartActionServer,
  saveCartDraftAction as saveCartDraftActionServer,
  startCheckoutAction as startCheckoutActionServer,
  previewPlanChangeAction as previewPlanChangeActionServer,
  confirmPlanChangeAction as confirmPlanChangeActionServer,
  openCardUpdateAction as openCardUpdateActionServer,
  retryPaymentAction as retryPaymentActionServer,
  cancelPlanAction as cancelPlanActionServer,
  keepPlanAction as keepPlanActionServer,
  pausePlanAction as pausePlanActionServer,
  undoPauseAction as undoPauseActionServer,
  updateBillingDetailsAction as updateBillingDetailsActionServer,
  addBillingManagerAction as addBillingManagerActionServer,
  removeBillingManagerAction as removeBillingManagerActionServer,
  inviteBillingManagerAction as inviteBillingManagerActionServer,
  cancelBillingInviteAction as cancelBillingInviteActionServer,
  testShiftTimeAction as testShiftTimeActionServer,
  testFailNextPaymentAction as testFailNextPaymentActionServer,
  testRunDueAction as testRunDueActionServer,
} from '@/server/billing-actions';
import { renderedOrgId } from './org-scope';

function scoped<A extends unknown[], R>(action: (orgId: string | null, ...args: A) => R): (...args: A) => R {
  return (...args: A) => action(renderedOrgId(), ...args);
}

export const startTrialAction = scoped(startTrialActionServer);
export const changeTrialProductsAction = scoped(changeTrialProductsActionServer);
export const saveCartAction = scoped(saveCartActionServer);
export const saveCartDraftAction = scoped(saveCartDraftActionServer);
export const startCheckoutAction = scoped(startCheckoutActionServer);
export const previewPlanChangeAction = scoped(previewPlanChangeActionServer);
export const confirmPlanChangeAction = scoped(confirmPlanChangeActionServer);
export const openCardUpdateAction = scoped(openCardUpdateActionServer);
export const retryPaymentAction = scoped(retryPaymentActionServer);
export const cancelPlanAction = scoped(cancelPlanActionServer);
export const keepPlanAction = scoped(keepPlanActionServer);
export const pausePlanAction = scoped(pausePlanActionServer);
export const undoPauseAction = scoped(undoPauseActionServer);
export const updateBillingDetailsAction = scoped(updateBillingDetailsActionServer);
export const addBillingManagerAction = scoped(addBillingManagerActionServer);
export const removeBillingManagerAction = scoped(removeBillingManagerActionServer);
export const inviteBillingManagerAction = scoped(inviteBillingManagerActionServer);
export const cancelBillingInviteAction = scoped(cancelBillingInviteActionServer);
export const testShiftTimeAction = scoped(testShiftTimeActionServer);
export const testFailNextPaymentAction = scoped(testFailNextPaymentActionServer);
export const testRunDueAction = scoped(testRunDueActionServer);
