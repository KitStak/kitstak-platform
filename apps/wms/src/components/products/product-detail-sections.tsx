'use client';

/**
 * Product detail tab bodies: overview, pack types & barcodes, inventory (real buckets +
 * ATP per warehouse), open orders / POs, listings, kit components / used in kits,
 * planning (replenishment + channel allocation) and the inventory ledger.
 */
import * as React from 'react';
import Link from 'next/link';
import { Box, Boxes, Layers, PackageSearch } from 'lucide-react';
import { KvList, type KvItem } from '@/components/shared/kv-list';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Barcode } from '@/components/ui/barcode';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, YesNoPill } from '@/components/ui/status-pill';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { countryName } from '@/lib/countries';
import { normalizeCountryCode } from '@/lib/grid-defs/products/product-form';
import {
  formatVolume,
  hasIncompleteDimensions,
  hasMissingWeight,
} from '@/lib/grid-defs/products/catalog-options';
import { buildableFromComponent, kitBuildability } from '@/lib/grid-defs/products/kit-buildability';
import { ProductThumb, type ProductDetailData } from './catalog-shared';
import { PackHierarchy, PackTypesEditor, hierarchyFromView } from './product-pack-types-editor';

type D = ProductDetailData;

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description ? <p className="text-xs text-secondary">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

interface Col<T> {
  readonly key: string;
  readonly label: string;
  readonly align?: 'right';
  readonly render: (row: T) => React.ReactNode;
}

export function MiniTable<T>({
  rows,
  columns,
  getKey,
  empty,
  footer,
}: {
  readonly rows: readonly T[];
  readonly columns: readonly Col<T>[];
  readonly getKey: (row: T) => string;
  readonly empty: { title: string; description: string; action?: React.ReactNode };
  readonly footer?: React.ReactNode;
}) {
  if (rows.length === 0)
    return (
      <EmptyState
        compact
        icon={PackageSearch}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  return (
    <div className="overflow-x-auto rounded-md border border-border ks-scroll">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn('whitespace-nowrap px-3 py-2', c.align === 'right' && 'text-right')}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={getKey(r)} className="hover:bg-surface-sunken/60">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-body',
                    c.align === 'right' && 'text-right tabular-nums',
                  )}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot className="border-t border-border bg-surface-sunken/60 text-xs font-semibold">
            {footer}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

const yes = (v: boolean) => <YesNoPill value={v} />;
const n = (v: number | null | undefined, d = 2) => (v ?? 0).toFixed(d);

