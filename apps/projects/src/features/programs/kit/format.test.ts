import { describe, expect, it } from 'vitest';
import { dayLabel, doneOfText, healthBasisText, keyInitials, lockText, moneyOrNull, paletteColor, qtyOfText, qtyPercent, qtyTone, rangeLabel, runLineText, targetText, targetTone } from './format';
import { readQty, remainingText, trimQty } from './qty-input';

const kits = { singular: 'kit', plural: 'kits' };

describe('kit format', () => {
  it('labels days and ranges', () => {
    expect(dayLabel('2026-11-25')).toBe('Wed Nov 25');
    expect(rangeLabel('2026-11-23', '2026-11-29')).toBe('Nov 23 to Nov 29');
    expect(rangeLabel('2026-11-25', '2026-11-25')).toBe('Wed Nov 25');
  });

  it('writes qty and done text with words', () => {
    expect(qtyOfText('60.000', '100.000', kits)).toBe('60 of 100 kits');
    expect(qtyOfText('0', '1.000', kits)).toBe('0 of 1 kit');
    expect(doneOfText(5, 8)).toBe('5 of 8 builds done');
    expect(doneOfText(1, 1)).toBe('1 of 1 build done');
    expect(doneOfText(5, 8, 'done')).toBe('5 of 8 done');
    expect(runLineText({ date: '2026-11-25', name: 'Weekday glove run', builtUnits: '560.000', plannedUnits: '800.000', done: 5, builds: 8 }, kits)).toBe('Wed Nov 25 · Weekday glove run · 560 of 800 kits · 5 of 8 done');
    expect(runLineText({ date: '2026-11-25', name: 'Unscheduled', builtUnits: '0', plannedUnits: '10', done: 0, builds: 1 }, kits, { withDate: false })).toBe('Unscheduled · 0 of 10 kits · 0 of 1 done');
  });

  it('picks progress percent and tone without float money math', () => {
    expect(qtyPercent('60', '100')).toBe(60);
    expect(qtyPercent('150', '100')).toBe(100);
    expect(qtyPercent('5', '0')).toBe(100);
    expect(qtyPercent('0', '0')).toBe(0);
    expect(qtyTone('100.000', '100')).toBe('success');
    expect(qtyTone('101', '100')).toBe('warning');
    expect(qtyTone('99', '100')).toBe('primary');
  });

  it('colors target chips by percent', () => {
    expect(targetTone(10_500)).toBe('success');
    expect(targetTone(10_000)).toBe('success');
    expect(targetTone(9_200)).toBe('warning');
    expect(targetTone(8_100)).toBe('danger');
    expect(targetText(10_500)).toBe('105% of target');
    expect(targetText(21_672)).toBe('217% of target');
  });

  it('explains health and locks', () => {
    expect(healthBasisText('money_target', true)).toMatch(/monthly revenue target/);
    expect(healthBasisText('plan', false)).toBe('Set by hand by an owner.');
    expect(healthBasisText(null, true)).toMatch(/Not enough data/);
    expect(lockText('2026-10-31')).toBe('Closed through Oct 31');
  });

  it('formats money only through the engine and hides null', () => {
    expect(moneyOrNull('2997040')).toBe('$29,970.40');
    expect(moneyOrNull(null)).toBeNull();
    expect(moneyOrNull('3370840', { compact: true })).toBe('$34K');
  });

  it('maps colors to the label palette', () => {
    expect(paletteColor('amber')).toBe('orange');
    expect(paletteColor('brown')).toBe('brown');
    expect(paletteColor('nope', 'gray')).toBe('gray');
    expect(paletteColor(null)).toBe('orange');
    expect(keyInitials('glove')).toBe('GL');
  });
});

describe('qty input', () => {
  it('reads typed qty with the engine message table', () => {
    expect(readQty('')).toEqual({ ok: true, qty: null });
    expect(readQty('1,200')).toEqual({ ok: true, qty: '1200.000' });
    expect(readQty('12.5')).toEqual({ ok: true, qty: '12.500' });
    const bad = readQty('abc');
    expect(bad.ok).toBe(false);
    const price = readQty('$10');
    expect(price.ok).toBe(false);
  });

  it('fills the remaining qty', () => {
    expect(remainingText('100.000', '60.000')).toBe('40');
    expect(remainingText('100', '120')).toBe('0');
    expect(remainingText('10.500', '0')).toBe('10.5');
    expect(trimQty('40.000')).toBe('40');
    expect(trimQty('12.500')).toBe('12.5');
    expect(trimQty('7')).toBe('7');
  });
});
