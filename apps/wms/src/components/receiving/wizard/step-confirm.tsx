"use client";

/**
 * Step 4 — Other info (custom fields) and Step 5 — Confirm: lines summary (with received /
 * difference once receiving started), the Vendor card (shipping + billing) and the Order
 * details card. A duplicate PO number at Confirm shows Logiwa's red banner.
 */
import * as React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Building2, CalendarDays, Pencil, Warehouse } from "lucide-react";
import { AddressCard, CustomFieldsSection } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/lib/format";
import { useMe } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { receivingDifference } from "@/lib/grid-defs/receiving/po-schemas";
import { ProductThumb, type VendorDetail, useCan } from "../receiving-shared";
import { linesQty, linesTotal, type PoFormValues } from "./po-form-model";

export function StepOther({ form, disabled }: { readonly form: UseFormReturn<PoFormValues>; readonly disabled: boolean }) {
  const values = useWatch({ control: form.control, name: "customFields" });
  const canManage = useCan("inventory.purchase_orders.custom_field_management").allowed;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-secondary">You can optionally add or edit custom fields under “Other info”. They become filters on the purchase order list.</p>
      <CustomFieldsSection entityType="purchase_order" values={values ?? {}} canManage={canManage} disabled={disabled} onChange={(next) => form.setValue("customFields", { ...next }, { shouldDirty: true })} />
    </div>
  );
}

/** Difference pill: negative = short (red), positive = over (green). */
export function DiffPill({ value }: { readonly value: number }) {
  if (value === 0) return <span className="text-xs tabular-nums text-faint">0</span>;
  return (
    <span className={cn("inline-flex min-w-[36px] justify-center rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums", value < 0 ? "bg-[#ED634A3D] text-[var(--label-brown-text)]" : "bg-success-soft text-success")}>
      {value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString()}
    </span>
  );
}

