import { describe, expect, it } from 'vitest';
import { V1, V2, VARIANTS, VERSIONS, line } from './glove.fixture';
import { BUILD_RATE_DECIMALS_MESSAGE, MAX_RATE_SCALED, RATE_TOO_LARGE_MESSAGE, NEGATIVE_BUILD_RATE_MESSAGE, NEGATIVE_RATE_MESSAGE, buildRateProblem, cardLineProblem, cardSummary, isUsableLine, readRateText, compileRateRules, describeRateRule, normalize4, priceFor, rateConflictMessage, resolveHourRate, resolveOrderCharge, resolveUnitPrice, versionFor } from './price';
import type { CardVersion, RateRule } from './types';

const SMALL_BROWN = 'v-S-BRN';
const XL_BROWN = 'v-XL-BRN';

describe('priceFor and versionFor', () => {
  const rows = [
    { effectiveFrom: '2026-01-01', price: 'a' },
    { effectiveFrom: '2026-06-01', price: 'b' },
  ];
  it('picks the latest row on or before the date', () => {
    expect(priceFor(rows, '2025-12-31')).toBeNull();
    expect(priceFor(rows, '2026-01-01')?.price).toBe('a');
    expect(priceFor(rows, '2026-07-01')?.price).toBe('b');
  });
  it('never uses a version before its start (M3)', () => {
    expect(versionFor(VERSIONS, '2026-10-31')?.id).toBe('v1');
    expect(versionFor(VERSIONS, '2026-11-01')?.id).toBe('v2');
    expect(versionFor(VERSIONS, '2026-09-14')).toBeNull();
  });
});

describe('resolveUnitPrice (D5)', () => {
  it('E7 Small Brown in October uses the v1 card rate', () => {
    expect(resolveUnitPrice({ workDate: '2026-10-30', variantId: SMALL_BROWN, buildOverride: null, versions: VERSIONS })).toEqual({ unitPrice: '1.8500', source: 'card', versionId: 'v1', lineId: 'v1-unit' });
  });
  it('E8 XL Brown in November uses the v2 variant rate', () => {
    expect(resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: null, versions: VERSIONS })).toMatchObject({ unitPrice: '2.2000', source: 'variant', versionId: 'v2' });
  });
  it('E9 a build rate beats the card', () => {
    expect(resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: '2.05', versions: VERSIONS })).toEqual({ unitPrice: '2.0500', source: 'build', versionId: null, lineId: null });
  });
  it('refuses a build rate below $0', () => {
    expect(() => resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: '-1', versions: VERSIONS })).toThrow(new RangeError('A build rate cannot be less than $0.'));
    expect(() => resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: '-0.0001', versions: VERSIONS })).toThrow(RangeError);
    expect(resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: '0', versions: VERSIONS })).toEqual({ unitPrice: '0.0000', source: 'build', versionId: null, lineId: null });
    expect(buildRateProblem('-1')).toBe(NEGATIVE_BUILD_RATE_MESSAGE);
    expect(buildRateProblem('abc')).toBe('The build rate abc is not a number.');
    expect(buildRateProblem(' 2.05 ')).toBeNull();
    expect(buildRateProblem(null)).toBeNull();
    expect(buildRateProblem('')).toBeNull();
  });
  it('E10 before the first version with no job there is no price', () => {
    expect(resolveUnitPrice({ workDate: '2026-09-14', variantId: SMALL_BROWN, buildOverride: null, versions: VERSIONS })).toEqual({ unitPrice: '0.0000', source: 'none', versionId: null, lineId: null });
  });
  it('E11 before the first version a job price applies', () => {
    expect(resolveUnitPrice({ workDate: '2026-09-14', variantId: SMALL_BROWN, buildOverride: null, versions: VERSIONS, jobPrices: [{ effectiveFrom: '0001-01-01', unitPrice: '1.7000' }] })).toEqual({ unitPrice: '1.7000', source: 'job', versionId: null, lineId: null });
  });
  it('the card beats a job price, and a blank job price is no price', () => {
    expect(resolveUnitPrice({ workDate: '2026-10-01', variantId: null, buildOverride: '  ', versions: VERSIONS, jobPrices: [{ effectiveFrom: '0001-01-01', unitPrice: '9.0000' }] }).source).toBe('card');
    expect(resolveUnitPrice({ workDate: '2026-09-01', variantId: null, buildOverride: null, versions: [], jobPrices: [{ effectiveFrom: '0001-01-01', unitPrice: null }] }).source).toBe('none');
  });
  it('normalize4 makes equal prices equal strings', () => {
    expect(normalize4('2.05')).toBe('2.0500');
    expect(normalize4(1.5)).toBe('1.5000');
  });
});

