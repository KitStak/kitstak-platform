/** M10 round-2 critic fixes: blank ints stay blank, new sort fields, zone strip warehouse, LP count copy, error copy, package delete guard. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '@/server/auth/context';
import { parseGridQuery } from '@/server/query/grid-query';
import { friendlyErrorMessage, plural, stripFieldPrefix } from '@/lib/grid-defs/facility/common';
import {
  LOCATION_INFO_DEFAULTS,
  LOCATION_SORT_FIELDS,
  locationSaveSchema,
  unsetAsNull,
} from '@/lib/grid-defs/facility/locations';
import { lpCreateSchema } from '@/lib/grid-defs/facility/lp-numbers';
import { packageDeleteReason } from '@/lib/grid-defs/facility/shipment-packages';
import { createLocation, getLocation, getZoneSummary, listLocations } from '@/server/repositories/locations';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;
const actor = () => ({ userId: w.userId, source: 'Web' });

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(),
    restrictions: [],
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
});
afterEach(() => w.close());

const save = (code: string, extra: Record<string, unknown> = {}) =>
  locationSaveSchema.parse({
    info: { ...LOCATION_INFO_DEFAULTS, code, warehouseId: w.warehouseId, ...extra },
    productCapacities: [],
    lpCapacities: [],
  });

describe('blank level / column / walking path', () => {
  it('defaults to null in the form and reads back as null, not a fake 0', async () => {
    expect(LOCATION_INFO_DEFAULTS).toMatchObject({ level: null, column: null, walkingPathPriority: null });
    const { id } = await createLocation(w.db, auth, actor(), save('KS-TEST-BLANK'));
    expect(await getLocation(w.db, auth, id)).toMatchObject({
      level: null,
      column: null,
      walkingPathPriority: null,
    });
    const row = (
      await listLocations(w.db, auth, parseGridQuery(new URLSearchParams('q=KS-TEST-BLANK')).query)
    ).rows[0];
    expect(row).toMatchObject({ level: null, column: null, walkingPathPriority: null });
  });

  it('keeps real values', async () => {
    const { id } = await createLocation(
      w.db,
      auth,
      actor(),
      save('KS-TEST-SET', { level: 3, column: 2, walkingPathPriority: 140 }),
    );
    expect(await getLocation(w.db, auth, id)).toMatchObject({
      level: '3',
      column: 2,
      walkingPathPriority: 140,
    });
  });

  it("unsetAsNull treats 0, '' and '0' as not set", () => {
    expect([
      unsetAsNull(0),
      unsetAsNull(''),
      unsetAsNull('0'),
      unsetAsNull(null),
      unsetAsNull(7),
      unsetAsNull('4'),
    ]).toEqual([null, null, null, null, 7, 4]);
  });
});

describe('locations grid sorting', () => {
  it('accepts volume, ABC code and dedicated client sorts', async () => {
    expect(LOCATION_SORT_FIELDS).toEqual(expect.arrayContaining(['volume', 'abcCode', 'dedicatedClient']));
    await createLocation(w.db, auth, actor(), save('KS-TEST-V1', { volume: 10, abcCode: 'A' }));
    await createLocation(w.db, auth, actor(), save('KS-TEST-V2', { volume: 50, abcCode: 'C' }));
    const rows = (
      await listLocations(w.db, auth, parseGridQuery(new URLSearchParams('q=KS-TEST-V&sort=-volume')).query)
    ).rows;
    expect(rows.map((r) => r.code)).toEqual(['KS-TEST-V2', 'KS-TEST-V1']);
    expect(rows[0]).toMatchObject({ volume: 50, abcCode: 'C' });
    await listLocations(w.db, auth, parseGridQuery(new URLSearchParams('sort=abcCode')).query);
    await listLocations(w.db, auth, parseGridQuery(new URLSearchParams('sort=-dedicatedClient')).query);
  });
});

describe('zone summary', () => {
  it('carries the warehouse code of each zone card', async () => {
    await createLocation(w.db, auth, actor(), save('KS-TEST-Z1'));
    const zones = await getZoneSummary(w.db, auth);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) expect(typeof z.warehouseCode === 'string' || z.warehouseCode === null).toBe(true);
    expect(zones.some((z) => typeof z.warehouseCode === 'string' && z.warehouseCode.length > 0)).toBe(true);
  });
});

describe('copy', () => {
  it('LP count 0 gives exactly one message', () => {
    const r = lpCreateSchema.safeParse({ warehouseId: 'w', lpTypeId: 't', method: 'sequence', count: 0 });
    expect(r.error?.issues.filter((i) => i.path[0] === 'count').map((i) => i.message)).toEqual([
      'Enter a count of at least 1',
    ]);
    const missing = lpCreateSchema.safeParse({
      warehouseId: 'w',
      lpTypeId: 't',
      method: 'sequence',
      count: null,
    });
    expect(missing.error?.issues.filter((i) => i.path[0] === 'count').map((i) => i.message)).toEqual([
      'Enter a count of at least 1',
    ]);
  });

  it('error copy never shows the raw field key', () => {
    expect(stripFieldPrefix('Invalid request: clientId — Client is required for SSCC18 numbers')).toBe(
      'Client is required for SSCC18 numbers',
    );
    expect(
      friendlyErrorMessage({
        code: 'VALIDATION',
        message: 'Invalid request: clientId — Client is required for SSCC18 numbers',
        fieldErrors: { clientId: ['Client is required for SSCC18 numbers'] },
      }),
    ).toBe('Client is required for SSCC18 numbers');
    expect(
      friendlyErrorMessage({
        code: 'VALIDATION',
        message: 'Invalid request: a — x',
        fieldErrors: { a: ['x'], b: ['y'] },
      }),
    ).toBe('Fix the highlighted fields');
    expect(friendlyErrorMessage({ code: 'CONFLICT', message: 'stale' })).toBe(
      'This record changed since you opened it — Reload',
    );
    expect(friendlyErrorMessage({ code: 'INVALID_STATE', message: 'Holds 4 units' })).toBe('Holds 4 units');
  });

  it('pluralizes the generator button', () => {
    expect(`Create ${plural(1, 'location')}`).toBe('Create 1 location');
    expect(`Create ${plural(12, 'location')}`).toBe('Create 12 locations');
  });

  it("explains why a used shipment package can't be deleted", () => {
    expect(packageDeleteReason({ shipmentCount: 0, orderCount: 0, productCount: 0 })).toBeNull();
    expect(packageDeleteReason({ shipmentCount: 1, orderCount: 0, productCount: 0 })).toBe(
      'Used by 1 shipment; set it inactive instead',
    );
    expect(packageDeleteReason({ shipmentCount: 0, orderCount: 3, productCount: 0 })).toBe(
      'Set on 3 shipment orders; set it inactive instead',
    );
    expect(packageDeleteReason({ shipmentCount: 0, orderCount: 0, productCount: 2 })).toBe(
      'Required box of 2 products',
    );
  });
});
