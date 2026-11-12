import { describe, expect, it } from 'vitest';
import { changeLogValue, cleanChangeMessage } from '@/lib/grid-defs/facility/common';
import {
  lpTypeGeneralSchema,
  lpTypeInUseReason,
  maxWeightIssue,
  LP_TYPE_DEFAULTS,
} from '@/lib/grid-defs/facility/lp-types';
import { packageDeleteCopy } from '@/lib/grid-defs/facility/shipment-packages';
import { CUSTOM_FIELD_SORT_KEYS, customFieldSql } from '@/server/repositories/custom-field-sql';
import * as shared from '@/server/repositories/locations-shared';
import * as s from '@/server/db/schema';

const unused = { shipmentCount: 0, orderCount: 0, productCount: 0 };

describe('round 7 parity fixes', () => {
  it('customFieldSql lives in a dependency-free leaf and is re-exported unchanged', () => {
    expect(typeof customFieldSql).toBe('function');
    expect(shared.customFieldSql).toBe(customFieldSql);
    expect(Object.keys(customFieldSql(s.locations.customFields))).toEqual(CUSTOM_FIELD_SORT_KEYS);
    expect(CUSTOM_FIELD_SORT_KEYS).toHaveLength(10);
  });

  it("shipment package delete copy only mentions 'used' when a package is blocked", () => {
    expect(packageDeleteCopy([unused])).toBe("The package is removed permanently. This can't be undone.");
    expect(packageDeleteCopy([unused])).not.toMatch(/used/);
    expect(packageDeleteCopy([{ ...unused, shipmentCount: 2 }])).toBe(
      'Used by 2 shipments; set it inactive instead.',
    );
    expect(packageDeleteCopy([unused, { ...unused, orderCount: 1 }])).toMatch(
      /1 of them has been used .* skipped; set it inactive instead\.$/,
    );
  });

  it('LP type max weight must be at least the empty weight (0 = no limit)', () => {
    expect(maxWeightIssue(20, 10)).toBe('Max weight must be at least the empty weight');
    expect(maxWeightIssue(20, 0)).toBeNull();
    expect(maxWeightIssue(10, 20)).toBeNull();
    const base = { ...LP_TYPE_DEFAULTS, warehouseId: 'w', code: 'PC', numberPrefix: 'PC-', numberLength: 5 };
    const r = lpTypeGeneralSchema.safeParse({ ...base, emptyWeight: 20, maxWeight: 10 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['maxWeight']);
  });

  it('LP type in-use tooltip is pluralised', () => {
    expect(lpTypeInUseReason(1)).toBe('1 LP number uses this type. Delete unused LPs in LP Numbers first.');
    expect(lpTypeInUseReason(2)).toBe('2 LP numbers use this type. Delete unused LPs in LP Numbers first.');
    expect(lpTypeInUseReason(1200)).toBe(
      '1,200 LP numbers use this type. Delete unused LPs in LP Numbers first.',
    );
  });

  it('change-log values and messages never render an empty side', () => {
    expect(changeLogValue('')).toBe('(blank)');
    expect(changeLogValue(null)).toBe('(blank)');
    expect(changeLogValue('  ')).toBe('(blank)');
    expect(changeLogValue('Z')).toBe('Z');
    expect(cleanChangeMessage('Aisle is modified.  --> Z')).toBe('Aisle is modified. (blank) → Z');
    expect(cleanChangeMessage('Max Sku Qty is modified. 7 →')).toBe('Max SKU Qty is modified. 7 → (blank)');
    expect(cleanChangeMessage('Walking path is modified. 3 --> 55')).toBe('Walking path is modified. 3 → 55');
    expect(cleanChangeMessage('Location A-01 created.')).toBe('Location A-01 created.');
  });
});