const DUDE: CardVersion = {
  id: 'd1',
  number: 1,
  effectiveFrom: '2026-01-01',
  rules: [],
  lines: [
    line({ id: 'd1-order', kind: 'per_order', amountCents: '4500', label: 'Kit fee' }),
    line({ id: 'd1-order-xl', kind: 'per_order', variantId: XL_BROWN, amountCents: '5000' }),
    line({ id: 'd1-hour', kind: 'per_hour', rateCents: 4200 }),
  ],
};

describe('order and hour lines', () => {
  it('uses the variant per batch line, then the card default', () => {
    expect(resolveOrderCharge([DUDE], XL_BROWN, '2026-11-23')).toEqual({ amountCents: BigInt(5000), versionId: 'd1', lineId: 'd1-order-xl' });
    expect(resolveOrderCharge([DUDE], SMALL_BROWN, '2026-11-23')).toEqual({ amountCents: BigInt(4500), versionId: 'd1', lineId: 'd1-order' });
    expect(resolveOrderCharge([DUDE], null, '2025-12-31')).toBeNull();
    expect(resolveOrderCharge(VERSIONS, null, '2026-11-23')).toBeNull();
  });
  it('uses the per hour line in force', () => {
    expect(resolveHourRate([DUDE], '2026-11-23')).toEqual({ rateCents: 4200, versionId: 'd1', lineId: 'd1-hour' });
    expect(resolveHourRate([DUDE], '2025-01-01')).toBeNull();
    expect(resolveHourRate(VERSIONS, '2026-11-23')).toBeNull();
  });
});

