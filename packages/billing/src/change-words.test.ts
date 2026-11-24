/** The sentences of the confirm panel: every amount named adds up to what is due or to the credit. */
import { describe, expect, it } from 'vitest';
import { changeWords, STARTED_DAY_RULE, type ChangeWordsInput } from './change-words';

const base: ChangeWordsInput = {
  dueTodayCents: 0,
  creditCents: 0,
  creditAppliedCents: 0,
  taxCents: 0,
  lines: [],
  daysLeft: 15,
  direction: 'charge',
  fromInterval: 'monthly',
  toInterval: 'monthly',
};
const part = (amountCents: number) => ({ amountCents, proration: true });
const whole = (amountCents: number) => ({ amountCents, proration: false });

/** Every dollar amount in a sentence, in cents, in order. */
function amounts(text: string): number[] {
  return [...text.matchAll(/\$([\d,]+\.\d\d)/g)].map((match) => Math.round(Number(match[1]!.replace(/,/g, '')) * 100));
}

describe('changeWords', () => {
  it('adding a seat: the days the charge is for', () => {
    const words = changeWords({ ...base, dueTodayCents: 1160, lines: [part(1160)] });
    expect(words).toEqual({ dueTodayNote: 'For the 15 days left in this period.', creditNote: null });
  });

  it('removing a seat: the credit says it is for full days only, and why', () => {
    const words = changeWords({ ...base, direction: 'credit', daysLeft: 14, creditCents: 1083, lines: [part(-1083)] });
    expect(words.dueTodayNote).toBe('Nothing to pay now.');
    expect(words.creditNote).toBe(`That is for the 14 full days left in this period. ${STARTED_DAY_RULE}`);
  });

  it('one full day left reads "1 full day"', () => {
    const words = changeWords({ ...base, direction: 'credit', daysLeft: 1, creditCents: 77, lines: [part(-77)] });
    expect(words.creditNote).toContain('the 1 full day left');
  });

  it('removing a seat with less than one full day left: no credit, and the reason', () => {
    const words = changeWords({ ...base, direction: 'credit', daysLeft: 0 });
    expect(words).toEqual({
      dueTodayNote: 'Nothing to pay now. Less than one full day is left in this period, so there is no credit.',
      creditNote: null,
    });
  });

  it('monthly to yearly: a full year, less the unused part of the month', () => {
    const words = changeWords({
      ...base,
      direction: 'credit',
      daysLeft: 29,
      toInterval: 'yearly',
      dueTodayCents: 147900 - 14017,
      lines: [part(-14017), whole(147900)],
    });
    expect(words.dueTodayNote).toBe('$1,479.00 for the next year. Less $140.17 for the 29 full days left on your monthly plan.');
    const [year, back] = amounts(words.dueTodayNote);
    expect(year! - back!).toBe(133883);
  });

  it('monthly to yearly with credit on the account (the case the review found): the three amounts add up to what is due', () => {
    const words = changeWords({
      ...base,
      direction: 'credit',
      daysLeft: 29,
      toInterval: 'yearly',
      dueTodayCents: 888,
      creditAppliedCents: 132995,
      lines: [part(-14017), whole(147900), whole(-132995)],
    });
    expect(words.dueTodayNote).toBe(
      '$1,479.00 for the next year. Less $140.17 for the 29 full days left on your monthly plan. Less $1,329.95 from your credit.',
    );
    const [year, back, credit] = amounts(words.dueTodayNote);
    expect(year! - back! - credit!).toBe(888);
    // The old sentence called the net amount the price "for the 30 days left". It is gone.
    expect(words.dueTodayNote).not.toContain('days left in this period');
  });

  it('monthly to yearly paid in full from credit', () => {
    const words = changeWords({
      ...base,
      direction: 'credit',
      daysLeft: 29,
      toInterval: 'yearly',
      dueTodayCents: 0,
      creditAppliedCents: 133883,
      lines: [part(-14017), whole(147900)],
    });
    const [year, back, credit] = amounts(words.dueTodayNote);
    expect(year! - back! - credit!).toBe(0);
  });

  it('yearly to monthly: the credit is the unused year less the next month', () => {
    const words = changeWords({
      ...base,
      direction: 'credit',
      daysLeft: 300,
      fromInterval: 'yearly',
      creditCents: 121562 - 14500,
      lines: [part(-121562), whole(14500)],
    });
    expect(words.dueTodayNote).toBe('Nothing to pay now.');
    expect(words.creditNote).toBe(`That is $1,215.62 for the 300 full days left on your yearly plan, less $145.00 for the next month. ${STARTED_DAY_RULE}`);
    const [unused, month] = amounts(words.creditNote!);
    expect(unused! - month!).toBe(121562 - 14500);
  });

  it('adding with credit on the account: partly and fully paid from credit', () => {
    expect(changeWords({ ...base, dueTodayCents: 600, creditAppliedCents: 560, lines: [part(1160)] }).dueTodayNote).toBe(
      '$11.60 for the 15 days left in this period, less $5.60 paid from your credit.',
    );
    expect(changeWords({ ...base, dueTodayCents: 0, creditAppliedCents: 1160, lines: [part(1160)] }).dueTodayNote).toBe(
      '$11.60 for the 15 days left in this period. Paid from your credit.',
    );
  });

  it('an app swapped for a dearer one: what is added, less what is taken off', () => {
    const words = changeWords({ ...base, dueTodayCents: 5000, lines: [part(-10000), part(15000)] });
    expect(words.dueTodayNote).toBe('$150.00 for the 15 days left in this period. Less $100.00 for what you take off.');
  });

  it('an app swapped for a cheaper one: the credit names both sides', () => {
    const words = changeWords({ ...base, direction: 'credit', daysLeft: 14, creditCents: 4000, lines: [part(-10000), part(6000)] });
    expect(words.creditNote).toBe(`That is $100.00 for the 14 full days left of what you take off, less $60.00 for what you add. ${STARTED_DAY_RULE}`);
  });

  it('sales tax is named when there is some', () => {
    const words = changeWords({ ...base, toInterval: 'yearly', direction: 'credit', daysLeft: 10, dueTodayCents: 100000 - 2000 + 8000, taxCents: 8000, lines: [part(-2000), whole(100000)] });
    expect(words.dueTodayNote).toBe('$1,000.00 for the next year. Less $20.00 for the 10 full days left on your monthly plan. Plus $80.00 sales tax.');
  });

  it('numbers that would not add up are never shown: a plain sentence instead', () => {
    const words = changeWords({ ...base, dueTodayCents: 999, lines: [part(1160)] });
    expect(amounts(words.dueTodayNote)).toEqual([]);
    expect(words.dueTodayNote).toBe('This is the price of the change for the time left in this period.');
  });

  it('inside a free trial nothing is prorated', () => {
    expect(changeWords({ ...base, daysLeft: null })).toEqual({ dueTodayNote: 'Nothing to pay now.', creditNote: null });
  });
});
