import { describe, expect, it } from 'vitest';
import { dealCallout, dealPrefill, dealValueToCents, isWonStage, monthlyFromDeal } from './deal';

describe('isWonStage (A12)', () => {
  it('E31 done flag first, then the word won', () => {
    expect(isWonStage({ isDone: true, name: 'Closed' })).toBe(true);
    expect(isWonStage({ isDone: null, name: 'Won' })).toBe(true);
    expect(isWonStage({ isDone: false, name: 'Won back later' })).toBe(false);
    expect(isWonStage({ isDone: null, name: "Won't buy" })).toBe(false);
    expect(isWonStage({ isDone: null, name: 'Closed won' })).toBe(true);
  });
  it('E31 a negation right before won, the word lost, or a question is never won', () => {
    for (const name of ['Not won', 'Never won', 'No won deals', 'Not yet won', "Isn't won", 'Lost to competitor who won', 'Lost', 'Won?', 'Won (maybe)?']) {
      expect(isWonStage({ isDone: null, name })).toBe(false);
    }
    expect(isWonStage({ isDone: null, name: 'Won - signed' })).toBe(true);
    expect(isWonStage({ isDone: null, name: 'Deal won' })).toBe(true);
    expect(isWonStage({ isDone: true, name: 'Not won' })).toBe(true);
  });
  it('A12 reads only the whole word won, so real CRM won stages with more words start a program', () => {
    expect(isWonStage({ isDone: null, name: 'Closed Won - Pending Signature' })).toBe(true);
    expect(isWonStage({ isDone: null, name: 'Won (expected start Jan)' })).toBe(true);
    expect(isWonStage({ name: 'Won, starts soon' })).toBe(true);
    expect(isWonStage({ name: 'Won back later' })).toBe(true);
    // The board's own flag still wins over the words.
    expect(isWonStage({ isDone: false, name: 'Closed Won - Pending Signature' })).toBe(false);
  });
  it('an apostrophe joins the word, so lost stages never count as won', () => {
    expect(isWonStage({ name: "Won't renew" })).toBe(false);
    expect(isWonStage({ name: 'Won\u2019t renew' })).toBe(false);
    expect(isWonStage({ name: "Lost: won't buy" })).toBe(false);
    expect(isWonStage({ name: "Deal's won" })).toBe(true);
    expect(isWonStage({ name: 'Won (signed)' })).toBe(true);
    expect(isWonStage({ name: 'WON' })).toBe(true);
  });
  it('matches the whole word only', () => {
    expect(isWonStage({ name: 'Closed won' })).toBe(true);
    expect(isWonStage({ name: 'Closed-Won' })).toBe(true);
    expect(isWonStage({ name: 'Wonderful' })).toBe(false);
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