function Card({ title, icon: Icon, action, children, className }: { readonly title: string; readonly icon: React.ComponentType<{ className?: string }>; readonly action?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-lg border border-border bg-surface p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-faint"><Icon className="h-3.5 w-3.5" aria-hidden />{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StepConfirm({ form, duplicate, onDismissDuplicate, goTo, receiving, readOnly = false, vendorFallback = null }: {
  readonly form: UseFormReturn<PoFormValues>;
  readonly duplicate: string | null;
  readonly onDismissDuplicate: () => void;
  readonly goTo: (key: string) => void;
  /** Show received / difference columns (edit after receiving started). */
  readonly receiving: boolean;
  /** Hide the Edit links (view-only roles). */
  readonly readOnly?: boolean;
  /** The vendor loaded with the PO detail: shown at once and kept if the vendor fetch fails. */
  readonly vendorFallback?: VendorDetail | null;
}) {
  const fmt = useFormat();
  const me = useMe();
  const v = useWatch({ control: form.control }) as PoFormValues;
  const fallback = vendorFallback && vendorFallback.id === v.vendorId ? vendorFallback : null;
  const vendor = useApiQuery<VendorDetail>(["vendor", v.vendorId], v.vendorId ? `/api/vendors/${v.vendorId}` : null, { retry: 2, staleTime: 60_000 });
  const warehouse = me.data?.data.contextOptions.warehouses.find((w) => w.id === v.warehouseId);
  const client = me.data?.data.contextOptions.clients.find((c) => c.id === v.clientId);
  const lines = v.lines ?? [];
  const vd = vendor.data?.data ?? fallback ?? undefined;
  const editLink = (key: string, label: string) => readOnly ? null : (
    <Button variant="ghost" size="sm" onClick={() => goTo(key)} aria-label={`Edit ${label}`}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button>
  );

  return (
    <div className="flex flex-col gap-4">
      {duplicate ? (
        <Callout variant="error" title="Duplicate PO number" onDismiss={onDismissDuplicate} action={<Button size="sm" variant="secondary" onClick={() => goTo("details")}>Back to PO details</Button>}>
          {duplicate}
        </Callout>
      ) : null}
      <div className="relative max-w-full overflow-x-auto rounded-lg border border-border ks-scroll">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-surface-sunken">
            <tr className="text-left text-2xs font-semibold text-faint">
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Pack type</th>
              <th className="px-3 py-2 text-right">Quantity</th>
              {receiving ? <th className="px-3 py-2 text-right">Received</th> : null}
              {receiving ? <th className="px-3 py-2 text-right">Difference</th> : null}
              <th className="px-3 py-2 text-right">Price per item</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2.5">
                    <ProductThumb url={l.imageUrl} label={l.sku} size={32} />
                    <span className="min-w-0"><span className="block font-semibold text-foreground">{l.sku}</span><span className="block max-w-[260px] truncate text-secondary">{l.productName}</span></span>
                  </span>
                </td>
                <td className="px-3 py-2">{l.packType}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.orderedQuantity.toLocaleString()}</td>
                {receiving ? <td className="px-3 py-2 text-right tabular-nums">{l.receivedQuantity.toLocaleString()}</td> : null}
                {receiving ? <td className="px-3 py-2 text-right"><DiffPill value={receivingDifference(l.orderedQuantity, l.receivedQuantity)} /></td> : null}
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmt.money(l.unitCost)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-foreground">{fmt.money(Math.round(l.orderedQuantity * l.unitCost * 100) / 100)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-surface-sunken/60 font-semibold">
              <td className="px-3 py-2" colSpan={2}>{lines.length} line{lines.length === 1 ? "" : "s"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{linesQty(lines).toLocaleString()}</td>
              {receiving ? <td className="px-3 py-2 text-right tabular-nums">{lines.reduce((s, l) => s + l.receivedQuantity, 0).toLocaleString()}</td> : null}
              {receiving ? <td className="px-3 py-2 text-right"><DiffPill value={lines.reduce((s, l) => s + l.receivedQuantity - l.orderedQuantity, 0)} /></td> : null}
              <td />
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmt.money(linesTotal(lines))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Vendor" icon={Building2} action={editLink("vendor", "vendor")}>
          {vendor.isPending && v.vendorId && !vd ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              {v.vendorLabel ? <p className="text-base font-semibold text-foreground">{v.vendorLabel}</p> : <Skeleton className="h-5 w-1/2" />}
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-[92px] w-full" />
                <Skeleton className="h-[92px] w-full" />
              </div>
            </div>
          ) : vendor.isError && v.vendorId && !vd ? (
            <div className="flex flex-col gap-2">
              {v.vendorLabel ? <p className="text-base font-semibold text-foreground">{v.vendorLabel}</p> : null}
              <p role="alert" className="text-sm text-secondary">{"Couldn't load the vendor's addresses."}</p>
              <div><Button variant="secondary" size="sm" onClick={() => void vendor.refetch()}>Retry</Button></div>
            </div>
          ) : vd ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-base font-semibold text-foreground">{vd.displayName}</p>
                <p className="text-xs text-secondary">{vd.vendorName}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <AddressCard title="Shipping address" address={vd.shipping} className="p-3" />
                <AddressCard title="Billing address" address={vd.useShipAsBilling ? vd.shipping : vd.billing} className="p-3" />
              </div>
            </div>
          ) : <p className="text-sm text-faint">No vendor selected</p>}
        </Card>
        <Card title="Order details" icon={Warehouse} action={editLink("details", "order details")}>
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Warehouse className="h-7 w-7" aria-hidden /></span>
            <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div className="col-span-2"><dt className="text-faint">PO number</dt><dd className="text-base font-semibold text-foreground">{v.code || "—"}</dd></div>
              <div><dt className="text-faint">PO type</dt><dd className="text-foreground">{v.poType}</dd></div>
              <div><dt className="text-faint">Client</dt><dd className="text-foreground">{client ? client.name : v.clientLabel || "—"}</dd></div>
              <div><dt className="text-faint">PO date</dt><dd className="flex items-center gap-1 text-foreground"><CalendarDays className="h-3 w-3 text-faint" aria-hidden />{v.poDate ? fmt.date(v.poDate) : "—"}</dd></div>
              <div><dt className="text-faint">Warehouse</dt><dd className="text-foreground">{warehouse ? `${warehouse.code} · ${warehouse.name}` : "—"}</dd></div>
              <div><dt className="text-faint">Planned receiving</dt><dd className="text-foreground">{v.plannedReceivingDate ? fmt.dateTime(v.plannedReceivingDate) : "—"}</dd></div>
              <div><dt className="text-faint">Reference number</dt><dd className="text-foreground">{v.referenceNumber || "—"}</dd></div>
              {v.note ? <div className="col-span-2"><dt className="text-faint">Note</dt><dd className="whitespace-pre-wrap text-foreground">{v.note}</dd></div> : null}
            </dl>
          </div>
        </Card>
      </div>
    </div>
  );
}
