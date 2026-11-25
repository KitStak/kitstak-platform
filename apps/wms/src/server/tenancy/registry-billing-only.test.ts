import { describe, expect, it, vi } from 'vitest';

// The registry reads the database through other modules. Only its two pure helpers are tested here.
vi.mock('@/server/auth/entitlements', () => ({ wmsAccessForOrg: vi.fn() }));

import { billingOnlyOrg, isBillingOnlyMemberRole, type WmsOrgChoice } from './registry';

const choice = (orgId: string, memberRole: string, more: Partial<WmsOrgChoice> = {}): WmsOrgChoice => ({ orgId, name: `Org ${orgId}`, slug: `org-${orgId}`, memberRole, schemaName: 'wms_x', entitled: true, ...more });

describe('the billing only role in the WMS', () => {
  it('knows the role that only manages billing', () => {
    expect(isBillingOnlyMemberRole('billing')).toBe(true);
    expect(isBillingOnlyMemberRole(' Billing ')).toBe(true);
    // A member who also manages billing has a seat: not billing only.
    expect(isBillingOnlyMemberRole('member,billing')).toBe(false);
    expect(isBillingOnlyMemberRole('owner')).toBe(false);
    expect(isBillingOnlyMemberRole('')).toBe(false);
    expect(isBillingOnlyMemberRole(null)).toBe(false);
  });

  it('sends a person who only manages billing to the lock screen, never to the sign in form', () => {
    // Every organization of theirs is billing only.
    expect(billingOnlyOrg([choice('a', 'billing')], [null, null])?.orgId).toBe('a');
    expect(billingOnlyOrg([choice('a', 'billing'), choice('b', 'billing')], [null, 'b'])?.orgId).toBe('b');
  });

  it('leaves a person with a real seat somewhere alone, unless they asked for the billing only organization', () => {
    const mixed = [choice('a', 'billing'), choice('b', 'member')];
    expect(billingOnlyOrg(mixed, [null, null])).toBeNull();
    expect(billingOnlyOrg(mixed, [null, 'b'])).toBeNull();
    expect(billingOnlyOrg(mixed, ['a', null])?.orgId).toBe('a');
    expect(billingOnlyOrg([choice('b', 'admin')], [null, null])).toBeNull();
    expect(billingOnlyOrg([], [null, null])).toBeNull();
  });
});