export function OverviewTab({ data }: { readonly data: D }) {
  const fmt = useFormat();
  const p = data.product;
  const customs = (p.customs ?? {}) as Record<string, unknown>;
  const hazmat = (p.hazmat ?? {}) as Record<string, unknown>;
  const isPackaging = p.productCategory === 'Packaging Material';
  const general: KvItem[] = [
    { key: 'client', label: 'Client', value: `${p.clientName} (${p.clientCode})` },
    {
      key: 'category',
      label: 'Category',
      value:
        p.productCategory === 'Kit'
          ? `Kit · ${p.kitType ?? ''}`
          : p.productCategory === 'Packaging Material'
            ? 'Packaging material'
            : 'Product',
    },
    { key: 'type', label: 'Product type', value: p.productType },
    { key: 'group', label: 'Product group', value: p.productGroup },
    { key: 'uom', label: 'UOM pack type', value: p.uom },
    ...(() => {
      const primary = data.packTypes.find((pt) => pt.kind === 'Primary');
      return primary
        ? [
            {
              key: 'pack-weight',
              label: `Weight (${primary.packType})`,
              value: `${n(primary.weight)} ${primary.weightUnit.toLowerCase()}`,
            },
            {
              key: 'pack-dims',
              label: `Dimensions (${primary.packType})`,
              value: `${n(primary.length)} × ${n(primary.width)} × ${n(primary.height)} ${primary.dimensionUnit.toLowerCase()}`,
            },
          ]
        : [];
    })(),
    { key: 'fnsku', label: 'FNSKU', value: p.fnsku },
    { key: 'purchase', label: 'Purchase price', value: fmt.money(p.purchasePrice, p.currency, 'summary') },
    ...(isPackaging
      ? []
      : [
          { key: 'sales', label: 'Sales price', value: fmt.money(p.price, p.currency, 'summary') },
          { key: 'tax', label: 'Tax rate', value: `${p.taxRate}%` },
        ]),
    { key: 'safety', label: 'Minimum safety stock', value: fmt.quantity(p.minSafetyStock) },
    { key: 'created', label: 'Created', value: fmt.dateTime(p.createdAt) },
    { key: 'updated', label: 'Last updated', value: fmt.dateTime(p.updatedAt) },
    { key: 'desc', label: 'Description', value: p.description, full: true },
  ];
  const flags: readonly (readonly [string, boolean])[] = [
    ['Fragile', p.isFragile],
    ['Oversized', p.isOversized],
    ['Insert', p.isInsert],
    ['Stackable', p.isStackable],
    ['Poster', p.isPoster],
    ['Foldable', p.isFoldable],
    ...(isPackaging ? [] : [['Liquid', p.isLiquid] as const]),
    ['Non-returnable', p.isNonReturnable],
    ['Digital', p.isDigital],
    ['Hazardous', p.isHazmat],
  ];
  const tracking: KvItem[] =
    p.productCategory === 'Kit'
      ? []
      : [
          {
            key: 'lot',
            label: 'Lot/batch tracking',
            value: p.trackLot
              ? `On · ${p.lotScanMethod ?? 'During Picking'}${p.lotReceivingOnly ? ' · receiving only' : ''}`
              : 'Off',
          },
          {
            key: 'exp',
            label: 'Expiry tracking',
            value: p.trackExpiry
              ? `On · ${p.expiryFormat ?? ''} · ${p.expiryScanMethod ?? 'During Picking'}`
              : 'Off',
          },
          { key: 'shelf', label: 'Shelf life', value: p.shelfLifeDays ? `${p.shelfLifeDays} days` : null },
          {
            key: 'prod',
            label: 'Production date tracking',
            value: p.trackProductionDate ? `On · ${p.productionFormat ?? ''}` : 'Off',
          },
          {
            key: 'serial',
            label: 'Serial tracking',
            value: p.trackSerial
              ? `${p.serialMethod ?? 'On'}${p.trackSecondarySerial ? ' · secondary' : ''}`
              : 'Off',
          },
        ];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Section title="General" className="xl:col-span-2">
        <KvList items={general} columns={3} />
      </Section>
      <Section title="Handling">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {flags.map(([label, on]) => (
            <li key={label} className="flex items-center justify-between gap-2">
              <span className="text-secondary">{label}</span>
              {yes(on)}
            </li>
          ))}
        </ul>
        {p.packingInstructions || p.returnInstructions ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-xs">
            {p.packingInstructions ? (
              <p>
                <span className="font-semibold text-foreground">Packing: </span>
                {p.packingInstructions}
              </p>
            ) : null}
            {p.returnInstructions ? (
              <p>
                <span className="font-semibold text-foreground">Returns: </span>
                {p.returnInstructions}
              </p>
            ) : null}
          </div>
        ) : null}
      </Section>
      {tracking.length ? (
        <Section title="Tracking" className="xl:col-span-2">
          <KvList items={tracking} columns={3} />
        </Section>
      ) : null}
      <Section title="Customs and hazmat">
        <KvList
          columns={2}
          items={[
            { key: 'hs', label: 'HS tariff code', value: (customs.hsCode as string) || null },
            {
              key: 'origin',
              label: 'Origin',
              value: customs.originCountry
                ? countryName(normalizeCountryCode(customs.originCountry)) || String(customs.originCountry)
                : null,
            },
            {
              key: 'declared',
              label: 'Declared value',
              value: customs.declaredValue
                ? fmt.money(Number(customs.declaredValue), p.currency, 'summary')
                : null,
            },
            {
              key: 'hzType',
              label: 'Hazmat type',
              value: p.isHazmat ? ((hazmat.type as string) ?? 'Hazardous') : 'Not hazardous',
            },
            ...(p.isHazmat
              ? [
                  { key: 'hzId', label: 'Hazmat ID', value: (hazmat.hazmatId as string) || null },
                  {
                    key: 'psn',
                    label: 'Proper shipping name',
                    value: (hazmat.properShippingName as string) || null,
                    full: true,
                  },
                ]
              : []),
          ]}
        />
      </Section>
    </div>
  );
}

