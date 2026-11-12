/** Round 3 parity loop (M12): local-day bucketing, nice ticks, relative dates, brand text, labels, imports. */
import { describe, expect, it } from 'vitest';
import { dayKeyInZone, lastDaysInZone, niceTicks, safeTimeZone } from '@/lib/grid-defs/integrations/time';
import { brandText } from '@/lib/grid-defs/integrations/common';
import {
  RELATIVE_DATES_SUPPORTED,
  comparatorsFor,
  PUTAWAY_CONDITION_FIELDS,
} from '@/lib/grid-defs/integrations/rule-fields';
import { matchesDateSpec, evaluateCondition } from '@/server/domain/conditions';
import { connectionLabelOf } from '@/server/repositories/carriers';
import { importTitle, unavailableReason } from '@/components/integrations/imports-hub';
import { mergeApplyFailures } from '@/server/imports/pipeline';
import type { ImportPreview } from '@/server/imports/validate';

describe('local-day bucketing', () => {
  it("puts an 11:46 PM Chicago event on that evening's day, not the next UTC day", () => {
    expect(dayKeyInZone('2026-11-10T05:46:00.839Z', 'America/Chicago')).toBe('2026-11-09');
    expect(dayKeyInZone('2026-11-10T05:46:00.839Z', 'UTC')).toBe('2026-11-10');
    expect(dayKeyInZone('bad', 'UTC')).toBe('');
  });
  it('lists the last N local days ending today, DST-safe', () => {
    const days = lastDaysInZone(new Date('2026-11-10T05:00:00Z'), 14, 'America/Chicago');
    expect(days).toHaveLength(14);
    expect(days.at(-1)).toBe('2026-11-09');
    expect(days[0]).toBe('2026-10-27');
    expect(new Set(days).size).toBe(14);
  });
  it('falls back for unknown zones', () => {
    expect(safeTimeZone('Not/AZone')).toBe('America/Chicago');
    expect(safeTimeZone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(safeTimeZone('', 'UTC')).toBe('UTC');
  });
});

describe('niceTicks', () => {
  it('gives evenly spaced round ticks', () => {
    expect(niceTicks(33)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
    expect(niceTicks(18)).toEqual({ max: 20, ticks: [0, 5, 10, 15, 20] });
    expect(niceTicks(0)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceTicks(158).ticks.every((t, i, a) => i === 0 || t - (a[i - 1] ?? 0) === (a[1] ?? 0))).toBe(
      true,
    );
  });
});

describe('relative date comparator (dateIs)', () => {
  const now = new Date('2026-11-10T15:00:00Z');
  it('is enabled in the comparator list', () => {
    expect(RELATIVE_DATES_SUPPORTED).toBe(true);
    expect(comparatorsFor('date')).toContain('dateIs');
  });
  it('matches date-only facts by calendar day', () => {
    expect(matchesDateSpec('2026-11-10', 'today', now)).toBe(true);
    expect(matchesDateSpec('2026-11-25', 'withinNext30d', now)).toBe(true);
    expect(matchesDateSpec('2027-01-25', 'withinNext30d', now)).toBe(false);
    expect(matchesDateSpec('2026-11-05', 'last7d', now)).toBe(true);
    expect(matchesDateSpec('2026-10-01', 'last7d', now)).toBe(false);
    expect(matchesDateSpec('2026-11-20', 'ahead5d', now)).toBe(true);
  });
  it('matches timestamps and rejects blanks and bad specs', () => {
    expect(matchesDateSpec('2026-11-10T09:00:00Z', 'today', now)).toBe(true);
    expect(matchesDateSpec(null, 'today', now)).toBe(false);
    expect(matchesDateSpec('2026-11-10', 'nonsense', now)).toBe(false);
  });
  it('evaluates through evaluateCondition', () => {
    expect(
      evaluateCondition(
        { field: 'expiryDate', comparator: 'dateIs', value: 'withinNext3650d' },
        { expiryDate: '2027-01-01' },
      ),
    ).toBe(true);
  });
});

describe('putaway If list', () => {
  it('offers the custom-field slots now wired in ruleFacts', () => {
    const keys = PUTAWAY_CONDITION_FIELDS.map((f) => f.key);
    for (const k of [
      'allocatedTransferQuantity',
      'isPreventAllocation',
      'lpCarrier',
      'isParentLpTransfer',
      'productCustomField.toggle1',
      'locationCustomField.date1',
      'lpTypeCustomField.textBox1',
    ])
      expect(keys).toContain(k);
  });
});

describe('brandText', () => {
  it('normalises legacy and catalog spellings to KitStak', () => {
    expect(brandText('One or more SKUs in the order were not found in KitStaks')).toBe(
      'One or more SKUs in the order were not found in KitStak',
    );
    expect(brandText('could not be created in LogiwaIO')).toBe('could not be created in KitStak');
    expect(brandText('KitStak Sandbox')).toBe('KitStak Sandbox');
    expect(brandText(null)).toBeNull();
  });
});

describe('carrier connection label', () => {
  it('does not repeat the carrier when the setup is named after it', () => {
    expect(connectionLabelOf('KitStak Sandbox', 'kitstaks-sandbox')).toBe('KitStak Sandbox');
    expect(connectionLabelOf('Main', 'ups')).toBe('Main - UPS');
    expect(connectionLabelOf('', 'fedex')).toBe('FEDEX');
  });
});

describe('imports hub', () => {
  it('upper-cases acronyms in titles', () => {
    expect(importTitle('Bulk Import Vas Operations')).toBe('Bulk Import VAS Operations');
    expect(importTitle('Import Po Serial Numbers')).toBe('Import PO Serial Numbers');
    expect(importTitle('Import Products')).toBe('Import Products');
  });
  it('explains unconfigured imports', () => {
    expect(unavailableReason({ configured: true, title: 'X' })).toBeNull();
    expect(unavailableReason({ configured: false, title: 'Bulk Import Users' })).toMatch(
      /isn't available yet/,
    );
  });
  it('folds dry-run apply failures into the preview', () => {
    const preview: ImportPreview = {
      configured: true,
      totalRows: 2,
      validCount: 2,
      errorCount: 0,
      missingColumns: [],
      unknownColumns: [],
      rows: [
        { rowNumber: 2, valid: true, errors: [], values: {} },
        { rowNumber: 3, valid: true, errors: [], values: {} },
      ],
    };
    const merged = mergeApplyFailures(preview, new Map([[3, 'Client ACME not found']]));
    expect(merged.validCount).toBe(1);
    expect(merged.errorCount).toBe(1);
    expect(merged.rows[0]).toMatchObject({ rowNumber: 3, valid: false, errors: ['Client ACME not found'] });
    expect(mergeApplyFailures(preview, new Map())).toBe(preview);
  });
});

describe('allocation inventory facts', () => {
  it('exposes location custom-field slots', async () => {
    const { bucketFacts } = await import('@/server/domain/facts');
    const { INVENTORY_CONDITION_FIELDS } = await import('@/lib/grid-defs/integrations/rule-fields');
    const facts = bucketFacts(
      { onHand: 5, allocated: 1 } as never,
      { customFields: { toggle1: true }, code: 'A-1' } as never,
      null,
    );
    expect(facts['locationCustomField.toggle1']).toBe(true);
    expect(facts['locationCustomField.textBox1']).toBeNull();
    expect(INVENTORY_CONDITION_FIELDS.map((f) => f.key)).toContain('locationCustomField.date1');
  });
});
