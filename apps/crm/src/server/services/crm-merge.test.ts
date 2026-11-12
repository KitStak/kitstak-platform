import { describe, expect, it } from 'vitest';
import { buildPrimaryPatch, isEmptyValue, type MergeColumn } from './crm-merge';

const col = (key: string, type = 'text', settings: unknown = {}): MergeColumn => ({ key, title: key.toUpperCase(), type, scope: 'item', settings });

const columns = [col('name'), col('email', 'email'), col('title'), col('phone', 'phone'), col('deals', 'connect_boards'), col('formula', 'formula')];

describe('buildPrimaryPatch', () => {
  const primary = { id: 'p', values: { email: { email: 'a@acme.com' }, title: 'CTO', deals: { itemIds: ['d1'] } } };
  const dup = { id: 'x', values: { email: { email: 'ann@acme.com' }, title: 'VP', phone: { phone: '+1' }, deals: { itemIds: ['d2', 'p'] }, formula: 1 } };

  it('keeps the primary values and fills only empty fields by default', () => {
    const { patch, filled } = buildPrimaryPatch(columns, primary, [dup]);
    expect(patch).toEqual({ phone: { phone: '+1' }, deals: { itemIds: ['d1', 'd2'] } });
    expect(filled).toEqual(['PHONE']);
  });

  it('applies explicit field choices from a duplicate', () => {
    const { patch, filled } = buildPrimaryPatch(columns, primary, [dup], { email: 'x', title: 'p' });
    expect(patch.email).toEqual({ email: 'ann@acme.com' });
    expect(patch.title).toBeUndefined();
    expect(filled).toContain('EMAIL');
  });

  it('never points relations at merged-away records and respects single-link columns', () => {
    const single = [col('account', 'connect_boards', { allowMultiple: false })];
    const { patch } = buildPrimaryPatch(single, { id: 'p', values: {} }, [{ id: 'x', values: { account: { itemIds: ['a1', 'a2', 'x'] } } }]);
    expect(patch).toEqual({ account: { itemIds: ['a1'] } });
  });

  it('skips computed columns', () => {
    const { patch } = buildPrimaryPatch(columns, { id: 'p', values: {} }, [dup]);
    expect(patch).not.toHaveProperty('formula');
  });
});

describe('isEmptyValue', () => {
  it('treats null, empty string and empty arrays as empty', () => {
    expect([undefined, null, '', []].every(isEmptyValue)).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
  });
});