const KIND_ICON = { Primary: Box, Hierarchical: Layers, Irregular: Boxes } as const;

export function PackTypesTab({
  data,
  canEdit = false,
  onSaved,
}: {
  readonly data: D;
  readonly canEdit?: boolean;
  readonly onSaved?: () => void;
}) {
  // Products edit pack types in place; kit and packaging dimensions live on the Packing step.
  if (canEdit && data.product.productCategory === 'Product') {
    return (
      <PackTypesEditor
        productId={data.product.id}
        category={data.product.productCategory}
        onSaved={onSaved ?? (() => undefined)}
      />
    );
  }
  if (data.packTypes.length === 0)
    return (
      <EmptyState
        icon={Box}
        title="No pack types"
        description="Edit the product to add a primary (UOM) pack type."
      />
    );
  return (
    <div className="flex flex-col gap-4">
      {data.product.productCategory !== 'Product' ? (
        <p className="text-xs text-secondary">
          Kit and packaging material dimensions are edited on the product&apos;s Packing step.
        </p>
      ) : null}
      <PackHierarchy nodes={hierarchyFromView(data.packTypes)} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.packTypes.map((pt) => {
          const Icon = KIND_ICON[pt.kind];
          return (
            <Card key={pt.id} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-soft text-primary">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-2xs font-semibold text-faint">
                    {pt.kind === 'Primary' ? 'Primary (UOM)' : pt.kind}
                  </p>
                  <p className="text-base font-semibold text-foreground">
                    {pt.packType}
                    <span className="ml-2 text-xs font-normal text-secondary">
                      {pt.kind === 'Hierarchical' && pt.parentPackType
                        ? `${pt.childQty ?? ''} × ${pt.parentPackType} · `
                        : ''}
                      UOM qty {pt.uomQty}
                    </span>
                  </p>
                </div>
                {hasIncompleteDimensions(pt) ? (
                  <Badge
                    tone="warning"
                    size="sm"
                    title="Length, width or height is 0. Cubing and box selection need all three."
                  >
                    Incomplete dimensions
                  </Badge>
                ) : null}
                {hasMissingWeight(pt) ? (
                  <Badge
                    tone="warning"
                    size="sm"
                    title="Weight is 0. Rate shopping and shipping labels need a weight."
                  >
                    No weight
                  </Badge>
                ) : null}
                {pt.shipPackage ? (
                  <Badge tone="neutral" size="sm">
                    Box {pt.shipPackage}
                  </Badge>
                ) : null}
                {pt.useOwnBox ? (
                  <Badge
                    tone="info"
                    size="sm"
                    title="Packing puts each unit in its own package, with nothing else in it."
                  >
                    Ships in own box
                  </Badge>
                ) : null}
              </div>
              <dl className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
                <div>
                  <dt className="text-2xs text-faint">L × W × H</dt>
                  <dd>
                    {n(pt.length)} × {n(pt.width)} × {n(pt.height)} {pt.dimensionUnit.toLowerCase()}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs text-faint">Weight</dt>
                  <dd>
                    {n(pt.weight)} {pt.weightUnit.toLowerCase()}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs text-faint">Volume</dt>
                  <dd>
                    {formatVolume(pt.volume)} {pt.volumeUnit.toLowerCase()}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-3 border-t border-border bg-surface-sunken/40 px-4 py-3">
                {pt.barcodes.length ? (
                  pt.barcodes.map((b) => (
                    <figure
                      key={b}
                      className="flex flex-col items-center gap-1 rounded-md border border-border bg-white px-3 py-2"
                    >
                      <Barcode
                        value={b}
                        height={10}
                        scale={1}
                        showText={false}
                        className="px-3 pt-2 pb-1"
                        aria-label={`Barcode ${b}`}
                      />
                      <figcaption className="font-mono text-2xs text-body">{b}</figcaption>
                    </figure>
                  ))
                ) : (
                  <p className="text-xs text-faint">
                    {pt.usePrimaryBarcodes
                      ? 'Scans with the primary barcodes.'
                      : 'No barcodes on this pack type.'}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function InventoryTab({ data }: { readonly data: D }) {
  const fmt = useFormat();
  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Available to promise by warehouse"
        description="Current ATP = undamaged on hand − open order demand (allocated or not). Planned ATP adds open purchase orders. The header's Unallocated figure is on hand − allocated − damaged, so it can be higher than ATP while orders wait for allocation."
      >
        <MiniTable
          rows={data.atp}
          getKey={(r) => r.warehouseId}
          empty={{
            title: 'No stock or demand',
            description: 'Nothing on hand, ordered or inbound in your warehouses.',
          }}
          columns={[
            {
              key: 'wh',
              label: 'Warehouse',
              render: (r) => <span className="font-semibold">{r.warehouseCode}</span>,
            },
            { key: 'onHand', label: 'On hand', align: 'right', render: (r) => fmt.quantity(r.onHand) },
            {
              key: 'undamaged',
              label: 'Undamaged',
              align: 'right',
              render: (r) => fmt.quantity(r.undamaged),
            },
            { key: 'openSo', label: 'Open orders', align: 'right', render: (r) => fmt.quantity(r.openSo) },
            {
              key: 'allocated',
              label: 'Allocated',
              align: 'right',
              render: (r) => fmt.quantity(r.allocatedSo),
            },
            { key: 'pickable', label: 'Pickable', align: 'right', render: (r) => fmt.quantity(r.pickable) },
            { key: 'openPo', label: 'Inbound (PO)', align: 'right', render: (r) => fmt.quantity(r.openPo) },
            {
              key: 'atp',
              label: 'Current ATP',
              align: 'right',
              render: (r) => (
                <span className={cn('font-semibold', r.currentAtp < 0 ? 'text-danger' : 'text-foreground')}>
                  {fmt.quantity(r.currentAtp)}
                </span>
              ),
            },
            {
              key: 'planned',
              label: 'Planned ATP',
              align: 'right',
              render: (r) => fmt.quantity(r.plannedAtp),
            },
          ]}
        />
      </Section>
      <Section
        title="Inventory by location"
        description="Every bucket with stock, by location, LP, lot and expiry. Unallocated = on hand − allocated − damaged."
        action={
          <Link
            href={`/inventory/by-location?q=${encodeURIComponent(data.product.sku)}&qm=eq`}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Open in Inventory by location
          </Link>
        }
      >
        <MiniTable
          rows={data.inventory}
          getKey={(r) => r.id}
          empty={{
            title: 'No stock on hand',
            description: 'Receive a purchase order or adjust inventory to put this product on a location.',
          }}
          columns={[
            { key: 'wh', label: 'Warehouse', render: (r) => r.warehouseCode },
            {
              key: 'loc',
              label: 'Location',
              render: (r) => <span className="font-mono font-semibold">{r.locationCode}</span>,
            },
            { key: 'zone', label: 'Zone', render: (r) => r.zone ?? '—' },
            { key: 'lp', label: 'LP', render: (r) => r.lpNumber ?? '—' },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} size="sm" /> },
            { key: 'pack', label: 'Pack type', render: (r) => r.packType },
            { key: 'lot', label: 'Lot', render: (r) => r.lotNumber ?? '—' },
            { key: 'exp', label: 'Expiry', render: (r) => (r.expiryDate ? fmt.date(r.expiryDate) : '—') },
            { key: 'onHand', label: 'On hand', align: 'right', render: (r) => fmt.quantity(r.onHand) },
            { key: 'alloc', label: 'Allocated', align: 'right', render: (r) => fmt.quantity(r.allocated) },
            {
              key: 'dmg',
              label: 'Damaged',
              align: 'right',
              render: (r) =>
                r.damaged ? (
                  <span className="text-danger">{fmt.quantity(r.damaged)}</span>
                ) : (
                  <span className="text-faint">0</span>
                ),
            },
            {
              key: 'avail',
              label: 'Unallocated',
              align: 'right',
              render: (r) => <span className="font-semibold">{fmt.quantity(r.available)}</span>,
            },
          ]}
          footer={
            data.inventory.length > 1 ? (
              <tr>
                <td colSpan={8} className="px-3 py-2 text-secondary">
                  Total · {data.inventory.length} buckets
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt.quantity(data.totals.onHand)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt.quantity(data.totals.allocated)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt.quantity(data.totals.damaged)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt.quantity(data.totals.available)}</td>
              </tr>
            ) : undefined
          }
        />
      </Section>
    </div>
  );
}

export function OrdersTab({ data }: { readonly data: D }) {
  const fmt = useFormat();
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
      <Section title="Open shipment orders" description="Orders that still need this product.">
        <MiniTable
          rows={data.openOrders}
          getKey={(r) => r.id}
          empty={{ title: 'No open orders', description: 'No unshipped order includes this product.' }}
          columns={[
            {
              key: 'code',
              label: 'Order',
              render: (r) => (
                <Link href={`/orders/${r.id}`} className="font-semibold text-primary hover:underline">
                  {r.code}
                </Link>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: (r) => <StatusPill status={r.status} domain="shipmentOrder" size="sm" />,
            },
            { key: 'wh', label: 'Warehouse', render: (r) => r.warehouseCode },
            { key: 'customer', label: 'Customer', render: (r) => r.customerName ?? '—' },
            { key: 'date', label: 'Order date', render: (r) => fmt.date(r.orderDate) },
            { key: 'qty', label: 'Qty', align: 'right', render: (r) => fmt.quantity(r.quantity) },
            { key: 'alloc', label: 'Allocated', align: 'right', render: (r) => fmt.quantity(r.allocated) },
          ]}
        />
      </Section>
      <Section title="Open purchase orders" description="Inbound supply not yet fully received.">
        <MiniTable
          rows={data.openPos}
          getKey={(r) => r.id}
          empty={{ title: 'No open purchase orders', description: 'Nothing is inbound for this product.' }}
          columns={[
            {
              key: 'code',
              label: 'PO',
              render: (r) => (
                <Link href={`/receiving/${r.id}`} className="font-semibold text-primary hover:underline">
                  {r.code}
                </Link>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: (r) => <StatusPill status={r.status} domain="purchaseOrder" size="sm" />,
            },
            { key: 'wh', label: 'Warehouse', render: (r) => r.warehouseCode },
            { key: 'vendor', label: 'Vendor', render: (r) => r.vendorName },
            {
              key: 'expected',
              label: 'Expected',
              render: (r) => (r.expectedAt ? fmt.date(r.expectedAt) : '—'),
            },
            { key: 'ordered', label: 'Ordered', align: 'right', render: (r) => fmt.quantity(r.ordered) },
            { key: 'received', label: 'Received', align: 'right', render: (r) => fmt.quantity(r.received) },
          ]}
        />
      </Section>
    </div>
  );
}

export function ListingsTab({ data }: { readonly data: D }) {
  const fmt = useFormat();
  return (
    <Section
      title="Channel listings"
      description="Store listings linked to this product."
      action={
        <Link
          href="/products/listings?link=linked"
          className="text-xs font-semibold text-primary hover:underline"
        >
          All product listings
        </Link>
      }
    >
      <MiniTable
        rows={data.listings}
        getKey={(r) => r.id}
        empty={{
          title: 'No linked listings',
          description: 'Link a store listing to this SKU from Product Listings.',
        }}
        columns={[
          {
            key: 'store',
            label: 'Store',
            render: (r) => <span className="font-semibold">{r.storeName}</span>,
          },
          { key: 'provider', label: 'Channel', render: (r) => r.provider },
          {
            key: 'seller',
            label: 'Seller SKU',
            render: (r) => <span className="font-mono">{r.sellerSku}</span>,
          },
          { key: 'channelId', label: 'Channel ID', render: (r) => r.channelProductId },
          {
            key: 'price',
            label: 'Store price',
            align: 'right',
            render: (r) => (r.storePrice === null ? '—' : fmt.money(r.storePrice)),
          },
          { key: 'never', label: 'Never sync', render: (r) => yes(r.neverSync) },
        ]}
      />
    </Section>
  );
}

/** Overall buildable figure for the kit, naming the component(s) that cap it. */
export function KitBuildabilitySummary({ components }: { readonly components: D['components'] }) {
  const fmt = useFormat();
  if (components.length === 0) return null;
  const { buildable, limiting, shortForNext } = kitBuildability(components);
  const allTie = limiting.length === components.length && components.length > 1;
  const first = limiting[0];
  const zero = buildable === 0;
  return (
    <div
      role="status"
      aria-label="Kit buildability"
      className={cn(
        'mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3',
        zero ? 'border-danger/40 bg-danger-soft' : 'border-border bg-surface-sunken',
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-2xs font-semibold text-secondary">Buildable kits</span>
        <span
          data-testid="kit-buildable-total"
          className={cn(
            'text-xl font-semibold tabular-nums leading-none',
            zero ? 'text-danger' : 'text-foreground',
          )}
        >
          {fmt.quantity(buildable)}
        </span>
      </div>
      {first ? (
        <p className="min-w-0 text-xs text-secondary">
          {allTie ? (
            <>Every component caps the kit at the same quantity.</>
          ) : (
            <>
              Limited by{' '}
              {limiting.map((c, i) => (
                <React.Fragment key={c.id}>
                  {i > 0 ? ', ' : null}
                  <Link
                    href={`/products/${c.id}`}
                    className="font-mono font-semibold text-primary hover:underline"
                  >
                    {c.sku}
                  </Link>
                </React.Fragment>
              ))}{' '}
              ({fmt.quantity(Math.max(0, first.available))} available, {fmt.quantity(first.quantity)} per
              kit).
            </>
          )}{' '}
          {fmt.quantity(shortForNext)} more {shortForNext === 1 ? 'unit' : 'units'} of{' '}
          {allTie ? 'each component' : first.sku} {shortForNext === 1 ? 'builds' : 'build'} one more kit.
        </p>
      ) : null}
    </div>
  );
}

export function KitTab({ data }: { readonly data: D }) {
  const isKit = data.product.productCategory === 'Kit';
  const limitingIds = new Set(kitBuildability(data.components).limiting.map((c) => c.id));
  const showLimiting = limitingIds.size > 0 && limitingIds.size < data.components.length;
  return (
    <div className="flex flex-col gap-4">
      {isKit ? (
        <Section
          title="Kit components"
          description={
            data.product.kitType === 'Kit to Stock'
              ? 'Assembled through work orders and stocked as its own SKU.'
              : 'Picked from these components per order.'
          }
        >
          <KitBuildabilitySummary components={data.components} />
          <MiniTable
            rows={data.components}
            getKey={(r) => r.id}
            empty={{ title: 'No components', description: 'Edit the kit to add its components.' }}
            columns={[
              {
                key: 'img',
                label: 'Image',
                render: (r) => <ProductThumb url={r.imageUrl} size={28} label={r.name} />,
              },
              {
                key: 'sku',
                label: 'SKU',
                render: (r) => (
                  <Link href={`/products/${r.id}`} className="font-semibold text-primary hover:underline">
                    {r.sku}
                  </Link>
                ),
              },
              { key: 'name', label: 'Name', render: (r) => r.name },
              { key: 'qty', label: 'Qty per kit', align: 'right', render: (r) => r.quantity },
              { key: 'avail', label: 'Available', align: 'right', render: (r) => r.available },
              {
                key: 'kits',
                label: 'Buildable kits',
                align: 'right',
                render: (r) => (
                  <span className="inline-flex items-center justify-end gap-1.5">
                    {showLimiting && limitingIds.has(r.id) ? (
                      <Badge tone="warning" size="sm">
                        Limiting
                      </Badge>
                    ) : null}
                    <span className="font-semibold tabular-nums">{buildableFromComponent(r)}</span>
                  </span>
                ),
              },
            ]}
          />
        </Section>
      ) : null}
      <Section title="Used in kits" description="Kits that consume this product as a component.">
        <MiniTable
          rows={data.usedInKits}
          getKey={(r) => r.id}
          empty={{
            title: 'Not used in any kit',
            description: 'Kits that list this product as a component appear here.',
          }}
          columns={[
            {
              key: 'sku',
              label: 'Kit SKU',
              render: (r) => (
                <Link href={`/products/${r.id}`} className="font-semibold text-primary hover:underline">
                  {r.sku}
                </Link>
              ),
            },
            { key: 'name', label: 'Name', render: (r) => r.name },
            { key: 'qty', label: 'Qty per kit', align: 'right', render: (r) => r.quantity },
          ]}
        />
      </Section>
    </div>
  );
}

export function PlanningTab({ data, onEdit }: { readonly data: D; readonly onEdit?: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Section
        title="Replenishment levels"
        description={`Strategy: ${data.product.replenishmentStrategy === 'Per Warehouse' ? 'per warehouse' : 'global'}.`}
      >
        <MiniTable
          rows={data.replenishment}
          getKey={(r) => r.warehouseCode}
          empty={{
            title: 'No replenishment levels',
            description:
              'Set min/max levels so KitStaks can flag low pick-face stock and create replenishment moves.',
            action: onEdit ? (
              <Button variant="primary" size="sm" onClick={onEdit}>
                Set replenishment levels
              </Button>
            ) : undefined,
          }}
          columns={[
            { key: 'wh', label: 'Warehouse', render: (r) => r.warehouseCode },
            { key: 'min', label: 'Min level', align: 'right', render: (r) => r.min },
            { key: 'max', label: 'Max level', align: 'right', render: (r) => r.max },
          ]}
        />
      </Section>
      <Section title="Inventory channel allocation" description="Quantities pushed to each sales channel.">
        <MiniTable
          rows={data.allocations}
          getKey={(r) => `${r.storeName}:${r.warehouseCode ?? ''}`}
          empty={{
            title: 'No allocations',
            description: 'All available stock is published to every channel.',
          }}
          columns={[
            { key: 'store', label: 'Channel', render: (r) => r.storeName },
            { key: 'wh', label: 'Warehouse', render: (r) => r.warehouseCode ?? 'All warehouses' },
            { key: 'static', label: 'Static qty', align: 'right', render: (r) => r.staticQty ?? '—' },
            { key: 'reserve', label: 'Reserve qty', align: 'right', render: (r) => r.reserveQty ?? '—' },
            {
              key: 'pct',
              label: 'Allocation %',
              align: 'right',
              render: (r) => (r.allocationPct === null ? '—' : `${r.allocationPct}%`),
            },
            { key: 'synced', label: 'Synced qty', align: 'right', render: (r) => r.syncedQty },
          ]}
        />
      </Section>
    </div>
  );
}

export function TransactionsTab({
  data,
  onOpenChangeLog,
  canAddStock,
}: {
  readonly data: D;
  readonly onOpenChangeLog?: () => void;
  readonly canAddStock?: boolean;
}) {
  const fmt = useFormat();
  return (
    <Section
      title="Inventory transactions"
      description="The last 100 ledger entries in your warehouses."
      action={
        onOpenChangeLog ? (
          <button
            type="button"
            onClick={onOpenChangeLog}
            className="text-xs font-semibold text-primary hover:underline"
          >
            View change log
          </button>
        ) : undefined
      }
    >
      <MiniTable
        rows={data.transactions}
        getKey={(r) => r.id}
        empty={{
          title: 'No transactions yet',
          description:
            'Stock movements for this product show up here once it is received, adjusted, moved or shipped.',
          action: (
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/receiving/new" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                Create receipt
              </Link>
              {canAddStock ? (
                <Link
                  href="/inventory/by-location"
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  Add inventory
                </Link>
              ) : null}
            </div>
          ),
        }}
        columns={[
          { key: 'seq', label: '#', render: (r) => <span className="tabular-nums text-faint">{r.seq}</span> },
          { key: 'at', label: 'Date', render: (r) => fmt.dateTime(r.at) },
          { key: 'type', label: 'Type', render: (r) => r.type },
          { key: 'wh', label: 'Warehouse', render: (r) => r.warehouseCode },
          { key: 'from', label: 'From', render: (r) => r.fromLocation ?? '—' },
          { key: 'to', label: 'To', render: (r) => r.toLocation ?? '—' },
          { key: 'lot', label: 'Lot', render: (r) => r.lotNumber ?? '—' },
          { key: 'ref', label: 'Reference', render: (r) => r.reference ?? '—' },
          { key: 'source', label: 'Source', render: (r) => r.source },
          {
            key: 'qty',
            label: 'Qty',
            align: 'right',
            render: (r) => (
              <span className={cn('font-semibold', r.qty < 0 && 'text-danger')}>{fmt.quantity(r.qty)}</span>
            ),
          },
        ]}
      />
    </Section>
  );
}
