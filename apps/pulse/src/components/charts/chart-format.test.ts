import { describe, expect, it } from 'vitest';
import { resolveFormat } from './chart-format';

describe('money on chart labels', () => {
  const money = resolveFormat('money');

  it('small amounts read as whole dollars, never half dollars like "-$502.5"', () => {
    expect(money.axis(-50250)).toBe('-$503');
    expect(money.axis(-59060)).toBe('-$591');
    expect(money.axis(95000)).toBe('$950');
  });

  it('big amounts stay short', () => {
    expect(money.axis(4821000)).toBe('$48.2K');
  });
});
