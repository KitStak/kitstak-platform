/** Orders-outbound blind-judge repair round 1: customer search scope, crumbs, company column, purge, grid label format, one-time customer ids. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import { createOrder, createOrderBodySchema } from '@/server/repositories/orders-commands';
import { customerPrefill, customerSearch, ORDER_CUSTOMER_PREFIX } from '@/server/repositories/orders-wizard';
import { planOrderTestDataPurge, purgeOrderTestData } from '@/server/repositories/orders-test-data';
import { GRID_LABEL_FORMAT } from '@/server/repositories/orders-labels';
import {
  columnsForView,
  defaultVisibleFor,
  DEFAULT_HIDDEN_COLUMNS,
} from '@/lib/grid-defs/orders/shipment-orders';
import { orderCrumbs, orderListCrumb } from '@/components/orders/order-crumbs';
import { linkedCustomerId } from '@/components/orders/wizard/order-form-model';
import { noCustomerMatch } from '@/components/orders/wizard/step-customer';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';

describe('breadcrumbs match Return Orders (Home › Fulfillment › Outbound › …)', () => {
  it('lists, detail and wizard share the Outbound root', () => {
    expect(orderCrumbs('Shipment Orders').map((c) => c.label)).toEqual([
      'Fulfillment',
      'Outbound',
      'Shipment Orders',
    ]);
    expect(orderCrumbs(orderListCrumb('Shipped'), 'SO1').map((c) => c.label)).toEqual([
      'Fulfillment',
      'Outbound',
      'Shipped & Canceled Orders',
      'SO1',
    ]);
    expect(orderListCrumb('Open').href).toBe('/orders');
    expect(orderListCrumb('Cancelled').href).toBe('/orders/shipped');
  });
});

describe('Company Name column', () => {
  it('is in the chooser but hidden by default', () => {
    const col = columnsForView('backlog').find((c) => c.id === 'companyName');
    expect(col).toBeDefined();
    expect(DEFAULT_HIDDEN_COLUMNS.has('companyName')).toBe(true);
    expect(defaultVisibleFor('backlog', col!)).toBe(false);
  });
});

describe('one-time customers picked from a previous order', () => {
  it('are never sent as a customer link', () => {
    expect(linkedCustomerId('order:abc')).toBeNull();
    expect(linkedCustomerId('__new')).toBeNull();
    expect(linkedCustomerId(null)).toBeNull();
    expect(linkedCustomerId('c-1')).toBe('c-1');
  });
  it('an empty search shows a disabled no-match row', () => {
    const row = noCustomerMatch(' Oli ');
    expect(row.label).toBe('No customers match "Oli"');
    expect(row.disabled).toBe(true);
  });
});

describe('grid labels open in the browser', () => {
  it('always ask the carrier for PDF', () => {
    expect(GRID_LABEL_FORMAT).toBe('PDF');
  });
});

describe('repository flows', () => {
  let w: World;
  const scope = { warehouseIds: [] as string[], clientIds: 'all' as const };
  beforeEach(async () => {
    w = await createWorld();
  });
  afterEach(() => w.close());
  const mk = async (extra: Record<string, unknown> = {}) =>
    await createOrder(
      w.db,
      w.ctx,
      createOrderBodySchema.parse(orderInput(w, [{ productId: w.productId, quantity: 1 }], extra)),
    );

  it("customer search finds saved customers and one-time customers from the client's orders", async () => {
    await w.db
      .insert(schema.customers)
      .values({ clientId: w.clientId, firstName: 'Oliver', lastName: 'Stone', email: 'o@x.io', phone: '1' });
    await mk({ customerName: 'Olivia Martinez', customerEmail: 'olivia@example.com' });
    await mk({ customerName: 'Olivia Martinez', customerEmail: 'olivia@example.com' });
    const hits = await customerSearch(w.db, scope, w.clientId, 'Oli');
    expect(hits.map((h) => h.label)).toEqual(['Oliver Stone', 'Olivia Martinez']);
    const fromOrder = hits.find((h) => h.source === 'order')!;
    expect(fromOrder.value.startsWith(ORDER_CUSTOMER_PREFIX)).toBe(true);
    expect(fromOrder.description).toMatch(/^From order /);
    const pre = await customerPrefill(w.db, scope, fromOrder.value);
    expect(pre?.firstName).toBe('Olivia');
    expect(pre?.lastName).toBe('Martinez');
    expect(pre?.addresses[0]?.line1).toBe('200 Oak Ave');
    // another client never sees them
    expect(await customerSearch(w.db, scope, w.otherClientId, 'Oli')).toEqual([]);
    expect(
      await customerSearch(w.db, { warehouseIds: [], clientIds: [w.otherClientId] }, w.clientId, 'Oli'),
    ).toEqual([]);
  });

  it('purges critic orders, tags, order types and notes; keeps orders in a job', async () => {
    const crit = await mk({ customerName: 'KS-CRIT Critic', note: 'KS-CRIT edited note' });
    const real = await mk();
    const tag = (
      await w.db
        .insert(schema.tags)
        .values({ name: 'KS-CRIT-TAG', color: '#000', scope: 'shipment_order' })
        .returning()
    )[0];
    await w.db
      .insert(schema.entityTags)
      .values({ tagId: tag.id, entityType: 'shipment_order', entityId: real.id });
    await w.db.insert(schema.lookupValues).values({ type: 'so_type', name: 'KS-CRIT SO Type 1' });
    await w.db
      .insert(schema.entityNotes)
      .values({
        entityType: 'shipment_order',
        entityId: real.id,
        body: 'Hold reason: KS-CRIT check',
        userId: w.userId,
      });
    const plan = await planOrderTestDataPurge(w.db);
    expect(plan.orders.map((o) => o.id)).toEqual([crit.id]);
    expect(plan.tags).toHaveLength(1);
    expect(plan.orderTypes[0]?.inUse).toBe(false);
    expect(plan.noteIds).toHaveLength(1);
    await purgeOrderTestData(w.db, plan);
    expect(
      (
        await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, crit.id)).limit(1)
      )[0]?.deletedAt,
    ).not.toBeNull();
    expect(
      (
        await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, real.id)).limit(1)
      )[0]?.deletedAt,
    ).toBeNull();
    expect((await w.db.select().from(schema.tags)).filter((t) => t.name.startsWith('KS-CRIT'))).toHaveLength(
      0,
    );
    expect(await w.db.select().from(schema.entityTags)).toHaveLength(0);
    expect((await planOrderTestDataPurge(w.db)).orders).toHaveLength(0);
  });
});