describe('compileRateRules (A3)', () => {
  const xlAdd: RateRule = { id: 'r-xl', attributeId: 'size', valueId: 'size-xl', op: 'add', amount: '0.25' };
  const yellowAdd: RateRule = { id: 'r-ylw', attributeId: 'color', valueId: 'color-ylw', op: 'add', amount: '0.10' };
  it('E38 adds rules on top of the default and keeps hand lines', () => {
    const result = compileRateRules({ defaultUnitPrice: '1.95', rules: [xlAdd, yellowAdd], variants: VARIANTS, handLines: [{ variantId: SMALL_BROWN, unitPrice: '1.90' }] });
    const price = (id: string): string | undefined => result.lines.find((row) => row.variantId === id)?.unitPrice;
    expect(price('v-XL-BRN')).toBe('2.2000');
    expect(price('v-XL-YLW')).toBe('2.3000');
    expect(price('v-S-YLW')).toBe('2.0500');
    expect(price(SMALL_BROWN)).toBeUndefined();
    expect(price('v-M-BRN')).toBeUndefined();
    expect(result.lines.find((row) => row.variantId === 'v-XL-YLW')?.ruleId).toBe('r-xl');
    expect(result.conflicts).toEqual([]);
  });
  it('E39 two set rules on XL Yellow are a conflict', () => {
    const result = compileRateRules({
      defaultUnitPrice: '1.95',
      rules: [
        { id: 'set-xl', attributeId: 'size', valueId: 'size-xl', op: 'set', amount: '2.10' },
        { id: 'set-ylw', attributeId: 'color', valueId: 'color-ylw', op: 'set', amount: '2.00' },
      ],
      variants: VARIANTS,
      handLines: [],
    });
    expect(result.conflicts).toContainEqual({ variantId: 'v-XL-YLW', ruleIds: ['set-xl', 'set-ylw'], reason: 'two_sets' });
    expect(result.lines.find((row) => row.variantId === 'v-XL-BRN')?.unitPrice).toBe('2.1000');
  });
  it('one set rule plus add rules', () => {
    const result = compileRateRules({ defaultUnitPrice: null, rules: [{ id: 's', attributeId: 'size', valueId: 'size-xl', op: 'set', amount: '2.00' }, yellowAdd], variants: VARIANTS, handLines: [] });
    expect(result.lines.find((row) => row.variantId === 'v-XL-YLW')?.unitPrice).toBe('2.1000');
    expect(result.conflicts).toContainEqual({ variantId: 'v-S-YLW', ruleIds: ['r-ylw'], reason: 'no_default' });
  });
  it('a rate below 0 is a conflict', () => {
    const result = compileRateRules({ defaultUnitPrice: '0.10', rules: [{ id: 'neg', attributeId: 'size', valueId: 'size-xl', op: 'add', amount: '-0.25' }], variants: VARIANTS, handLines: [] });
    expect(result.conflicts.map((row) => row.reason)).toEqual(['below_zero', 'below_zero']);
  });
  it('says each conflict in plain words', () => {
    expect(rateConflictMessage('two_sets', 'XL Yellow')).toBe('Two rules set a price for XL Yellow.');
    expect(rateConflictMessage('no_default', 'XL Yellow')).toBe('Add a card rate before you add to it.');
    expect(rateConflictMessage('below_zero', 'XL Yellow')).toBe('This rule makes the XL Yellow rate less than $0.');
  });
  it('describes a rule', () => {
    expect(describeRateRule({ op: 'add', amount: '0.25' }, 'Size', 'XL')).toBe('Size is XL: add $0.25');
    expect(describeRateRule({ op: 'set', amount: '2.1' }, 'Size', 'XL')).toBe('Size is XL: set $2.10');
    expect(describeRateRule({ op: 'add', amount: '-0.05' }, 'Color', 'Brown')).toBe('Color is Brown: take off $0.05');
  });
});

describe('cardSummary', () => {
  it('sums up a version in one line', () => {
    expect(cardSummary(V2, 'kit')).toBe('$1.95 per kit · $1,500 monthly · $30,000 minimum');
    expect(cardSummary(V1, 'kit')).toBe('$1.85 per kit · $1,500 monthly · $30,000 minimum');
  });
  it('shows batch, hour and a range of variant rates', () => {
    const version: CardVersion = { ...DUDE, lines: [...DUDE.lines, line({ id: 'a', kind: 'per_unit', variantId: 'x', unitPrice: '1.90' }), line({ id: 'b', kind: 'per_unit', variantId: 'y', unitPrice: '2.2' }), line({ id: 'c', kind: 'flat_monthly', amountCents: '150050' })] };
    expect(cardSummary(version, 'order')).toBe('$1.90 to $2.20 per order · $45 per batch · $42 per hour · $1,500.50 monthly');
    expect(cardSummary({ ...DUDE, lines: [line({ id: 'a', kind: 'per_unit', variantId: 'x', unitPrice: '1.90' })] }, '')).toBe('$1.90 per unit');
  });
  it('says when there are no prices', () => {
    expect(cardSummary(null, 'kit')).toBe('No prices yet');
    expect(cardSummary({ ...DUDE, lines: [] }, 'kit')).toBe('No prices yet');
  });
});

