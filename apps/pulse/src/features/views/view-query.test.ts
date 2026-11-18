import { describe, expect, it } from 'vitest';
import { describeQuery, normalizeQuery, readViewConfig, toViewConfig, viewHref } from './view-query';

describe('saved view queries', () => {
  it('treats two addresses that show the same thing as equal', () => {
    expect(normalizeQuery('?to=2026-11-30&from=2026-11-01&client=abc')).toBe('client=abc&from=2026-11-01&to=2026-11-30');
    expect(normalizeQuery('from=2026-11-01&client=abc&to=2026-11-30')).toBe(normalizeQuery(new URLSearchParams({ client: 'abc', to: '2026-11-30', from: '2026-11-01' })));
  });

  it('drops empty values and ignored keys', () => {
    expect(normalizeQuery('q=&section=audit&actor=1', ['section'])).toBe('actor=1');
    expect(normalizeQuery(null)).toBe('');
  });

  it('keeps repeated keys and odd characters', () => {
    expect(normalizeQuery('cols=b&cols=a&q=J-1042 kits')).toBe('cols=a&cols=b&q=J-1042+kits');
  });

  it('round trips through a stored config', () => {
    const config = toViewConfig('status=active&from=2026-01-01', ['page']);
    expect(readViewConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(readViewConfig({ filters: {} })).toEqual({ query: '' });
    expect(readViewConfig(null)).toEqual({ query: '' });
    expect(viewHref('/export', config)).toBe('/export?from=2026-01-01&status=active');
    expect(viewHref('/export', { query: '' })).toBe('/export');
  });

  it('describes a query in plain words', () => {
    expect(describeQuery('')).toBe('No filters');
    expect(describeQuery('a=1')).toBe('1 filter');
    expect(describeQuery('a=1&b=2&b=3')).toBe('2 filters');
  });
});
