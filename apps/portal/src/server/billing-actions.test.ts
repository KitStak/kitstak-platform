/**
 * The stale tab rule (review round 2): a billing page made for organization A, pressed after the
 * person switched to organization B in another tab, is refused and nothing is written.
 *
 * Every exported action of `billing-actions.ts` is called here with the id of A while the session's
 * active organization is B. The list is read from the module, so an action added later without the
 * rule fails this test. The test gateway page actions are left out by name: they are tied to a pay
 * page (the organization on the checkout document), not to the active organization.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

/** Anything that would read or write for the active organization. None of it may run. */
const used = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('next/cache', () => ({ revalidatePath: () => used.calls.push('revalidatePath') }));
vi.mock('@/server/session', () => ({ getSession: async () => ({ user: { id: 'user-1', email: 'maya@example.com', name: 'Maya Chen' }, session: {} }) }));
vi.mock('@/server/orgs', () => ({ isActiveOrgMember: async () => true }));
vi.mock('@/server/billing/runtime', () => ({
  billingRuntime: () => new Proxy({}, { get: (_t, key) => (key === 'mode' ? 'test_gateway' : used.calls.push(`runtime.${String(key)}`)) }),
}));
vi.mock('@/server/billing/context', () => ({
  getBillingContext: async () => ({
    // The session's active organization is B, with every right there is.
    org: { id: ORG_B, name: 'Org B', slug: 'org-b', role: 'owner' },
    rt: new Proxy({ mode: 'test_gateway' }, { get: (target, key) => (key in target ? (target as Record<string | symbol, unknown>)[key] : used.calls.push(`rt.${String(key)}`)) }),
    session: { user: { id: 'user-1', email: 'maya@example.com', name: 'Maya Chen' } },
    access: { isOwner: true, isAdmin: false, isBillingManager: false, canView: true, canManage: true, canStartTrial: true, canAssignManagers: true, ownerName: 'Maya Chen' },
    actor: { userId: 'user-1', label: 'Maya Chen' },
    emailVerified: true,
    timeZone: 'UTC',
  }),
}));
vi.mock('@kitstak/billing/server', async (original) => {
  const real = await original<Record<string, unknown>>();
  const spied: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(real)) {
    spied[name] = typeof value === 'function' ? (...args: unknown[]) => (used.calls.push(name), (value as (...a: unknown[]) => unknown)(...args)) : value;
  }
  return spied;
});
vi.mock('@kitstak/billing/gateway/test', async (original) => {
  const real = await original<Record<string, unknown>>();
  const spied: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(real)) {
    spied[name] = typeof value === 'function' ? (...args: unknown[]) => (used.calls.push(name), (value as (...a: unknown[]) => unknown)(...args)) : value;
  }
  return spied;
});

import * as actions from './billing-actions';
import { sameOrganization } from './billing/org-scope';

/** Tied to the organization of a pay page document, checked by membership of that organization. */
const PAY_PAGE_ACTIONS = new Set(['testCompleteCheckoutAction', 'testApplyPromoAction', 'testCancelCheckoutAction', 'testCompleteCardUpdateAction']);

const SELECTION = { products: ['crm'], seats: 5, warehouses: 1, interval: 'monthly' } as const;
/** A valid input for each action, so a refusal can only come from the organization check. */
const INPUT: Record<string, unknown> = {
  startTrialAction: { selection: SELECTION },
  changeTrialProductsAction: { products: ['crm'] },
  saveCartAction: { selection: SELECTION },
  saveCartDraftAction: { selection: SELECTION },
  startCheckoutAction: { selection: SELECTION },
  previewPlanChangeAction: { selection: SELECTION },
  confirmPlanChangeAction: { selection: SELECTION, basis: 'a-basis-from-a-preview', expectedDueTodayCents: 0 },
  cancelPlanAction: { reason: null, detail: null },
  pausePlanAction: { months: 1, reason: null },
  updateBillingDetailsAction: { billingEmail: null, companyName: 'STALE TAB COMPANY A', address: {}, taxIdType: null, taxIdValue: null },
  addBillingManagerAction: { userId: 'user-2' },
  removeBillingManagerAction: { userId: 'user-2' },
  inviteBillingManagerAction: { email: 'books@example.com' },
  cancelBillingInviteAction: { invitationId: 'inv-1' },
  testShiftTimeAction: { days: 1 },
};

type Action = (renderedOrgId: string | null | undefined, input?: unknown) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
const scopedActions = Object.entries(actions).filter(([name, value]) => typeof value === 'function' && !PAY_PAGE_ACTIONS.has(name)) as [string, Action][];

beforeEach(() => {
  used.calls.length = 0;
});

describe('billing actions from a stale tab', () => {
  it('covers every action that runs for the active organization', () => {
    expect(scopedActions.map(([name]) => name).sort()).toEqual(
      expect.arrayContaining([
        'addBillingManagerAction',
        'cancelPlanAction',
        'changeTrialProductsAction',
        'confirmPlanChangeAction',
        'keepPlanAction',
        'openCardUpdateAction',
        'pausePlanAction',
        'previewPlanChangeAction',
        'removeBillingManagerAction',
        'retryPaymentAction',
        'saveCartAction',
        'saveCartDraftAction',
        'startCheckoutAction',
        'startTrialAction',
        'testFailNextPaymentAction',
        'testRunDueAction',
        'testShiftTimeAction',
        'undoPauseAction',
        'updateBillingDetailsAction',
      ]),
    );
  });

  it.each(scopedActions)('%s: rendered for A, active is B: refused, nothing read or written', async (name, action) => {
    const result = await action(ORG_A, INPUT[name]);
    expect(result).toEqual({ ok: false, error: { code: 'org_changed', message: 'You switched organizations. Reload this page.' } });
    expect(used.calls).toEqual([]);
  });

  it.each(scopedActions)('%s: a page that sends no organization at all is refused the same way', async (name, action) => {
    for (const missing of [null, undefined, '', 42 as unknown as string, { id: ORG_B } as unknown as string]) {
      const result = await action(missing, INPUT[name]);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('org_changed');
    }
    expect(used.calls).toEqual([]);
  });

  it('the id from the browser is only compared: a page made for B goes on to the real work for B', async () => {
    // The package call runs (and fails on the fake database). What matters: it was reached for B.
    const result = await actions.updateBillingDetailsAction(ORG_B, INPUT.updateBillingDetailsAction as never);
    expect(result.ok ? 'ok' : result.error.code).not.toBe('org_changed');
    expect(used.calls).toContain('updateBillingProfile');
  });

  it('sameOrganization is exact', () => {
    expect(sameOrganization(ORG_A, ORG_A)).toBe(true);
    expect(sameOrganization(ORG_A, ORG_B)).toBe(false);
    expect(sameOrganization(` ${ORG_A}`, ORG_A)).toBe(false);
    expect(sameOrganization(null, ORG_A)).toBe(false);
    expect(sameOrganization(undefined, ORG_A)).toBe(false);
  });
});
