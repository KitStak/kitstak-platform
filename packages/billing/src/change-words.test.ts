/** The sentences of the confirm panel: every amount named adds up to what is due or to the credit. */
import { describe, expect, it } from 'vitest';
import type { PlanSelection, ProductId } from './catalog';
import { bundleChangeNote, changeWords, STARTED_DAY_RULE, type ChangeWordsInput } from './change-words';
import { quote } from './quote';

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
    expect(words).toMatchObject({ dueTodayNote: 'For the 15 days left in this period.', creditNote: null, bundleNote: null, bundleNoteTone: null });
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
    expect(words).toMatchObject({
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
    expect(changeWords({ ...base, daysLeft: null })).toMatchObject({ dueTodayNote: 'Nothing to pay now.', creditNote: null });
  });
});

/* ===== review round 3: a change that starts or ends the bundle discount names it ===== */

const plan = (products: ProductId[], seats = 5, warehouses = 1): PlanSelection => ({ products, seats, warehouses, interval: 'monthly' });
const line = (product: ProductId, amountCents: number) => ({ product, amountCents, proration: true });
const between = (before: PlanSelection, after: PlanSelection) => ({
  before,
  after,
  beforeRecurringCents: quote(before).totalCents,
  afterRecurringCents: quote(after).totalCents,
});