describe('typed rates', () => {
  it('reads a build rate the way people type it', () => {
    expect(buildRateProblem('$2.05')).toBeNull();
    expect(buildRateProblem('2,050.00')).toBeNull();
    expect(buildRateProblem('$ 1,250.5')).toBeNull();
    expect(resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: '$2.05', versions: VERSIONS })).toEqual({ unitPrice: '2.0500', source: 'build', versionId: null, lineId: null });
    expect(resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: '2,050.00', versions: VERSIONS }).unitPrice).toBe('2050.0000');
  });
  it('refuses more than 4 decimals instead of rounding', () => {
    expect(buildRateProblem('1.23456')).toBe('Use up to 4 decimals for a build rate.');
    expect(BUILD_RATE_DECIMALS_MESSAGE).toBe('Use up to 4 decimals for a build rate.');
    expect(() => resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: '1.23456', versions: VERSIONS })).toThrow(new RangeError('Use up to 4 decimals for a build rate.'));
    expect(buildRateProblem('1.23450')).toBeNull();
  });
  it('refuses text that is not a rate, with words people can read', () => {
    expect(buildRateProblem('1,5')).toBe('The build rate 1,5 is not a number.');
    expect(buildRateProblem('$$2')).toBe('The build rate $$2 is not a number.');
    expect(() => resolveUnitPrice({ workDate: '2026-11-02', variantId: XL_BROWN, buildOverride: 'abc', versions: VERSIONS })).toThrow(new RangeError('The build rate abc is not a number.'));
    expect(buildRateProblem('-$1.00')).toBe(NEGATIVE_BUILD_RATE_MESSAGE);
    expect(readRateText('$-1.00')).toEqual({ ok: false, problem: 'below_zero' });
    expect(readRateText('-0')).toEqual({ ok: true, scaled: BigInt(0), price: '0.0000' });
  });
});

