import { describe, expect, it } from 'vitest';
import { amountError } from '../convert/convert-lead-dialog';
import { niceMax as forecastNiceMax } from '../pipeline/forecast-chart';
import { funnelWidth } from '../pipeline/funnel';
import { intFieldError, quotaFieldError } from '../pipeline/settings-dialog';
import { timeSlots } from '../records/activity-composer';

describe('CRM form validation', () => {
  it('validates the deal amount', () => {
    expect(amountError('')).toBeNull();
    expect(amountError('1200')).toBeNull();
    expect(amountError('-50')).toMatch(/negative/);
    expect(amountError('abc')).toMatch(/number/);
  });

  it('validates stage probabilities and stale days', () => {
    expect(intFieldError('40', 0, 100)).toBeNull();
    expect(intFieldError('250', 0, 100, '%')).toBe('Between 0 and 100%');
    expect(intFieldError('12.5', 0, 100)).toMatch(/Whole/);
    expect(intFieldError('', 1, 365)).toBe('Required');
  });

  it('validates quotas', () => {
    expect(quotaFieldError('')).toBeNull();
    expect(quotaFieldError('-1')).toMatch(/negative/);
  });
});

describe('chart helpers', () => {
  it('rounds axis maxima to nice numbers', () => {
    expect(forecastNiceMax(0)).toBe(1);
    expect(forecastNiceMax(830_000)).toBe(1_000_000);
    expect(forecastNiceMax(2_100_000)).toBe(2_500_000);
    expect(forecastNiceMax(41_000)).toBe(50_000);
  });

  it('sizes funnel bars without a minimum for empty stages', () => {
    expect(funnelWidth(0, 10)).toBe(0);
    expect(funnelWidth(10, 10)).toBe(100);
    expect(funnelWidth(1, 1000)).toBe(3);
  });

  it('builds 15-minute time slots', () => {
    const slots = timeSlots();
    expect(slots).toHaveLength(97);
    expect(slots[0]?.value).toBe('none');
    expect(slots.find((slot) => slot.value === '13:45')?.label).toBe('1:45 PM');
    expect(slots[1]?.label).toBe('12:00 AM');
  });
});
