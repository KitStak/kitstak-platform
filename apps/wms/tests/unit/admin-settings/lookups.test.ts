/** M14 Data Setup lookups: type-specific meta (Logiwa parity fields) and the repository round trip. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import {
  lookupBySlug,
  lookupCreateDefaults,
  lookupFormSchema,
  lookupFormValues,
  lookupIssues,
  lookupMeta,
  lookupMetaDisplay,
  RECOMMENDED_MERGE_CRITERIA,
  SO_TYPE_FLAGS,
  type LookupDef,
  type LookupFormValues,
} from '@/lib/grid-defs/admin/lookups';
import { createLookupValue, getLookupRow, updateLookupValue } from '@/server/repositories/company-lookups';
import { createWorld, type World } from '../foundation/domain/fixtures';

const def = (slug: string): LookupDef => lookupBySlug(slug)!;
const parse = (d: LookupDef, over: Partial<LookupFormValues>) =>
  lookupFormSchema.parse({ ...lookupCreateDefaults(d), name: 'KS-TEST value', ...over });

describe('lookup schema', () => {
  it('still accepts the original minimal payload (defaults fill the new fields)', () => {
    const v = lookupFormSchema.parse({
      name: 'X',
      isActive: true,
      warehouseId: null,
      clientId: null,
      sortOrder: 0,
      calculationType: null,
      levels: null,
      columns: null,
      operation: null,
      criteria: [],
      countsAsDamaged: true,
    });
    expect(v.flags).toEqual([]);
    expect(v.inheritFrom).toBe('oldest');
    expect(v.customerReason).toBe(true);
  });

  it("pre-checks Logiwa's default merge conditions on a new rule", () => {
    expect(lookupCreateDefaults(def('order-merge-rule')).criteria).toEqual([...RECOMMENDED_MERGE_CRITERIA]);
    expect(RECOMMENDED_MERGE_CRITERIA).toEqual(['client', 'customerName', 'channel', 'shipAddress']);
  });
});

describe('lookupIssues', () => {
  it('requires warning text and trigger on packing warnings and validates media links', () => {
    const d = def('packing-warning-type');
    const issues = lookupIssues(d, parse(d, { showWhen: null, mediaLinks: ['ftp://x'] })).map((i) => i.path);
    expect(issues).toEqual(['warningText', 'showWhen', 'mediaLinks']);
    expect(
      lookupIssues(d, parse(d, { warningText: 'Fragile', mediaLinks: ['https://cdn.example.com/a.png'] })),
    ).toEqual([]);
  });

  it('requires a carrier code and rejects duplicate service codes', () => {
    const d = def('custom-carrier');
    const v = parse(d, {
      code: '',
      services: [
        { code: 'GRD', name: 'Ground' },
        { code: 'grd', name: 'Again' },
      ],
    });
    expect(lookupIssues(d, v).map((i) => i.path)).toEqual(['code', 'services']);
  });

  it('needs at least one usage on a return reason and a damage reason when linked', () => {
    const d = def('return-reason');
    expect(
      lookupIssues(d, parse(d, { customerReason: false, actualReason: false })).map((i) => i.path),
    ).toEqual(['customerReason']);
    expect(lookupIssues(d, parse(d, { linkDamageReason: true })).map((i) => i.path)).toEqual([
      'linkedDamageReasonId',
    ]);
  });

  it('keeps cell dimensions inside the cart', () => {
    const d = def('mobile-cart-type');
    expect(lookupIssues(d, parse(d, { cartHeight: 50, cellHeight: 60 })).map((i) => i.path)).toEqual([
      'cellHeight',
    ]);
  });

  it('requires a zone code', () => {
    const d = def('location-zone');
    expect(lookupIssues(d, parse(d, { warehouseId: 'w1', code: '' })).map((i) => i.path)).toEqual(['code']);
  });
});

describe('lookupMeta / lookupFormValues', () => {
  it('round-trips SO type flags as a full boolean map', () => {
    const d = def('shipment-order-type');
    const meta = lookupMeta(d, parse(d, { flags: ['createBackOrder', 'allowShipWithoutLabel'] }))!;
    expect(Object.keys(meta.flags as object)).toHaveLength(SO_TYPE_FLAGS.length);
    expect((meta.flags as Record<string, boolean>).createBackOrder).toBe(true);
    expect(
      lookupFormValues({
        name: 'x',
        code: null,
        isActive: true,
        warehouseId: null,
        clientId: null,
        sortOrder: 0,
        meta,
      }).flags,
    ).toEqual(['createBackOrder', 'allowShipWithoutLabel']);
    expect(lookupMetaDisplay(d, meta)['Create back order']).toBe('Yes');
  });

  it('keeps the mobile-cart keys other modules read (levels / columns / operation)', () => {
    const d = def('mobile-cart-type');
    const meta = lookupMeta(
      d,
      parse(d, { cartHeight: 55, cartLength: 36, cartWidth: 25, allowMultipleJobs: true }),
    )!;
    expect(meta).toMatchObject({
      levels: 4,
      columns: 6,
      operation: 'Picking',
      allowMultipleJobs: true,
      cart: { height: 55, length: 36, width: 25 },
    });
    expect(lookupMetaDisplay(d, meta).cartDimensions).toBe('55x36x25');
  });

  it('drops the linked damage reason when linking is switched off', () => {
    const d = def('return-reason');
    expect(
      lookupMeta(d, parse(d, { linkDamageReason: false, linkedDamageReasonId: 'abc' }))!.linkedDamageReasonId,
    ).toBeNull();
  });

  it('reads legacy rows without the new keys', () => {
    const v = lookupFormValues({
      name: 'Old',
      code: null,
      isActive: true,
      warehouseId: null,
      clientId: null,
      sortOrder: 0,
      meta: { criteria: ['client', 'bogus'] },
    });
    expect(v.criteria).toEqual(['client']);
    expect(v.inheritFrom).toBe('oldest');
  });
});

describe('lookup repository', () => {
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

  it('creates and updates a custom carrier with services, logging readable diffs', async () => {
    const d = def('custom-carrier');
    const row = await createLookupValue(
      w.db,
      auth,
      actor(),
      d,
      parse(d, { name: 'KS-TEST Courier', code: 'KSC', services: [{ code: 'SD', name: 'Same day' }] }),
    );
    expect(row.code).toBe('KSC');
    expect((row.meta?.services as unknown[]).length).toBe(1);
    await expect(
      async () =>
        await createLookupValue(w.db, auth, actor(), d, parse(d, { name: 'KS-TEST Other', code: 'ksc' })),
    ).rejects.toThrow(/already exists/);
    await updateLookupValue(
      w.db,
      auth,
      actor(),
      d,
      row.id,
      parse(d, {
        name: 'KS-TEST Courier',
        code: 'KSC',
        services: [
          { code: 'SD', name: 'Same day' },
          { code: 'ND', name: 'Next day' },
        ],
        version: row.version,
      }),
    );
    const log = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, row.id));
    expect(log.some((e) => (e.toValue ?? '').includes('SD, ND'))).toBe(true);
  });

  it('links a return reason to an existing damage reason only', async () => {
    const dr = await createLookupValue(
      w.db,
      auth,
      actor(),
      def('damaged-reasons'),
      parse(def('damaged-reasons'), { name: 'KS-TEST Crushed' }),
    );
    const d = def('return-reason');
    await expect(
      async () =>
        await createLookupValue(
          w.db,
          auth,
          actor(),
          d,
          parse(d, { name: 'KS-TEST Bad', linkDamageReason: true, linkedDamageReasonId: 'nope' }),
        ),
    ).rejects.toThrow(/Damage reason not found/);
    const rr = await createLookupValue(
      w.db,
      auth,
      actor(),
      d,
      parse(d, {
        name: 'KS-TEST Bad',
        linkDamageReason: true,
        linkedDamageReasonId: dr.id,
        customerReason: false,
      }),
    );
    expect((await getLookupRow(w.db, auth, 'return_reason', rr.id)).meta).toMatchObject({
      customerReason: false,
      actualReason: true,
      linkedDamageReasonId: dr.id,
    });
  });
});
