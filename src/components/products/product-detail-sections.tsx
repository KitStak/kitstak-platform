"use client";

/**
 * Product detail tab bodies: overview, pack types & barcodes, inventory (real buckets +
 * ATP per warehouse), open orders / POs, listings, kit components / used in kits,
 * planning (replenishment + channel allocation) and the inventory ledger.
 */
import * as React from "react";
import Link from "next/link";
import { Box, Boxes, Layers, PackageSearch } from "lucide-react";
import { KvList, type KvItem } from "@/components/shared/kv-list";
import { Badge } from "@/components/ui/badge";
import { Barcode } from "@/components/ui/barcode";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, YesNoPill } from "@/components/ui/status-pill";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { countryName } from "@/lib/countries";
import { normalizeCountryCode } from "@/lib/grid-defs/products/product-form";
import { ProductThumb, type ProductDetailData } from "./catalog-shared";

type D = ProductDetailData;

export function Section({ title, description, action, children, className }: { readonly title: string; readonly description?: string; readonly action?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
          {description ? <p className="text-[12px] text-secondary">{description}</p> : null}
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
  readonly align?: "right";
  readonly render: (row: T) => React.ReactNode;
}

export function MiniTable<T>({ rows, columns, getKey, empty, footer }: { readonly rows: readonly T[]; readonly columns: readonly Col<T>[]; readonly getKey: (row: T) => string; readonly empty: { title: string; description: string }; readonly footer?: React.ReactNode }) {
  if (rows.length === 0) return <EmptyState compact icon={PackageSearch} title={empty.title} description={empty.description} />;
  return (
    <div className="overflow-x-auto rounded-md border border-border ks-scroll">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          <tr>{columns.map((c) => <th key={c.key} className={cn("whitespace-nowrap px-3 py-2", c.align === "right" && "text-right")}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={getKey(r)} className="hover:bg-surface-sunken/60">
              {columns.map((c) => <td key={c.key} className={cn("whitespace-nowrap px-3 py-2 text-body", c.align === "right" && "text-right tabular-nums")}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot className="border-t border-border bg-surface-sunken/60 text-[12px] font-semibold">{footer}</tfoot> : null}
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
  const isPackaging = p.productCategory === "Packaging Material";
  const general: KvItem[] = [
    { key: "client", label: "Client", value: `${p.clientName} (${p.clientCode})` },
    { key: "category", label: "Category", value: p.productCategory === "Kit" ? `Kit · ${p.kitType ?? ""}` : p.productCategory === "Packaging Material" ? "Packaging material" : "Product" },
    { key: "type", label: "Product type", value: p.productType },
    { key: "group", label: "Product group", value: p.productGroup },
    { key: "uom", label: "UOM pack type", value: p.uom },
    { key: "fnsku", label: "FNSKU", value: p.fnsku },
    { key: "purchase", label: "Purchase price", value: fmt.money(p.purchasePrice, p.currency, "summary") },
    ...(isPackaging ? [] : [{ key: "sales", label: "Sales price", value: fmt.money(p.price, p.currency, "summary") }, { key: "tax", label: "Tax rate", value: `${p.taxRate}%` }]),
    { key: "safety", label: "Minimum safety stock", value: fmt.quantity(p.minSafetyStock) },
    { key: "created", label: "Created", value: fmt.dateTime(p.createdAt) },
    { key: "updated", label: "Last updated", value: fmt.dateTime(p.updatedAt) },
    { key: "desc", label: "Description", value: p.description, full: true },
  ];
  const flags: readonly (readonly [string, boolean])[] = [
    ["Fragile", p.isFragile], ["Oversized", p.isOversized], ["Insert", p.isInsert], ["Stackable", p.isStackable], ["Poster", p.isPoster],
    ["Foldable", p.isFoldable], ...(isPackaging ? [] : [["Liquid", p.isLiquid] as const]), ["Non-returnable", p.isNonReturnable], ["Digital", p.isDigital], ["Hazardous", p.isHazmat],
  ];
  const tracking: KvItem[] = p.productCategory === "Kit" ? [] : [
    { key: "lot", label: "Lot/batch tracking", value: p.trackLot ? `On · ${p.lotScanMethod ?? "During Picking"}${p.lotReceivingOnly ? " · receiving only" : ""}` : "Off" },
    { key: "exp", label: "Expiry tracking", value: p.trackExpiry ? `On · ${p.expiryFormat ?? ""} · ${p.expiryScanMethod ?? "During Picking"}` : "Off" },
    { key: "shelf", label: "Shelf life", value: p.shelfLifeDays ? `${p.shelfLifeDays} days` : null },
    { key: "prod", label: "Production date tracking", value: p.trackProductionDate ? `On · ${p.productionFormat ?? ""}` : "Off" },
    { key: "serial", label: "Serial tracking", value: p.trackSerial ? `${p.serialMethod ?? "On"}${p.trackSecondarySerial ? " · secondary" : ""}` : "Off" },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Section title="General" className="xl:col-span-2"><KvList items={general} columns={3} /></Section>
      <Section title="Handling">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          {flags.map(([label, on]) => <li key={label} className="flex items-center justify-between gap-2"><span className="text-secondary">{label}</span>{yes(on)}</li>)}
        </ul>
        {p.packingInstructions || p.returnInstructions ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-[12px]">
            {p.packingInstructions ? <p><span className="font-semibold text-foreground">Packing: </span>{p.packingInstructions}</p> : null}
            {p.returnInstructions ? <p><span className="font-semibold text-foreground">Returns: </span>{p.returnInstructions}</p> : null}
          </div>
        ) : null}
      </Section>
      {tracking.length ? <Section title="Tracking" className="xl:col-span-2"><KvList items={tracking} columns={3} /></Section> : null}
      <Section title="Customs and hazmat">
        <KvList columns={2} items={[
          { key: "hs", label: "HS tariff code", value: (customs.hsCode as string) || null },
          { key: "origin", label: "Origin", value: customs.originCountry ? countryName(normalizeCountryCode(customs.originCountry)) || String(customs.originCountry) : null },
          { key: "declared", label: "Declared value", value: customs.declaredValue ? fmt.money(Number(customs.declaredValue), p.currency, "summary") : null },
          { key: "hzType", label: "Hazmat type", value: p.isHazmat ? (hazmat.type as string) ?? "Hazardous" : "Not hazardous" },
          ...(p.isHazmat ? [{ key: "hzId", label: "Hazmat ID", value: (hazmat.hazmatId as string) || null }, { key: "psn", label: "Proper shipping name", value: (hazmat.properShippingName as string) || null, full: true }] : []),
        ]} />
      </Section>
    </div>
  );
}

const KIND_ICON = { Primary: Box, Hierarchical: Layers, Irregular: Boxes } as const;

export function PackTypesTab({ data }: { readonly data: D }) {
  if (data.packTypes.length === 0) return <EmptyState icon={Box} title="No pack types" description="Edit the product to add a primary (UOM) pack type." />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {data.packTypes.map((pt) => {
        const Icon = KIND_ICON[pt.kind];
        return (
          <Card key={pt.id} className="overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-soft text-primary"><Icon className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">{pt.kind === "Primary" ? "Primary (UOM)" : pt.kind}</p>
                <p className="text-[15px] font-semibold text-foreground">
                  {pt.packType}
                  <span className="ml-2 text-[12px] font-normal text-secondary">{pt.kind === "Hierarchical" && pt.parentPackType ? `${pt.childQty ?? ""} × ${pt.parentPackType} · ` : ""}UOM qty {pt.uomQty}</span>
                </p>
              </div>
              {pt.shipPackage ? <Badge tone="neutral" size="sm">Box {pt.shipPackage}</Badge> : null}
            </div>
            <dl className="grid grid-cols-3 gap-3 px-4 py-3 text-[13px]">
              <div><dt className="text-[11px] uppercase tracking-[0.04em] text-faint">L × W × H</dt><dd>{n(pt.length)} × {n(pt.width)} × {n(pt.height)} {pt.dimensionUnit.toLowerCase()}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-[0.04em] text-faint">Weight</dt><dd>{n(pt.weight)} {pt.weightUnit.toLowerCase()}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-[0.04em] text-faint">Volume</dt><dd>{n(pt.volume, 3)} {pt.volumeUnit.toLowerCase()}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-3 border-t border-border bg-surface-sunken/40 px-4 py-3">
              {pt.barcodes.length ? pt.barcodes.map((b) => (
                <figure key={b} className="flex flex-col items-center gap-1 rounded-md border border-border bg-white px-3 py-2">
                  <Barcode value={b} height={10} scale={1} aria-label={`Barcode ${b}`} />
                  <figcaption className="font-mono text-[11px] text-body">{b}</figcaption>
                </figure>
              )) : <p className="text-[12px] text-faint">{pt.usePrimaryBarcodes ? "Scans with the primary barcodes." : "No barcodes on this pack type."}</p>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function InventoryTab({ data }: { readonly data: D }) {
  const fmt = useFormat();
  return (
    <div className="flex flex-col gap-4">
      <Section title="Available to promise by warehouse" description="Current ATP = undamaged on hand − open order demand. Planned adds open purchase orders.">
        <MiniTable rows={data.atp} getKey={(r) => r.warehouseId} empty={{ title: "No stock or demand", description: "Nothing on hand, ordered or inbound in your warehouses." }} columns={[
          { key: "wh", label: "Warehouse", render: (r) => <span className="font-semibold">{r.warehouseCode}</span> },
          { key: "onHand", label: "On hand", align: "right", render: (r) => fmt.quantity(r.onHand) },
          { key: "undamaged", label: "Undamaged", align: "right", render: (r) => fmt.quantity(r.undamaged) },
          { key: "openSo", label: "Open orders", align: "right", render: (r) => fmt.quantity(r.openSo) },
          { key: "allocated", label: "Allocated", align: "right", render: (r) => fmt.quantity(r.allocatedSo) },
          { key: "pickable", label: "Pickable", align: "right", render: (r) => fmt.quantity(r.pickable) },
          { key: "openPo", label: "Inbound (PO)", align: "right", render: (r) => fmt.quantity(r.openPo) },
          { key: "atp", label: "Current ATP", align: "right", render: (r) => <span className={cn("font-semibold", r.currentAtp < 0 ? "text-danger" : "text-foreground")}>{fmt.quantity(r.currentAtp)}</span> },
          { key: "planned", label: "Planned ATP", align: "right", render: (r) => fmt.quantity(r.plannedAtp) },
        ]} />
      </Section>
      <Section title="Inventory by location" description="Every bucket with stock, by location, LP, lot and expiry." action={<Link href={`/inventory/by-location?q=${encodeURIComponent(data.product.sku)}&qm=eq`} className="text-[12px] font-semibold text-primary hover:underline">Open in Inventory by location</Link>}>
        <MiniTable rows={data.inventory} getKey={(r) => r.id} empty={{ title: "No stock on hand", description: "Receive a purchase order or adjust inventory to put this product on a location." }} columns={[
          { key: "wh", label: "Warehouse", render: (r) => r.warehouseCode },
          { key: "loc", label: "Location", render: (r) => <span className="font-mono font-semibold">{r.locationCode}</span> },
          { key: "zone", label: "Zone", render: (r) => r.zone ?? "—" },
          { key: "lp", label: "LP", render: (r) => r.lpNumber ?? "—" },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} size="sm" /> },
          { key: "pack", label: "Pack type", render: (r) => r.packType },
          { key: "lot", label: "Lot", render: (r) => r.lotNumber ?? "—" },
          { key: "exp", label: "Expiry", render: (r) => (r.expiryDate ? fmt.date(r.expiryDate) : "—") },
          { key: "onHand", label: "On hand", align: "right", render: (r) => fmt.quantity(r.onHand) },
          { key: "alloc", label: "Allocated", align: "right", render: (r) => fmt.quantity(r.allocated) },
          { key: "dmg", label: "Damaged", align: "right", render: (r) => (r.damaged ? <span className="text-danger">{fmt.quantity(r.damaged)}</span> : <span className="text-faint">0</span>) },
          { key: "avail", label: "Available", align: "right", render: (r) => <span className="font-semibold">{fmt.quantity(r.available)}</span> },
        ]} footer={data.inventory.length > 1 ? (
          <tr>
            <td colSpan={8} className="px-3 py-2 text-secondary">Total · {data.inventory.length} buckets</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmt.quantity(data.totals.onHand)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmt.quantity(data.totals.allocated)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmt.quantity(data.totals.damaged)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmt.quantity(data.totals.available)}</td>
          </tr>
        ) : undefined} />
      </Section>
    </div>
  );
}

export function OrdersTab({ data }: { readonly data: D }) {
  const fmt = useFormat();
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
      <Section title="Open shipment orders" description="Orders that still need this product.">
        <MiniTable rows={data.openOrders} getKey={(r) => r.id} empty={{ title: "No open orders", description: "No unshipped order includes this product." }} columns={[
          { key: "code", label: "Order", render: (r) => <Link href={`/orders/${r.id}`} className="font-semibold text-primary hover:underline">{r.code}</Link> },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} domain="shipmentOrder" size="sm" /> },
          { key: "wh", label: "Warehouse", render: (r) => r.warehouseCode },
          { key: "customer", label: "Customer", render: (r) => r.customerName ?? "—" },
          { key: "date", label: "Order date", render: (r) => fmt.date(r.orderDate) },
          { key: "qty", label: "Qty", align: "right", render: (r) => fmt.quantity(r.quantity) },
          { key: "alloc", label: "Allocated", align: "right", render: (r) => fmt.quantity(r.allocated) },
        ]} />
      </Section>
      <Section title="Open purchase orders" description="Inbound supply not yet fully received.">
        <MiniTable rows={data.openPos} getKey={(r) => r.id} empty={{ title: "No open purchase orders", description: "Nothing is inbound for this product." }} columns={[
          { key: "code", label: "PO", render: (r) => <Link href={`/receiving/${r.id}`} className="font-semibold text-primary hover:underline">{r.code}</Link> },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} domain="purchaseOrder" size="sm" /> },
          { key: "wh", label: "Warehouse", render: (r) => r.warehouseCode },
          { key: "vendor", label: "Vendor", render: (r) => r.vendorName },
          { key: "expected", label: "Expected", render: (r) => (r.expectedAt ? fmt.date(r.expectedAt) : "—") },
          { key: "ordered", label: "Ordered", align: "right", render: (r) => fmt.quantity(r.ordered) },
          { key: "received", label: "Received", align: "right", render: (r) => fmt.quantity(r.received) },
        ]} />
      </Section>
    </div>
  );
}

export function ListingsTab({ data }: { readonly data: D }) {
  const fmt = useFormat();
  return (
    <Section title="Channel listings" description="Store listings linked to this product." action={<Link href="/products/listings?link=linked" className="text-[12px] font-semibold text-primary hover:underline">All product listings</Link>}>
      <MiniTable rows={data.listings} getKey={(r) => r.id} empty={{ title: "No linked listings", description: "Link a store listing to this SKU from Product Listings." }} columns={[
        { key: "store", label: "Store", render: (r) => <span className="font-semibold">{r.storeName}</span> },
        { key: "provider", label: "Channel", render: (r) => r.provider },
        { key: "seller", label: "Seller SKU", render: (r) => <span className="font-mono">{r.sellerSku}</span> },
        { key: "channelId", label: "Channel ID", render: (r) => r.channelProductId },
        { key: "price", label: "Store price", align: "right", render: (r) => (r.storePrice === null ? "—" : fmt.money(r.storePrice)) },
        { key: "never", label: "Never sync", render: (r) => yes(r.neverSync) },
      ]} />
    </Section>
  );
}

export function KitTab({ data }: { readonly data: D }) {
  const isKit = data.product.productCategory === "Kit";
  return (
    <div className="flex flex-col gap-4">
      {isKit ? (
        <Section title="Kit components" description={data.product.kitType === "Kit to Stock" ? "Assembled through work orders and stocked as its own SKU." : "Picked from these components per order."}>
          <MiniTable rows={data.components} getKey={(r) => r.id} empty={{ title: "No components", description: "Edit the kit to add its components." }} columns={[
            { key: "img", label: "Image", render: (r) => <ProductThumb url={r.imageUrl} size={28} label={r.name} /> },
            { key: "sku", label: "SKU", render: (r) => <Link href={`/products/${r.id}`} className="font-semibold text-primary hover:underline">{r.sku}</Link> },
            { key: "name", label: "Name", render: (r) => r.name },
            { key: "qty", label: "Qty per kit", align: "right", render: (r) => r.quantity },
            { key: "avail", label: "Available", align: "right", render: (r) => r.available },
            { key: "kits", label: "Buildable kits", align: "right", render: (r) => <span className="font-semibold">{Math.floor(Math.max(0, r.available) / Math.max(1, r.quantity))}</span> },
          ]} />
        </Section>
      ) : null}
      <Section title="Used in kits" description="Kits that consume this product as a component.">
        <MiniTable rows={data.usedInKits} getKey={(r) => r.id} empty={{ title: "Not used in any kit", description: "Kits that list this product as a component appear here." }} columns={[
          { key: "sku", label: "Kit SKU", render: (r) => <Link href={`/products/${r.id}`} className="font-semibold text-primary hover:underline">{r.sku}</Link> },
          { key: "name", label: "Name", render: (r) => r.name },
          { key: "qty", label: "Qty per kit", align: "right", render: (r) => r.quantity },
        ]} />
      </Section>
    </div>
  );
}

export function PlanningTab({ data }: { readonly data: D }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Section title="Replenishment levels" description={`Strategy: ${data.product.replenishmentStrategy === "Per Warehouse" ? "per warehouse" : "global"}.`}>
        <MiniTable rows={data.replenishment} getKey={(r) => r.warehouseCode} empty={{ title: "No replenishment levels", description: "Edit the product to set min/max levels per warehouse." }} columns={[
          { key: "wh", label: "Warehouse", render: (r) => r.warehouseCode },
          { key: "min", label: "Min level", align: "right", render: (r) => r.min },
          { key: "max", label: "Max level", align: "right", render: (r) => r.max },
        ]} />
      </Section>
      <Section title="Inventory channel allocation" description="Quantities pushed to each sales channel.">
        <MiniTable rows={data.allocations} getKey={(r) => `${r.storeName}:${r.warehouseCode ?? ""}`} empty={{ title: "No allocations", description: "All available stock is published to every channel." }} columns={[
          { key: "store", label: "Channel", render: (r) => r.storeName },
          { key: "wh", label: "Warehouse", render: (r) => r.warehouseCode ?? "All warehouses" },
          { key: "static", label: "Static qty", align: "right", render: (r) => r.staticQty ?? "—" },
          { key: "reserve", label: "Reserve qty", align: "right", render: (r) => r.reserveQty ?? "—" },
          { key: "pct", label: "Allocation %", align: "right", render: (r) => (r.allocationPct === null ? "—" : `${r.allocationPct}%`) },
          { key: "synced", label: "Synced qty", align: "right", render: (r) => r.syncedQty },
        ]} />
      </Section>
    </div>
  );
}

export function TransactionsTab({ data, onOpenChangeLog }: { readonly data: D; readonly onOpenChangeLog?: () => void }) {
  const fmt = useFormat();
  return (
    <Section title="Inventory transactions" description="The last 100 ledger entries in your warehouses." action={onOpenChangeLog ? <button type="button" onClick={onOpenChangeLog} className="text-[12px] font-semibold text-primary hover:underline">View change log</button> : undefined}>
      <MiniTable rows={data.transactions} getKey={(r) => r.id} empty={{ title: "No transactions yet", description: "Receipts, moves, adjustments and shipments appear here." }} columns={[
        { key: "seq", label: "#", render: (r) => <span className="tabular-nums text-faint">{r.seq}</span> },
        { key: "at", label: "Date", render: (r) => fmt.dateTime(r.at) },
        { key: "type", label: "Type", render: (r) => r.type },
        { key: "wh", label: "Warehouse", render: (r) => r.warehouseCode },
        { key: "from", label: "From", render: (r) => r.fromLocation ?? "—" },
        { key: "to", label: "To", render: (r) => r.toLocation ?? "—" },
        { key: "lot", label: "Lot", render: (r) => r.lotNumber ?? "—" },
        { key: "ref", label: "Reference", render: (r) => r.reference ?? "—" },
        { key: "source", label: "Source", render: (r) => r.source },
        { key: "qty", label: "Qty", align: "right", render: (r) => <span className={cn("font-semibold", r.qty < 0 && "text-danger")}>{fmt.quantity(r.qty)}</span> },
      ]} />
    </Section>
  );
}