describe('the $0 floor for every rate source', () => {
  const at = '2026-11-02';
  const withLines = (lines: CardVersion['lines']): CardVersion[] => [{ id: 'n1', number: 1, effectiveFrom: '2026-01-01', rules: [], lines }];
  it('a per unit variant line below $0 is skipped, so the card rate applies', () => {
    const versions = withLines([line({ id: 'card', kind: 'per_unit', unitPrice: '1.95' }), line({ id: 'neg', kind: 'per_unit', variantId: XL_BROWN, unitPrice: '-1.00' })]);
    expect(resolveUnitPrice({ workDate: at, variantId: XL_BROWN, buildOverride: null, versions })).toEqual({ unitPrice: '1.9500', source: 'card', versionId: 'n1', lineId: 'card' });
  });
  it('a per unit card line below $0 is skipped, so there is no price (never negative revenue)', () => {
    const versions = withLines([line({ id: 'neg', kind: 'per_unit', unitPrice: '-1.00' })]);
    expect(resolveUnitPrice({ workDate: at, variantId: null, buildOverride: null, versions })).toEqual({ unitPrice: '0.0000', source: 'none', versionId: null, lineId: null });
  });
  it('a job price below $0 is skipped', () => {
    expect(resolveUnitPrice({ workDate: at, variantId: null, buildOverride: null, versions: [], jobPrices: [{ effectiveFrom: '0001-01-01', unitPrice: '-2.0000' }] }).source).toBe('none');
  });
  it('a per batch line below $0 is skipped, so the card default batch fee applies', () => {
    const versions = withLines([line({ id: 'card', kind: 'per_order', amountCents: '4500' }), line({ id: 'neg', kind: 'per_order', variantId: XL_BROWN, amountCents: '-100' })]);
    expect(resolveOrderCharge(versions, XL_BROWN, at)).toEqual({ amountCents: BigInt(4500), versionId: 'n1', lineId: 'card' });
    expect(resolveOrderCharge(withLines([line({ id: 'neg', kind: 'per_order', amountCents: '-100' })]), null, at)).toBeNull();
  });
  it('a per hour line below $0 is skipped', () => {
    expect(resolveHourRate(withLines([line({ id: 'neg', kind: 'per_hour', rateCents: -4200 })]), at)).toBeNull();
    expect(resolveHourRate(withLines([line({ id: 'neg', kind: 'per_hour', rateCents: -4200 }), line({ id: 'ok', kind: 'per_hour', rateCents: 4200 })]), at)?.lineId).toBe('ok');
  });
  it('monthly fee and minimum lines below $0 are not usable', () => {
    expect(isUsableLine(line({ id: 'f', kind: 'flat_monthly', amountCents: '-150000' }))).toBe(false);
    expect(isUsableLine(line({ id: 'm', kind: 'monthly_minimum', amountCents: '-1' }))).toBe(false);
    expect(isUsableLine(line({ id: 'm', kind: 'monthly_minimum', amountCents: '3000000' }))).toBe(true);
    expect(cardSummary(withLines([line({ id: 'f', kind: 'flat_monthly', amountCents: '-150000' })])[0]!, 'kit')).toBe('No prices yet');
  });
  it('cardLineProblem gives the editor the same words for every line kind', () => {
    expect(NEGATIVE_RATE_MESSAGE).toBe('A rate cannot be less than $0.');
    expect(cardLineProblem(line({ id: 'a', kind: 'per_unit', unitPrice: '-1.00' }))).toBe('A rate cannot be less than $0.');
    expect(cardLineProblem(line({ id: 'b', kind: 'per_order', amountCents: '-4500' }))).toBe('A rate cannot be less than $0.');
    expect(cardLineProblem(line({ id: 'c', kind: 'per_hour', rateCents: -4200 }))).toBe('A rate cannot be less than $0.');
    expect(cardLineProblem(line({ id: 'd', kind: 'flat_monthly', amountCents: '-150000' }))).toBe('A rate cannot be less than $0.');
    expect(cardLineProblem(line({ id: 'e', kind: 'monthly_minimum', amountCents: '-1' }))).toBe('A rate cannot be less than $0.');
    expect(cardLineProblem(line({ id: 'f', kind: 'per_unit', unitPrice: '1.23456' }))).toBe('Use up to 4 decimals for a rate.');
    expect(cardLineProblem(line({ id: 'g', kind: 'per_unit', unitPrice: '$1.95' }))).toBeNull();
    expect(cardLineProblem(line({ id: 'h', kind: 'per_order', amountCents: '45.5' }))).toBe('The batch fee must be a whole number of cents.');
    expect(cardLineProblem(line({ id: 'i', kind: 'per_hour', rateCents: 42.5 }))).toBe('The rate per hour must be a whole number of cents.');
    expect(cardLineProblem(line({ id: 'j', kind: 'per_unit', unitPrice: null }))).toBeNull();
    expect(cardLineProblem(line({ id: 'k', kind: 'per_hour', rateCents: 0 }))).toBeNull();
  });
  it('a typed card rate with a dollar sign still resolves to a clean 4 decimal price', () => {
    const versions = withLines([line({ id: 'card', kind: 'per_unit', unitPrice: '$1.95' })]);
    expect(resolveUnitPrice({ workDate: at, variantId: null, buildOverride: null, versions }).unitPrice).toBe('1.9500');
  });
});