describe('a change that ends the bundle discount', () => {
  it('removing Pulse from CRM (7 users) and Pulse costs money today, and the words say why', () => {
    const before = plan(['crm', 'pulse'], 7);
    const after = plan(['crm'], 7);
    expect(quote(before).totalCents).toBe(18560);
    expect(quote(after).totalCents).toBe(20300);
    // The lines the gateway gives for 22 of 30 days: the CRM at the old price back, at the new price
    // on, and Pulse back.
    const words = changeWords({
      ...base,
      ...between(before, after),
      daysLeft: 22,
      direction: 'charge',
      dueTodayCents: 1277,
      lines: [line('crm', -11909), line('crm', 14887), line('pulse', -1701)],
    });
    expect(words.bundleNote).toBe(
      'Removing Pulse ends your 20% bundle discount. Your CRM goes from $23.20 to $29 per user. Your plan goes from $185.60 to $203.00 per month. Keeping Pulse costs less.',
    );
    expect(words.bundleNoteTone).toBe('warning');
    expect(words.dueTodayNote).toBe(
      'Your CRM goes from $23.20 to $29 per user, because the bundle discount needs 2 apps. For the 22 days left in this period that is $29.78 more. Less $17.01 back for Pulse.',
    );
    expect(words.creditNote).toBeNull();
    // The two amounts of the sentence add up to what is due.
    const [, more, back] = amounts(words.dueTodayNote);
    expect(more! - back!).toBe(1277);
    expect(words.dueTodayNote).not.toContain('what you add');
  });

  it('removing WMS from CRM (5 users) and WMS: the credit names the app that came off and the CRM price', () => {
    const before = plan(['crm', 'wms'], 5);
    const after = plan(['crm'], 5);
    const words = changeWords({
      ...base,
      ...between(before, after),
      daysLeft: 22,
      direction: 'credit',
      creditCents: 18349,
      lines: [line('crm', -8507), line('crm', 10633), line('wms', -20475)],
    });
    expect(words.dueTodayNote).toBe('Nothing to pay now.');
    expect(words.creditNote).toBe(
      `That is $204.75 back for WMS, for the 22 full days left. Your CRM goes from $23.20 to $29 per user, because the bundle discount needs 2 apps. That takes $21.26 off the credit. ${STARTED_DAY_RULE}`,
    );
    const [back, , less] = amounts(words.creditNote!);
    expect(back! - less!).toBe(18349);
    expect(words.creditNote).not.toContain('what you add');
    // The plan gets cheaper here, so the warning names the new price and does not say "costs less".
    expect(words.bundleNote).toBe(
      'Removing WMS ends your 20% bundle discount. Your CRM goes from $23.20 to $29 per user. Your plan goes from $395.20 to $145.00 per month.',
    );
  });

  it('removing two apps at once names both', () => {
    const before = plan(['crm', 'wms', 'pulse'], 5);
    const after = plan(['crm'], 5);
    const words = changeWords({
      ...base,
      ...between(before, after),
      daysLeft: 14,
      direction: 'credit',
      creditCents: 12758,
      lines: [line('crm', -5413), line('crm', 6767), line('wms', -13029), line('pulse', -1083)],
    });
    expect(words.creditNote).toBe(
      `That is $141.12 back for WMS and Pulse, for the 14 full days left. Your CRM goes from $23.20 to $29 per user, because the bundle discount needs 2 apps. That takes $13.54 off the credit. ${STARTED_DAY_RULE}`,
    );
    expect(words.bundleNote).toContain('Removing WMS and Pulse ends your 20% bundle discount.');
    expect(words.creditNote).not.toContain('what you add');
  });

  it('a flat price app that stays is named with its own words', () => {
    const before = plan(['crm', 'pulse'], 1);
    const after = plan(['pulse'], 1);
    const note = bundleChangeNote(between(before, after));
    expect(note).toEqual({
      text: 'Removing CRM ends your 20% bundle discount. Your Pulse goes from $23.20 to $29 per month. Your plan goes from $46.40 to $29.00 per month.',
      tone: 'warning',
    });
  });

  it('removing one of three apps keeps the discount: no warning and the plain credit sentence', () => {
    const before = plan(['crm', 'wms', 'pulse'], 5);
    const after = plan(['crm', 'wms'], 5);
    const words = changeWords({ ...base, ...between(before, after), daysLeft: 14, direction: 'credit', creditCents: 1083, lines: [line('pulse', -1083)] });
    expect(words.bundleNote).toBeNull();
    expect(words.creditNote).toBe(`That is for the 14 full days left in this period. ${STARTED_DAY_RULE}`);
  });

  it('with a seat change in the same step the plain sentence is used, and it never says "what you add"', () => {
    const before = plan(['crm', 'wms'], 5);
    const after = plan(['crm'], 4);
    const words = changeWords({
      ...base,
      ...between(before, after),
      daysLeft: 22,
      direction: 'credit',
      creditCents: 20475 + 8507 - 8507,
      lines: [line('crm', -8507), line('crm', 8507), line('wms', -20475)],
    });
    expect(words.creditNote).toBe(
      `$289.82 back for the 22 full days left at your old prices. Less $85.07 for the same days at your new prices. ${STARTED_DAY_RULE}`,
    );
    expect(words.creditNote).not.toContain('what you add');
    // Review round 5: no sentence is longer than 20 words.
    for (const sentence of (words.creditNote ?? '').split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it('adding an app and giving seats back names each amount for what it is (review round 5)', () => {
    // CRM and Projects with 5 seats (the bundle is on before and after), then Pulse on and 2 seats off.
    const before = plan(['crm', 'projects'], 5);
    const after = plan(['crm', 'projects', 'pulse'], 3);
    const words = changeWords({
      ...base,
      ...between(before, after),
      daysLeft: 29,
      direction: 'credit',
      creditCents: 4485 - 2243,
      lines: [line('crm', -2243), line('projects', -2242), line('pulse', 2243)],
    });
    expect(words.creditNote).toBe(`$44.85 back for 2 seats. $22.43 for Pulse. Both are for the 29 full days left. ${STARTED_DAY_RULE}`);
    expect(words.creditNote).not.toContain('old prices');
    // The same change when the lines do not say which app they are for: the plain sentences.
    const unnamed = changeWords({
      ...base,
      ...between(before, after),
      daysLeft: 29,
      direction: 'credit',
      creditCents: 4485 - 2243,
      lines: [part(-4485), part(2243)],
    });
    expect(unnamed.creditNote).toBe(`$44.85 back for the 29 full days left at your old prices. Less $22.43 for the same days at your new prices. ${STARTED_DAY_RULE}`);
  });

  it('amounts that would not add up fall back to a sentence with no wrong reason', () => {
    const before = plan(['crm', 'pulse'], 7);
    const after = plan(['crm'], 7);
    const words = changeWords({ ...base, ...between(before, after), daysLeft: 22, dueTodayCents: 999, lines: [line('crm', -11909), line('crm', 14887), line('pulse', -1701)] });
    expect(words.dueTodayNote).toBe('This is the price of the change for the time left in this period.');
    expect(words.bundleNote).toContain('Removing Pulse ends your 20% bundle discount.');
  });
});

describe('a change that starts the bundle discount', () => {
  it('adding WMS to CRM (2 users): the charge names the new app, less what the CRM saves', () => {
    const before = plan(['crm'], 2);
    const after = plan(['crm', 'wms'], 2);
    const words = changeWords({
      ...base,
      ...between(before, after),
      daysLeft: 15,
      direction: 'charge',
      dueTodayCents: 13380,
      lines: [line('crm', -2900), line('crm', 2320), line('wms', 13960)],
    });
    expect(words.dueTodayNote).toBe(
      '$139.60 for WMS for the 15 days left in this period. Less $5.80, because your CRM goes from $29 to $23.20 per user with the bundle discount.',
    );
    const [cost, saved] = amounts(words.dueTodayNote);
    expect(cost! - saved!).toBe(13380);
    expect(words.bundleNote).toBe('Adding WMS starts your 20% bundle discount. Your CRM goes from $29 to $23.20 per user.');
    expect(words.bundleNoteTone).toBe('info');
  });

  it('adding Pulse to CRM (5 users) leaves a credit: the plan gets cheaper, and the words say so', () => {
    const before = plan(['crm'], 5);
    const after = plan(['crm', 'pulse'], 5);
    const words = changeWords({
      ...base,
      ...between(before, after),
      daysLeft: 15,
      direction: 'credit',
      creditCents: 290,
      lines: [line('crm', -7250), line('crm', 5800), line('pulse', 1160)],
    });
    expect(words.dueTodayNote).toBe('Nothing to pay now.');
    expect(words.creditNote).toBe(
      `Your CRM goes from $29 to $23.20 per user with the bundle discount. That is $14.50 back for the 15 full days left, less $11.60 for Pulse. ${STARTED_DAY_RULE}`,
    );
    const [, saved, cost] = amounts(words.creditNote!);
    expect(saved! - cost!).toBe(290);
    expect(words.bundleNote).toBe(
      'Adding Pulse starts your 20% bundle discount. Your CRM goes from $29 to $23.20 per user. Your plan goes from $145.00 to $139.20 per month.',
    );
  });

  it('no bundle sentence when the discount does not change, or when the billing period changes too', () => {
    expect(bundleChangeNote(between(plan(['crm'], 5), plan(['crm'], 6)))).toBeNull();
    expect(bundleChangeNote(between(plan(['crm', 'wms'], 5), plan(['crm', 'wms', 'pulse'], 5)))).toBeNull();
    const yearly: PlanSelection = { ...plan(['crm'], 5), interval: 'yearly' };
    expect(bundleChangeNote({ before: plan(['crm', 'wms'], 5), after: yearly, beforeRecurringCents: 39520, afterRecurringCents: quote(yearly).totalCents })).toBeNull();
  });
});
