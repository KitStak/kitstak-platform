import * as React from "react";
import { Package, PencilLine, Printer } from "lucide-react";
import type { ProductDetail } from "@/server/repositories/products";
import { cn, formatDate, formatMoney, formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import {
  categoryTileClass,
  isFragileHint,
  isHazmatHint,
  isOversized,
  kitComponentsFor,
} from "./derive";

export interface ProductDetailViewProps {
  detail: ProductDetail;
}

function IdentityRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0">
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className="text-right text-[13px] font-medium text-body">{children}</dd>
    </div>
  );
}

function AttributeCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-sunken px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium tabular-nums text-body">{value}</p>
    </div>
  );
}

function HandlingChip({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        active ? "bg-warning-soft text-warning" : "bg-neutral-soft text-faint"
      )}
    >
      {label}
    </span>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="flex-1 border-l border-border px-5 py-3 first:border-l-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{label}</p>
      <p className={cn("mt-0.5 text-[20px] font-semibold tabular-nums text-foreground", accent)}>
        {formatNumber(value)}
      </p>
    </div>
  );
}

const TH = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint whitespace-nowrap";
const TD = "px-4 align-middle whitespace-nowrap";

export function ProductDetailView({ detail }: ProductDetailViewProps) {
  const { product, totals, inventory } = detail;
  const maxDim = Math.max(product.lengthIn, product.widthIn, product.heightIn);
  const fragile = product.isFragile || isFragileHint(product.name);
  const hazmat = product.isHazmat || isHazmatHint(product.name);
  const oversized = isOversized(product.weightOz, maxDim);
  const unitCost = Math.round(product.price * 58) / 100;
  const margin = product.price > 0 ? ((product.price - unitCost) / product.price) * 100 : 0;
  const kitComponents = product.isKit ? kitComponentsFor(product.sku, product.name) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Products", href: "/products" },
          { label: product.sku },
        ]}
        title={product.sku}
        helper={product.name}
        actions={
          <>
            <Button variant="secondary" size="md">
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print Labels
            </Button>
            <Button variant="primary" size="md">
              <PencilLine className="h-3.5 w-3.5" aria-hidden />
              Edit Product
            </Button>
          </>
        }
      />

      <div className="ks-scroll min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* left — identity */}
          <Card className="p-5">
            <div
              className={cn(
                "flex aspect-square w-full items-center justify-center rounded-lg",
                categoryTileClass(product.category)
              )}
              aria-hidden
            >
              <Package className="h-14 w-14" strokeWidth={1.25} />
            </div>
            <div className="mt-4 flex items-start justify-between gap-2">
              <h2 className="text-[15px] font-semibold leading-5 text-foreground">
                {product.name}
              </h2>
              <StatusPill status={product.status} />
            </div>
            <dl className="mt-4">
              <IdentityRow label="SKU">{product.sku}</IdentityRow>
              <IdentityRow label="Barcode">
                <span className="font-mono text-[12px] tabular-nums">{product.barcode}</span>
              </IdentityRow>
              <IdentityRow label="Client">
                {product.clientName}
                <span className="ml-1 text-[11px] font-normal text-faint">
                  ({product.clientCode})
                </span>
              </IdentityRow>
              <IdentityRow label="Category">
                <span className="inline-flex items-center rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-medium text-neutral">
                  {product.category}
                </span>
              </IdentityRow>
              <IdentityRow label="Unit of Measure">{product.uom}</IdentityRow>
              <IdentityRow label="Reorder Point">
                <span className="tabular-nums">{formatNumber(product.reorderPoint)}</span>
              </IdentityRow>
              <IdentityRow label="Created">{formatDate(product.createdAt)}</IdentityRow>
            </dl>
          </Card>

          {/* right — attributes, pricing, inventory */}
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex divide-border">
              <StatTile label="On Hand" value={totals.onHand} />
              <StatTile label="Allocated" value={totals.allocated} />
              <StatTile
                label="Available"
                value={totals.available}
                accent={totals.available <= product.reorderPoint ? "text-warning" : "text-success"}
              />
              <StatTile
                label="Damaged"
                value={totals.damaged}
                accent={totals.damaged > 0 ? "text-danger" : undefined}
              />
            </Card>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader title="Attributes" description="Dimensions, weight and handling" />
                <div className="grid grid-cols-2 gap-2 px-5 pb-3 sm:grid-cols-4">
                  <AttributeCell label="Length" value={`${product.lengthIn} in`} />
                  <AttributeCell label="Width" value={`${product.widthIn} in`} />
                  <AttributeCell label="Height" value={`${product.heightIn} in`} />
                  <AttributeCell label="Weight" value={`${product.weightOz} oz`} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
                  {product.isKit ? (
                    <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                      Kit
                    </span>
                  ) : null}
                  <HandlingChip label="Fragile" active={fragile} />
                  <HandlingChip label="Oversized" active={oversized} />
                  <HandlingChip label="Hazmat" active={hazmat} />
                </div>
              </Card>

              <Card>
                <CardHeader title="Pricing" description="Retail and landed economics" />
                <dl className="px-5 pb-4">
                  <IdentityRow label="Retail Price">
                    <span className="tabular-nums">{formatMoney(product.price)}</span>
                  </IdentityRow>
                  <IdentityRow label="Unit Cost">
                    <span className="tabular-nums">{formatMoney(unitCost)}</span>
                  </IdentityRow>
                  <IdentityRow label="Gross Margin">
                    <span className="tabular-nums text-success">{margin.toFixed(1)}%</span>
                  </IdentityRow>
                  <IdentityRow label="Declared Value">
                    <span className="tabular-nums">{formatMoney(product.price)}</span>
                  </IdentityRow>
                </dl>
              </Card>
            </div>

            <Card>
              <CardHeader
                title="Inventory by Location"
                description={`${formatNumber(inventory.length)} stocked location${inventory.length === 1 ? "" : "s"} in MLT1`}
              />
              <div className="ks-scroll overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={TH}>Location</th>
                      <th className={TH}>Zone</th>
                      <th className={TH}>Type</th>
                      <th className={TH}>Lot #</th>
                      <th className={cn(TH, "text-right")}>On Hand</th>
                      <th className={cn(TH, "text-right")}>Allocated</th>
                      <th className={cn(TH, "text-right")}>Available</th>
                      <th className={cn(TH, "text-right")}>Damaged</th>
                      <th className={TH}>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-[12px] text-faint">
                          No inventory on hand — receive a PO to stock this product.
                        </td>
                      </tr>
                    ) : (
                      inventory.map((row) => (
                        <tr
                          key={`${row.locationId}-${row.lotNumber ?? ""}`}
                          className="h-10 border-b border-border transition-colors last:border-b-0 hover:bg-surface-sunken"
                        >
                          <td className={cn(TD, "font-medium text-primary")}>{row.locationCode}</td>
                          <td className={TD}>
                            <span className="inline-flex items-center rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-medium text-neutral">
                              {row.zone}
                            </span>
                          </td>
                          <td className={cn(TD, "text-secondary")}>{row.locationType}</td>
                          <td className={cn(TD, "font-mono text-[12px] text-secondary")}>
                            {row.lotNumber ?? "—"}
                          </td>
                          <td className={cn(TD, "text-right tabular-nums text-body")}>
                            {formatNumber(row.onHand)}
                          </td>
                          <td className={cn(TD, "text-right tabular-nums text-secondary")}>
                            {formatNumber(row.allocated)}
                          </td>
                          <td className={cn(TD, "text-right font-medium tabular-nums text-body")}>
                            {formatNumber(row.onHand - row.allocated)}
                          </td>
                          <td
                            className={cn(
                              TD,
                              "text-right tabular-nums",
                              row.damaged > 0 ? "font-medium text-danger" : "text-faint"
                            )}
                          >
                            {formatNumber(row.damaged)}
                          </td>
                          <td className={cn(TD, "text-secondary")}>{formatDate(row.receivedAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {inventory.length > 0 ? (
                    <tfoot>
                      <tr className="h-10 border-t border-border bg-surface-sunken/60">
                        <td className={cn(TD, "text-[11px] font-semibold uppercase tracking-[0.04em] text-faint")} colSpan={4}>
                          Totals
                        </td>
                        <td className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}>
                          {formatNumber(totals.onHand)}
                        </td>
                        <td className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}>
                          {formatNumber(totals.allocated)}
                        </td>
                        <td className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}>
                          {formatNumber(totals.available)}
                        </td>
                        <td className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}>
                          {formatNumber(totals.damaged)}
                        </td>
                        <td className={TD} />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </Card>

            {product.isKit ? (
              <Card>
                <CardHeader
                  title="Kit Components"
                  description="Bill of materials consumed when this kit ships"
                />
                <div className="ks-scroll overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className={TH}>Component SKU</th>
                        <th className={TH}>Name</th>
                        <th className={cn(TH, "text-right")}>Qty per Kit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kitComponents.map((component) => (
                        <tr
                          key={component.sku}
                          className="h-10 border-b border-border transition-colors last:border-b-0 hover:bg-surface-sunken"
                        >
                          <td className={cn(TD, "font-medium text-primary")}>{component.sku}</td>
                          <td className={cn(TD, "text-body")}>{component.name}</td>
                          <td className={cn(TD, "text-right tabular-nums text-body")}>
                            {component.qty}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
