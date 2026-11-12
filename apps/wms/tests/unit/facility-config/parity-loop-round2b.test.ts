/** Round 2 critic (6.4) fixes: address/phone validation, max volume, custom fields, wizard server-error routing, tabs, ranges, cart cell names. */
import { describe, expect, it } from 'vitest';
import {
  boxVolume,
  customFieldValuesSchema,
  maxVolumeIssue,
  CUSTOM_FIELD_FILTER_FIELDS,
} from '@/lib/grid-defs/facility/common';
import {
  normalizeWarehouseAddress,
  phoneError,
  warehousePostalError,
  warehouseSchema,
  WAREHOUSE_DEFAULTS,
  WAREHOUSE_INFO_KEYS,
} from '@/lib/grid-defs/facility/warehouses';
import { packageGeneralSchema, SHIPMENT_PACKAGE_DEFAULTS } from '@/lib/grid-defs/facility/shipment-packages';
import {
  LOCATION_FIELDS,
  LOCATION_INFO_DEFAULTS,
  LOCATION_SORT_FIELDS,
  locationSaveSchema,
  mergeLocationPatch,
  type LocationRecordForMerge,
} from '@/lib/grid-defs/facility/locations';
import { LP_TYPE_DEFAULTS, LP_TYPE_FIELDS, lpTypeSchema } from '@/lib/grid-defs/facility/lp-types';
import { cellDisplayName, cellName } from '@/lib/grid-defs/facility/mobile-carts';
import { takenIssues } from '@/components/facility/wizard-guard';
import { rangeMessage } from '@/components/facility/form-controls';
import { tabFromParam } from '@/components/locations/location-detail-page';
import { savedPatch, newLocationForm } from '@/components/locations/location-wizard';

const validWarehouse = {
  ...WAREHOUSE_DEFAULTS,
  code: 'MLT9',
  name: 'Memphis 9',
  prefix: 'M9',
  addressLine: '1 Main St',
  city: 'Memphis',
  state: 'Tennessee',
  country: 'USA',
  postalCode: '38103',
  contactName: 'Pat',
  contactPhone: '+1 (901) 555-0100',
};

describe('warehouse address validation', () => {
  it('validates postal codes per country', () => {
    expect(warehousePostalError('United States', '38103')).toBeNull();
    expect(warehousePostalError('United States', '38103-1234')).toBeNull();
    expect(warehousePostalError('United States', 'abc')).toMatch(/ZIP/);
    expect(warehousePostalError('Canada', 'K1A 0B1')).toBeNull();
    expect(warehousePostalError('Canada', '12345')).toMatch(/Canadian/);
    expect(warehousePostalError('Germany', '10115')).toBeNull();
    expect(warehousePostalError('Germany', '!')).toMatch(/2-10/);
  });

  it('accepts E.164 / national phones and rejects junk', () => {
    expect(phoneError('+15551234567')).toBeNull();
    expect(phoneError('(901) 555-0100 ext 12')).toBeNull();
    expect(phoneError('not a phone')).toMatch(/digits/);
    expect(phoneError('12345')).toMatch(/7 to 15/);
    expect(phoneError('')).toBeNull();
  });

  it('server schema rejects Narnia / bad phone and normalises a valid address', () => {
    const bad = warehouseSchema.safeParse({
      ...validWarehouse,
      country: 'Narnia',
      contactPhone: 'not a phone',
    });
    expect(bad.success).toBe(false);
    const paths = bad.success ? [] : bad.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['country', 'contactPhone']));
    const ok = warehouseSchema.safeParse(validWarehouse);
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.country).toBe('United States');
      expect(ok.data.state).toBe('TN');
    }
    expect(normalizeWarehouseAddress({ country: 'Canada', state: 'ontario', postalCode: 'k1a0b1' })).toEqual({
      country: 'Canada',
      state: 'ON',
      postalCode: 'K1A 0B1',
    });
  });

  it('knows which fields belong to the Information step', () => {
    expect(WAREHOUSE_INFO_KEYS.has('code')).toBe(true);
    expect(WAREHOUSE_INFO_KEYS.has('defaultReceivingLocationId')).toBe(false);
  });
});

describe('max volume vs box volume', () => {
  it('converts units', () => {
    expect(boxVolume(12, 10, 8, 'Inch', 'Cubic Inch')).toBeCloseTo(960);
    expect(boxVolume(1, 1, 1, 'Foot', 'Cubic Inch')).toBeCloseTo(1728);
    expect(boxVolume(0, 1, 1, 'Inch', 'Cubic Inch')).toBeNull();
  });
  it('flags a max volume larger than the box', () => {
    expect(
      maxVolumeIssue({
        length: 12,
        width: 10,
        height: 8,
        dimensionUnit: 'Inch',
        volumeUnit: 'Cubic Inch',
        maxVolume: 5000,
      }),
    ).toMatch(/960/);
    expect(
      maxVolumeIssue({
        length: 12,
        width: 10,
        height: 8,
        dimensionUnit: 'Inch',
        volumeUnit: 'Cubic Inch',
        maxVolume: 900,
      }),
    ).toBeNull();
    const r = packageGeneralSchema.safeParse({
      ...SHIPMENT_PACKAGE_DEFAULTS,
      warehouseId: 'w',
      code: 'BOX',
      length: 12,
      width: 10,
      height: 8,
      maxVolume: 5000,
    });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toContain('maxVolume');
  });
});

