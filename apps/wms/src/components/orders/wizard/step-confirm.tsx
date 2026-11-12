"use client";

/** Step 6 — Confirm: products, customer (ship / bill), order details (warehouse illustration), shipment. */
import * as React from "react";
import { useWatch } from "react-hook-form";
import { Image as ImageIcon, Pencil, Warehouse } from "lucide-react";
import { useFormat } from "@/lib/format";
import { countryName } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { ReadValue } from "./fields";
import { addressNeedsAttention, orderTotals, priorityFromRank, type OrderFormValues } from "./order-form-model";
import { useOrderWizard } from "./order-wizard-context";

function Card({ title, onEdit, children, className }: { readonly title: string; readonly onEdit: () => void; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <section className={`flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 ${className ?? ""}`}>
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-faint">{title}</h3>
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </Button>
      </header>
      {children}
    </section>
  );
}

function addressLines(v: { line1: string; line2: string; city: string; state: string; postal: string; country: string; company?: string }): string[] {
  return [v.company ?? "", v.line1, v.line2, [v.city, [v.state, v.postal].filter(Boolean).join(" ")].filter(Boolean).join(", "), countryName(v.country) || v.country].filter((l) => l && l.trim());
}

export function StepConfirm({ goTo }: { readonly goTo: (key: string) => void }) {
  const fmt = useFormat();
  const { options } = useOrderWizard();
  const v = useWatch() as OrderFormValues;
  const totals = orderTotals(v.lines ?? [], v.discount);
  const warehouse = options?.warehouses.find((w) => w.value === v.warehouseId)?.label ?? "—";
  const client = options?.clients.find((c) => c.value === v.clientId)?.label ?? "—";
  const carrier = options?.carriers.find((c) => c.connectionId === v.carrierConnectionId);
  const service = carrier?.services.find((s) => s.id === v.carrierServiceId)?.name;
  const preset = options?.presets.find((p) => p.value === v.rateShoppingPresetId)?.label;
  const pkg = options?.shipmentPackages.find((p) => p.value === v.shipmentPackageId)?.label;
  const ship = addressLines({ company: v.companyName, line1: v.shipAddress, line2: v.shipAddress2, city: v.shipCity, state: v.shipState, postal: v.shipZip, country: v.shipCountry });
  const bill = v.useShipAsBilling ? null : addressLines({ company: v.billing.companyName, line1: v.billing.line1, line2: v.billing.line2, city: v.billing.city, state: v.billing.state, postal: v.billing.postalCode, country: v.billing.country });
  const name = [v.customerFirstName, v.customerLastName].filter(Boolean).join(" ") || "—";

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Products" onEdit={() => goTo("products")} className="xl:col-span-2">
        <ul className="divide-y divide-border">
          {(v.lines ?? []).map((l) => (
            <li key={l.key} className="flex items-center gap-3 py-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-surface-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element -- channel CDN images */}
                {l.imageUrl ? <img src={l.imageUrl} alt="" width={36} height={36} className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-faint" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{l.sku}</span>
                <span className="block truncate text-xs text-secondary">{l.name}</span>
              </span>
              <span className="w-24 text-right text-xs tabular-nums">{fmt.quantity(l.quantity)} {l.packType}</span>
              <span className="w-28 text-right text-sm font-semibold tabular-nums">{fmt.money(l.quantity * l.unitPrice)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-6 border-t border-border pt-2 text-xs">
          <span className="text-secondary">{fmt.quantity(totals.totalQuantity)} units · {fmt.measure(totals.weightOz / 16, "lb", 2)}</span>
          <span className="font-semibold text-foreground">Total {fmt.money(totals.total, "USD", "summary")}</span>
        </div>
      </Card>

      <Card title="Customer" onEdit={() => goTo("customer")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <ReadValue label="Name">{name}</ReadValue>
          <ReadValue label="Email">{v.customerEmail}</ReadValue>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-2xs font-semibold text-faint">
              Shipment address
              <StatusPill size="sm" status={v.skipAddressVerification ? "Skipped" : v.addressStatus} domain="generic" />
            </span>
            {ship.map((l) => <span key={l} className="text-sm text-foreground">{l}</span>)}
            {addressNeedsAttention(v) ? <span className="text-xs text-warning">Not verified — it is verified when you save.</span> : null}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-2xs font-semibold text-faint">Billing address</span>
            {bill ? bill.map((l) => <span key={l} className="text-sm text-foreground">{l}</span>) : <span className="text-sm text-secondary">Same as shipment address</span>}
          </div>
        </div>
      </Card>

      <Card title="Order details" onEdit={() => goTo("details")}>
        <div className="flex gap-4">
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <ReadValue label="Order code">{v.code}</ReadValue>
            <ReadValue label="Order type">{v.orderTypeName}</ReadValue>
            <ReadValue label="Client">{client}</ReadValue>
            <ReadValue label="Order date">{fmt.dateTime(v.orderDate)}</ReadValue>
            <ReadValue label="Expected shipment date">{fmt.dateTime(v.expectedShipDate)}</ReadValue>
            <ReadValue label="Priority">{`${v.priorityRank} · ${priorityFromRank(v.priorityRank)}`}</ReadValue>
          </div>
          <div className="hidden w-32 shrink-0 flex-col items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-primary-soft to-surface p-3 text-center sm:flex">
            <Warehouse className="h-10 w-10 text-primary" strokeWidth={1.5} aria-hidden />
            <span className="text-xs font-semibold text-foreground">{warehouse}</span>
          </div>
        </div>
      </Card>

      <Card title="Shipment" onEdit={() => goTo("shipping")} className="xl:col-span-2">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <ReadValue label="Carrier">{carrier?.label}</ReadValue>
          <ReadValue label="Service">{service ?? (preset ? `Preset: ${preset}` : null)}</ReadValue>
          <ReadValue label="Shipment package">{pkg}</ReadValue>
          <ReadValue label="Shipping cost">{v.totalShippingCost ? fmt.money(v.totalShippingCost) : null}</ReadValue>
          <ReadValue label="Tracking numbers">{v.trackingNumbers?.length ? v.trackingNumbers.join(", ") : null}</ReadValue>
        </div>
      </Card>
    </div>
  );
}
