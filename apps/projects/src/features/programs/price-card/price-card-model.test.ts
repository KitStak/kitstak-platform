import { describe, expect, it } from 'vitest';
import type { CardVersionDTO } from '@/lib/program-types';
import { DEFAULT_PRICE_LINES } from '../editors/price-model';
import { compareVersions, defaultVersionId, deltaText, firstStartDay, railOrder, stateText, toLinePayload, toRulePayload, versionName, versionRanges } from './price-card-model';

const unit = { singular: 'kit', plural: 'kits' };
const version = (id: string, patch: Partial<CardVersionDTO>): CardVersionDTO => ({
  id,
  programId: 'p',
  number: 1,
  status: 'published',
  state: 'in_force',
  effectiveFrom: '2026-11-01',
  label: null,
  note: null,
  source: 'manual',
  reviewStatus: 'none',
  reviewNote: null,
  publishedAt: null,
  publishedBy: null,
  lines: [],
  rules: [],
  summary: null,
  version: 1,
  moneyHidden: false,
  ...patch,
});

describe('price card model', () => {
  const v1 = version('v1', { number: 1, state: 'ended', effectiveFrom: '2026-09-15' });
  const v2 = version('v2', { number: 2, state: 'in_force', effectiveFrom: '2026-11-01', lines: [{ id: 'l1', kind: 'per_unit', variantId: null, ruleId: null, unitPrice: '1.9500', rateCents: null, amountCents: null, prorate: true, chargeWhilePaused: true, label: null, position: 0 }] });
  const v3 = version('v3', { number: 3, state: 'scheduled', effectiveFrom: '2027-01-01', lines: [{ id: 'l2', kind: 'per_unit', variantId: null, ruleId: null, unitPrice: '2.0500', rateCents: null, amountCents: null, prorate: true, chargeWhilePaused: true, label: null, position: 0 }, { id: 'l3', kind: 'flat_monthly', variantId: null, ruleId: null, unitPrice: null, rateCents: null, amountCents: '150000', prorate: true, chargeWhilePaused: true, label: null, position: 1 }] });
  const draft = version('d', { number: null, status: 'draft', state: 'draft', effectiveFrom: '2026-12-01' });

  it('names and dates versions', () => {
    expect(versionName(draft)).toBe('Draft');
    expect(stateText(v3)).toBe('Starts Jan 1');
    const ranges = versionRanges([v1, v2, v3, draft]);
    expect(ranges.get('v1')).toBe('Sep 15 to Oct 31');
    expect(ranges.get('v2')).toBe('Nov 1 to now');
    expect(ranges.get('v3')).toBe('From Jan 1');
    expect(ranges.get('d')).toBe('Would start Dec 1');
  });

  it('orders the rail and opens the version in force', () => {
    expect(railOrder([v1, v2, v3, draft]).map((entry) => entry.id)).toEqual(['d', 'v3', 'v2', 'v1']);
    expect(defaultVersionId([v1, v2, v3], null)).toBe('v2');
    expect(defaultVersionId([v1, v2, v3], 'v3')).toBe('v3');
  });

  it('compares two versions line by line', () => {
    const rows = compareVersions(v2, v3, unit, () => null);
    expect(rows.map((row) => [row.label, row.left, row.right, row.state])).toEqual([
      ['Per kit', '$1.95', '$2.05', 'changed'],
      ['Monthly fee', null, '$1,500.00', 'added'],
    ]);
  });

  it('builds the draft payload with variant ids', () => {
    const value = { ...DEFAULT_PRICE_LINES, perUnit: { on: true, price: '1.95', label: null }, variantRates: { 'S-BR': '2.10', GONE: '9' } };
    const lines = toLinePayload(value, [{ id: 'id-sbr', key: 'S-BR' }]);
    expect(lines.find((line) => line.variantId === 'id-sbr')?.unitPrice).toBe('2.1000');
    expect(lines.some((line) => line.variantKey)).toBe(false);
    expect(toRulePayload([{ id: 'r', attributeId: 'a', valueId: 'v', op: 'add', amount: '$0.25' }, { id: 'r2', attributeId: 'a', valueId: 'w', op: 'add', amount: '' }])).toEqual([{ attributeId: 'a', valueId: 'v', op: 'add', amount: '0.25' }]);
  });

  it('words deltas and start days', () => {
    expect(deltaText('12000', 300)).toBe('+$120.00 (+3.0%)');
    expect(deltaText('0', null)).toBe('No change');
    expect(firstStartDay('2026-11-25', '2026-10-31', false)).toBe('2026-11-25');
    expect(firstStartDay('2026-11-25', '2026-10-31', true)).toBe('2026-11-01');
  });
});