describe('custom fields on locations and LP types', () => {
  it('accepts known slots, drops empties, rejects unknown slots', () => {
    expect(
      customFieldValuesSchema.parse({ textBox1: 'Blue', toggle1: true, date1: '', dropDown1: null }),
    ).toEqual({ textBox1: 'Blue', toggle1: true });
    expect(customFieldValuesSchema.safeParse({ hacker: 'x' }).success).toBe(false);
  });
  it('is part of the location save document, merge and grid fields', () => {
    const parsed = locationSaveSchema.parse({
      info: { ...LOCATION_INFO_DEFAULTS, code: 'X-1', warehouseId: 'w' },
      customFields: { textBox2: 'Cold' },
    });
    expect(parsed.customFields).toEqual({ textBox2: 'Cold' });
    const stored = {
      ...LOCATION_INFO_DEFAULTS,
      code: 'X-1',
      warehouseId: 'w',
      locationGroupId: null,
      locationZoneId: null,
      rack: null,
      bay: null,
      level: null,
      barcode: null,
      displayMember: null,
      colorCode: null,
      mezzanine: null,
      aisle: null,
      position: null,
      version: 3,
      productCapacities: [],
      lpCapacities: [],
      customFields: { toggle1: true },
    } as unknown as LocationRecordForMerge;
    expect(mergeLocationPatch(stored, { info: { aisle: 'B' } }).customFields).toEqual({ toggle1: true });
    expect(mergeLocationPatch(stored, { customFields: { textBox1: 'Z' } }).customFields).toEqual({
      textBox1: 'Z',
    });
    expect(LOCATION_FIELDS.map((f) => f.field)).toEqual(
      expect.arrayContaining(['customField.textBox1', 'customField.date3', 'customField.toggle2']),
    );
    expect(LOCATION_SORT_FIELDS).toContain('customField.dropDown2');
    expect(CUSTOM_FIELD_FILTER_FIELDS).toHaveLength(10);
  });
  it('is part of the LP type save document and exposes the full flag set as filters', () => {
    expect(
      lpTypeSchema.parse({
        ...LP_TYPE_DEFAULTS,
        warehouseId: 'w',
        code: 'TOTE',
        numberPrefix: 'T-',
        customFields: { textBox1: 'Blue' },
      }).customFields,
    ).toEqual({ textBox1: 'Blue' });
    expect(LP_TYPE_FIELDS.map((f) => f.field)).toEqual(
      expect.arrayContaining([
        'onlyOneExpiry',
        'onlyOneLot',
        'onlyOneOrder',
        'onlyOneJob',
        'dimensionUnit',
        'weightUnit',
        'customField.textBox1',
      ]),
    );
  });
});

describe('wizard server-error routing', () => {
  it('keeps a value the server rejected invalid until it changes (case-insensitive)', () => {
    const taken = new Map([
      ['code', { value: 'mlt1', message: 'Warehouse MLT1 already exists' }],
      ['info.code', { value: 'a-1', message: 'dup' }],
    ]);
    const ownsInfo = (p: string) => p === 'code';
    expect(takenIssues(taken, ownsInfo, { code: 'MLT1' })).toEqual([
      { path: 'code', message: 'Warehouse MLT1 already exists' },
    ]);
    expect(takenIssues(taken, ownsInfo, { code: 'MLT2' })).toEqual([]);
    expect(takenIssues(taken, (p) => p.startsWith('info.'), { info: { code: 'A-1' } })).toEqual([
      { path: 'info.code', message: 'dup' },
    ]);
    expect(takenIssues(taken, (p) => p.startsWith('cells'), { code: 'MLT1' })).toEqual([]);
  });
});

describe('inline range errors (no silent clamping)', () => {
  it('reports out-of-range values', () => {
    expect(rangeMessage(-5, 0, undefined)).toBe("Can't be negative");
    expect(rangeMessage(0, 1, 500)).toBe('Must be at least 1');
    expect(rangeMessage(1200, 1, 500)).toBe('Must be at most 500');
    expect(rangeMessage(null, 1, 500)).toBeNull();
    expect(rangeMessage(5, 0, 10)).toBeNull();
  });
});

describe('location detail', () => {
  it('maps ?tab= to a tab, defaulting to Contents', () => {
    expect(tabFromParam('ledger')).toBe('ledger');
    expect(tabFromParam(null)).toBe('contents');
    expect(tabFromParam('bogus')).toBe('contents');
  });
  it('optimistic patch carries the saved values in the detail shape', async () => {
    const form = newLocationForm('w');
    const patch = await savedPatch({
      ...form,
      info: { ...form.info, code: ' A-9 ', aisle: 'Y', walkingPathPriority: 9991, level: 2, barcode: '' },
      customFields: { textBox1: 'x' },
    });
    expect(patch).toMatchObject({
      code: 'A-9',
      barcode: 'A-9',
      aisle: 'Y',
      walkingPathPriority: 9991,
      level: '2',
      customFields: { textBox1: 'x' },
    });
  });
});

describe('mobile cart cells', () => {
  it('builds Logiwa cell and display names', () => {
    expect(cellName('MC-01', 3, 2)).toBe('MC-01_3_2');
    expect(cellName('', 1, 1)).toBe('CART_1_1');
    expect(cellDisplayName(2, 3)).toBe('B03');
  });
});
