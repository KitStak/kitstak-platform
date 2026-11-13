import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats whole units in a fixed locale', () => {
    expect(formatMoney(420_000, 'USD')).toBe('$420,000');
    expect(formatMoney(305_000, 'usd')).toBe('$305,000');
    expect(formatMoney(150_000, null)).toBe('$150,000');
    expect(formatMoney(1234.6, 'USD')).toBe('$1,235');
  });
  it('falls back for unknown currency codes', () => {
    expect(formatMoney(120_000, 'NOPE')).toBe('120,000 NOPE');
  });
});
