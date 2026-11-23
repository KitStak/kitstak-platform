import { describe, expect, it } from 'vitest';
import { BILLING_ERROR_COPY, billingError, billingOk } from './errors';
import { billingLink } from './links';

describe('billingLink', () => {
  const portal = 'https://kitstak.app/';

  it.each([
    [{ to: 'home' } as const, '/billing'],
    [{ to: 'plan' } as const, '/billing/plan'],
    [{ to: 'add', product: 'wms' } as const, '/billing/plan?add=wms'],
    [{ to: 'checkout' } as const, '/billing/checkout'],
    [{ to: 'fix_payment' } as const, '/billing?fix=payment'],
    [{ to: 'seats', seats: 6 } as const, '/billing/plan?seats=6'],
    [{ to: 'seats' } as const, '/billing/plan?focus=seats'],
    [{ to: 'warehouses', warehouses: 2 } as const, '/billing/plan?warehouses=2'],
    [{ to: 'warehouses' } as const, '/billing/plan?focus=warehouses'],
    [{ to: 'invoices' } as const, '/billing/invoices'],
    [{ to: 'cancel' } as const, '/billing/cancel'],
    [{ to: 'activity' } as const, '/billing/activity'],
  ])('%o goes to %s', (intent, path) => {
    expect(billingLink(portal, intent)).toBe(`https://kitstak.app${path}`);
  });

  it('adds the calling app so the portal can offer a way back', () => {
    expect(billingLink('http://localhost:3300', { to: 'add', product: 'wms' }, 'crm')).toBe(
      'http://localhost:3300/billing/plan?add=wms&from=crm',
    );
    expect(billingLink('http://localhost:3300', { to: 'home' }, 'pulse')).toBe('http://localhost:3300/billing?from=pulse');
  });

  it('never puts a junk number in a link', () => {
    expect(billingLink(portal, { to: 'seats', seats: -3 })).toBe('https://kitstak.app/billing/plan?seats=1');
    expect(billingLink(portal, { to: 'seats', seats: Number.NaN })).toBe('https://kitstak.app/billing/plan?focus=seats');
  });
});

describe('billing errors', () => {
  it('has a plain sentence for every code, with no dash characters', () => {
    for (const [code, message] of Object.entries(BILLING_ERROR_COPY)) {
      expect(message.length, code).toBeGreaterThan(5);
      expect(message, code).not.toMatch(/[\u2013\u2014]|-{2}/);
      for (const sentence of message.split(/(?<=[.?!])\s+/)) {
        expect(sentence.split(/\s+/).length, `${code}: ${sentence}`).toBeLessThanOrEqual(20);
      }
    }
  });

  it('builds results', () => {
    expect(billingError('trial_used')).toEqual({
      ok: false,
      error: { code: 'trial_used', message: 'You already used your free trial. You can still pick a plan.' },
    });
    expect(billingError('below_usage', 'You have 6 people. Pick 6 seats or more.').error.message).toBe(
      'You have 6 people. Pick 6 seats or more.',
    );
    expect(billingOk(3)).toEqual({ ok: true, data: 3 });
  });
});
