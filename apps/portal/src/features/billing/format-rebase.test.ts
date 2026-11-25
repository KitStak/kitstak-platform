import { describe, expect, test } from 'vitest';
import type { PlanSelection } from '@kitstak/billing/catalog';
import { quote } from '@kitstak/billing/quote';
import { describeChange, pickerPriceWords, planToShow, rebaseSelection, viewOnlyAsk, viewOnlyFix } from './format';

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

describe('viewOnlyAsk: a person who cannot pay reads who to ask (review round 4)', () => {
  test('one ask per state, the same as the plan banner for an admin', () => {
    expect(viewOnlyAsk('unpaid', 'Maya Chen')).toBe('Ask Maya Chen to update the card.');
    expect(viewOnlyAsk('paused', 'Maya Chen')).toBe('Ask Maya Chen to start the plan again.');
    expect(viewOnlyAsk('trial_ended', 'your organization owner')).toBe('Ask your organization owner to pick a plan.');
    expect(viewOnlyAsk('ended', 'Maya Chen')).toBe('Ask Maya Chen to pick a plan.');
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

describe('planToShow: billing home never shows a plan the team cannot buy (review round 5)', () => {
  const usage = (seatFloor: number, warehousesUsed: number | null = null) => ({ seatFloor, warehousesUsed });

  test('a trial that ended with 3 people and a cart of 2 seats shows 3 seats, at the price the picker opens with', () => {
    const cart = plan({ seats: 2 });
    const shown = planToShow({ phase: 'trial_ended', selection: cart, usage: usage(3) });
    expect(shown.seats).toBe(3);
    // CRM is $29 a seat: $87, not the $58 of the saved cart.
    expect(quote(shown).totalCents).toBe(8700);
    expect(quote(cart).totalCents).toBe(5800);
  });

  test('a running trial and a plan that ended follow the same rule, and open invites hold a seat', () => {
    expect(planToShow({ phase: 'trial', selection: plan({ seats: 1 }), usage: usage(4) }).seats).toBe(4);
    expect(planToShow({ phase: 'ended', selection: plan({ seats: 2 }), usage: usage(5) }).seats).toBe(5);
  });

  test('warehouses in use count too', () => {
    const shown = planToShow({ phase: 'trial', selection: plan({ products: ['wms'], seats: 1, warehouses: 1 }), usage: usage(1, 3) });
    expect(shown.warehouses).toBe(3);
  });

  test('a cart that already fits the team is returned as it is', () => {
    const cart = plan({ seats: 7 });
    expect(planToShow({ phase: 'trial', selection: cart, usage: usage(3) })).toBe(cart);
  });

  test('a paid plan is shown as it is billed, also with more people than seats', () => {
    const paid = plan({ seats: 2 });
    for (const phase of ['active', 'past_due', 'unpaid', 'cancel_scheduled', 'pause_scheduled', 'paused']) {
      expect(planToShow({ phase, selection: paid, usage: usage(3) })).toBe(paid);
    }
  });
});
