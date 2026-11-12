/**
 * Platform data: default printout templates for all 25 types, the app catalog (two active),
 * company settings, custom field definitions, colored tags applied to orders and POs,
 * shared saved views and admin notifications.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { notify } from '@/server/domain';
import type { Tx } from '@/server/domain/types';
import { SANDBOX_CARRIER_NAME } from '@/config/brand';
import { PRINT_TYPES } from '@/server/print/catalog';
import { setClock, isoOf, utcAt } from './runtime';
import type { Id } from './types';
import type { World } from './world';
import { forEachSeq, mapSeq } from '@/server/db/sql';

/** App catalog rows: key, name, description, category, active in the demo seed. */
export const SEED_APPS: readonly (readonly [string, string, string, string, boolean])[] = [
  ['ai-jobs', 'AI Jobs', 'Optimizes pick paths and batches with machine learning.', 'Operations', false],
  [
    'custom-branding',
    'Custom Branding',
    'Brand packing slips and the client portal with your logo and colors.',
    'Branding',
    false,
  ],
  [
    'labor-analytics',
    'Labor Analytics',
    'Task, associate and receiving performance analysis.',
    'Analytics',
    true,
  ],
  [
    'operational-analytics',
    'Operational Analytics',
    'Throughput, backlog and SLA dashboards for every warehouse.',
    'Analytics',
    true,
  ],
  ['scale', 'Scale', 'Read package weights from USB and network scales at packing.', 'Hardware', false],
  ['sso', 'Single sign-on (SSO)', 'SAML / OIDC sign-in with your identity provider.', 'Security', false],
  ['two-boxes', 'Two Boxes', 'Returns processing and grading.', 'Returns', false],
  ['api-user', 'API User', 'Machine users and API keys for integrations.', 'Developer', false],
  ['bukuship', 'BukuShip Carrier Integration', 'Discounted multi-carrier labels.', 'Carriers', false],
  ['dropstream', 'Dropstream', 'Order routing from 40+ marketplaces.', 'Channels', false],
  ['ehub', 'Ehub Carrier Integration', 'Negotiated rates via Ehub.', 'Carriers', false],
  ['locad-oms', 'Locad OMS', 'Order management for multi-node fulfillment.', 'Channels', false],
  ['locus', 'Locus', 'Autonomous mobile robot picking.', 'Robotics', false],
  ['shipium', 'Shipium Carrier Integration', 'Delivery promise and carrier selection.', 'Carriers', false],
  ['techship', 'Techship Store Connections', 'Store connections via Techship.', 'Channels', false],
  ['eshipper', 'eShipper Carrier Integration', 'Cross-border shipping via eShipper.', 'Carriers', false],
];

const TAGS: readonly (readonly [string, string, NonNullable<(typeof schema.tags.$inferInsert)['scope']>])[] =
  [
    ['VIP', '#621DB8', 'shipment_order'],
    ['Gift', '#E55B56', 'shipment_order'],
    ['Rush', '#B20B1C', 'shipment_order'],
    ['Prime', '#0D36A3', 'shipment_order'],
    ['Wholesale', '#394357', 'shipment_order'],
    ['Fragile', '#A13406', 'any'],
    ['Influencer', '#16C2AA', 'shipment_order'],
    ['Replacement', '#EBAC00', 'shipment_order'],
    ['Holiday 2026', '#17874D', 'any'],
    ['Address Check', '#ED634A', 'shipment_order'],
    ['Priority Vendor', '#28B573', 'purchase_order'],
    ['Damaged Inbound', '#A13406', 'purchase_order'],
    ['Cross-dock', '#0D36A3', 'purchase_order'],
    ['Sample', '#50575C', 'any'],
    ['Return to Vendor', '#B20B1C', 'return_order'],
  ];

async function seedPrintouts(tx: Tx): Promise<number> {
  for (const t of PRINT_TYPES) {
    await tx.insert(schema.printoutTemplates).values({
      typeKey: t.key,
      name: `${t.name} (Default)`,
      description: `Default ${t.name.toLowerCase()} template`,
      recordsPerPage: t.category === 'labels' ? 'Single Record' : 'Multiple Records',
      printMode: t.printerType === 'Label Printer' ? 'Direct Print' : 'PDF Preview',
      printerType: t.printerType,
      baseTemplate: t.renderer ?? t.key,
      layout: { size: t.printerType === 'Label Printer' ? '4x6' : 'Letter' },
      options: { showLogo: true, showBarcode: true },
      isDefault: true,
    });
  }
  return PRINT_TYPES.length;
}

