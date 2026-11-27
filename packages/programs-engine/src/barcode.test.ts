import { describe, expect, it } from 'vitest';
import { canEncode128, code128, code128Pattern, code128Width } from './barcode';

describe('Code 128 patterns', () => {
  it('every symbol is 11 modules with even bars and odd spaces, all different', () => {
    const seen = new Set<string>();
    for (let value = 0; value <= 105; value += 1) {
      const pattern = code128Pattern(value);
      expect(pattern).toHaveLength(6);
      expect(pattern.reduce((sum, width) => sum + width, 0)).toBe(11);
      expect(((pattern[0] as number) + (pattern[2] as number) + (pattern[4] as number)) % 2).toBe(0);
      seen.add(pattern.join(''));
    }
    expect(seen.size).toBe(106);
    expect(code128Pattern(106).reduce((sum, width) => sum + width, 0)).toBe(13);
    expect(() => code128Pattern(107)).toThrow(RangeError);
  });
});

describe('code128', () => {
  it('computes the check symbol', () => {
    // 104 + 48*1 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7 = 879, and 879 mod 103 = 55.
    expect(code128('PJJ123C').checksum).toBe(55);
    expect(code128('GLOVE-212').checksum).toBe((104 + [39, 44, 47, 54, 37, 13, 18, 17, 18].reduce((sum, value, index) => sum + value * (index + 1), 0)) % 103);
  });
  it('lays out start, data, check and stop', () => {
    const { bars } = code128('A');
    expect(bars.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
    expect(bars.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
    expect(code128Width(bars)).toBe(11 * 3 + 13);
  });
  it('takes printable characters only', () => {
    expect(canEncode128('GLOVE-212')).toBe(true);
    expect(canEncode128('')).toBe(false);
    expect(canEncode128('é')).toBe(false);
    expect(() => code128('tab\there')).toThrow(RangeError);
  });
});
