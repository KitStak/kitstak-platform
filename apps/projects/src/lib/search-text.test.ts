import { describe, expect, it } from 'vitest';
import { commentPlainText, excerptAround } from './search-text';

describe('commentPlainText', () => {
  it('turns mention tokens into @Name and drops markdown', () => {
    expect(commentPlainText('Hey @[Maya Chen](user:1a36494e-24f0-44b1-ad16-799053515679), **ship** it `now`')).toBe('Hey @Maya Chen, ship it now');
    expect(commentPlainText('See [the doc](https://x.test) and ![img](a.png)')).toBe('See the doc and');
  });
});

describe('excerptAround', () => {
  const long = `${'a'.repeat(200)} the pallet count is off ${'b'.repeat(200)}`;
  it('centres the snippet on the match with ellipses', () => {
    const out = excerptAround(long, 'pallet');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('pallet count');
    expect(out.length).toBeLessThanOrEqual(162);
  });
  it('falls back to any query word, then the start', () => {
    expect(excerptAround('short note about labels', 'missing labels')).toBe('short note about labels');
    expect(excerptAround('nothing here', 'zzz')).toBe('nothing here');
  });
});
