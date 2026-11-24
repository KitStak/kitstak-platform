import { describe, expect, test } from 'vitest';
import type { PlanSelection } from '@kitstak/billing/catalog';
import { describeChange, pickerPriceWords, rebaseSelection, viewOnlyFix } from './format';

const plan = (over: Partial<PlanSelection> = {}): PlanSelection => ({ products: ['crm'], seats: 7, warehouses: 1, interval: 'monthly', ...over });

describe('rebaseSelection: a cart moved onto the plan as it is now', () => {
  test('a colleague added a seat while this person was switching to yearly: the seat is kept', () => {
    const base = plan();
    const cart = plan({ interval: 'yearly' });
    const fresh = plan({ seats: 8 });
    const rebased = rebaseSelection(base, fresh, cart);
    expect(rebased).toEqual(plan({ seats: 8, interval: 'yearly' }));
    // The title is built from the fresh plan, so it names all of what a confirm will do.
    expect(describeChange(fresh, rebased)).toBe('Switch to yearly');
    expect(describeChange(base, fresh)).toBe('Add 1 seat');
  });

  test('what this person changed themselves wins over the fresh plan', () => {
    const base = plan();
    const cart = plan({ seats: 5 });
    const fresh = plan({ seats: 8, interval: 'yearly' });
    expect(rebaseSelection(base, fresh, cart)).toEqual(plan({ seats: 5, interval: 'yearly' }));
  });

  test('apps: my add and my remove are kept, and an app somebody else added stays', () => {
    const base = plan({ products: ['crm', 'projects'] });
    const cart = plan({ products: ['crm', 'pulse'] });
    const fresh = plan({ products: ['crm', 'wms', 'projects'] });
    expect([...rebaseSelection(base, fresh, cart).products].sort()).toEqual(['crm', 'pulse', 'wms']);
  });

  test('nothing changed elsewhere: the cart stays as it is', () => {
    const base = plan();
    const cart = plan({ seats: 9, interval: 'yearly' });
    expect(rebaseSelection(base, base, cart)).toEqual(cart);
  });
});

describe('pickerPriceWords: both price lines of a row use one unit', () => {
  test('monthly', () => {
    expect(pickerPriceWords('crm', 'monthly', true)).toEqual({ list: '$29 per user each month', yours: '$23.20 per user each month' });
  });

  test('yearly is shown per month, billed yearly, never "each year" under "each month"', () => {
    expect(pickerPriceWords('crm', 'yearly', false)).toEqual({ list: '$29 per user each month', yours: '$24.65 per user each month, billed yearly' });
    expect(pickerPriceWords('crm', 'yearly', true).yours).toBe('$19.72 per user each month, billed yearly');
    for (const product of ['crm', 'wms', 'projects', 'pulse'] as const) {
      const words = pickerPriceWords(product, 'yearly', true);
      expect(words.list).toContain('each month');
      expect(words.yours).toContain('each month');
      expect(words.yours).not.toContain('each year');
    }
  });
});

describe('viewOnlyFix: the launcher names the same fix as the plan banner', () => {
  test('one fix per state', () => {
    expect(viewOnlyFix('trial_ended')).toBe('Pick a plan to make changes.');
    expect(viewOnlyFix('ended')).toBe('Pick a plan to make changes.');
    expect(viewOnlyFix('unpaid')).toBe('Update your card to make changes.');
    expect(viewOnlyFix('paused')).toBe('Start your plan again to make changes.');
  });
});