describe('compileRateRules reads amounts like typed text', () => {
  const xlAdd: RateRule = { id: 'r-xl', attributeId: 'size', valueId: 'size-xl', op: 'add', amount: '0.25' };
  const xlBrown = (result: ReturnType<typeof compileRateRules>) => result.lines.find((row) => row.variantId === XL_BROWN);

  it('reads a $ default and a $ rule amount', () => {
    expect(xlBrown(compileRateRules({ defaultUnitPrice: '$1.95', rules: [{ ...xlAdd, amount: '$0.25' }], variants: VARIANTS, handLines: [] }))?.unitPrice).toBe('2.2000');
  });

  it('refuses a rule amount with more than 4 decimals instead of rounding it', () => {
    const result = compileRateRules({ defaultUnitPrice: '1.95', rules: [{ ...xlAdd, amount: '0.00005' }], variants: VARIANTS, handLines: [] });
    expect(result.lines).toEqual([]);
    const conflict = result.conflicts.find((row) => row.variantId === XL_BROWN);
    expect(conflict).toEqual({ variantId: XL_BROWN, ruleIds: ['r-xl'], reason: 'bad_amount', amount: '0.00005', problem: 'too_many_decimals' });
    expect(rateConflictMessage('bad_amount', 'XL Brown', conflict)).toBe('Use up to 4 decimals for a rate.');
  });

  it('names a rule amount or a default that is not a number', () => {
    const bad = compileRateRules({ defaultUnitPrice: '1.95', rules: [{ ...xlAdd, amount: 'abc' }], variants: VARIANTS, handLines: [] });
    expect(rateConflictMessage('bad_amount', 'XL Brown', bad.conflicts[0])).toBe('The rate abc is not a number.');
    const badDefault = compileRateRules({ defaultUnitPrice: 'one ninety five', rules: [xlAdd], variants: VARIANTS, handLines: [] });
    expect(badDefault.conflicts[0]).toMatchObject({ reason: 'bad_amount', amount: 'one ninety five', problem: 'not_number' });
    // A set rule does not need the default, so a bad default does not block it.
    const set = compileRateRules({ defaultUnitPrice: 'one ninety five', rules: [{ ...xlAdd, op: 'set', amount: '2.10' }], variants: VARIANTS, handLines: [] });
    expect(xlBrown(set)?.unitPrice).toBe('2.1000');
  });

  it('treats a default below $0 as no default, and lets only add rules take off', () => {
    const negativeDefault = compileRateRules({ defaultUnitPrice: '-1', rules: [xlAdd], variants: VARIANTS, handLines: [] });
    expect(negativeDefault.lines).toEqual([]);
    expect(negativeDefault.conflicts[0]?.reason).toBe('no_default');
    expect(rateConflictMessage('no_default', 'XL Brown')).toBe('Add a card rate before you add to it.');
    const takeOff = compileRateRules({ defaultUnitPrice: '1.95', rules: [{ ...xlAdd, amount: '-0.20' }], variants: VARIANTS, handLines: [] });
    expect(xlBrown(takeOff)?.unitPrice).toBe('1.7500');
    const negativeSet = compileRateRules({ defaultUnitPrice: '1.95', rules: [{ ...xlAdd, op: 'set', amount: '-0.20' }], variants: VARIANTS, handLines: [] });
    expect(negativeSet.conflicts[0]).toMatchObject({ reason: 'below_zero', ruleIds: ['r-xl'] });
  });

  it('refuses a rate at or above $1,000,000, the database CHECK on every rate column', () => {
    const TOO_LARGE = 'The rate is too large. Use up to $999,999.9999.';
    expect(RATE_TOO_LARGE_MESSAGE).toBe(TOO_LARGE);
    expect(MAX_RATE_SCALED).toBe(BigInt('9999999999'));
    expect(readRateText('999999.9999')).toEqual({ ok: true, scaled: BigInt('9999999999'), price: '999999.9999' });
    expect(readRateText('$999,999.9999')).toEqual({ ok: true, scaled: BigInt('9999999999'), price: '999999.9999' });
    expect(readRateText('1000000')).toEqual({ ok: false, problem: 'too_large' });
    expect(readRateText('2000000')).toEqual({ ok: false, problem: 'too_large' });
    expect(readRateText('-999999.9999', { allowNegative: true })).toMatchObject({ ok: true, price: '-999999.9999' });
    expect(readRateText('-1000000', { allowNegative: true })).toEqual({ ok: false, problem: 'too_large' });
    expect(buildRateProblem('999999.9999')).toBeNull();
    expect(buildRateProblem('1000000')).toBe(TOO_LARGE);
    expect(buildRateProblem('5000000')).toBe(TOO_LARGE);
    expect(cardLineProblem({ kind: 'per_unit', unitPrice: '999999.9999', rateCents: null, amountCents: null })).toBeNull();
    expect(cardLineProblem({ kind: 'per_unit', unitPrice: '1000000', rateCents: null, amountCents: null })).toBe(TOO_LARGE);
    expect(() => resolveUnitPrice({ workDate: '2026-11-02', variantId: null, buildOverride: '1000000', versions: [] })).toThrow(TOO_LARGE);

    const huge = compileRateRules({ defaultUnitPrice: '1.95', rules: [{ ...xlAdd, op: 'set', amount: '1000000' }], variants: VARIANTS, handLines: [] });
    expect(rateConflictMessage('bad_amount', 'XL Brown', huge.conflicts[0])).toBe(TOO_LARGE);
    // set 999,999 plus add 5 is 1,000,004, which the CHECK refuses, so it is a conflict, not a line.
    const sum = compileRateRules({ defaultUnitPrice: '1.95', rules: [{ ...xlAdd, id: 'r-set', op: 'set', amount: '999999' }, { ...xlAdd, amount: '5' }], variants: VARIANTS, handLines: [] });
    expect(sum.lines).toEqual([]);
    expect(sum.conflicts[0]).toMatchObject({ reason: 'bad_amount', amount: '1000004.0000', problem: 'too_large' });
    expect(rateConflictMessage('bad_amount', 'XL Brown', sum.conflicts[0])).toBe(TOO_LARGE);
    const edge = compileRateRules({ defaultUnitPrice: '999999.7499', rules: [xlAdd], variants: VARIANTS, handLines: [] });
    expect(xlBrown(edge)?.unitPrice).toBe('999999.9999');
    const over = compileRateRules({ defaultUnitPrice: '999999.7500', rules: [xlAdd], variants: VARIANTS, handLines: [] });
    expect(over.conflicts[0]).toMatchObject({ reason: 'bad_amount', amount: '1000000.0000', problem: 'too_large' });
  });

  it('refuses fees and hourly rates above the database limits', () => {
    expect(cardLineProblem({ kind: 'per_order', unitPrice: null, rateCents: null, amountCents: '10000000000000' })).toBeNull();
    expect(cardLineProblem({ kind: 'per_order', unitPrice: null, rateCents: null, amountCents: '10000000000001' })).toBe('The batch fee is too large.');
    expect(cardLineProblem({ kind: 'per_order', unitPrice: null, rateCents: null, amountCents: '99999999999999999999' })).toBe('The batch fee is too large.');
    expect(cardLineProblem({ kind: 'flat_monthly', unitPrice: null, rateCents: null, amountCents: '+10000000000001' })).toBe('The monthly fee is too large.');
    expect(cardLineProblem({ kind: 'monthly_minimum', unitPrice: null, rateCents: null, amountCents: '10000000000001' })).toBe('The monthly minimum is too large.');
    expect(cardLineProblem({ kind: 'per_hour', unitPrice: null, rateCents: 10000000, amountCents: null })).toBeNull();
    expect(cardLineProblem({ kind: 'per_hour', unitPrice: null, rateCents: 10000001, amountCents: null })).toBe('The rate per hour is too large.');
    expect(cardLineProblem({ kind: 'per_hour', unitPrice: null, rateCents: 2000000000, amountCents: null })).toBe('The rate per hour is too large.');
    expect(isUsableLine({ kind: 'per_order', unitPrice: null, rateCents: null, amountCents: '99999999999999999999' })).toBe(false);
    expect(isUsableLine({ kind: 'per_hour', unitPrice: null, rateCents: 2000000000, amountCents: null })).toBe(false);
    expect(isUsableLine({ kind: 'per_hour', unitPrice: null, rateCents: 10000000, amountCents: null })).toBe(true);
    expect(isUsableLine({ kind: 'per_order', unitPrice: null, rateCents: null, amountCents: '10000000000000' })).toBe(true);
  });

  it('describes rules typed with $ or that cannot be read without throwing', () => {
    expect(describeRateRule({ op: 'add', amount: '$0.25' }, 'Size', 'XL')).toBe('Size is XL: add $0.25');
    expect(describeRateRule({ op: 'add', amount: '-0.20' }, 'Size', 'XL')).toBe('Size is XL: take off $0.20');
    expect(describeRateRule({ op: 'set', amount: 'abc' }, 'Size', 'XL')).toBe('Size is XL: set abc');
  });
});
