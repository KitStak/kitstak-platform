import { describe, expect, it } from 'vitest';
import { formatStorage, retentionLabel, roleChangeNeedsConfirm, sortRows } from './format';
import { interceptableHref } from './use-unsaved-guard';

describe('sortRows', () => {
  const rows = [
    { name: 'bob', at: 2 },
    { name: 'Alice', at: null },
    { name: 'carol', at: 1 },
  ];
  it('sorts strings case-insensitively and keeps nulls last in both directions', () => {
    expect(sortRows(rows, (row) => row.name, 'asc').map((row) => row.name)).toEqual(['Alice', 'bob', 'carol']);
    expect(sortRows(rows, (row) => row.at, 'asc').map((row) => row.name)).toEqual(['carol', 'bob', 'Alice']);
    expect(sortRows(rows, (row) => row.at, 'desc').map((row) => row.name)).toEqual(['bob', 'carol', 'Alice']);
  });
  it('does not mutate the input', () => {
    const copy = [...rows];
    sortRows(rows, (row) => row.name, 'desc');
    expect(rows).toEqual(copy);
  });
});

describe('display helpers', () => {
  it('formats small storage in words', () => {
    expect(formatStorage(22)).toBe('22 bytes');
    expect(formatStorage(1)).toBe('1 byte');
    expect(formatStorage(2048)).toBe('2.0 KB');
  });
  it('clamps retention to "Today"', () => {
    expect(retentionLabel(-3)).toBe('Today');
    expect(retentionLabel(0)).toBe('Today');
    expect(retentionLabel(1)).toBe('1 day');
    expect(retentionLabel(12)).toBe('12 days');
  });
  it('requires confirmation for escalation and admin demotion only', () => {
    expect(roleChangeNeedsConfirm('member', 'owner')).toBe(true);
    expect(roleChangeNeedsConfirm('viewer', 'admin')).toBe(true);
    expect(roleChangeNeedsConfirm('admin', 'member')).toBe(true);
    expect(roleChangeNeedsConfirm('member', 'viewer')).toBe(false);
    expect(roleChangeNeedsConfirm('admin', 'admin')).toBe(false);
  });
});

describe('unsaved-changes guard', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const anchor = (href: string, attrs: Record<string, string> = {}) =>
    ({ href, target: attrs.target ?? '', hasAttribute: (name: string) => name in attrs }) as unknown as HTMLAnchorElement;
  const origin = 'http://localhost:3100';

  it('intercepts same-origin navigation away from the page', () => {
    expect(interceptableHref(click, anchor(`${origin}/acme/admin/users`), origin, '/acme/admin')).toBe('/acme/admin/users');
  });
  it('lets modified clicks, new tabs, downloads, other origins and same-page links through', () => {
    expect(interceptableHref({ ...click, metaKey: true }, anchor(`${origin}/x`), origin, '/a')).toBeNull();
    expect(interceptableHref(click, anchor(`${origin}/x`, { target: '_blank' }), origin, '/a')).toBeNull();
    expect(interceptableHref(click, anchor(`${origin}/x`, { download: '' }), origin, '/a')).toBeNull();
    expect(interceptableHref(click, anchor('https://example.com/x'), origin, '/a')).toBeNull();
    expect(interceptableHref(click, anchor(`${origin}/a#top`), origin, '/a')).toBeNull();
    expect(interceptableHref(click, null, origin, '/a')).toBeNull();
  });
});
