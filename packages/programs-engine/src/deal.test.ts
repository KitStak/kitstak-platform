import { describe, expect, it } from 'vitest';
import { dealCallout, dealPrefill, dealValueToCents, isWonStage, monthlyFromDeal } from './deal';

describe('isWonStage (A12)', () => {
  it('E31 done flag first, then the word won', () => {
    expect(isWonStage({ isDone: true, name: 'Closed' })).toBe(true);
    expect(isWonStage({ isDone: null, name: 'Won' })).toBe(true);
    expect(isWonStage({ isDone: false, name: 'Won back later' })).toBe(false);
    expect(isWonStage({ isDone: null, name: 'Closed won' })).toBe(true);
  });
  it('A12 reads only the whole word won, so real CRM won stages with more words start a program', () => {
    expect(isWonStage({ isDone: null, name: 'Closed Won - Pending Signature' })).toBe(true);
    expect(isWonStage({ isDone: null, name: 'Won (expected start Jan)' })).toBe(true);
    expect(isWonStage({ name: 'Won, starts soon' })).toBe(true);
    expect(isWonStage({ name: 'Won back later' })).toBe(true);
    expect(isWonStage({ name: 'Deal won' })).toBe(true);
    expect(isWonStage({ name: "Deal's won" })).toBe(true);
    expect(isWonStage({ name: 'Won (signed)' })).toBe(true);
    expect(isWonStage({ name: 'WON' })).toBe(true);
  });
  it('A12 adds no other rule: labels with the whole word won are won unless the board flag says no', () => {
    // These read like not won, but A12 reads only the word. The board marks such a label not done.
    for (const name of ['Not won', 'Not yet won', 'Won?', 'Lost to Acme who won', "Won't renew", 'Won\u2019t renew']) {
      expect(isWonStage({ isDone: null, name })).toBe(true);
      expect(isWonStage({ isDone: false, name })).toBe(false);
    }
    expect(isWonStage({ isDone: true, name: 'Not won' })).toBe(true);
    expect(isWonStage({ isDone: null, name: 'Lost' })).toBe(false);
  });
  it('matches the whole word only, like the Postgres \\mwon\\M test', () => {
    expect(isWonStage({ name: 'Closed won' })).toBe(true);
    expect(isWonStage({ name: 'Closed-Won' })).toBe(true);
    expect(isWonStage({ name: 'won_stage' })).toBe(false);
    expect(isWonStage({ name: 'Wonderful' })).toBe(false);
    expect(isWonStage({ name: 'Swon' })).toBe(false);
    expect(isWonStage({ name: 'Won2' })).toBe(false);
    expect(isWonStage({ name: null })).toBe(false);
    expect(isWonStage({})).toBe(false);
  });
});

describe('deal values', () => {
  it('turns whole currency units into cents', () => {
    expect(dealValueToCents(386400)).toBe(BigInt(38640000));
    expect(dealValueToCents('386,400.50')).toBe(BigInt(38640050));
    expect(dealValueToCents('$1,000')).toBe(BigInt(100000));
    expect(dealValueToCents(19.995)).toBe(BigInt(2000));
    expect(dealValueToCents(BigInt(5))).toBe(BigInt(500));
    expect(dealValueToCents('n/a')).toBeNull();
    expect(dealValueToCents('386,400')).toBe(BigInt(38640000));
    expect(dealValueToCents('$386,400.00')).toBe(BigInt(38640000));
    expect(dealValueToCents(' $ 386,400.00 ')).toBe(BigInt(38640000));
    expect(dealValueToCents('386400')).toBe(BigInt(38640000));
    expect(dealValueToCents('-$1,000')).toBe(BigInt(-100000));
    expect(dealValueToCents('.5')).toBe(BigInt(50));
    // A comma must group thousands: never read a European decimal comma or bad grouping.
    for (const bad of ['1,23', '1.234,56', '1,2,3', '12,34,567', '1,2345', '386 400', ',500', '1,000.', '$', '']) expect(dealValueToCents(bad)).toBeNull();
    // A leading zero thousands group is a European decimal (0,500 is 0.5), never $500 or $123.
    expect(dealValueToCents('0,500')).toBeNull();
    expect(dealValueToCents('00,123')).toBeNull();
    expect(dealValueToCents('0,5')).toBeNull();
    expect(dealValueToCents('$0,500.00')).toBeNull();
    expect(dealValueToCents('0500')).toBe(BigInt(50000));
    expect(dealValueToCents('1,000,000')).toBe(BigInt(100000000));
    expect(dealValueToCents(Number.NaN)).toBeNull();
    expect(dealValueToCents(null)).toBeNull();
  });
  it('splits a deal over its term', () => {
    expect(monthlyFromDeal({ valueCents: BigInt(38640000), termMonths: 12 })).toBe(BigInt(3220000));
    expect(monthlyFromDeal({ valueCents: BigInt(100000), termMonths: null })).toBe(BigInt(8333));
    expect(monthlyFromDeal({ valueCents: BigInt(100000), termMonths: 0 })).toBeNull();
  });
  it('writes the deal callout', () => {
    expect(dealCallout({ valueCents: BigInt(38640000), termMonths: 12 })).toEqual({ text: 'From the deal: $386,400 over 12 months is about $32,200 a month.', monthlyCents: BigInt(3220000) });
    expect(dealCallout({ valueCents: BigInt(500000), termMonths: 1 })?.text).toBe('From the deal: $5,000 over 1 month is about $5,000 a month.');
    expect(dealCallout({ valueCents: null, termMonths: 12 })).toBeNull();
    expect(dealCallout({ valueCents: BigInt(100), termMonths: -1 })).toBeNull();
  });
});

describe('dealPrefill', () => {
  const rates = { unitPrice: '1.95', monthlyFeeCents: '150000', setupFeeCents: null, monthlyMinimumCents: '3000000', termMonths: 12 };
  it('E47 a deal in another currency fills nothing', () => {
    expect(dealPrefill({ deal: { currency: 'EUR', valueCents: BigInt(100), rates }, programCurrency: 'USD' })).toEqual({ rates: null, currencyNote: 'This deal is in EUR. Type the rates in USD.' });
  });
  it('fills the rates in the same currency, or with no currency', () => {
    expect(dealPrefill({ deal: { currency: 'usd', valueCents: null, rates }, programCurrency: 'USD' })).toEqual({ rates, currencyNote: null });
    expect(dealPrefill({ deal: { currency: null, valueCents: null, rates }, programCurrency: 'USD' })).toEqual({ rates, currencyNote: null });
  });
});
