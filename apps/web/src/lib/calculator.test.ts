import { describe, expect, test } from 'vitest';
import { LINKS, LOCAL_DEV_ORIGINS, PRODUCTION_ORIGINS, pricingHref, resolveAppOrigins } from '@/components/site-links';
import { CALCULATOR_START, selectionFromSearch } from './calculator';
import { formatMoney, quote } from './pricing';

describe('the cart the calculator opens with', () => {
  test('is the cart sign-up leads with: CRM for five and one warehouse, monthly', () => {
    expect(CALCULATOR_START).toEqual({ products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' });
    expect(formatMoney(quote(CALCULATOR_START).totalCents)).toBe('$395.20');
  });
});

describe('selectionFromSearch', () => {
  test('leaves the cart alone when the link carries nothing', () => {
    expect(selectionFromSearch('', CALCULATOR_START)).toEqual(CALCULATOR_START);
    expect(selectionFromSearch('?utm_source=mail', CALCULATOR_START)).toEqual(CALCULATOR_START);
  });

  test('reads a whole cart from a link', () => {
    expect(selectionFromSearch('?stack=projects,pulse&seats=12&warehouses=3&billing=yearly', CALCULATOR_START)).toEqual({
      products: ['projects', 'pulse'],
      seats: 12,
      warehouses: 3,
      interval: 'yearly',
    });
  });

  test('reads the old word for yearly', () => {
    expect(selectionFromSearch('?billing=annual', CALCULATOR_START).interval).toBe('yearly');
  });

  test('reads a link made by pricingHref', () => {
    const search = new URL(pricingHref('wms'), 'https://kitstak.com').search;

    expect(selectionFromSearch(search, CALCULATOR_START).products).toEqual(['wms']);
  });

  test('drops junk and clamps numbers to the catalog limits', () => {
    const read = selectionFromSearch('?stack=erp,crm&seats=99999&warehouses=-2&billing=weekly', CALCULATOR_START);

    expect(read).toEqual({ products: ['crm'], seats: 500, warehouses: 1, interval: 'monthly' });
    expect(selectionFromSearch('?seats=lots&warehouses=1e3', CALCULATOR_START)).toEqual(CALCULATOR_START);
    expect(selectionFromSearch('?seats=0', CALCULATOR_START).seats).toBe(1);
    expect(selectionFromSearch('?stack=nothing', CALCULATOR_START).products).toEqual(CALCULATOR_START.products);
  });
});

describe('pricingHref', () => {
  test('links to the calculator, with products switched on when asked', () => {
    expect(pricingHref()).toBe('/pricing#calculator');
    expect(pricingHref('crm')).toBe('/pricing?stack=crm#calculator');
    expect(pricingHref(['projects', 'crm'])).toBe('/pricing?stack=crm,projects#calculator');
  });
});

describe('app origins', () => {
  test('a production build uses the real domains', () => {
    expect(resolveAppOrigins({})).toEqual({
      portal: 'https://kitstak.app',
      crm: 'https://crm.kitstak.app',
      wms: 'https://wms.kitstak.app',
      projects: 'https://projects.kitstak.app',
      pulse: 'https://pulse.kitstak.app',
    });
    // Tests run like a production build: no variable set, not `next dev`.
    expect(LINKS.portal).toBe('https://kitstak.app');
  });

  test('NEXT_PUBLIC_PORTAL_URL moves the hand-off, with or without a trailing slash', () => {
    expect(resolveAppOrigins({ portal: 'https://staging.kitstak.app/' }).portal).toBe('https://staging.kitstak.app');
    expect(resolveAppOrigins({ portal: 'http://localhost:3300' }).portal).toBe('http://localhost:3300');
  });

  test('a blank or broken value falls back, so a link is never empty', () => {
    expect(resolveAppOrigins({ portal: '' }).portal).toBe('https://kitstak.app');
    expect(resolveAppOrigins({ portal: '   ' }).portal).toBe('https://kitstak.app');
    expect(resolveAppOrigins({ portal: 'kitstak.app' }).portal).toBe('https://kitstak.app');
    expect(resolveAppOrigins({ portal: 'javascript:alert(1)' }).portal).toBe('https://kitstak.app');
  });

  test('next dev hands off to the local portal with no setup, unless a variable says otherwise', () => {
    expect(resolveAppOrigins({}, LOCAL_DEV_ORIGINS)).toEqual({
      portal: 'http://localhost:3300',
      crm: 'http://localhost:3100',
      wms: 'http://localhost:3000',
      projects: 'http://localhost:3400',
      pulse: 'http://localhost:3500',
    });
    expect(resolveAppOrigins({ portal: 'https://kitstak.app' }, LOCAL_DEV_ORIGINS).portal).toBe(
      'https://kitstak.app',
    );
    expect(resolveAppOrigins({}, PRODUCTION_ORIGINS)).toEqual(PRODUCTION_ORIGINS);
  });
});