async function seedApps(w: World, tx: Tx): Promise<void> {
  await tx.insert(schema.apps).values(
    SEED_APPS.map(([key, name, description, category, active]) => ({
      key,
      name,
      description,
      category,
      isActive: active,
      activatedAt: active ? isoOf(utcAt(140, 15)) : null,
      activatedBy: active ? w.access.admin.id : null,
    })),
  );
}

async function seedCompany(tx: Tx): Promise<void> {
  await tx.insert(schema.companySettings).values({
    id: 'company',
    displayName: 'KitStaks',
    fullName: 'KitStaks Fulfillment LLC',
    defaults: {
      currency: 'USD',
      dateFormat: 'M/D/YYYY h:mm:ss A',
      weightUnit: 'Pound',
      dimensionUnit: 'Inch',
    },
    passwordPolicy: {
      minLength: 12,
      requireUpper: true,
      requireNumber: true,
      requireSymbol: true,
      maxAgeDays: 180,
      lockoutThreshold: 5,
      lockoutMinutes: 15,
    },
  });
  await tx.insert(schema.customFieldDefs).values([
    { entityType: 'shipment_order', slot: 'textBox1', name: 'Gift Wrap Code' },
    { entityType: 'product', slot: 'textBox1', name: 'Training' },
    {
      entityType: 'purchase_order',
      slot: 'dropDown1',
      name: 'Inbound Appointment',
      options: ['Morning', 'Afternoon', 'Drop Trailer'],
    },
  ]);
}

/**
 * Upserts the demo tags. Workflow "Add Tag" actions replayed earlier in the seed may already
 * have created some by name, so an existing (name, scope) row is reused and given the palette color.
 */
async function tagIds(tx: Tx): Promise<Map<string, Id>> {
  return new Map(
    await mapSeq(TAGS, async ([name, color, tagScope]) => {
      const scope = tagScope ?? 'any';
      const found = (
        await tx
          .select({ id: schema.tags.id })
          .from(schema.tags)
          .where(and(eq(schema.tags.name, name), eq(schema.tags.scope, scope)))
          .limit(1)
      )[0];
      if (found) {
        await tx.update(schema.tags).set({ color }).where(eq(schema.tags.id, found.id));
        return [name, found.id] as const;
      }
      return [
        name,
        (await tx.insert(schema.tags).values({ name, color, scope }).returning({ id: schema.tags.id }))[0].id,
      ] as const;
    }),
  );
}

async function applyTags(w: World, tx: Tx, tags: ReadonlyMap<string, Id>): Promise<number> {
  const o = schema.shipmentOrders;
  const smt = w.org.clientByCode.get('SMT')?.id ?? '';
  const rules: readonly (readonly [string, ReturnType<typeof eq>])[] = [
    ['VIP', eq(o.clientId, smt)],
    ['Prime', eq(o.isPrime, true)],
    ['Gift', eq(o.isGift, true)],
    ['Wholesale', eq(o.channel, 'Wholesale')],
    ['Rush', eq(o.priority, 'Urgent')],
    ['Address Check', eq(o.workflowBlocked, 'Fully')],
  ];
  let n = 0;
  for (const [name, where] of rules) {
    const tagId = tags.get(name);
    if (!tagId) continue;
    const ids = await tx.select({ id: o.id }).from(o).where(where);
    if (ids.length > 0)
      await tx
        .insert(schema.entityTags)
        .values(ids.map((r) => ({ tagId, entityType: 'shipment_order', entityId: r.id })))
        .onConflictDoNothing();
    n += ids.length;
  }
  const pos = await tx
    .select({ id: schema.purchaseOrders.id, poType: schema.purchaseOrders.poType })
    .from(schema.purchaseOrders);
  const damaged = new Set(
    (
      await tx
        .select({ id: schema.purchaseOrderLines.purchaseOrderId })
        .from(schema.purchaseOrderLines)
        .where(sql`${schema.purchaseOrderLines.damagedQuantity} > 0`)
    ).map((r) => r.id),
  );
  await forEachSeq(pos, async (po, i) => {
    const name = damaged.has(po.id)
      ? 'Damaged Inbound'
      : po.poType === 'Purchase Order- Non Crossdock'
        ? 'Cross-dock'
        : i % 4 === 0
          ? 'Priority Vendor'
          : null;
    const tagId = name ? tags.get(name) : undefined;
    if (tagId) {
      await tx
        .insert(schema.entityTags)
        .values({ tagId, entityType: 'purchase_order', entityId: po.id })
        .onConflictDoNothing();
      n += 1;
    }
  });
  return n;
}

