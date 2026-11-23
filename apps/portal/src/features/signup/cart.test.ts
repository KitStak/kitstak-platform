import { describe, expect, test } from 'vitest';
import { handoffQuery, handoffRecord, hasHandoff, readHandoff, trialSummary, withHandoff } from './cart';

const LINK = {
  products: 'crm,wms',
  seats: '5',
  warehouses: '1',
  billing: 'monthly',
  businessType: '3pl',
  teamSize: 'small',
  startMode: 'fresh',
  src: 'wizard',
};

describe('readHandoff', () => {
  test('reads a cart from a record and from URLSearchParams the same way', () => {
    const fromRecord = readHandoff(LINK);
    const fromParams = readHandoff(new URLSearchParams(LINK));
    expect(fromRecord).toEqual(fromParams);
    expect(fromRecord.selection).toEqual({ products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' });
    expect(fromRecord.profile).toEqual({ businessType: '3pl', teamSize: 'small', startMode: 'fresh' });
    expect(fromRecord.source).toBe('wizard');
  });

  test('drops what it does not know and clamps what is too big', () => {
    const handoff = readHandoff({ products: 'crm,erp,<script>', seats: '999999', warehouses: '-4', billing: 'weekly', price: '1' });
    expect(handoff.selection).toEqual({ products: ['crm'], seats: 500, warehouses: 1, interval: 'monthly' });
    expect(handoffRecord(handoff)).not.toHaveProperty('price');
  });

  test('a link with nothing in it carries no handoff', () => {
    const empty = readHandoff({});
    expect(hasHandoff(empty)).toBe(false);
    expect(handoffRecord(empty)).toEqual({});
    expect(handoffQuery(empty)).toBe('');
    expect(trialSummary(empty)).toBeNull();
  });
});

describe('withHandoff', () => {
  test('keeps the cart when moving between sign up and sign in', () => {
    const handoff = readHandoff(LINK);
    const href = withHandoff('/login', handoff);
    expect(href.startsWith('/login?')).toBe(true);
    expect(readHandoff(new URLSearchParams(href.split('?')[1]))).toEqual(handoff);
  });

  test('adds nothing when there is no cart', () => {
    expect(withHandoff('/login', readHandoff({}))).toBe('/login');
    expect(withHandoff('/login', readHandoff({}), { next: '/billing' })).toBe('/login?next=%2Fbilling');
  });

  test('never carries a name, an email or a price in the query', () => {
    const href = withHandoff('/signup', readHandoff({ ...LINK, name: 'Maya', email: 'maya@x.example', total: '1' }));
    expect(href).not.toMatch(/name=|email=|total=/);
  });
});

describe('trialSummary', () => {
  test('prices the reference cart from the one catalog', () => {
    const summary = trialSummary(readHandoff(LINK));
    expect(summary?.products).toEqual(['crm', 'wms']);
    expect(summary?.quote.totalCents).toBe(39520);
    expect(summary?.thenLine).toBe('Then $395.20 per month if you add a card.');
    expect(summary?.monthlyLine).toBeNull();
  });

  test('a yearly cart shows the year and the per month view', () => {
    const summary = trialSummary(readHandoff({ ...LINK, billing: 'yearly' }));
    expect(summary?.thenLine).toBe('Then $4,031.04 per year if you add a card.');
    expect(summary?.monthlyLine).toBe('That is $335.92 per month.');
  });

  test('Pulse alone is the flat price', () => {
    expect(trialSummary(readHandoff({ products: 'pulse' }))?.thenLine).toBe('Then $29.00 per month if you add a card.');
  });
});
