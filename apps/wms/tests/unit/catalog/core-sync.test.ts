/**
 * §2.4 core sync: client and product CRUD in the WMS repositories round-trips into the
 * shared core registry (core.customers / core.items) in the same transaction.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { customers as coreCustomers, items as coreItems } from '@kitstak/db/schema';
import type { AuthContext } from '@/server/auth/context';
import * as schema from '@/server/db/schema';
import { CLIENT_DEFAULTS, clientSchema } from '@/lib/grid-defs/organization/clients';
import { emptyProductForm, newPackType, type ProductFormValues, type ProductInput } from '@/lib/grid-defs/products/product-form';
import {
  createClient,
  deleteClients,
  setClientStatus,
  updateClient,
  updateClientSettings,
} from '@/server/repositories/clients';
import {
  createProductFromWizard,
  deleteProduct,
  setProductStatus,
  updateProductFromWizard,
} from '@/server/repositories/products-commands';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;

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

const actor = () => ({ userId: w.userId, source: 'Web' });
const ctx = () => ({ ...w.ctx, scope: auth.scope });

const clientInput = (extra: Record<string, unknown> = {}) =>
  clientSchema.parse({
    ...CLIENT_DEFAULTS,
    name: 'Core Sync Co',
    code: 'CORE1',
    officialName: 'Core Sync Co LLC',
    contactName: 'Ann Lee',
    contactEmail: 'ann@example.com',
    phone: '(512) 555-0100',
    ...extra,
  });

const coreCustomer = async (id: string) =>
  (await w.db.select().from(coreCustomers).where(eq(coreCustomers.id, id)).limit(1))[0];
const coreItem = async (id: string) =>
  (await w.db.select().from(coreItems).where(eq(coreItems.id, id)).limit(1))[0];
const clientVersion = async (id: string) =>
  (await w.db.select().from(schema.clients).where(eq(schema.clients.id, id)).limit(1))[0].version;

const unit = () => ({
  ...newPackType('Primary', []),
  key: 'u',
  packType: 'Unit',
  length: 10,
  width: 8,
  height: 6,
  weight: 2,
  barcodes: ['0300001234567'],
});
const productInput = (sku: string, extra: Partial<ProductFormValues> = {}): ProductInput =>
  ({
    ...emptyProductForm('Product', w.clientId),
    sku,
    name: `${sku} name`,
    packTypes: [unit()],
    ...extra,
  }) as ProductInput;

describe('client core sync (wms.clients → core.customers)', () => {
  it('create, update, settings edit, status change and delete round-trip into core.customers', async () => {
    const { id } = await createClient(w.db, auth, actor(), clientInput());
    let core = await coreCustomer(id);
    expect(core).toMatchObject({
      code: 'CORE1',
      name: 'Core Sync Co',
      officialName: 'Core Sync Co LLC',
      contactName: 'Ann Lee',
      contactEmail: 'ann@example.com',
      phone: '(512) 555-0100',
      status: 'Active',
      currency: 'USD',
    });
    expect(core.orgId).toBeTruthy();

    await updateClient(
      w.db,
      auth,
      actor(),
      id,
      clientInput({ name: 'Core Sync Co Renamed', contactName: 'Bea Cruz', version: await clientVersion(id) }),
    );
    core = await coreCustomer(id);
    expect(core).toMatchObject({ name: 'Core Sync Co Renamed', contactName: 'Bea Cruz' });

    await updateClientSettings(w.db, auth, actor(), id, {
      currency: 'EUR',
      settings: clientInput().settings,
      version: await clientVersion(id),
    });
    expect((await coreCustomer(id)).currency).toBe('EUR');

    const bulk = await setClientStatus(w.db, auth, actor(), [id], 'Inactive');
    expect(bulk.succeeded).toEqual([id]);
    expect((await coreCustomer(id)).status).toBe('Inactive');

    const del = await deleteClients(w.db, auth, actor(), [id]);
    expect(del.succeeded).toEqual([id]);
    expect(await coreCustomer(id)).toBeUndefined();
  });
});

describe('product core sync (wms.products → core.items)', () => {
  it('create, update, status change and delete round-trip into core.items', async () => {
    const row = await createProductFromWizard(w.db, ctx(), productInput('CORE-SKU-1'));
    expect(row.coreItemId).toBeTruthy();
    const coreItemId = row.coreItemId as string;

    // The pointer is persisted on wms.products.
    const stored = (
      await w.db.select().from(schema.products).where(eq(schema.products.id, row.id)).limit(1)
    )[0];
    expect(stored.coreItemId).toBe(coreItemId);

    let item = await coreItem(coreItemId);
    expect(item).toMatchObject({
      customerId: w.clientId,
      sku: 'CORE-SKU-1',
      name: 'CORE-SKU-1 name',
      barcode: '0300001234567',
      uom: 'Unit',
      isKit: false,
      status: 'Active',
    });
    // The owning core.customers row was created on demand for a directly-seeded client.
    expect(await coreCustomer(w.clientId)).toMatchObject({ status: 'Active' });

    const updated = await updateProductFromWizard(
      w.db,
      ctx(),
      row.id,
      productInput('CORE-SKU-1', { name: 'Renamed core product' }),
    );
    expect(updated.coreItemId).toBe(coreItemId);
    item = await coreItem(coreItemId);
    expect(item.name).toBe('Renamed core product');

    await setProductStatus(w.db, ctx(), row.id, 'Inactive');
    expect((await coreItem(coreItemId)).status).toBe('Inactive');

    await deleteProduct(w.db, ctx(), row.id);
    expect(await coreItem(coreItemId)).toBeUndefined();
  });
});