async function seedSavedViews(w: World, tx: Tx): Promise<void> {
  const userId = w.access.manager.id;
  await tx.insert(schema.savedViews).values([
    {
      userId,
      gridKey: 'orders-backlog',
      name: 'Prime & urgent backlog',
      query: 'f.priority=in:High,Urgent&sort=orderDate',
      isShared: true,
    },
    {
      userId,
      gridKey: 'purchase-orders',
      name: 'Arriving this week',
      query: 'f.status=in:Pending,Started&f.plannedArrivalDate=date:withinNext7d&sort=plannedArrivalDate',
      isShared: true,
    },
    {
      userId: w.access.admin.id,
      gridKey: 'inventory-total',
      name: 'Coffee lots by expiry',
      query: 'q=CPL-&qm=sw&sort=expiryDate',
      isShared: true,
      pinnedFields: ['sku', 'lotNumber', 'expiryDate'],
    },
  ]);
}

async function seedProductCustomFields(w: World, tx: Tx): Promise<void> {
  const ids = w.catalog.products.filter((p) => p.trackSerial || p.isPackaging).map((p) => p.id);
  if (ids.length > 0)
    await tx
      .update(schema.products)
      .set({ customFields: { textBox1: 'Required - see SOP-114' } })
      .where(inArray(schema.products.id, ids));
}

/** Seeded admin notifications: [daysAgo, kind, title, body, href, severity, read]. Every href must be a real route. */
export const NOTIFICATIONS: readonly (readonly [
  number,
  string,
  string,
  string,
  string,
  (typeof schema.notifications.$inferInsert)['severity'],
  boolean,
])[] = [
  [
    0,
    'wave.completed',
    'Wave 101 completed',
    'D2C Daily Waves allocated every eligible order.',
    '/jobs',
    'success',
    false,
  ],
  [
    0,
    'shortage.created',
    '3 orders are short',
    'Allocation could not cover Summit Shell Jacket and Voltbyte XL Speaker.',
    '/jobs/allocation-exceptions',
    'warning',
    false,
  ],
  [
    1,
    'import.failed',
    'Product import finished with errors',
    '2 of 48 rows failed: duplicate SKU.',
    '/imports/products',
    'error',
    false,
  ],
  [
    1,
    'receiving.completed',
    'Purchase order received',
    'All lines of the latest Apex Threads PO were received.',
    '/receiving',
    'success',
    true,
  ],
  [
    2,
    'channel.error',
    'Shopify order download failed',
    'Apex Threads Shopify: 1 order could not be downloaded (rate limited).',
    '/integrations/logs/history',
    'error',
    true,
  ],
  [
    3,
    'eod.closed',
    'End of day manifest closed',
    `${SANDBOX_CARRIER_NAME} manifest closed and printed.`,
    '/shipments/end-of-day',
    'info',
    true,
  ],
  [
    4,
    'count.variance',
    'Cycle count variance to review',
    'Weekly cycle count - zone C aisle 3 has differences.',
    '/counts',
    'warning',
    true,
  ],
  [
    5,
    'work-order.shortage',
    'Work order short on components',
    'Black Friday gift box build is waiting on Harbor beans.',
    '/work-orders',
    'warning',
    true,
  ],
  [
    7,
    'carrier.error',
    'Carrier label errors',
    `${SANDBOX_CARRIER_NAME} rejected label requests; see Carrier Errors.`,
    '/integrations/carriers',
    'error',
    true,
  ],
  [
    9,
    'billing.calculated',
    'October bills calculated',
    'Apex Threads and NovaForge bills are ready for review.',
    '/billing',
    'info',
    true,
  ],
];

async function seedNotifications(w: World, tx: Tx): Promise<number> {
  let n = 0;
  for (const [daysAgo, kind, title, body, href, severity, read] of NOTIFICATIONS) {
    const at = utcAt(daysAgo, 15, 10 + n);
    setClock(at);
    n += await notify(tx, [w.access.admin.id], { kind, title, body, href, severity });
    if (read) {
      await tx
        .update(schema.notifications)
        .set({ readAt: isoOf(at + 3_600_000) })
        .where(
          and(eq(schema.notifications.userId, w.access.admin.id), eq(schema.notifications.title, title)),
        );
    }
  }
  return n;
}

export async function seedPlatform(w: World, tx: Tx): Promise<void> {
  await seedPrintouts(tx);
  await seedApps(w, tx);
  await seedCompany(tx);
  await seedSavedViews(w, tx);
  await seedProductCustomFields(w, tx);
  await applyTags(w, tx, await tagIds(tx));
  await seedNotifications(w, tx);
}
