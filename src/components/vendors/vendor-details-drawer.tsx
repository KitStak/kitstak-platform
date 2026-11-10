"use client";

/**
 * Read-only vendor "Show details" drawer (parity with the client / customer / retailer
 * Show details views): client, status, contact, shipping + billing addresses, open PO
 * count and the five most recent purchase orders (links to the PO detail page).
 */
import * as React from "react";
import Link from "next/link";
import { Building2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { useApiQuery } from "@/lib/query-client";
import { subdivisionName } from "@/lib/countries";
import { formatDate } from "@/lib/utils";
import { errorMessage, type PoRow, type VendorAddress, type VendorDetail } from "@/components/receiving/receiving-shared";

const dash = <span className="text-faint">—</span>;

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 text-body">{children}</dd>
    </div>
  );
}

function AddressCard({ title, address }: { readonly title: string; readonly address: VendorAddress | null }) {
  const has = address && (address.line1 || address.city || address.state || address.name);
  return (
    <section className="rounded-lg border border-border p-3" aria-label={title}>
      <h4 className="mb-1 text-[12px] font-semibold text-foreground">{title}</h4>
      {has && address ? (
        <div className="text-[13px] leading-5 text-body">
          {address.name ? <div className="font-medium text-foreground">{address.name}</div> : null}
          {address.contactName ? <div>{address.contactName}</div> : null}
          {address.line1 ? <div>{address.line1}</div> : null}
          {address.line2 ? <div>{address.line2}</div> : null}
          <div>{[address.city, address.state ? subdivisionName(address.country || "US", address.state) || address.state : null, address.postalCode].filter(Boolean).join(", ")}</div>
          {address.country ? <div className="text-faint">{address.country}</div> : null}
          {address.phone ? <div className="text-faint">{address.phone}</div> : null}
        </div>
      ) : (
        <p className="text-[13px] text-faint">Not set</p>
      )}
    </section>
  );
}

export function VendorDetailsDrawer({ vendorId, onOpenChange, onEdit }: {
  readonly vendorId: string | null;
  readonly onOpenChange: (open: boolean) => void;
  /** Shown when the viewer may edit vendors. */
  readonly onEdit?: (id: string) => void;
}) {
  const open = vendorId !== null;
  const detail = useApiQuery<VendorDetail>(["vendor", vendorId ?? ""], open ? `/api/vendors/${vendorId}` : null, { retry: false });
  const v = detail.data?.data ?? null;
  const poUrl = v ? `/api/purchase-orders?f.clientId=in:${encodeURIComponent(v.clientId)}&f.vendorName=eq:${encodeURIComponent(v.displayName)}&sort=-poDate&ps=5` : null;
  const pos = useApiQuery<readonly PoRow[]>(["vendor-recent-pos", vendorId ?? "", v?.displayName ?? ""], poUrl, { retry: false });
  const recent = pos.data?.data ?? [];
  const contact = v?.shipping?.contactName || v?.billing?.contactName || "";
  const phone = v?.shipping?.phone || v?.billing?.phone || "";

  let body: React.ReactNode;
  if (detail.isPending) {
    body = <div className="flex flex-col gap-3" aria-busy>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>;
  } else if (detail.error || !v) {
    body = <Callout variant="error" title="Couldn't load the vendor" action={<Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>Retry</Button>}>{errorMessage(detail.error)}</Callout>;
  } else {
    body = (
      <div className="flex flex-col gap-5">
        <dl className="divide-y divide-border">
          <Row label="Display name">{v.displayName}</Row>
          <Row label="Vendor name">{v.vendorName}</Row>
          <Row label="Client">{v.clientName}</Row>
          <Row label="Status"><StatusPill status={v.isActive ? "Active" : "Inactive"} domain="active" size="sm" /></Row>
          <Row label="Contact">{contact || dash}</Row>
          <Row label="Phone">{phone || dash}</Row>
          <Row label="Open POs"><span className="tabular-nums">{v.openPoCount}</span></Row>
          <Row label="Created">{formatDate(v.createdAt)}</Row>
        </dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <AddressCard title="Shipping address" address={v.shipping} />
          <AddressCard title="Billing address" address={v.useShipAsBilling ? v.shipping : v.billing} />
        </div>
        <section aria-label="Recent purchase orders">
          <h4 className="mb-2 text-[12px] font-semibold text-foreground">Recent purchase orders</h4>
          {pos.isPending ? <Skeleton className="h-20 w-full" /> : recent.length === 0 ? (
            <p className="text-[13px] text-faint">No purchase orders for this vendor yet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-faint"><th className="py-1 font-semibold">PO</th><th className="py-1 font-semibold">Status</th><th className="py-1 font-semibold">PO date</th><th className="py-1 text-right font-semibold">Quantity</th></tr></thead>
              <tbody className="divide-y divide-border">
                {recent.map((po) => (
                  <tr key={po.id}>
                    <td className="py-1.5"><Link href={`/receiving/${po.id}`} className="font-medium text-primary hover:underline">{po.code}</Link></td>
                    <td className="py-1.5"><StatusPill status={po.status} domain="purchaseOrder" size="sm" /></td>
                    <td className="py-1.5">{po.poDate ? formatDate(po.poDate) : dash}</td>
                    <td className="py-1.5 text-right tabular-nums">{po.totalQuantity.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={45}
      title={<span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" aria-hidden />Vendor details</span>}
      description={v?.displayName}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          {onEdit && v ? <Button variant="primary" onClick={() => onEdit(v.id)}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button> : null}
        </>
      }
    >
      {body}
    </Drawer>
  );
}
